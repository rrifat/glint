import { keyFor, readConversation, COLORS } from './storage.js';
let queue = Promise.resolve();
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'save' && msg.type !== 'update' && msg.type !== 'delete') return;
  const task = queue.then(async () => {
    if (typeof msg.conversation !== 'string') throw new Error('Missing conversation');
    const rows = await readConversation(msg.conversation);
    if (msg.type === 'save') {
      const a = msg.annotation;
      if (!a?.anchor?.exact || !COLORS.includes(a.color) || a.conversation !== msg.conversation) throw new Error('Invalid annotation');
      rows.push(a);
    } else {
      const i = rows.findIndex(a => a.id === msg.id);
      if (i < 0) throw new Error('This highlight no longer exists. Refresh the page and try again.');
      if (msg.type === 'delete') rows.splice(i, 1);
      else { if (COLORS.includes(msg.color)) rows[i].color = msg.color; if (typeof msg.note === 'string') rows[i].note = msg.note; }
    }
    await browser.storage.local.set({ [keyFor(msg.conversation)]: rows });
  });
  queue = task.catch(() => {}); return task.then(() => ({ ok: true }));
});
async function highlight(tab) { if (tab?.id) await browser.tabs.sendMessage(tab.id, { type: 'highlight' }).catch(() => {}); }
browser.commands.onCommand.addListener(async command => { if (command === 'highlight-selection') await highlight((await browser.tabs.query({ active: true, currentWindow: true }))[0]); });
browser.runtime.onInstalled.addListener(() => { browser.contextMenus.create({ id: 'highlight', title: 'Highlight selection', contexts: ['selection'] }); });
browser.contextMenus.onClicked.addListener((info, tab) => { if (info.menuItemId === 'highlight') void highlight(tab); });
browser.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId }) => { if (frameId === 0) browser.tabs.sendMessage(tabId, { type: 'navigate' }).catch(() => {}); });
