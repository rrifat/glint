// Installed-extension smoke test in an isolated Chromium profile. No personal browser data is read.
// Usage: node scripts/browser-smoke.js /path/to/chromium
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const executable = process.argv[2];
if (!executable)
  throw new Error("Pass a Chromium executable that supports --load-extension.");
const work = await mkdtemp(join(tmpdir(), "glint-browser-smoke-"));
const downloads = join(work, "downloads");
await mkdir(downloads);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    "<!doctype html><title>Glint smoke test</title><p>Hello world. A saved passage.</p>",
  );
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const url = `http://127.0.0.1:${server.address().port}/`;
const extension = resolve("dist-chromium");
const child = spawn(
  executable,
  [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${join(work, "profile")}`,
    "--remote-debugging-pipe",
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let sequence = 0,
  buffer = "",
  errors = "";
child.stderr.on("data", (chunk) => {
  errors = (errors + chunk).slice(-5000);
});
const pending = new Map();
child.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf("\0")) !== -1) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      message.error
        ? request.reject(new Error(JSON.stringify(message.error)))
        : request.resolve(message.result);
    }
  }
});
function command(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}\n${errors}`));
    }, 10000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    child.stdio[3].write(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }) + "\0",
    );
  });
}
async function evaluate(session, expression) {
  const result = await command(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    session,
  );
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(check) {
  for (let i = 0; i < 60; i++) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Browser check did not complete.");
}
async function page(url) {
  const { targetId } = await command("Target.createTarget", { url });
  const { sessionId } = await command("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await until(() =>
    evaluate(
      sessionId,
      `location.href === ${JSON.stringify(url)} && document.readyState === "complete"`,
    ),
  );
  return sessionId;
}
try {
  const version = await command("Browser.getVersion");
  console.log(`Browser: ${version.product}`);
  const worker = await until(async () =>
    (await command("Target.getTargets")).targetInfos.find(
      (t) => t.type === "service_worker" && t.url.endsWith("/background.js"),
    ),
  );
  const id = new URL(worker.url).host;
  await command("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
  });
  const source = await page(url);
  const transfer = await page(`chrome-extension://${id}/transfer.html`);
  const send = (msg) =>
    evaluate(transfer, `chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
  const tabId = await evaluate(
    transfer,
    `(async () => (await chrome.tabs.query({})).find(t => t.url === ${JSON.stringify(url)}).id)()`,
  );
  const toPage = (message) =>
    evaluate(
      transfer,
      `chrome.tabs.sendMessage(${tabId}, ${JSON.stringify(message)})`,
    );
  const context = await until(async () => {
    try {
      return await toPage({ type: "context" });
    } catch {
      return false;
    }
  });
  assert.equal(context.supported, true);
  await evaluate(
    source,
    `(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('p')); getSelection().removeAllRanges(); getSelection().addRange(range); })()`,
  );
  await toPage({ type: "highlight" });
  const backup = await until(async () => {
    const result = await send({ type: "export" });
    return result.backup?.annotations.length ? result.backup : false;
  });
  assert.equal(backup.annotations.length, 1);
  assert.equal(
    backup.annotations[0].anchor.exact,
    "Hello world. A saved passage.",
  );
  const row = backup.annotations[0];
  assert.equal(
    (
      await send({
        type: "update",
        conversation: row.conversation,
        id: row.id,
        color: "#123456",
        note: "Read on iPhone",
      })
    ).ok,
    true,
  );
  await command("Page.reload", {}, source);
  await until(async () => {
    try {
      return (await toPage({ type: "scroll", id: row.id })).ok;
    } catch {
      return false;
    }
  });
  const edited = (await send({ type: "export" })).backup;
  assert.equal(edited.annotations[0].color, "#123456");
  assert.equal(edited.annotations[0].note, "Read on iPhone");
  assert.deepEqual((await send({ type: "saved-colors" })).colors, ["#123456"]);
  await until(() =>
    evaluate(
      source,
      `document.querySelector('style[data-ph-ui]')?.textContent.includes('ph-custom-123456')`,
    ),
  );
  const paints = await evaluate(
    source,
    `(() => {
    document.body.style.backgroundColor = 'black';
    document.body.style.color = 'white';
    const paragraph = document.querySelector('p');
    const normal = getComputedStyle(paragraph, '::highlight(ph-custom-123456)').backgroundColor;
    const preset = getComputedStyle(paragraph, '::highlight(ph-yellow)').backgroundColor;
    const ink = getComputedStyle(paragraph, '::highlight(ph-custom-123456)').color;
    const presetInk = getComputedStyle(paragraph, '::highlight(ph-yellow)').color;
    const layer = document.createElement('div'); layer.className = 'textLayer';
    const span = document.createElement('span'); span.textContent = 'PDF fixture';
    layer.append(span); document.body.append(layer);
    const pdf = getComputedStyle(span, '::highlight(ph-custom-123456)').backgroundColor;
    const pdfPreset = getComputedStyle(span, '::highlight(ph-yellow)').backgroundColor;
    const pdfInk = getComputedStyle(span, '::highlight(ph-custom-123456)').color;
    layer.remove();
    return { normal, preset, pdf, pdfPreset, ink, presetInk, pdfInk };
  })()`,
  );
  assert.deepEqual(paints, {
    normal: "rgb(18, 52, 86)",
    preset: "rgb(255, 214, 0)",
    pdf: "rgba(18, 52, 86, 0.4)",
    pdfPreset: "rgba(255, 214, 0, 0.4)",
    ink: "rgb(255, 255, 255)",
    presetInk: "rgb(0, 0, 0)",
    pdfInk: "rgba(0, 0, 0, 0)",
  });
  assert.equal(
    (await send({ type: "delete-saved-color", color: "#123456" })).ok,
    true,
  );
  assert.deepEqual((await send({ type: "saved-colors" })).colors, []);
  assert.equal(
    (await send({ type: "export" })).backup.annotations[0].color,
    "#123456",
  );
  await evaluate(transfer, 'document.getElementById("text").click()');
  const textFile = await until(async () =>
    (await readdir(downloads)).find((name) => name.endsWith(".txt")),
  );
  const text = await readFile(join(downloads, textFile), "utf8");
  assert.ok(text.includes("Read on iPhone"));
  assert.ok(text.includes(row.url));
  assert.ok(text.includes(row.anchor.exact));
  const fixture = join(work, "backup.json");
  await writeFile(
    fixture,
    JSON.stringify({
      ...edited,
      annotations: [...edited.annotations, { ...row, id: "imported-copy" }],
    }),
  );
  const { root } = await command("DOM.getDocument", {}, transfer);
  const { nodeId } = await command(
    "DOM.querySelector",
    { nodeId: root.nodeId, selector: "#import-file" },
    transfer,
  );
  await command(
    "DOM.setFileInputFiles",
    { nodeId, files: [fixture] },
    transfer,
  );
  await until(() =>
    evaluate(transfer, '!document.getElementById("import").disabled'),
  );
  await evaluate(transfer, 'document.getElementById("import").click()');
  await until(() =>
    evaluate(
      transfer,
      'document.getElementById("status").textContent.includes("Imported 1 highlights; skipped 1")',
    ),
  );
  assert.equal((await send({ type: "export" })).backup.annotations.length, 2);
  assert.equal((await send({ type: "import", backup: edited })).skipped, 1);
  assert.equal(
    (await send({ type: "delete", conversation: row.conversation, id: row.id }))
      .ok,
    true,
  );
  assert.equal(
    (
      await send({
        type: "delete",
        conversation: row.conversation,
        id: "imported-copy",
      })
    ).ok,
    true,
  );
  assert.equal((await send({ type: "export" })).backup.annotations.length, 0);
  assert.equal((await toPage({ type: "scroll", id: row.id })).ok, false);
  const oldProjectUrl = "https://chatgpt.com/g/g-p-old-name/c/stable-chat-id";
  const newProjectUrl = "https://chatgpt.com/g/g-p-new-name/c/stable-chat-id";
  const legacyConversation = `chatgpt:${oldProjectUrl}`;
  const canonicalConversation = "chatgpt:conversation:stable-chat-id";
  const legacy = {
    ...row,
    id: "legacy-url",
    conversation: legacyConversation,
    provider: "chatgpt",
    url: oldProjectUrl,
  };
  delete legacy.originalUrl;
  const legacyData = { [`annotations:${legacyConversation}`]: [legacy] };
  await evaluate(
    transfer,
    `(async () => { await chrome.storage.local.set(${JSON.stringify(legacyData)}); await chrome.storage.local.remove("identity-schema-version"); })()`,
  );
  assert.equal((await send({ type: "library" })).ok, true);
  let migrated = (await send({ type: "export" })).backup.annotations.find(
    (item) => item.id === "legacy-url",
  );
  assert.equal(migrated.conversation, canonicalConversation);
  assert.equal(migrated.originalUrl, oldProjectUrl);
  assert.equal(
    (
      await send({
        type: "load",
        conversation: canonicalConversation,
        url: newProjectUrl,
        title: "Renamed project",
      })
    ).ok,
    true,
  );
  migrated = (await send({ type: "export" })).backup.annotations.find(
    (item) => item.id === "legacy-url",
  );
  assert.equal(migrated.url, newProjectUrl);
  assert.equal(migrated.originalUrl, oldProjectUrl);
  assert.equal(
    (
      await send({
        type: "delete",
        conversation: canonicalConversation,
        id: "legacy-url",
      })
    ).ok,
    true,
  );
  console.log(
    "PASS: installed extension creation, restoration, transfer, deletion, and renamed provider URL migration.",
  );
  const recoverySource = `web:${url}old`;
  const seed = {
    ...row,
    id: "recover-original",
    conversation: recoverySource,
    url: `${url}old`,
    originalUrl: `${url}old`,
    note: "Original note",
  };
  assert.equal(
    (
      await send({
        type: "save",
        conversation: recoverySource,
        annotation: seed,
      })
    ).ok,
    true,
  );
  const sidebar = await page(`chrome-extension://${id}/sidebar.html`);
  await command("Page.bringToFront", {}, source);
  await until(() =>
    evaluate(
      sidebar,
      `document.querySelector('.page-title')?.textContent === 'Glint smoke test'`,
    ),
  );
  await evaluate(sidebar, `document.querySelector('.recovery').open = true`);
  await until(() =>
    evaluate(
      sidebar,
      `Array.from(document.querySelector('.recovery select')?.options || []).some(o => o.value === ${JSON.stringify(recoverySource)})`,
    ),
  );
  await evaluate(
    sidebar,
    `(() => { const s = document.querySelector('.recovery select'); s.value = ${JSON.stringify(recoverySource)}; s.dispatchEvent(new Event('change')); document.querySelector('.recovery button').click(); })()`,
  );
  await until(() =>
    evaluate(
      sidebar,
      `document.querySelector('.recovery [role=status]').textContent.includes('1 matched')`,
    ),
  );
  await command(
    "Emulation.setDeviceMetricsOverride",
    { width: 400, height: 1100, deviceScaleFactor: 1, mobile: false },
    sidebar,
  );
  await evaluate(
    sidebar,
    `document.querySelector('.recovery').scrollIntoView()`,
  );
  const screenshot = await command("Page.captureScreenshot", {}, sidebar);
  await writeFile(
    join(work, "recovery.png"),
    Buffer.from(screenshot.data, "base64"),
  );
  assert.equal((await send({ type: "export" })).backup.annotations.length, 1); // Preview did not copy anything.
  await evaluate(
    sidebar,
    `Array.from(document.querySelectorAll('.recovery button')).find(b => b.textContent === 'Confirm link to this page').click()`,
  );
  await until(() =>
    evaluate(
      sidebar,
      `document.querySelector('.recovery [role=status]').textContent.includes('Linked 1 highlights')`,
    ),
  );
  const recoveredBackup = (await send({ type: "export" })).backup;
  assert.equal(recoveredBackup.version, 2);
  assert.equal(recoveredBackup.annotations.length, 2);
  const copy = recoveredBackup.annotations.find((a) => a.recovery);
  assert.equal(copy.recovery.conversation, recoverySource);
  assert.equal(copy.originalUrl, seed.url);
  assert.equal(copy.conversation, row.conversation);
  await command("Page.reload", {}, source);
  await until(async () => {
    try {
      return (await toPage({ type: "scroll", id: copy.id })).ok;
    } catch {
      return false;
    }
  });
  assert.equal(
    (
      await send({
        type: "delete",
        conversation: copy.conversation,
        id: copy.id,
      })
    ).ok,
    true,
  );
  assert.equal(
    (await send({ type: "export" })).backup.annotations[0].note,
    "Original note",
  );
  console.log(
    "PASS: generic recovery UI preview, explicit confirmation, preserved original, strict reload restoration, and independent deletion.",
  );
  console.log(`Isolated test profile and generated exports: ${work}`);
} finally {
  child.kill();
  server.close();
}
