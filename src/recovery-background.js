import { browser } from "./browser.js";
import { adapterFor } from "./adapters.js";
import { keyFor, readConversation, LIBRARY_KEY, summarize } from "./storage.js";
import { recoveryCopies } from "./recovery.js";

async function fingerprint(rows) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(rows)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
// Called inside the existing serialized storage queue. No background cache or
// saved preview is needed: confirmation re-reads and rechecks its inputs.
export async function recover(msg, sender) {
  if (sender?.url?.split("?")[0] !== browser.runtime.getURL("sidebar.html"))
    throw new Error("Open recovery from Glint’s popup or sidebar.");
  const { target, source } = msg;
  if (
    !target ||
    !Number.isInteger(target.tabId) ||
    typeof source !== "string" ||
    !source ||
    !/^https?:\/\//.test(target.url) ||
    adapterFor(target.url).identity(target.url) !== target.conversation ||
    source === target.conversation
  )
    throw new Error(
      "Choose a different saved conversation and a regular destination page.",
    );
  const tab = await browser.tabs.get(target.tabId);
  if (tab.url !== target.url)
    throw new Error("The destination page changed. Preview again.");
  const rows = await readConversation(source);
  if (!rows.length)
    throw new Error("The saved conversation is empty or was removed.");
  const revision = await fingerprint(rows);
  const preview = await browser.tabs.sendMessage(target.tabId, {
    type: "recovery-preview",
    url: target.url,
    conversation: target.conversation,
    rows: rows.map((row) => ({ id: row.id, anchor: row.anchor })),
  });
  if (!preview?.ok)
    throw new Error(
      preview?.reason || "Cannot preview this page. Reload it and try again.",
    );
  const stamp = {
    revision,
    document: preview.document,
    results: preview.results,
  };
  if (msg.type === "recovery-preview")
    return {
      stamp,
      title: tab.title || target.url,
      passages: rows.map((row, i) => ({
        id: row.id,
        quote: row.anchor.exact,
        status: preview.results[i].status,
      })),
    };
  if (JSON.stringify(msg.stamp) !== JSON.stringify(stamp))
    throw new Error(
      "The page or saved highlights changed. Preview again before linking.",
    );
  const latestTab = await browser.tabs.get(target.tabId);
  if (latestTab.url !== target.url)
    throw new Error("The destination page changed. Preview again.");
  const destination = await readConversation(target.conversation);
  const result = recoveryCopies(rows, destination, {
    ...target,
    title: tab.title || target.url,
    provider: adapterFor(target.url).name,
  });
  if (result.added) {
    const index = (await browser.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY];
    const changes = { [keyFor(target.conversation)]: result.rows };
    if (index)
      changes[LIBRARY_KEY] = [
        ...index.filter((item) => item.conversation !== target.conversation),
        summarize(target.conversation, result.rows),
      ];
    await browser.storage.local.set(changes);
  }
  return { added: result.added, skipped: result.skipped };
}
