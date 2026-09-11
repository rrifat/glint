import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { recoveryMatch, recoveryCopies } from "../src/recovery.js";
import { createBackup, validateBackup } from "../src/transfer.js";

const source = "web:https://old-provider.example/old";
const sourceRow = (id, exact, patch = {}) => ({
  id,
  conversation: source,
  provider: "web",
  messageId: "old-message",
  scope: "message",
  url: "https://old-provider.example/old",
  title: "Saved conversation",
  note: "Keep this note",
  color: "#123456",
  createdAt: 1,
  anchor: { exact, prefix: "", suffix: "", start: 0, end: exact.length },
  ...patch,
});
const fixtureRows = () => [
  sourceRow("one", "Unique passage"),
  sourceRow("two", "Repeat"),
  sourceRow("three", "Later passage"),
];
const bundle = async (path) =>
  (
    await build({
      entryPoints: [path],
      bundle: true,
      write: false,
      format: "iife",
    })
  ).outputFiles[0].text;
const backgroundCode = await bundle("src/background.js");
const contentCode = await bundle("src/content.js");
const sidebarCode = await bundle("src/sidebar.js");
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

test("recovery never uses old offsets to choose between repeated passages", () => {
  assert.deepEqual(
    recoveryMatch("Repeat Repeat", {
      exact: "Repeat",
      prefix: "",
      suffix: "",
      start: 0,
    }),
    { status: "ambiguous" },
  );
  assert.equal(
    recoveryMatch("First Repeat Last Repeat", {
      exact: "Repeat",
      prefix: "Last ",
      suffix: "",
      start: 6,
    }).start,
    18,
  );
  assert.equal(
    recoveryMatch("Unique passage", { exact: "Unique passage" }).status,
    "matched",
  );
  assert.equal(
    recoveryMatch("Unique passage", { exact: "Edited passage" }).status,
    "missing",
  );
});

test("linked copies preserve originals and backup provenance, skip repeats, and keep local edits", () => {
  const original = fixtureRows();
  const saved = structuredClone(original);
  const target = {
    conversation: "web:https://new.example/",
    provider: "web",
    title: "Destination",
    url: "https://new.example/",
  };
  let id = 0;
  const copies = recoveryCopies(original, [], target, () => `copy-${++id}`);
  assert.deepEqual(original, saved);
  assert.equal(copies.added, 3);
  assert.equal(copies.rows[0].messageId, null);
  assert.equal(copies.rows[0].scope, "page");
  assert.equal(copies.rows[0].originalUrl, saved[0].url);
  assert.deepEqual(copies.rows[0].anchor, saved[0].anchor);
  copies.rows[0].note = "Destination edit";
  const again = recoveryCopies(original, copies.rows, target);
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 3);
  assert.equal(again.rows[0].note, "Destination edit");
  const exported = validateBackup(
    createBackup({ [`annotations:${target.conversation}`]: copies.rows }),
  );
  assert.deepEqual(exported, copies.rows);
  assert.throws(
    () =>
      validateBackup(
        createBackup({
          a: [],
          "annotations:x": [{ ...copies.rows[0], recovery: { id: "x" } }],
        }),
      ),
    /invalid/,
  );
});

async function harness(url = "https://new-provider.example/new") {
  const bg = new JSDOM("", { runScripts: "outside-only" });
  const page = new JSDOM(
    "<p>Unique <b>passage</b></p><p>Repeat Repeat</p><textarea>Later passage</textarea>",
    { url, runScripts: "outside-only", pretendToBeVisual: true },
  );
  const data = {
    "identity-schema-version": 1,
    [`annotations:${source}`]: fixtureRows(),
    "highlight-library-v1": [
      {
        conversation: source,
        title: "Saved conversation",
        url: "https://old-provider.example/old",
        count: 3,
        updatedAt: 1,
      },
    ],
  };
  const callbacks = [];
  let background,
    content,
    failWrite = false,
    writes = 0;
  const event = () => ({ addListener() {} });
  const storage = {
    local: {
      get: async (key) =>
        key === null
          ? structuredClone(data)
          : { [key]: structuredClone(data[key]) },
      set: async (changes) => {
        if (failWrite) throw new Error("Disk full");
        writes++;
        Object.assign(data, structuredClone(changes));
      },
    },
    onChanged: event(),
  };
  const tabs = {
    get: async () => ({
      id: 1,
      url: page.window.location.href,
      title: "Destination",
    }),
    sendMessage: async (id, msg) => content(msg),
    query: async () => [
      { id: 1, windowId: 10, url: page.window.location.href },
    ],
    onActivated: event(),
    onUpdated: event(),
  };
  bg.window.TextEncoder = TextEncoder;
  Object.defineProperty(bg.window, "crypto", { value: webcrypto });
  bg.window.browser = {
    storage,
    tabs,
    runtime: {
      getURL: (path) => `moz-extension://glint/${path}`,
      onMessage: {
        addListener(fn) {
          background = fn;
        },
      },
      onInstalled: event(),
    },
    commands: { onCommand: event() },
    contextMenus: { onClicked: event() },
    webNavigation: { onHistoryStateUpdated: event() },
  };
  bg.window.eval(backgroundCode);
  page.window.browser = {
    storage,
    runtime: {
      onMessage: {
        addListener(fn) {
          content = fn;
        },
      },
      sendMessage: async (msg) =>
        background(msg, { url: page.window.location.href }),
    },
  };
  page.window.CSS = { highlights: new Map() };
  page.window.Highlight = class extends Set {
    constructor(...ranges) {
      super(ranges);
    }
  };
  const Observer = page.window.MutationObserver;
  page.window.MutationObserver = class extends Observer {
    constructor(callback) {
      super(callback);
      callbacks.push(this);
    }
  };
  page.window.eval(contentCode);
  await settle();
  return {
    bg,
    page,
    data,
    tabs,
    storage,
    get writes() {
      return writes;
    },
    fail() {
      failWrite = true;
    },
    send: (msg, sender = { url: "moz-extension://glint/sidebar.html?popup" }) =>
      background(msg, sender),
    context: () => content({ type: "context" }),
    content: (msg) => content(msg),
    close() {
      callbacks.forEach((observer) => observer.disconnect());
      page.window.close();
      bg.window.close();
    },
  };
}

