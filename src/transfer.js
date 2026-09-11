import { isColor } from "./colors.js";
import { keyFor, LIBRARY_KEY, summarize } from "./storage.js";
import { normalizeAnnotation } from "./identity-migration.js";

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const FORMAT = "glint-backup";

export function createBackup(data) {
  const annotations = Object.entries(data)
    .filter(([key]) => key.startsWith("annotations:"))
    .flatMap(([, rows]) => rows);
  return {
    format: FORMAT,
    // Older Glint versions must not discard the conservative recovery policy.
    version: annotations.some((row) => row.recovery) ? 2 : 1,
    exportedAt: new Date().toISOString(),
    annotations,
  };
}

export function validateBackup(backup) {
  if (
    backup?.format !== FORMAT ||
    ![1, 2].includes(backup.version) ||
    !Array.isArray(backup.annotations)
  )
    throw new Error("Choose a Glint JSON backup (version 1 or 2).");
  if (
    backup.annotations.length > 20000 ||
    new TextEncoder().encode(JSON.stringify(backup)).length > MAX_BACKUP_BYTES
  )
    throw new Error(
      "This backup exceeds the import limit (10 MB or 20,000 highlights).",
    );
  return backup.annotations.map((row, index) => {
    const invalid = () => {
      throw new Error(
        `Highlight ${index + 1} is invalid. Nothing was imported.`,
      );
    };
    if (!row || typeof row !== "object") invalid();
    for (const field of [
      "id",
      "conversation",
      "provider",
      "scope",
      "url",
      "title",
      "note",
    ]) {
      if (typeof row[field] !== "string") invalid();
    }
    if (
      !row.id ||
      !row.conversation ||
      !isColor(row.color) ||
      !["page", "message"].includes(row.scope) ||
      !(row.messageId === null || typeof row.messageId === "string") ||
      !Number.isFinite(row.createdAt) ||
      row.createdAt < 0 ||
      !Number.isFinite(new Date(row.createdAt).getTime())
    )
      invalid();
    try {
      if (!["http:", "https:"].includes(new URL(row.url).protocol)) invalid();
      if (
        row.originalUrl !== undefined &&
        (typeof row.originalUrl !== "string" ||
          !["http:", "https:"].includes(new URL(row.originalUrl).protocol))
      )
        invalid();
    } catch {
      invalid();
    }
    const a = row.anchor;
    if (
      row.recovery !== undefined &&
      (!row.recovery ||
        typeof row.recovery.conversation !== "string" ||
        !row.recovery.conversation ||
        typeof row.recovery.id !== "string" ||
        !row.recovery.id ||
        row.scope !== "page" ||
        row.messageId !== null)
    )
      invalid();
    if (
      !a ||
      typeof a.exact !== "string" ||
      !a.exact.trim() ||
      typeof a.prefix !== "string" ||
      typeof a.suffix !== "string" ||
      !Number.isSafeInteger(a.start) ||
      !Number.isSafeInteger(a.end) ||
      a.start < 0 ||
      a.end - a.start !== a.exact.length
    )
      invalid();
    // Copy the storage schema explicitly; never merge arbitrary imported object properties.
    return normalizeAnnotation({
      id: row.id,
      conversation: row.conversation,
      provider: row.provider,
      messageId: row.messageId,
      scope: row.scope,
      url: row.url,
      ...(row.recovery
        ? {
            recovery: {
              conversation: row.recovery.conversation,
              id: row.recovery.id,
            },
          }
        : {}),
      ...(row.originalUrl !== undefined
        ? { originalUrl: row.originalUrl }
        : {}),
      title: row.title,
      note: row.note,
      color: row.color,
      createdAt: row.createdAt,
      anchor: {
        exact: a.exact,
        prefix: a.prefix,
        suffix: a.suffix,
        start: a.start,
        end: a.end,
      },
    });
  });
}

export async function importChanges(backup, readAll) {
  const imported = validateBackup(backup);
  const data = await readAll();
  const changes = {};
  const ids = new Map();
  let added = 0,
    skipped = 0;
  for (const row of imported) {
    const key = keyFor(row.conversation);
    if (!ids.has(key))
      ids.set(key, new Set((data[key] || []).map((a) => a.id)));
    if (ids.get(key).has(row.id)) {
      skipped++;
      continue;
    }
    changes[key] ??= [...(data[key] || [])];
    changes[key].push(row);
    ids.get(key).add(row.id);
    added++;
  }
  if (added)
    changes[LIBRARY_KEY] = Object.entries({ ...data, ...changes })
      .filter(([key]) => key.startsWith("annotations:"))
      .map(([key, rows]) => summarize(key.slice("annotations:".length), rows))
      .filter(Boolean);
  return { changes, added, skipped };
}

const markdown = (text) =>
  String(text).replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, "\\$&");
export function readableExport(backup, format = "txt") {
  const md = format === "md";
  const escape = md ? markdown : String;
  const lines = [
    md ? "# Glint highlights" : "Glint highlights",
    "",
    `Exported: ${backup.exportedAt}`,
    "",
    "A snapshot of saved highlights and notes. New changes require another export.",
    "",
  ];
  const groups = new Map();
  for (const row of backup.annotations) {
    if (!groups.has(row.conversation)) groups.set(row.conversation, []);
    groups.get(row.conversation).push(row);
  }
  for (const rows of groups.values()) {
    lines.push(
      `${md ? "## " : ""}${escape((rows[0].title || rows[0].url).replace(/[\r\n]+/g, " "))}`,
      "",
    );
    for (const row of rows) {
      lines.push(
        ...row.anchor.exact
          .split("\n")
          .map((line) => `${md ? "> " : ""}${escape(line)}`),
        "",
      );
      if (row.note) lines.push(`Note: ${escape(row.note)}`, "");
      lines.push(
        `Source: ${escape(row.url)}`,
        `Colour: ${escape(row.color)}`,
        `Saved: ${new Date(row.createdAt).toISOString()}`,
        "",
        "---",
        "",
      );
    }
  }
  if (!backup.annotations.length)
    lines.push("No highlights in this selection.", "");
  return lines.join("\n");
}
