import { spawnSync } from "node:child_process";

const xcodeDeveloperDir =
  process.env.DEVELOPER_DIR || "/Volumes/Samsung/Applications/Xcode.app/Contents/Developer";

function run(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("Build Chrome extension", "npm", ["run", "extension:package"]);
run("Build Safari extension directory", "npm", ["run", "extension:safari:build"]);
run("Package Safari Extension App project", "npm", ["run", "extension:safari:package"], {
  env: {
    ...process.env,
    DEVELOPER_DIR: xcodeDeveloperDir
  }
});

console.log("\nBrowser extension outputs:");
console.log("- Chrome unpacked: extensions/chrome/dist/rustyreader-connector");
console.log("- Chrome zip: extensions/chrome/dist/rustyreader-connector-v0.1.0.zip");
console.log("- Safari web extension input: extensions/safari/build/extension");
console.log("- Safari Xcode project: extensions/safari/build/RustyReaderSafari");
