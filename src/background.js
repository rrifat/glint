import { keyFor, readConversation, LIBRARY_KEY, summarize } from "./storage.js";
import { isColor } from "./colors.js";
import { browser, onMessage } from "./browser.js";
import { createBackup, importChanges } from "./transfer.js";
let queue = Promise.resolve();
onMessage((msg, sender) => {
  if (
    !["save", "update", "delete", "library", "export", "import"].includes(
      msg?.type,
    )
  )
    return;
  const task = queue.then(async () => {
    if (msg.type === "export" || msg.type === "import") {
      if (
        sender?.url?.split("?")[0] !== browser.runtime.getURL("transfer.html")
      )
        throw new Error("Open Export & transfer from Glint.");
      if (msg.type === "export") {
        const data = await browser.storage.local.get(
          typeof msg.conversation === "string" && msg.conversation
            ? keyFor(msg.conversation)
            : null,
        );
        return { backup: createBackup(data) };
      }
      // Validate before reading/writing. One queued storage write also updates the library index.
      const merge = await importChanges(msg.backup, () =>
        browser.storage.local.get(null),
      );
      if (merge.added) await browser.storage.local.set(merge.changes);
      return { added: merge.added, skipped: merge.skipped };
    }
    if (msg.type === "library") {
      const existing = (await browser.storage.local.get(LIBRARY_KEY))[
        LIBRARY_KEY
      ];
      if (existing) return { summaries: existing };
      // One-time, on-demand migration; original annotation records stay intact.
      const data = await browser.storage.local.get(null);
      const summaries = Object.entries(data)
        .filter(([key]) => key.startsWith("annotations:"))
        .map(([key, rows]) => summarize(key.slice("annotations:".length), rows))
        .filter(Boolean);
      await browser.storage.local.set({ [LIBRARY_KEY]: summaries });
      return { summaries };
    }
    if (typeof msg.conversation !== "string")
      throw new Error("Missing conversation");
    const rows = await readConversation(msg.conversation);
    if (msg.type === "save") {
      const a = msg.annotation;
      if (
        !a?.anchor?.exact ||
        !isColor(a.color) ||
        a.conversation !== msg.conversation
      )
        throw new Error("Invalid annotation");
      rows.push(a);
    } else {
      const i = rows.findIndex((a) => a.id === msg.id);
      if (i < 0)
        throw new Error(
          "This highlight no longer exists. Refresh the page and try again.",
        );
      if (msg.type === "delete") rows.splice(i, 1);
      else {
        if (msg.color !== undefined) {
          if (!isColor(msg.color)) throw new Error("Invalid colour");
          rows[i].color = msg.color;
        }
        if (typeof msg.note === "string") rows[i].note = msg.note;
      }
    }
    const index = (await browser.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY];
    const changes = { [keyFor(msg.conversation)]: rows };
    if (index) {
      const summaries = index.filter(
        (item) => item.conversation !== msg.conversation,
      );
      const summary = summarize(msg.conversation, rows);
      if (summary) summaries.push(summary);
      changes[LIBRARY_KEY] = summaries;
    }
    await browser.storage.local.set(changes);
  });
  queue = task.then(
    () => {},
    () => {},
  );
  return task.then((result) => ({ ok: true, ...result }));
});
async function highlight(tab) {
  if (tab?.id)
    await browser.tabs
      .sendMessage(tab.id, { type: "highlight" })
      .catch(() => {});
}
browser.commands.onCommand.addListener(async (command) => {
  if (command === "highlight-selection")
    await highlight(
      (await browser.tabs.query({ active: true, currentWindow: true }))[0],
    );
});
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "highlight",
    title: "Highlight selection",
    contexts: ["selection"],
  });
});
browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "highlight") void highlight(tab);
});
browser.webNavigation.onHistoryStateUpdated.addListener(
  ({ tabId, frameId }) => {
    if (frameId === 0)
      browser.tabs.sendMessage(tabId, { type: "navigate" }).catch(() => {});
  },
);
