import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const firefox = JSON.parse(await readFile("public/manifest.json", "utf8"));
const chromium = structuredClone(firefox);
delete chromium.browser_specific_settings;
delete chromium.sidebar_action;
chromium.minimum_chrome_version = "116";
chromium.background = { service_worker: "background.js" };
chromium.permissions.push("sidePanel");
chromium.side_panel = { default_path: "sidebar.html" };

for (const [outdir, manifest, target] of [
  ["dist", firefox, "firefox140"],
  ["dist-chromium", chromium, "chrome116"],
]) {
  await mkdir(outdir, { recursive: true });
  await writeFile(
    `${outdir}/manifest.json`,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await Promise.all([
    ...["highlights.css", "sidebar.css", "transfer.css"].map((file) =>
      cp(`public/${file}`, `${outdir}/${file}`),
    ),
    ...["sidebar.html", "transfer.html"].map((file) =>
      cp(file, `${outdir}/${file}`),
    ),
  ]);
  await build({
    entryPoints: [
      "src/content.js",
      "src/background.js",
      "src/sidebar.js",
      "src/transfer-page.js",
    ],
    bundle: true,
    outdir,
    format: "iife",
    target,
    minify: true,
  });
}
