import { browser } from "./browser.js";
export { COLORS } from "./colors.js";
export const LIBRARY_KEY = "highlight-library-v1";
export function summarize(conversation, rows) {
  const latest = rows.reduce(
    (a, b) => (!a || b.createdAt > a.createdAt ? b : a),
    null,
  );
  return latest
    ? {
        conversation,
        title: latest.title,
        url: latest.url,
        count: rows.length,
        updatedAt: latest.createdAt,
      }
    : null;
}
export const keyFor = (conversation) => `annotations:${conversation}`;
export async function readConversation(conversation) {
  const key = keyFor(conversation);
  return (await browser.storage.local.get(key))[key] || [];
}
export async function loadConversation(conversation, url, title = "") {
  const result = await browser.runtime.sendMessage({
    type: "load",
    conversation,
    url,
    title,
  });
  if (!result?.ok)
    throw new Error(result?.error || "Could not load highlights.");
  return result.rows;
}
