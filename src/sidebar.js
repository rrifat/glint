import { keyFor, readConversation, LIBRARY_KEY } from './storage.js';
import { element, reconcile, website, makeList } from './sidebar-ui.js';

const app = document.getElementById('app');
const isPopup = location.search === '?popup';
if (isPopup) document.body.classList.add('popup');
let state = { conversation: '', tabId: null };
let refreshVersion = 0, libraryVersion = 0, refreshTimer;
const drafts = new Map();
const handlers = { change, jump, drafts };
const header = element('header');
const top = element('div', { className: 'header-top' });
top.append(element('span', { className: 'eyebrow', text: 'PERSISTENT HIGHLIGHTER' }), element('button', { className: 'panel-button', text: isPopup ? 'Open sidebar' : 'Close sidebar', on: { click: () => {
  const action = isPopup ? browser.sidebarAction.open() : browser.sidebarAction.close();
  action.then(() => { if (isPopup) window.close(); }).catch(showError);
} } }));
header.append(top, element('h1', { text: 'Your highlights' }), element('p', { className: 'intro', text: 'Good finds, easy to find again.' }));
const content = element('main', { className: 'content' });
const notice = element('p', { className: 'notice', attrs: { role: 'status', hidden: '' } });
const current = element('section', { className: 'current' });
const currentHeading = element('h2', { text: 'Current conversation' });
const currentCount = element('span', { className: 'count' }); currentHeading.append(currentCount);
const source = element('p', { className: 'website-name' });
const title = element('p', { className: 'page-title' });
const empty = element('div', { className: 'empty', text: 'Select a passage to keep it here.' });
empty.append(element('small', { text: 'Pick a colour, or press Alt + Shift + H.' }));
let currentList = makeList({ ...handlers, current: true });
current.append(currentHeading, source, title, empty, currentList.node);
const library = element('details', { className: 'library' });
const librarySummary = element('summary', { text: 'Saved websites' });
const libraryBody = element('div'); library.append(librarySummary, libraryBody);
const sites = new Map(); const conversations = new Map();
let summaries = [];
library.addEventListener('toggle', () => {
  if (library.open) void refreshLibrary();
  else { ++libraryVersion; summaries = []; sites.clear(); conversations.clear(); libraryBody.replaceChildren(); }
});
content.append(notice, current, library); app.append(header, content);
function showError(error) { notice.textContent = error.message || String(error); notice.hidden = false; }

async function refresh() {
  const version = ++refreshVersion;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const context = tab?.id != null ? await browser.tabs.sendMessage(tab.id, { type: 'context' }).catch(() => null) : null;
    const rows = context ? await readConversation(context.conversation) : [];
    if (version !== refreshVersion) return;
    if (state.conversation !== context?.conversation) {
      currentList.node.remove(); currentList = makeList({ ...handlers, current: true }); current.append(currentList.node);
    }
    state = { conversation: context?.conversation || '', tabId: tab?.id ?? null };
    source.textContent = website(tab?.url); title.textContent = context?.title || tab?.title || 'Open a web page to get started';
    title.title = title.textContent; currentCount.textContent = String(rows.length); empty.hidden = rows.length > 0;
    currentList.update(rows);
    if (!context) { empty.textContent = 'Highlights are unavailable on this page. Open a regular website to get started.'; }
    else if (!rows.length) { empty.textContent = 'Select a passage to keep it here.'; empty.append(element('small', { text: 'Pick a colour, or press Alt + Shift + H.' })); }
    if (library.open) await refreshLibrary();
  } catch (error) { if (version === refreshVersion) showError(error); }
}

