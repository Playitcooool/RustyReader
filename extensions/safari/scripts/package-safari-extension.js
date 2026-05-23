import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const safariDir = join(root, "extensions/safari");
const extensionDir = join(safariDir, "build/extension");
const outputDir = join(safariDir, "build/RustyReaderSafari");

const probe = spawnSync("xcrun", ["--find", "safari-web-extension-packager"], { encoding: "utf8" });
if (probe.status !== 0) {
  console.error("Safari packaging requires full Xcode. Install Xcode, then run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.");
  console.error("Command Line Tools alone do not provide `xcrun safari-web-extension-packager`.");
  process.exit(1);
}

if (!existsSync(extensionDir)) {
  const build = spawnSync("npm", ["run", "build"], { cwd: safariDir, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

rmSync(outputDir, { recursive: true, force: true });

const result = spawnSync("xcrun", [
  "safari-web-extension-packager",
  extensionDir,
  "--project-location",
  outputDir,
  "--app-name",
  "RustyReader Safari",
  "--bundle-identifier",
  "com.rustyreader.safari"
], { stdio: "inherit" });

process.exit(result.status ?? 1);
