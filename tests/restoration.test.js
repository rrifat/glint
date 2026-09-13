import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { createAnchor } from "../src/anchors.js";

const code = (await build({ entryPoints: ["src/content.js"], bundle: true,
  write: false, format: "iife" })).outputFiles[0].text;

async function fixture(markup) {
  const dom = new JSDOM(`<body>${markup}</body>`, {
    url: "https://gemini.google.com/app/regression", runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window, rows = [], messages = [], observers = [];
  let ui, listener;
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (options) {
    ui = attach.call(this, options); return ui;
  };
  const Observer = w.MutationObserver;
  w.MutationObserver = class extends Observer {
    constructor(callback) { super(callback); observers.push(this); }
  };
  w.CSS = { highlights: new Map() };
  w.Highlight = class extends Set { constructor(...ranges) { super(ranges); } };
  w.Range.prototype.getBoundingClientRect = () => ({ left: 10, bottom: 30 });
  w.Range.prototype.getClientRects = () => [];
  w.browser = {
    storage: { onChanged: { addListener() {} } },
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      sendMessage: async (msg) => {
        messages.push(msg);
        if (msg.type === "load") return { ok: true, rows: structuredClone(rows) };
        if (msg.type === "saved-colors") return { ok: true, colors: [] };
        if (msg.type === "save") rows.push(structuredClone(msg.annotation));
        if (msg.type === "delete") rows.splice(rows.findIndex(a => a.id === msg.id), 1);
        if (msg.type === "update") rows.find(a => a.id === msg.id).color = msg.color;
        return { ok: true };
      },
    },
  };
  const settle = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
  function select(root, quote) {
    const node = root.firstChild, range = w.document.createRange();
    const start = node.data.indexOf(quote);
    range.setStart(node, start); range.setEnd(node, start + quote.length);
    w.getSelection().removeAllRanges(); w.getSelection().addRange(range);
    root.dispatchEvent(new w.MouseEvent("mouseup", { bubbles: true }));
    return range;
  }
  w.eval(code); await settle();
  return { w, rows, messages, ui, select, settle,
    reload: () => listener({ type: "navigate" }),
    painted: (color = "yellow") => [...w.CSS.highlights.get(`ph-${color}`)],
    close() { observers.forEach(o => o.disconnect()); dom.window.close(); },
  };
}

test("Gemini repeated quotes stay in their original messages across writes and replacement", async () => {
  const f = await fixture("<model-response>Original repeated passage.</model-response><model-response>Another repeated passage.</model-response>");
  try {
    const [first, second] = f.w.document.querySelectorAll("model-response");
    f.select(first, "repeated passage"); f.ui.querySelector('[data-color="yellow"]').click();
    await f.settle();
    assert.equal(f.painted()[0].startContainer.parentElement, first);
    f.select(second, "Another"); f.ui.querySelector('[data-color="blue"]').click();
    await f.settle();
    assert.equal(f.rows.length, 2);
    assert.equal(f.painted()[0].startContainer.parentElement, first);
    f.select(second, "Another"); f.ui.querySelector(".remove").click();
    await f.settle();
    assert.equal(f.rows.length, 1);
    first.textContent = "Original repeated passage.";
    await f.settle(190);
    assert.equal(f.painted()[0].startContainer.parentElement, first);
    first.remove(); await f.settle(190);
    assert.equal(f.painted().length, 0, "must not move to the remaining quote");
    f.w.document.body.prepend(first); await f.settle(190);
    assert.equal(f.painted()[0].startContainer.parentElement, first);
  } finally { f.close(); }
});

test("identical ID-less messages stay unresolved regardless of mutation order", async () => {
  const f = await fixture("<model-response>Identical passage.</model-response><model-response>Identical passage.</model-response>");
  try {
    const first = f.w.document.querySelector("model-response");
    f.select(first, "Identical passage"); f.ui.querySelector('[data-color="yellow"]').click();
    await f.settle();
    assert.equal(f.rows.length, 1);
    assert.equal(f.painted().length, 0);
    assert.match(f.ui.querySelector(".status").textContent, /ambiguous/);
    first.textContent = "Identical passage."; await f.settle(190);
    assert.equal(f.painted().length, 0);
    await f.reload(); assert.equal(f.painted().length, 0);
  } finally { f.close(); }
});

test("a replaced selection cannot silently save or recolour a different passage", async () => {
  const f = await fixture("<model-response>First passage and second passage.</model-response>");
  try {
    const root = f.w.document.querySelector("model-response");
    f.select(root, "First passage");
    root.textContent = "Replacement passage.";
    f.ui.querySelector('[data-color="yellow"]').click(); await f.settle();
    assert.equal(f.rows.length, 0);
    assert.match(f.ui.querySelector(".status").textContent, /selection changed/i);
    f.select(root, "Replacement"); f.ui.querySelector('[data-color="yellow"]').click();
    await f.settle(); assert.equal(f.rows.length, 1);
    f.select(root, "Replacement"); root.textContent = "Changed passage.";
    f.ui.querySelector('[data-color="blue"]').click(); await f.settle();
    assert.equal(f.rows[0].color, "yellow");
    assert.match(f.ui.querySelector(".status").textContent, /passage changed/i);
    await f.settle(190); assert.equal(f.painted().length, 0);
  } finally { f.close(); }
});

test("restoration runs while Gemini continues streaming", async () => {
  const f = await fixture("<model-response>Saved passage.</model-response><model-response>Streaming</model-response>");
  let interval;
  try {
    const [first, stream] = f.w.document.querySelectorAll("model-response");
    const range = f.select(first, "Saved passage");
    f.rows.push({ id: "legacy", messageId: null, scope: "message", color: "yellow",
      anchor: createAnchor(first, range) });
    await f.reload();
    first.textContent = "Saved passage.";
    interval = setInterval(() => stream.firstChild.appendData("."), 30);
    await f.settle(240);
    assert.equal(f.painted()[0].toString(), "Saved passage");
    assert.equal(f.painted()[0].startContainer, first.firstChild);
  } finally { clearInterval(interval); f.close(); }
});

test("range validation retains anchors crossing excluded script text", async () => {
  const f = await fixture("<model-response>Start<script>excluded</script>end</model-response>");
  try {
    const root = f.w.document.querySelector("model-response");
    const range = f.w.document.createRange(); range.selectNodeContents(root);
    f.rows.push({ id: "excluded", messageId: null, scope: "message", color: "yellow",
      anchor: createAnchor(root, range) });
    await f.reload();
    assert.equal(f.rows[0].anchor.exact, "Startend");
    assert.equal(f.painted().length, 1);
  } finally { f.close(); }
});
