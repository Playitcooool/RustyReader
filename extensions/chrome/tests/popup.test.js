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

test("popup exposes retry and rescan without connector settings", () => {
  const html = readFileSync(join(testDir, "../extension/popup/popup.html"), "utf8");

  assert.match(html, /id="retryButton"/);
  assert.match(html, /id="rescanButton"/);
  assert.doesNotMatch(html, /id="toggleConfigButton"/);
  assert.doesNotMatch(html, /config-card/);
  assert.doesNotMatch(html, /id="connectorUrl"/);
  assert.doesNotMatch(html, /Save<\/button>/);
  assert.doesNotMatch(html, /Check<\/button>/);
});

test("popup does not expose connector token setup", () => {
  const html = readFileSync(join(testDir, "../extension/popup/popup.html"), "utf8");
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");

  assert.doesNotMatch(html, /connectorToken/);
  assert.doesNotMatch(html, /Token/);
  assert.doesNotMatch(source, /Token required/);
  assert.doesNotMatch(source, /connectorTokenInput/);
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

test("popup starts connector polling after initial setup", () => {
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");
  const initialize = extractFunctionSource(source, "initialize");

  assert.match(initialize, /scheduleConnectorRetry\(0\)/);
  assert.doesNotMatch(initialize, /await discoverConnector\(\);\s*await loadCollections\(\);/);
  assert.match(source, /CONNECTOR_RETRY_DELAY_MS = 2000/);
  assert.match(source, /function scheduleConnectorRetry/);
  assert.match(source, /async function runConnectorCycle/);
});

test("popup retries connector failures and scans after collections load", () => {
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");
  const discoverConnector = extractFunctionSource(source, "discoverConnector");
  const runConnectorCycle = extractFunctionSource(source, "runConnectorCycle");
  const scanPage = extractFunctionSource(source, "scanPage");

  assert.match(discoverConnector, /discoverConnectorUrl\(\)/);
  assert.match(runConnectorCycle, /await discoverConnector\(\);\s*await loadCollections\(\);\s*await scanPage\(\);/);
  assert.match(runConnectorCycle, /scheduleConnectorRetry\(\)/);
  assert.match(runConnectorCycle, /Waiting for Paper Reader/);
  assert.match(scanPage, /!state\.collectionsLoaded/);
  assert.doesNotMatch(discoverConnector, /saveConfig/);
  assert.doesNotMatch(source, /connectorUrlInput/);
});

test("popup disables imports until collections are loaded", () => {
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");
  const updateActionAvailability = extractFunctionSource(source, "updateActionAvailability");
  const renderCandidates = extractFunctionSource(source, "renderCandidates");

  assert.match(updateActionAvailability, /state\.collectionsLoaded && Number\(collectionSelect\.value\) > 0/);
  assert.match(updateActionAvailability, /button\.disabled = state\.busy \|\| !hasCollection/);
  assert.match(renderCandidates, /button\.disabled = state\.busy \|\| !state\.collectionsLoaded/);
});
