import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const safariDir = join(root, "extensions/safari");
const output = join(safariDir, "build/extension");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(join(safariDir, "manifest.json"), join(output, "manifest.json"));
cpSync(join(root, "extensions/chrome/extension"), join(output, "extension"), { recursive: true });

console.log(`Built Safari extension at ${output}`);
