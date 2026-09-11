import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { isColor, textColor } from "../src/colors.js";
const bundle = async (path) =>
  (
    await build({
      entryPoints: [path],
      bundle: true,
      write: false,
      format: "iife",
    })
  ).outputFiles[0].text;
const background = await bundle("src/background.js");
const sidebar = await bundle("src/sidebar.js");
const annotation = (id, conversation, title = "A conversation") => ({
  id,
  conversation,
  url: conversation,
  title,
  createdAt: Number(id) || 1,
  color: "yellow",
  note: "",
  anchor: { exact: `Passage ${id}` },
});
const event = () => ({ addListener() {} });
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

test("custom colours are validated and their text remains legible", () => {
  for (const color of ["purple", "teal", "#aBcD12", "#000000"])
    assert.ok(isColor(color));
  for (const color of [
    "red",
    "#fff",
    "#ffffff;}body{display:none}",
    null,
    "constructor",
  ])
    assert.equal(isColor(color), false);
  assert.equal(textColor("#000000"), "#ffffff");
  assert.equal(textColor("#ffffff"), "#181c24");
});

test("on-demand library migration preserves records and tracks custom-colour writes and deletions", async () => {
  const dom = new JSDOM("", { runScripts: "outside-only" });
  const data = {
    "annotations:https://example.com/a": [
      annotation("1", "https://example.com/a"),
    ],
  };
  let listener,
    scans = 0;
  dom.window.browser = {
    storage: {
      local: {
        get: async (key) => {
          if (key === null) {
            scans++;
            return structuredClone(data);
          }
          return { [key]: structuredClone(data[key]) };
        },
        set: async (changes) => Object.assign(data, structuredClone(changes)),
      },
    },
    runtime: {
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
  try {
    dom.window.eval(background);
    const original = structuredClone(data["annotations:https://example.com/a"]);
    assert.equal((await listener({ type: "library" })).summaries[0].count, 1);
    assert.deepEqual(data["annotations:https://example.com/a"], original);
    await listener({ type: "library" });
    assert.equal(scans, 1);
    await listener({
      type: "update",
      conversation: "https://example.com/a",
      id: "1",
      color: "#123456",
    });
    assert.equal(data["annotations:https://example.com/a"][0].color, "#123456");
    await assert.rejects(
      listener({
        type: "update",
        conversation: "https://example.com/a",
        id: "1",
        color: "bad",
      }),
      /Invalid colour/,
    );
    await listener({
      type: "delete",
      conversation: "https://example.com/a",
      id: "1",
    });
    assert.equal((await listener({ type: "library" })).summaries.length, 0);
  } finally {
    dom.window.close();
  }
});

test("sidebar loads groups on demand, bounds cards, and preserves focused note drafts through refresh", async () => {
  const dom = new JSDOM('<div id="app"></div>', {
    url: "https://extension.local/sidebar.html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const current = "https://chatgpt.com/c/current";
  const other = "https://chatgpt.com/c/other";
  const rows = Array.from({ length: 30 }, (_, i) =>
    annotation(String(i + 1), current),
  );
  const reads = [];
  let storageListener;
  let libraryReads = 0;
  const data = {
    [`annotations:${current}`]: rows,
    [`annotations:${other}`]: [
      annotation("99", other, "<script>Unsafe title</script>"),
    ],
  };
  w.browser = {
    tabs: {
      query: async () => [{ id: 1, url: current }],
      sendMessage: async () => ({
        conversation: current,
        title: "Current title",
      }),
      onActivated: event(),
      onUpdated: event(),
    },
    storage: {
      local: {
        get: async (key) => {
          reads.push(key);
          return { [key]: structuredClone(data[key]) };
        },
      },
      onChanged: {
        addListener(fn) {
          storageListener = fn;
        },
      },
    },
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === "load") {
          const key = `annotations:${msg.conversation}`;
          reads.push(key);
          return { ok: true, rows: structuredClone(data[key] || []) };
        }
        if (msg.type === "library") {
          libraryReads++;
          return {
            ok: true,
            summaries: [
              {
                conversation: other,
                title: "<script>Unsafe title</script>",
                url: other,
                count: 1,
                updatedAt: 2,
              },
            ],
          };
        }
        const item = data[`annotations:${msg.conversation}`].find(
          (a) => a.id === msg.id,
        );
        if (msg.note !== undefined) item.note = msg.note;
        return { ok: true };
      },
    },
  };
  try {
    w.eval(sidebar);
    await settle();
    assert.equal(libraryReads, 0);
    assert.deepEqual(reads, [`annotations:${current}`]);
    assert.equal(w.document.querySelectorAll("article").length, 25);
    assert.equal(w.document.querySelectorAll("textarea").length, 0);
    const editor = w.document.querySelector(".editor");
    editor.open = true;
    await settle();
    const note = editor.querySelector("textarea");
    note.focus();
    note.value = "Unfinished thought";
    note.setSelectionRange(4, 4);
    note.dispatchEvent(new w.Event("input"));
    storageListener({ [`annotations:${current}`]: {} }, "local");
    await settle();
    await settle();
    assert.equal(w.document.activeElement, note);
    assert.equal(note.value, "Unfinished thought");
    assert.equal(note.selectionStart, 4);
    editor.querySelector(".save-note").click();
    await settle();
    assert.equal(rows[29].note, "Unfinished thought");
    w.document.querySelector(".library").open = true;
    await settle();
    assert.equal(
      w.document.querySelector(".site-label strong").textContent,
      "chatgpt.com",
    );
    assert.ok(!reads.includes(`annotations:${other}`));
    w.document.querySelector(".website").open = true;
    await settle();
    w.document.querySelector(".conversation").open = true;
    await settle();
    assert.ok(reads.includes(`annotations:${other}`));
    assert.equal(w.document.querySelectorAll("article").length, 26);
    assert.equal(
      w.document.querySelector(".conversation-title").textContent,
      "<script>Unsafe title</script>",
    );
    assert.equal(w.document.querySelectorAll("script").length, 0);
    w.document.querySelector(".conversation").open = false;
    await settle();
    assert.equal(w.document.querySelectorAll("article").length, 25);
  } finally {
    w.close();
  }
});
