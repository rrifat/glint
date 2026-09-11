import { browser } from "./browser.js";
import {
  readableExport,
  validateBackup,
  MAX_BACKUP_BYTES,
} from "./transfer.js";

const $ = (id) => document.getElementById(id);
const conversation =
  new URLSearchParams(location.search).get("conversation") || "";
const current = $("scope").querySelector("[value=current]");
current.disabled = !conversation;
if (conversation) $("scope").value = "current";
let pending = null,
  selectionVersion = 0;
const urls = new Set();
const report = (message) => {
  $("status").textContent = message;
  $("status").hidden = false;
};
async function request(message) {
  const response = await browser.runtime.sendMessage(message);
  if (!response?.ok)
    throw new Error(
      response?.error || "The operation failed. Reload Glint and try again.",
    );
  return response;
}
function download(text, extension, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  urls.add(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = `glint-highlights-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    urls.delete(url);
  }, 30000);
}
addEventListener("pagehide", () => {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  pending = null;
});
for (const [id, extension, type] of [
  ["text", "txt", "text/plain;charset=utf-8"],
  ["markdown", "md", "text/markdown;charset=utf-8"],
  ["backup", "json", "application/json"],
]) {
  $(id).addEventListener("click", async () => {
    $(id).disabled = true;
    try {
      const { backup } = await request({
        type: "export",
        conversation: $("scope").value === "current" ? conversation : "",
      });
      download(
        extension === "json"
          ? JSON.stringify(backup, null, 2)
          : readableExport(backup, extension),
        extension,
        type,
      );
      report(
        `Export prepared: ${backup.annotations.length} highlights. Check your downloads. This is a snapshot, not automatic sync.`,
      );
    } catch (error) {
      report(error.message);
    } finally {
      $(id).disabled = false;
    }
  });
}
$("import-file").addEventListener("change", async () => {
  const version = ++selectionVersion;
  pending = null;
  $("import").disabled = true;
  $("preview").textContent = "";
  try {
    const file = $("import-file").files[0];
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES)
      throw new Error("Choose a backup smaller than 10 MB.");
    const backup = JSON.parse(await file.text());
    const rows = validateBackup(backup);
    if (version !== selectionVersion) return;
    pending = { ...backup, annotations: rows };
    $("preview").textContent =
      `${rows.length} highlights ready to import. Existing IDs will be skipped.`;
    $("import").disabled = !rows.length;
  } catch (error) {
    if (version === selectionVersion) report(error.message);
  }
});
$("import").addEventListener("click", async () => {
  if (!pending) return;
  $("import").disabled = true;
  $("import-file").disabled = true;
  try {
    const result = await request({ type: "import", backup: pending });
    report(
      `Imported ${result.added} highlights; skipped ${result.skipped} existing IDs. Local edits were kept. Open the saved pages to restore loaded passages.`,
    );
    pending = null;
    $("import-file").value = "";
    $("preview").textContent = "";
  } catch (error) {
    report(error.message);
  } finally {
    $("import").disabled = !pending;
    $("import-file").disabled = false;
  }
});
