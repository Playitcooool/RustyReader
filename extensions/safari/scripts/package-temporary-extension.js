import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const safariDir = join(root, "extensions/safari");
const extensionDir = join(safariDir, "build/extension");
const outputDir = join(safariDir, "dist");
const zipPath = join(outputDir, "rustyreader-safari-temporary-extension.zip");

if (!existsSync(extensionDir)) {
  const build = spawnSync("npm", ["run", "build"], { cwd: safariDir, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

mkdirSync(outputDir, { recursive: true });
rmSync(zipPath, { force: true });

execFileSync("zip", ["-qr", zipPath, "manifest.json", "extension"], {
  cwd: extensionDir,
  stdio: "inherit"
});

console.log(`Safari temporary extension archive: ${zipPath}`);
