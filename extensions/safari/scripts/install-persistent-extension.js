import { existsSync, readdirSync, rmSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const safariDir = join(root, "extensions/safari");
const generatedRoot = join(safariDir, "build/RustyReaderSafari");
const derivedData = join(safariDir, "build/DerivedData");
const appInstallDir = "/Applications";
const appleDevelopmentTeamPattern = /OU=([A-Z0-9]+)/;

function run(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findXcodeProject(rootDir) {
  if (!existsSync(rootDir)) return null;

  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.shift();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory() && entry.name.endsWith(".xcodeproj")) return path;
      if (entry.isDirectory()) pending.push(path);
    }
  }

  return null;
}

function findBuiltApp(rootDir) {
  const productsDir = join(rootDir, "Build/Products/Release");
  if (!existsSync(productsDir)) return null;

  return readdirSync(productsDir)
    .filter((entry) => entry.endsWith(".app"))
    .map((entry) => join(productsDir, entry))[0] ?? null;
}

function findAppleDevelopmentTeamId() {
  const certificate = spawnSync("security", ["find-certificate", "-c", "Apple Development", "-p"], {
    encoding: "utf8"
  });
  if (certificate.status !== 0 || !certificate.stdout.trim()) return null;

  const details = spawnSync("openssl", ["x509", "-noout", "-subject"], {
    encoding: "utf8",
    input: certificate.stdout
  });
  if (details.status !== 0) return null;

  return details.stdout.match(appleDevelopmentTeamPattern)?.[1] ?? null;
}

run("Package Safari Web Extension App project", "npm", ["run", "package"], {
  cwd: safariDir
});

const projectPath = findXcodeProject(generatedRoot);
if (!projectPath) {
  console.error(`Could not find a generated Xcode project under ${generatedRoot}.`);
  process.exit(1);
}

rmSync(derivedData, { recursive: true, force: true });

const developmentTeamId = findAppleDevelopmentTeamId();
const signingArgs = developmentTeamId
  ? [
      `DEVELOPMENT_TEAM=${developmentTeamId}`,
      "CODE_SIGN_STYLE=Automatic",
      "CODE_SIGN_IDENTITY=Apple Development",
      "-allowProvisioningUpdates"
    ]
  : [];

if (!developmentTeamId) {
  console.warn("No Apple Development signing identity found; Safari may require Develop -> Allow Unsigned Extensions.");
}

run("Build Safari Web Extension App", "xcodebuild", [
  "-project",
  projectPath,
  "-scheme",
  "RustyReader Safari (macOS)",
  "-configuration",
  "Release",
  "-derivedDataPath",
  derivedData,
  ...signingArgs,
  "build"
]);

const builtApp = findBuiltApp(derivedData);
if (!builtApp) {
  console.error(`Could not find a built .app under ${derivedData}.`);
  process.exit(1);
}

const installedApp = join(appInstallDir, "RustyReader Safari.app");
rmSync(installedApp, { recursive: true, force: true });
cpSync(builtApp, installedApp, { recursive: true });

run("Refresh Safari extension registration", "pluginkit", [
  "-r",
  join(builtApp, "Contents/PlugIns/RustyReader Safari Extension.appex")
]);
run("Register installed Safari extension", "pluginkit", [
  "-a",
  join(installedApp, "Contents/PlugIns/RustyReader Safari Extension.appex")
]);
run("Open installed Safari Web Extension App", "open", [installedApp]);

console.log("\nInstalled persistent Safari extension app:");
console.log(installedApp);
console.log("\nIn Safari, open Settings -> Extensions and enable RustyReader.");
