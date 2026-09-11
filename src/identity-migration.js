import { stableConversationIdentity } from "./adapters.js";
import { keyFor, LIBRARY_KEY, summarize } from "./storage.js";

export const IDENTITY_SCHEMA_KEY = "identity-schema-version";
export const IDENTITY_SCHEMA_VERSION = 1;
const PREFIX = "annotations:";

export function normalizeAnnotation(row) {
  const identity = stableConversationIdentity(row?.url);
  if (!identity) return row;
  const provider = identity.slice(0, identity.indexOf(":"));
  if (row.conversation === identity && row.provider === provider) return row;
  return {
    ...row,
    conversation: identity,
    provider,
    originalUrl: row.originalUrl || row.url,
  };
}

export function planIdentityMigration(data) {
  const sources = Object.entries(data).filter(
    ([key, rows]) => key.startsWith(PREFIX) && Array.isArray(rows),
  );
  const canonicalSource = ([key, rows]) =>
    rows.some(
      (row) =>
        stableConversationIdentity(row?.url) === key.slice(PREFIX.length),
    );
  sources.sort(
    (a, b) => Number(canonicalSource(b)) - Number(canonicalSource(a)),
  );
  const groups = new Map();
  const ids = new Map();
  for (const [sourceKey, rows] of sources) {
    const sourceConversation = sourceKey.slice(PREFIX.length);
    for (const original of rows) {
      const row = normalizeAnnotation(original);
      const conversation =
        stableConversationIdentity(row?.url) || sourceConversation;
      const key = keyFor(conversation);
      if (!groups.has(key)) {
        groups.set(key, []);
        ids.set(key, new Set());
      }
      if (row.id && ids.get(key).has(row.id)) continue;
      groups
        .get(key)
        .push(
          row.conversation === conversation ? row : { ...row, conversation },
        );
      if (row.id) ids.get(key).add(row.id);
    }
  }
  const changes = Object.fromEntries(groups);
  changes[LIBRARY_KEY] = [...groups]
    .map(([key, rows]) => summarize(key.slice(PREFIX.length), rows))
    .filter(Boolean);
  const removals = sources
    .map(([key]) => key)
    .filter((key) => !groups.has(key));
  return { changes, removals };
}

export async function ensureIdentityMigration(storage) {
  const version =
    (await storage.get(IDENTITY_SCHEMA_KEY))[IDENTITY_SCHEMA_KEY] || 0;
  if (version >= IDENTITY_SCHEMA_VERSION) return;
  const data = await storage.get(null);
  const { changes, removals } = planIdentityMigration(data);
  await storage.set(changes);
  if (removals.length) await storage.remove(removals);
  await storage.set({ [IDENTITY_SCHEMA_KEY]: IDENTITY_SCHEMA_VERSION });
}
