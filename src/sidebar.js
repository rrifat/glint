import { COLORS } from './storage.js';

const app = document.getElementById('app');
const isPopup = location.search === '?popup';
if (isPopup) document.body.style.width = '360px';
let state = { rows: [], conversation: '', title: 'Your highlights', error: '', tabId: null };
let refreshVersion = 0;
let refreshTimer;

function element(tag, { className, text, attrs = {}, on } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (on) for (const [event, handler] of Object.entries(on)) node.addEventListener(event, handler);
  return node;
}

function card(annotation, current) {
  const article = element('article'); article.style.setProperty('--accent', `var(--${annotation.color})`);
  article.append(element('button', { className: 'quote', text: annotation.anchor.exact, attrs: { type: 'button', title: 'Go to passage' }, on: { click: () => void jump(annotation) } }));
  if (!current) article.append(element('p', { className: 'source', text: annotation.title || annotation.url }));
  const controls = element('div', { className: 'actions' }); const colourLabel = element('label', { text: 'Colour ' });
  const select = element('select', { attrs: { 'aria-label': 'Highlight colour' } });
  for (const colour of COLORS) select.append(element('option', { text: colour, attrs: { value: colour, ...(colour === annotation.color ? { selected: '' } : {}) } }));
  select.addEventListener('change', event => void change(annotation, { color: event.currentTarget.value }));
  colourLabel.append(select); controls.append(colourLabel);
  controls.append(element('button', { className: 'delete', text: 'Delete', attrs: { type: 'button' }, on: { click: () => void change(annotation, {}, 'delete') } }));
  article.append(controls);
  const noteLabel = element('label', { className: 'note', text: 'Note' });
  const note = element('textarea', { attrs: { 'aria-label': 'Highlight note', placeholder: 'Add a thought…' } }); note.value = annotation.note || '';
  note.addEventListener('change', event => void change(annotation, { note: event.currentTarget.value })); noteLabel.append(note); article.append(noteLabel);
  return article;
}

function render() {
  const current = state.rows.filter(a => a.conversation === state.conversation);
  const others = state.rows.filter(a => a.conversation !== state.conversation);
  app.replaceChildren();
  const header = element('header'); header.append(element('div', { className: 'eyebrow', text: 'PERSISTENT HIGHLIGHTER' }), element('h1', { text: 'Worth keeping.' }), element('p', { text: 'Select a passage. Pick a colour. Come back to it.' }));
  header.append(element('button', { text: isPopup ? 'Open sidebar' : 'Close sidebar', on: { click: () => {
    const action = isPopup ? browser.sidebarAction.open() : browser.sidebarAction.close();
    action.then(() => { if (isPopup) window.close(); }).catch(error => { state.error = error.message; render(); });
  } } }));
  const shortcut = element('kbd', { text: 'Alt + Shift + H' }); header.append(shortcut, document.createTextNode(' '), element('span', { className: 'shortcut', text: 'quick highlight' })); app.append(header);
  const content = element('section', { className: 'content' });
  if (state.error) content.append(element('p', { className: 'notice', text: state.error, attrs: { role: 'status' } }));
  const heading = element('h2', { text: 'This conversation ' }); heading.append(element('span', { text: String(current.length) })); content.append(heading, element('p', { className: 'page-title', text: state.title }));
  if (!current.length) { const empty = element('div', { className: 'empty', text: 'Your next good find belongs here.' }); empty.append(element('small', { text: 'Select text on the page to save your first highlight.' })); content.append(empty); }
  for (const annotation of current) content.append(card(annotation, true));
  if (others.length) { const otherHeading = element('h2', { className: 'other', text: 'Other pages ' }); otherHeading.append(element('span', { text: String(others.length) })); content.append(otherHeading); for (const annotation of others) content.append(card(annotation, false)); }
  app.append(content);
}

async function refresh() {
  const version = ++refreshVersion;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const context = tab?.id ? await browser.tabs.sendMessage(tab.id, { type: 'context' }).catch(() => null) : null;
    const data = await browser.storage.local.get(null);
    if (version !== refreshVersion) return;
    state = { rows: Object.entries(data).filter(([key]) => key.startsWith('annotations:')).flatMap(([, value]) => value).sort((a, b) => b.createdAt - a.createdAt), conversation: context?.conversation || '', title: context?.title || 'Your highlights', tabId: tab?.id ?? null, error: context ? '' : 'Open a web page to highlight text. Firefox internal and protected pages are unavailable.' };
  } catch (error) { state = { ...state, error: error.message }; }
  render();
}

function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refresh(), 50); }
async function change(annotation, patch, type = 'update') { try { const result = await browser.runtime.sendMessage({ type, conversation: annotation.conversation, id: annotation.id, ...patch }); if (!result?.ok) throw new Error('Could not save the change. Reload the extension and page.'); await refresh(); } catch (error) { state = { ...state, error: error.message }; render(); } }
async function jump(annotation) {
  try {
    if (annotation.conversation !== state.conversation) { await browser.tabs.create({ url: annotation.url }); return; }
    const result = await browser.tabs.sendMessage(state.tabId, { type: 'scroll', id: annotation.id }); if (!result.ok) { state = { ...state, error: result.reason }; render(); }
  } catch { state = { ...state, error: 'Reload the page and try again.' }; render(); }
}

browser.tabs.onActivated.addListener(scheduleRefresh);
browser.tabs.onUpdated.addListener((tabId, changeInfo) => { if (tabId === state.tabId && (changeInfo.status || changeInfo.url)) scheduleRefresh(); });
browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && Object.keys(changes).some(key => key.startsWith('annotations:'))) scheduleRefresh(); });
void refresh();
