import test from "node:test";
import assert from "node:assert/strict";
import {
  adapterFor,
  stableConversationIdentity,
  DeepSeekAdapter,
  GenericAdapter,
} from "../src/adapters.js";
import { keyFor, LIBRARY_KEY } from "../src/storage.js";
import {
  IDENTITY_SCHEMA_KEY,
  ensureIdentityMigration,
  planIdentityMigration,
} from "../src/identity-migration.js";

const record = (id, conversation, url, patch = {}) => ({
  id,
  conversation,
  url,
  title: "Conversation",
  provider: "chatgpt",
  messageId: null,
  scope: "page",
  color: "yellow",
  note: "",
  createdAt: 1,
  anchor: { exact: `Quote ${id}`, prefix: "", suffix: "", start: 0, end: 7 },
  ...patch,
});

test("provider identities use stable conversation IDs while generic pages retain URL identity", () => {
  const cases = [
    [
      "https://chatgpt.com/g/g-p-old-research/c/6aa37c24-e2f8-83e9-972d-4d27f2260ef4",
      "chatgpt:conversation:6aa37c24-e2f8-83e9-972d-4d27f2260ef4",
    ],
    [
      "https://chatgpt.com/g/g-p-renamed/c/6aa37c24-e2f8-83e9-972d-4d27f2260ef4?model=auto",
      "chatgpt:conversation:6aa37c24-e2f8-83e9-972d-4d27f2260ef4",
    ],
    [
      "https://chat.openai.com/c/6aa37c24-e2f8-83e9-972d-4d27f2260ef4",
      "chatgpt:conversation:6aa37c24-e2f8-83e9-972d-4d27f2260ef4",
    ],
    [
      "https://claude.ai/project/project-id/chat/claude-chat-id?mode=focus",
      "claude:conversation:claude-chat-id",
    ],
    [
      "https://gemini.google.com/app/gemini-chat-id?hl=en",
      "gemini:conversation:gemini-chat-id",
    ],
    [
      "https://chat.deepseek.com/a/chat/s/deepseek-chat-id",
      "deepseek:conversation:deepseek-chat-id",
    ],
  ];
  for (const [url, identity] of cases) {
    assert.equal(stableConversationIdentity(url), identity);
    assert.equal(adapterFor(url).identity(url), identity);
  }
  assert.ok(adapterFor(cases.at(-1)[0]) instanceof DeepSeekAdapter);
  const generic = "https://example.com/articles/same-slug?revision=2#part";
  assert.ok(adapterFor(generic) instanceof GenericAdapter);
  assert.equal(
    adapterFor(generic).identity(generic),
    "web:https://example.com/articles/same-slug?revision=2",
  );
  assert.equal(stableConversationIdentity("https://chatgpt.com/"), null);
  assert.notEqual(
    adapterFor("https://chatgpt.com/new").identity("https://chatgpt.com/new"),
    adapterFor("https://chatgpt.com/g/gpt").identity(
      "https://chatgpt.com/g/gpt",
    ),
  );
});

test("migration joins renamed provider URLs, prefers canonical conflicts, and leaves generic records alone", () => {
  const oldUrl = "https://chatgpt.com/g/g-p-old/c/shared-id";
  const newUrl = "https://chatgpt.com/g/g-p-new/c/shared-id";
  const canonical = "chatgpt:conversation:shared-id";
  const legacy = `chatgpt:https://chatgpt.com/g/g-p-old/c/shared-id`;
  const generic = "web:https://example.com/article";
  const canonicalCopy = record("same", canonical, newUrl, {
    note: "Keep canonical edit",
  });
  const data = {
    [keyFor(legacy)]: [
      record("old", legacy, oldUrl),
      record("same", legacy, oldUrl, { note: "Old edit" }),
    ],
    [keyFor(canonical)]: [canonicalCopy],
    [keyFor(generic)]: [
      record("web", generic, "https://example.com/article", {
        provider: "web",
      }),
    ],
  };
  const { changes, removals } = planIdentityMigration(data);
  assert.deepEqual(
    changes[keyFor(canonical)].map((row) => row.id),
    ["same", "old"],
  );
  assert.equal(changes[keyFor(canonical)][0].note, "Keep canonical edit");
  assert.equal(changes[keyFor(canonical)][1].originalUrl, oldUrl);
  assert.equal(changes[keyFor(canonical)][1].conversation, canonical);
  assert.deepEqual(changes[keyFor(generic)], data[keyFor(generic)]);
  assert.deepEqual(removals, [keyFor(legacy)]);
  assert.equal(
    changes[LIBRARY_KEY].reduce((count, item) => count + item.count, 0),
    3,
  );
});

test("storage migration writes canonical data before removing legacy keys and runs once", async () => {
  const url = "https://chat.deepseek.com/a/chat/s/stable-id";
  const legacy = `web:${url}`;
  const data = {
    [keyFor(legacy)]: [record("deep", legacy, url, { provider: "web" })],
  };
  const operations = [];
  const storage = {
    async get(key) {
      if (key === null) return structuredClone(data);
      return { [key]: structuredClone(data[key]) };
    },
    async set(changes) {
      operations.push(["set", Object.keys(changes)]);
      Object.assign(data, structuredClone(changes));
    },
    async remove(keys) {
      operations.push(["remove", keys]);
      for (const key of keys) delete data[key];
    },
  };
  await ensureIdentityMigration(storage);
  const canonicalKey = keyFor("deepseek:conversation:stable-id");
  assert.equal(data[canonicalKey][0].provider, "deepseek");
  assert.equal(data[keyFor(legacy)], undefined);
  assert.equal(data[IDENTITY_SCHEMA_KEY], 1);
  assert.equal(operations[0][0], "set");
  assert.equal(operations[1][0], "remove");
  const count = operations.length;
  await ensureIdentityMigration(storage);
  assert.equal(operations.length, count);
});