function conversationView(summary) {
  const node = element('details', { className: 'conversation' });
  const heading = element('summary'); const name = element('span', { className: 'conversation-title' });
  const count = element('span', { className: 'count' }); heading.append(name, count);
  const body = element('div', { className: 'conversation-body' }); node.append(heading, body);
  let list = null, version = 0, record = summary;
  const view = { node, update(next) { record = next; name.textContent = next.title || next.url; name.title = next.url; count.textContent = String(next.count); }, async load() {
    const token = ++version;
    if (!node.open) return;
    try {
      const rows = await readConversation(record.conversation);
      if (version !== token || !node.open || !node.isConnected) return;
      if (!list) {
        list = makeList(handlers);
        body.replaceChildren(element('p', { className: 'muted', text: 'Select a quote to open its page.' }), list.node);
      }
      list.update(rows);
    } catch (error) { showError(error); }
  } };
  node.addEventListener('toggle', () => {
    if (node.open) void view.load();
    else { ++version; list = null; body.replaceChildren(); }
  });
  view.update(summary); return view;
}
function renderLibrary() {
  const groups = new Map();
  for (const summary of summaries.filter(item => item.conversation !== state.conversation).sort((a, b) => b.updatedAt - a.updatedAt)) {
    const host = website(summary.url);
    if (!groups.has(host)) groups.set(host, []);
    groups.get(host).push(summary);
  }
  const valid = new Set([...groups.values()].flat().map(item => item.conversation));
  for (const id of conversations.keys()) if (!valid.has(id)) conversations.delete(id);
  for (const host of sites.keys()) if (!groups.has(host)) sites.delete(host);
  const nodes = [];
  for (const [host, items] of groups) {
    if (!sites.has(host)) {
      const node = element('details', { className: 'website' });
      const summary = element('summary');
      const badge = element('span', { className: 'site-badge', text: host[0].toUpperCase(), attrs: { 'aria-hidden': 'true' } });
      const label = element('span', { className: 'site-label' }); label.append(element('strong', { text: host }));
      const meta = element('small'); label.append(meta);
      summary.append(badge, label); const body = element('div', { className: 'website-body' }); node.append(summary, body);
      node.addEventListener('toggle', () => {
        if (!node.open) for (const child of body.children) child.open = false;
      });
      sites.set(host, { node, meta, body });
    }
    const site = sites.get(host);
    site.meta.textContent = `${items.length} ${items.length === 1 ? 'conversation' : 'conversations'} · ${items.reduce((n, item) => n + item.count, 0)} highlights`;
    reconcile(site.body, items.map(item => {
      if (!conversations.has(item.conversation)) conversations.set(item.conversation, conversationView(item));
      const view = conversations.get(item.conversation); view.update(item); return view.node;
    }));
    nodes.push(site.node);
  }
  if (!nodes.length) nodes.push(element('p', { className: 'muted', text: 'Highlights from other conversations will appear here, grouped by website.' }));
  reconcile(libraryBody, nodes);
}
async function refreshLibrary() {
  const version = ++libraryVersion;
  try {
    const result = await browser.runtime.sendMessage({ type: 'library' });
    if (!result?.ok) throw new Error('Could not load saved websites.');
    if (version !== libraryVersion || !library.open) return;
    summaries = result.summaries; renderLibrary();
    await Promise.all([...conversations.values()].filter(view => view.node.open).map(view => view.load()));
  } catch (error) { showError(error); }
}
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refresh(), 50); }
async function change(annotation, patch, type = 'update') {
  try {
    const result = await browser.runtime.sendMessage({ type, conversation: annotation.conversation, id: annotation.id, ...patch });
    if (!result?.ok) throw new Error('Could not save the change. Reload the extension and page.');
    if (type === 'delete') drafts.delete(annotation.id);
    await refresh(); return true;
  } catch (error) { showError(error); return false; }
}
async function jump(annotation) {
  try {
    if (annotation.conversation !== state.conversation) { await browser.tabs.create({ url: annotation.url }); return; }
    const result = await browser.tabs.sendMessage(state.tabId, { type: 'scroll', id: annotation.id });
    if (!result?.ok) showError(result?.reason || 'Passage is not loaded or its text has changed.');
    else if (isPopup) window.close();
  } catch { showError('Reload the page and try again.'); }
}
browser.tabs.onActivated.addListener(scheduleRefresh);
browser.tabs.onUpdated.addListener((tabId, info) => { if (tabId === state.tabId && (info.status === 'complete' || info.url)) scheduleRefresh(); });
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[keyFor(state.conversation)]) scheduleRefresh();
  else if (library.open && (changes[LIBRARY_KEY] || [...conversations].some(([id, view]) => view.node.open && changes[keyFor(id)]))) void refreshLibrary();
});
void refresh();
