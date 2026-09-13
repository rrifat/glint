import { keyFor, readConversation, LIBRARY_KEY, summarize } from "./storage.js";
import { isColor } from "./colors.js";
import { browser, onMessage } from "./browser.js";
import { createBackup, importChanges } from "./transfer.js";
import { adapterFor, stableConversationIdentity } from "./adapters.js";
import { ensureIdentityMigration } from "./identity-migration.js";
import { recover } from "./recovery-background.js";
import {
  SAVED_COLORS_KEY,
  customColors,
  readSavedColors,
} from "./saved-colors.js";
let queue = Promise.resolve();
onMessage((msg, sender) => {
  if (
    ![
      "save",
      "saved-colors",
      "delete-saved-color",
      "update",
      "delete",
      "load",
      "library",
      "export",
      "import",
      "recovery-preview",
      "recovery-confirm",
    ].includes(msg?.type)
  )
    return;
  const task = queue.then(async () => {
    await ensureIdentityMigration(browser.storage.local);
    if (msg.type === "delete-saved-color") {
      const [color] = customColors([msg.color]);
      if (!color) throw new Error("Invalid custom colour");
      const colors = await readSavedColors(browser.storage.local);
      await browser.storage.local.set({
        [SAVED_COLORS_KEY]: colors.filter((saved) => saved !== color),
      });
      return;
    }
    if (msg.type === "saved-colors") {
      const colors = await readSavedColors(browser.storage.local);
      const stored = (await browser.storage.local.get(SAVED_COLORS_KEY))[
        SAVED_COLORS_KEY
      ];
      if (!Array.isArray(stored))
        await browser.storage.local.set({ [SAVED_COLORS_KEY]: colors });
      return { colors };
    }
    if (msg.type === "recovery-preview" || msg.type === "recovery-confirm")
      return recover(msg, sender);
    if (msg.type === "load") {
      if (
        typeof msg.conversation !== "string" ||
        typeof msg.url !== "string" ||
        adapterFor(msg.url).identity(msg.url) !== msg.conversation
      )
        throw new Error("Invalid conversation URL.");
      const rows = await readConversation(msg.conversation);
      let changed = false;
      for (const row of rows) {
        if (row.url !== msg.url) {
          row.originalUrl ||= row.url;
          row.url = msg.url;
          changed = true;
        }
        if (msg.title && row.title !== msg.title) {
          row.title = msg.title;
          changed = true;
        }
      }
      if (changed) {
        const changes = { [keyFor(msg.conversation)]: rows };
        const index = (await browser.storage.local.get(LIBRARY_KEY))[
          LIBRARY_KEY
        ];
        if (index) {
          const summaries = index.filter(
            (item) => item.conversation !== msg.conversation,
          );
          const summary = summarize(msg.conversation, rows);
          if (summary) summaries.push(summary);
          changes[LIBRARY_KEY] = summaries;
        }
        await browser.storage.local.set(changes);
      }
      return { rows };
    }
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
        a.conversation !== msg.conversation ||
        (stableConversationIdentity(a.url) &&
          stableConversationIdentity(a.url) !== msg.conversation)
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
    const appliedColor = msg.type === "save" ? msg.annotation.color : msg.color;
    if (customColors([appliedColor]).length) {
      changes[SAVED_COLORS_KEY] = customColors([
        ...(await readSavedColors(browser.storage.local)),
        appliedColor,
      ]);
    }
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
