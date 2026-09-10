import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const code = (await build({ entryPoints: ['src/content.js'], bundle: true, write: false, format: 'iife' })).outputFiles[0].text;

test('select, recolour and remove on the page without creating duplicates', async () => {
  const dom = new JSDOM('<body><p>Hello world</p></body>', { url: 'https://example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const rows = []; const messages = [];
  const observers = [];
  const Observer = w.MutationObserver;
  w.MutationObserver = class extends Observer { constructor(callback) { super(callback); observers.push(this); } };
  let ui;
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function(options) { ui = attach.call(this, options); return ui; };
  w.CSS = { highlights: new Map() }; w.Highlight = class extends Set { constructor(...ranges) { super(ranges); } };
  w.Range.prototype.getBoundingClientRect = () => ({ left: 10, bottom: 30 });
  w.Range.prototype.getClientRects = () => [{ left: 10, right: 100, top: 10, bottom: 30 }];
  w.browser = {
    storage: { local: { get: async key => ({ [key]: structuredClone(rows) }) }, onChanged: { addListener() {} } },
    runtime: { onMessage: { addListener() {} }, sendMessage: async msg => {
      messages.push(msg);
      if (msg.type === 'save') rows.push(structuredClone(msg.annotation));
      if (msg.type === 'update') rows.find(a => a.id === msg.id).color = msg.color;
      if (msg.type === 'delete') rows.splice(rows.findIndex(a => a.id === msg.id), 1);
      return { ok: true };
    } },
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 10));
  try {
    w.eval(code); await settle();
    const select = () => {
      const range = w.document.createRange(); range.selectNodeContents(w.document.querySelector('p'));
      w.getSelection().removeAllRanges(); w.getSelection().addRange(range);
      w.document.querySelector('p').dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true }));
    };
    select(); ui.querySelector('[aria-label="Highlight yellow"]').click(); await settle();
    assert.equal(rows.length, 1); assert.equal(w.CSS.highlights.get('ph-yellow').size, 1);
    select(); ui.querySelector('[aria-label="Highlight blue"]').click(); await settle();
    assert.equal(rows.length, 1); assert.equal(rows[0].color, 'blue');
    assert.equal(w.CSS.highlights.get('ph-yellow').size, 0); assert.equal(w.CSS.highlights.get('ph-blue').size, 1);
    // A click on an existing highlight exposes removal, even with no selection.
    w.document.querySelector('p').dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true, clientX: 20, clientY: 20 }));
    const remove = ui.querySelector('[aria-label="Remove highlight"]'); assert.equal(remove.hidden, false);
    remove.click(); await settle();
    assert.equal(rows.length, 0); assert.equal(w.CSS.highlights.get('ph-blue').size, 0);
    assert.deepEqual(messages.map(m => m.type), ['save', 'update', 'delete']);
  } finally { observers.forEach(observer => observer.disconnect()); w.close(); }
});
