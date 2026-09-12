import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createPdfLayerTracker } from "../src/pdf-layers.js";

test("PDF blend tracking is canvas scoped and releases removed or inactive layers", () => {
  const dom = new JSDOM(
    '<body><p>ordinary</p><div><canvas></canvas><div class="textLayer"><span>PDF text</span></div></div><div class="textLayer">unrelated</div></body>',
  );
  const document = dom.window.document;
  const update = createPdfLayerTracker();
  const range = document.createRange();
  const layer = document.querySelector(".textLayer");
  range.selectNodeContents(layer.firstChild);
  update([range]);
  assert.equal(layer.hasAttribute("data-glint-pdf-highlight"), true);
  range.selectNodeContents(document.querySelector("p"));
  update([range]);
  assert.equal(layer.hasAttribute("data-glint-pdf-highlight"), false);
  range.selectNodeContents(document.querySelectorAll(".textLayer")[1]);
  update([range]);
  assert.equal(document.querySelector("[data-glint-pdf-highlight]"), null);
  range.selectNodeContents(layer.firstChild);
  update([range]);
  layer.remove();
  update([range]);
  assert.equal(layer.hasAttribute("data-glint-pdf-highlight"), false);
  update([]);
  dom.window.close();
});
