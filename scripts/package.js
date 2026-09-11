import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

await mkdir("dist", { recursive: true });
execFileSync("zip", ["-qr", "../glint-0.2.0-firefox.xpi", "."], {
  cwd: "dist",
  stdio: "inherit",
});
execFileSync("zip", ["-qr", "../glint-0.2.0-chromium.zip", "."], {
  cwd: "dist-chromium",
  stdio: "inherit",
});
console.log("Created glint-0.2.0-firefox.xpi and glint-0.2.0-chromium.zip");
