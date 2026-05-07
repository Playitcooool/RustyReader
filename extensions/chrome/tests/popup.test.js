import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const testDir = dirname(fileURLToPath(import.meta.url));

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${functionName}`);
}

test("popup exposes retry, rescan, and collapsible connector settings", () => {
  const html = readFileSync(join(testDir, "../extension/popup/popup.html"), "utf8");

  assert.match(html, /id="toggleConfigButton"/);
  assert.match(html, /id="retryButton"/);
  assert.match(html, /id="rescanButton"/);
  assert.match(html, /config-card is-collapsed/);
});

test("popup no longer auto-imports a single detected file", () => {
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");
  const scanPage = extractFunctionSource(source, "scanPage");

  assert.doesNotMatch(source, /Importing automatically/);
  assert.doesNotMatch(scanPage, /importCandidate/);
  assert.match(scanPage, /Choose Import when ready/);
});

test("popup discovers connector and requests import capabilities", () => {
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");

  assert.match(source, /discoverConnectorUrl/);
  assert.match(source, /paper-reader:get-capabilities/);
  assert.match(source, /Upload to Paper Reader/);
  assert.match(source, /Download then import/);
});

test("popup persists discovered connector URL before background calls", () => {
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");
  const discoverConnector = extractFunctionSource(source, "discoverConnector");

  assert.match(discoverConnector, /connectorUrlInput\.value = connectorUrl/);
  assert.match(discoverConnector, /await saveConfig\(\{ quiet: true \}\)/);
});
