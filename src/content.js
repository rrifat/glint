import { adapterFor } from './adapters.js';
import { createAnchor, resolveAnchor } from './anchors.js';
import { COLORS, keyFor, readConversation } from './storage.js';
let adapter = adapterFor(); let conversation = adapter.identity();
let annotations = []; let byMessage = new Map(); const ranges = new Map();
let selected = null; let generation = 0;
let editingIds = [];
const supported = !!globalThis.CSS?.highlights && typeof Highlight !== 'undefined';
const host = document.createElement('div'); host.dataset.phUi = '';
const shadow = host.attachShadow({ mode: 'closed' });
shadow.innerHTML = `<style>:host{all:initial} .palette{position:fixed;z-index:2147483647;display:flex;gap:6px;padding:7px;background:#20252d;border:1px solid #646b78;border-radius:12px;box-shadow:0 4px 20px #0005}button{width:26px;height:26px;border:2px solid transparent;border-radius:50%;cursor:pointer}button:focus-visible{outline:2px solid white;outline-offset:2px}.status{position:fixed;bottom:20px;left:20px;background:#20252d;color:white;padding:12px;border-radius:8px;font:14px system-ui;z-index:2147483647}[hidden]{display:none!important}</style><div class="palette" role="toolbar" aria-label="Highlight colour" hidden></div><div class="status" role="status" hidden></div>`;
document.documentElement.append(host);
const palette = shadow.querySelector('.palette'); const status = shadow.querySelector('.status');
let statusTimer;
function notify(message) { status.textContent = message; status.hidden = false; clearTimeout(statusTimer); statusTimer = setTimeout(() => status.hidden = true, 3500); }
const swatches = ['#ffe082', '#a7e8b5', '#a9d5ff', '#ffc1df'];
COLORS.forEach((color, i) => { const button = document.createElement('button'); button.style.background = swatches[i]; button.title = `Highlight ${color}`; button.setAttribute('aria-label', button.title); button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', () => void save(color)); palette.append(button); });
const removeButton = document.createElement('button');
removeButton.textContent = '×'; removeButton.title = 'Remove highlight'; removeButton.setAttribute('aria-label', 'Remove highlight');
removeButton.style.cssText = 'background:white;color:#20252d;font-size:20px'; removeButton.hidden = true;
removeButton.addEventListener('mousedown', event => event.preventDefault());
removeButton.addEventListener('click', () => void editHighlights('delete'));
palette.append(removeButton);
function showPalette(rect) {
  removeButton.hidden = !editingIds.length;
  palette.hidden = false;
  palette.style.left = `${Math.max(8, Math.min(innerWidth - 190, rect.left))}px`;
  palette.style.top = `${Math.max(8, Math.min(innerHeight - 52, rect.bottom + 8))}px`;
}
function selectedHighlights(range) {
  return annotations.filter(a => {
    const saved = ranges.get(a.id);
    return saved && range.compareBoundaryPoints(Range.START_TO_END, saved) > 0 && range.compareBoundaryPoints(Range.END_TO_START, saved) < 0;
  }).map(a => a.id);
}
async function editHighlights(type, color) {
  try {
    for (const id of editingIds) {
      const result = await browser.runtime.sendMessage({ type, conversation, id, color });
      if (!result?.ok) throw new Error('Could not save the change. Reload the extension and page.');
    }
    editingIds = []; selected = null; palette.hidden = true; getSelection()?.removeAllRanges();
    await reload(); notify(type === 'delete' ? 'Highlight removed' : 'Colour updated');
  } catch (error) { notify(error.message); }
}
function capture() {
  editingIds = [];
  const selection = getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) { palette.hidden = true; selected = null; return; }
  const range = selection.getRangeAt(0);
  const element = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  if (element?.closest('input,textarea,[contenteditable]:not([contenteditable="false"])') || host.contains(element)) return;
  selected = range.cloneRange();
  editingIds = selectedHighlights(range);
  showPalette(range.getBoundingClientRect());
}
document.addEventListener('mouseup', event => {
  if (event.composedPath().includes(host)) return;
  capture();
  if (!getSelection()?.isCollapsed) return;
  // Hit-test range rectangles without inserting wrappers into the page.
  editingIds = annotations.filter(a => {
    const range = ranges.get(a.id);
    return range && [...range.getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
  }).map(a => a.id);
  if (editingIds.length) showPalette({ left: event.clientX, bottom: event.clientY });
});
function dismissPalette() { palette.hidden = true; selected = null; editingIds = []; }
document.addEventListener('keyup', event => { if (event.key === 'Escape') dismissPalette(); else if (event.shiftKey) capture(); });
document.addEventListener('scroll', dismissPalette, true);
addEventListener('blur', dismissPalette);
async function save(color = 'yellow') {
  if (adapter.identity() !== conversation) { dismissPalette(); await reload(); }
  if (editingIds.length) return editHighlights('update', color);
  try {
    if (adapter.identity() !== conversation) await reload();
    if (!supported) throw new Error('Highlights require Firefox 140 or later.');
    const selection = getSelection();
    const range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : selected;
    if (!range || !range.startContainer.isConnected) throw new Error('Select some text first.');
    let root = adapter.root(range.startContainer);
    if (!root.contains(range.endContainer)) root = document.body;
    const anchor = createAnchor(root, range);
    if (!anchor.exact.trim()) return;
    const annotation = { id: crypto.randomUUID(), conversation, provider: adapter.name, messageId: adapter.messageId(root), scope: root === document.body ? 'page' : 'message', anchor, color, note: '', url: location.href, title: document.title, createdAt: Date.now() };
    const result = await browser.runtime.sendMessage({ type: 'save', conversation, annotation });
    if (!result?.ok) throw new Error('Could not save the highlight. Reload the extension and page.');
    await reload();
    palette.hidden = true; selected = null; selection?.removeAllRanges(); notify('Highlight saved');
  } catch (error) { notify(error.message); }
}
function register() {
  if (!supported) return;
  for (const color of COLORS) CSS.highlights.set(`ph-${color}`, new Highlight(...annotations.filter(a => a.color === color).map(a => ranges.get(a.id)).filter(r => r?.startContainer.isConnected && r?.endContainer.isConnected)));
}
function restore(root) {
  const id = adapter.messageId(root);
  const candidates = root === document.body ? annotations.filter(a => a.scope === 'page') : [...(byMessage.get(id) || [])];
  for (const a of candidates) {
    if (a.scope === 'page' && root !== document.body) continue;
    const range = resolveAnchor(root, a.anchor);
    if (range) ranges.set(a.id, range);
    else if (ranges.get(a.id)?.startContainer && root.contains(ranges.get(a.id).startContainer)) ranges.delete(a.id);
  }
}
async function reload() {
  const token = ++generation;
  const next = adapterFor(); const identity = next.identity();
  const rows = await readConversation(identity);
  if (token !== generation) return;
  adapter = next; conversation = identity; annotations = rows; byMessage = new Map(); ranges.clear();
  for (const a of rows) { const group = byMessage.get(a.messageId) || []; group.push(a); byMessage.set(a.messageId, group); }
  for (const root of new Set([document.body, ...adapter.roots()])) restore(root);
  register();
}
const dirty = new Set(); let timer;
const observer = new MutationObserver(records => {
  for (const record of records) {
    if (record.target === host || host.contains(record.target)) continue;
    dirty.add(adapter.root(record.target));
    for (const node of record.addedNodes) if (node.nodeType === 1) {
      dirty.add(adapter.root(node));
      if (adapter.selector) node.querySelectorAll(adapter.selector).forEach(root => dirty.add(root));
    }
  }
  if (!dirty.size) return;
  clearTimeout(timer); timer = setTimeout(() => {
    if (adapter.identity() !== conversation) { dirty.clear(); void reload(); return; }
    for (const [id, range] of ranges) if (!range.startContainer.isConnected || !range.endContainer.isConnected) ranges.delete(id);
    for (const root of dirty) if (root.isConnected) restore(root);
    // Page-scoped selections can span several provider messages.
    if (annotations.some(a => a.scope === 'page')) restore(document.body);
    dirty.clear(); register();
  }, 150);
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-message-id', 'id'] });
browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[keyFor(conversation)]) void reload(); });
browser.runtime.onMessage.addListener(msg => {
  if (msg.type === 'highlight') { void save(); return Promise.resolve({ ok: true }); }
  if (msg.type === 'navigate') { dismissPalette(); return reload(); }
  if (msg.type === 'context') return Promise.resolve({ conversation, title: document.title, supported });
  if (msg.type === 'scroll') return (async () => {
    await reload(); const range = ranges.get(msg.id);
    if (!range) return { ok: false, reason: 'Passage is not loaded or its text has changed. Load the message and try again.' };
    range.startContainer.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { ok: true };
  })();
});
addEventListener('popstate', () => void reload());
void reload().catch(error => notify(error.message));
