import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const version = "0.1.0";
const distDir = "dist";
const unpackedDir = `${distDir}/paper-reader-connector`;
const zipPath = `${distDir}/paper-reader-connector-v${version}.zip`;

mkdirSync(distDir, { recursive: true });
rmSync(unpackedDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });

mkdirSync(unpackedDir, { recursive: true });
cpSync("manifest.json", `${unpackedDir}/manifest.json`);
cpSync("extension", `${unpackedDir}/extension`, { recursive: true });

execFileSync("zip", ["-qr", zipPath, "manifest.json", "extension"], { stdio: "inherit" });

console.log(`Chrome unpacked extension: extensions/chrome/${unpackedDir}`);
console.log(`Chrome extension archive: extensions/chrome/${zipPath}`);
