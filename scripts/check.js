import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
for (const directory of ["src", "scripts", "tests"]) {
  for (const file of await readdir(directory)) {
    if (file.endsWith(".js"))
      execFileSync(process.execPath, ["--check", `${directory}/${file}`], {
        stdio: "inherit",
      });
  }
}
