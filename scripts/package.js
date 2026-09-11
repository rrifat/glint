import { mkdtemp, readFile, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const staging = await mkdtemp(join(tmpdir(), "glint-package-"));
// Explicit inputs exclude stale archives or local files left in build folders.
const files = [
  "manifest.json",
  "background.js",
  "content.js",
  "sidebar.js",
  "transfer-page.js",
  "sidebar.html",
  "transfer.html",
  "highlights.css",
  "sidebar.css",
  "transfer.css",
];
for (const [directory, suffix] of [
  ["dist", "firefox.xpi"],
  ["dist-chromium", "chromium.zip"],
]) {
  const name = `glint-${version}-${suffix}`,
    archive = join(staging, name);
  assert.equal(
    JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"))
      .version,
    version,
  );
  execFileSync("zip", ["-q", archive, ...files], { cwd: directory });
  execFileSync("unzip", ["-t", archive]);
  assert.deepEqual(
    execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort(),
    [...files].sort(),
  );
  for (const file of files)
    assert.deepEqual(
      execFileSync("unzip", ["-p", archive, file]),
      await readFile(join(directory, file)),
    );
  await rename(archive, resolve(name));
  console.log(`Created and verified ${name}`);
}
