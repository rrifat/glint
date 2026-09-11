import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import {
  createBackup,
  validateBackup,
  importChanges,
  readableExport,
} from "../src/transfer.js";
import { keyFor, LIBRARY_KEY } from "../src/storage.js";
import { createAnchor, resolveAnchor } from "../src/anchors.js";

const conversation = "web:https://example.com/";
const annotation = (id = "a") => ({
  id,
  conversation,
  provider: "web",
  messageId: null,
  scope: "page",
  url: "https://example.com/",
  title: "Reading <script>alert(1)</script>",
  color: "#123456",
  note: "A note\nwith **literal** text",
  createdAt: 1,
  anchor: { exact: "Hello world", prefix: "", suffix: "", start: 0, end: 11 },
});

test("backup round trip preserves anchors, custom colour, notes and identity, and restores in another document", async () => {
  const first = new JSDOM("<p>Before. Hello world After.</p>");
  const second = new JSDOM(
    "<p>Inserted text. Before. <b>Hello</b> world After.</p>",
  );
  try {
    const range = first.window.document.createRange();
    const node = first.window.document.querySelector("p").firstChild;
    range.setStart(node, 8);
    range.setEnd(node, 19);
    const row = {
      ...annotation(),
      anchor: createAnchor(first.window.document.body, range),
    };
    const backup = JSON.parse(
      JSON.stringify(
        createBackup({ [keyFor(conversation)]: [row], irrelevant: "excluded" }),
      ),
    );
    const merge = await importChanges(backup, async () => ({}));
    assert.equal(merge.added, 1);
    assert.deepEqual(merge.changes[keyFor(conversation)][0], row);
    assert.equal(merge.changes[LIBRARY_KEY][0].count, 1);
    assert.equal(
      resolveAnchor(
        second.window.document.body,
        merge.changes[keyFor(conversation)][0].anchor,
      ).toString(),
      "Hello world",
    );
  } finally {
    first.window.close();
    second.window.close();
  }
});

test("repeated imports skip existing IDs and preserve local notes; distinct conversations and new IDs merge", async () => {
  const row = annotation();
  const local = { ...row, note: "Newer local note", color: "blue" };
  const other = {
    ...row,
    conversation: "web:https://example.com/other",
    url: "https://example.com/other",
  };
  const data = { [keyFor(conversation)]: [local] };
  const backup = createBackup({
    [keyFor(conversation)]: [row, annotation("b"), annotation("b")],
    [keyFor(other.conversation)]: [other],
  });
  const merge = await importChanges(backup, async () => structuredClone(data));
  assert.equal(merge.added, 2);
  assert.equal(merge.skipped, 2);
  assert.deepEqual(merge.changes[keyFor(conversation)][0], local);
  assert.equal(data[keyFor(conversation)].length, 1);
  Object.assign(data, merge.changes);
  const repeat = await importChanges(backup, async () => data);
  assert.equal(repeat.added, 0);
  assert.equal(repeat.skipped, 4);
  assert.deepEqual(repeat.changes, {});
});

test("malformed or unsafe imports are rejected before reading storage", async () => {
  for (const patch of [
    { url: "javascript:alert(1)" },
    { scope: "xpath" },
    { color: "#123;}" },
    { createdAt: 1e30 },
    {
      anchor: {
        exact: "Hello world",
        prefix: "",
        suffix: "",
        start: 0,
        end: 1,
      },
    },
    { note: {} },
  ]) {
    const backup = createBackup({
      [keyFor(conversation)]: [
        annotation(),
        { ...annotation("bad"), ...patch },
      ],
    });
    await assert.rejects(
      importChanges(backup, async () => {
        assert.fail("Invalid backup must not read storage");
      }),
      /invalid/,
    );
  }
  assert.throws(
    () =>
      validateBackup({ format: "glint-backup", version: 2, annotations: [] }),
    /version 1/,
  );
});

test("reading exports include full quotes, notes and sources and escape Markdown markup", () => {
  const backup = createBackup({ [keyFor(conversation)]: [annotation()] });
  const txt = readableExport(backup);
  assert.match(txt, /Hello world/);
  assert.ok(txt.includes(annotation().note));
  assert.ok(txt.includes(annotation().url));
  const md = readableExport(backup, "md");
  assert.ok(md.includes("\\<script\\>"));
  assert.ok(md.includes("\\*\\*literal\\*\\*"));
  assert.ok(!md.includes("<script>"));
});

test("Chromium message channel awaits writes, exports existing records, enforces transfer page, and reports storage errors", async () => {
  const code = (
    await build({
      entryPoints: ["src/background.js"],
      bundle: true,
      write: false,
      format: "iife",
    })
  ).outputFiles[0].text;
  const dom = new JSDOM("", { runScripts: "outside-only" });
  const w = dom.window;
  let listener,
    failWrites = false,
    releaseWrite,
    delayWrites = false;
  const data = { [keyFor(conversation)]: [annotation()] };
  const event = () => ({ addListener() {} });
  const extensionURL = "chrome-extension://glint/transfer.html";
  w.TextEncoder = TextEncoder;
  w.chrome = {
    storage: {
      local: {
        get: async (key) =>
          key === null
            ? structuredClone(data)
            : { [key]: structuredClone(data[key]) },
        set: async (changes) => {
          if (failWrites) throw new Error("Storage quota exceeded");
          if (delayWrites)
            await new Promise((resolve) => {
              releaseWrite = resolve;
            });
          Object.assign(data, structuredClone(changes));
        },
      },
    },
    runtime: {
      getURL: (path) => `chrome-extension://glint/${path}`,
      onMessage: {
        addListener(fn) {
          listener = fn;
        },
      },
      onInstalled: event(),
    },
    commands: { onCommand: event() },
    contextMenus: { onClicked: event() },
    webNavigation: { onHistoryStateUpdated: event() },
  };
  const send = (message, url = extensionURL) =>
    new Promise((resolve) => {
      assert.equal(listener(message, { url }, resolve), true);
    });
  try {
    w.eval(code);
    assert.equal(
      listener({ type: "unrelated" }, {}, () => assert.fail()),
      false,
    );
    const exported = await send({ type: "export" });
    assert.equal(exported.backup.annotations[0].anchor.exact, "Hello world");
    assert.equal(
      (await send({ type: "export" }, "https://example.com")).ok,
      false,
    );
    delayWrites = true;
    let answered = false;
    const pending = send({
      type: "import",
      backup: createBackup({ [keyFor(conversation)]: [annotation("b")] }),
    }).then((result) => {
      answered = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(answered, false);
    assert.equal(data[keyFor(conversation)].length, 1);
    releaseWrite();
    assert.equal((await pending).added, 1);
    delayWrites = false;
    failWrites = true;
    const failed = await send({
      type: "update",
      conversation,
      id: "a",
      note: "Unsaved",
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.error, "Storage quota exceeded");
    assert.equal(data[keyFor(conversation)][0].note, annotation().note);
    failWrites = false;
    assert.equal(
      (await send({ type: "update", conversation, id: "a", note: "Saved" })).ok,
      true,
    );
    assert.equal(data[keyFor(conversation)][0].note, "Saved");
  } finally {
    w.close();
  }
});
