const excluded = 'script, style, noscript, textarea, input, select, [contenteditable]:not([contenteditable="false"]), [data-ph-ui]';
export function textIndex(root) {
  const nodes = []; let text = '';
  const walker = root.ownerDocument.createTreeWalker(root, 4, { acceptNode(node) { return node.parentElement?.closest(excluded) ? 2 : 1; } });
  while (walker.nextNode()) { const node = walker.currentNode; nodes.push({ node, start: text.length }); text += node.data; }
  return { text, nodes };
}
export function createAnchor(root, range) {
  const index = textIndex(root);
  // Intersect each indexed text node, so excluded DOM text never changes offsets.
  let start = null; let end = null;
  for (const entry of index.nodes) {
    if (!range.intersectsNode(entry.node)) continue;
    const a = range.startContainer === entry.node ? range.startOffset : 0;
    const b = range.endContainer === entry.node ? range.endOffset : entry.node.length;
    if (a === b) continue;
    start ??= entry.start + a; end = entry.start + b;
  }
  if (start === null || end === null) throw new Error('Select readable page text.');
  return { exact: index.text.slice(start, end), prefix: index.text.slice(Math.max(0, start - 64), start), suffix: index.text.slice(end, end + 64), start, end };
}
export function locate(text, anchor) {
  const candidates = []; let pos = text.indexOf(anchor.exact);
  if (!anchor.exact) return null;
  while (pos !== -1) {
    const end = pos + anchor.exact.length;
    let context = 0;
    for (let i = 1; i <= anchor.prefix.length && text[pos - i] === anchor.prefix.at(-i); i++) context++;
    for (let i = 0; i < anchor.suffix.length && text[end + i] === anchor.suffix[i]; i++) context++;
    candidates.push({ start: pos, end, context, distance: Math.abs(pos - anchor.start) });
    pos = text.indexOf(anchor.exact, pos + 1);
  }
  candidates.sort((a, b) => b.context - a.context || a.distance - b.distance);
  if (!candidates.length) return null;
  if (candidates.length > 1 && candidates[0].context === candidates[1].context && candidates[0].distance === candidates[1].distance) return null;
  return candidates[0];
}
export function resolveAnchor(root, anchor) {
  const index = textIndex(root); const match = locate(index.text, anchor);
  if (!match) return null;
  const first = index.nodes.find(e => e.start + e.node.length > match.start);
  const last = index.nodes.find(e => e.start + e.node.length >= match.end);
  if (!first || !last) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(first.node, match.start - first.start); range.setEnd(last.node, match.end - last.start);
  return range;
}
