import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAnchor, resolveAnchor, locate } from '../src/anchors.js';
test('restores across DOM replacement and inserted text', () => {
  const { document } = new JSDOM('<main>Hello <b>lovely</b> world.</main>').window;
  const root = document.querySelector('main'); const range = document.createRange();
  range.setStart(root.firstChild, 3); range.setEnd(root.lastChild, 6);
  const anchor = createAnchor(root, range);
  assert.equal(anchor.exact, 'lo lovely world');
  root.innerHTML = '<p>New introduction. Hello <em>lovely world</em>.</p>';
  assert.equal(resolveAnchor(root, anchor).toString(), anchor.exact);
});
test('uses context to distinguish repeated quotes', () => {
  const text = 'First repeat. Second repeat. Third repeat.';
  const anchor = { exact: 'repeat', prefix: 'Second ', suffix: '. Third', start: 0 };
  assert.equal(locate(text, anchor).start, 21);
});
test('does not invent a match when text is missing', () => { assert.equal(locate('Changed text', { exact: 'original', prefix: '', suffix: '', start: 0 }), null); });
test('ignores script and editable text in anchors', () => {
  const { document } = new JSDOM('<main>Start<script>secret</script><b>end</b><textarea>draft</textarea></main>').window;
  const root = document.querySelector('main'); const range = document.createRange(); range.selectNodeContents(root);
  const anchor = createAnchor(root, range); assert.equal(anchor.exact, 'Startend'); assert.equal(resolveAnchor(root, anchor).endContainer.data, 'end');
});