test("preview writes nothing; confirmation copies all statuses and strict restoration survives DOM changes", async () => {
  const h = await harness();
  try {
    const original = structuredClone(h.data[`annotations:${source}`]);
    const target = {
      tabId: 1,
      url: h.page.window.location.href,
      conversation: (await h.context()).conversation,
    };
    const preview = await h.send({ type: "recovery-preview", target, source });
    assert.equal(h.writes, 0);
    assert.deepEqual(
      Array.from(preview.passages, (row) => row.status),
      ["matched", "ambiguous", "missing"],
    );
    const message = {
      type: "recovery-confirm",
      target,
      source,
      stamp: preview.stamp,
    };
    assert.equal((await h.send(message)).added, 3);
    assert.deepEqual(h.data[`annotations:${source}`], original);
    assert.equal((await h.send(message)).skipped, 3);
    await h.content({ type: "navigate" });
    let states = Object.values((await h.context()).recoveryStatuses);
    assert.deepEqual(states, ["matched", "ambiguous", "missing"]);
    const active = [...h.page.window.CSS.highlights.values()].flatMap((set) => [
      ...set,
    ]);
    assert.equal(active.length, 1);
    assert.equal(active[0].toString(), "Unique passage");
    h.page.window.document.querySelector("p").textContent =
      "Unique passage Unique passage";
    const later = h.page.window.document.createElement("p");
    later.textContent = "Later passage";
    h.page.window.document.body.append(later);
    await h.content({ type: "navigate" });
    states = Object.values((await h.context()).recoveryStatuses);
    assert.deepEqual(states, ["ambiguous", "ambiguous", "matched"]);
  } finally {
    h.close();
  }
});

test("recovery rejects changed source, changed text, navigation, foreign callers and storage failures", async () => {
  const h = await harness("https://claude.ai/chat/destination-id");
  try {
    const target = {
      tabId: 1,
      url: h.page.window.location.href,
      conversation: (await h.context()).conversation,
    };
    const preview = await h.send({ type: "recovery-preview", target, source });
    const message = {
      type: "recovery-confirm",
      target,
      source,
      stamp: preview.stamp,
    };
    await assert.rejects(
      h.send(message, { url: "https://example.com" }),
      /popup or sidebar/,
    );
    h.data[`annotations:${source}`][0].note = "Changed";
    await assert.rejects(h.send(message), /changed/);
    h.data[`annotations:${source}`][0].note = "Keep this note";
    h.page.window.document.querySelector("p").textContent = "Changed text";
    await assert.rejects(h.send(message), /changed/);
    h.page.window.document.querySelector("p").textContent = "Unique passage";
    h.page.window.history.pushState({}, "", "/chat/other-id");
    await assert.rejects(h.send(message), /changed/);
    h.page.window.history.pushState({}, "", "/chat/destination-id");
    h.fail();
    await assert.rejects(h.send(message), /Disk full/);
    assert.equal(h.data[`annotations:${target.conversation}`], undefined);
  } finally {
    h.close();
  }
});

test("sidebar recovery requires preview and explicit confirmation, renders source text safely", async () => {
  const h = await harness();
  const ui = new JSDOM('<div id="app"></div>', {
    url: "https://extension.local/sidebar.html",
    runScripts: "outside-only",
  });
  try {
    h.data[`annotations:${source}`][0].anchor.exact =
      "<img src=x onerror=alert(1)>";
    ui.window.browser = {
      tabs: h.tabs,
      storage: h.storage,
      runtime: { sendMessage: h.send },
    };
    ui.window.eval(sidebarCode);
    await settle();
    const details = ui.window.document.querySelector(".recovery");
    details.open = true;
    await settle();
    const select = details.querySelector("select");
    select.value = source;
    select.dispatchEvent(new ui.window.Event("change"));
    const buttons = details.querySelectorAll("button");
    assert.equal(buttons[2].disabled, true);
    buttons[0].click();
    await settle();
    assert.equal(h.writes, 0);
    assert.equal(details.querySelectorAll("img").length, 0);
    assert.equal(buttons[2].disabled, false);
    buttons[2].click();
    await settle();
    await settle();
    assert.equal(h.writes, 1);
    assert.match(details.textContent, /Linked 3 highlights/);
  } finally {
    ui.window.close();
    h.close();
  }
});
