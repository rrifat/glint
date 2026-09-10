export const COLORS = ['yellow', 'green', 'blue', 'pink'];
export const keyFor = conversation => `annotations:${conversation}`;
export async function readConversation(conversation) { const key = keyFor(conversation); return (await browser.storage.local.get(key))[key] || []; }
