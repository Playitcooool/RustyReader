import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const version = "0.1.0";
const distDir = "dist";
const zipPath = `${distDir}/paper-reader-connector-v${version}.zip`;

mkdirSync(distDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync("zip", ["-qr", zipPath, "manifest.json", "extension"], { stdio: "inherit" });

console.log(zipPath);
