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

test("popup quick-saves a single detected file after a countdown", () => {
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");
  const scanPage = extractFunctionSource(source, "scanPage");
  const scheduleAutoImport = extractFunctionSource(source, "scheduleAutoImport");
  const updateAutoImportCountdown = extractFunctionSource(source, "updateAutoImportCountdown");
  const autoImportIsEligible = extractFunctionSource(source, "autoImportIsEligible");

  assert.match(source, /AUTO_IMPORT_DELAY_MS = 5000/);
  assert.match(scanPage, /await sendMessage/);
  assert.match(scanPage, /renderCandidates\(\);/);
  assert.match(scanPage, /scheduleAutoImport\(\);/);
  assert.match(scanPage, /Choose Import when ready/);
  assert.match(autoImportIsEligible, /state\.collectionsLoaded/);
  assert.match(autoImportIsEligible, /state\.candidates\.length === 1/);
  assert.match(autoImportIsEligible, /hasValidSelectedCollection\(\)/);
  assert.match(scheduleAutoImport, /cancelAutoImport\(\)/);
  assert.match(scheduleAutoImport, /setTimeout/);
  assert.match(scheduleAutoImport, /AUTO_IMPORT_DELAY_MS/);
  assert.match(scheduleAutoImport, /importCandidate\(state\.candidates\[0\]\)/);
  assert.match(updateAutoImportCountdown, /Auto-saving in \$\{secondsRemaining\}s/);
});

test("popup discovers connector and requests import capabilities", () => {
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");

  assert.match(source, /discoverConnectorUrl/);
  assert.match(source, /paper-reader:get-capabilities/);
  assert.match(source, /Upload to RustyReader/);
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
  assert.match(runConnectorCycle, /Waiting for RustyReader/);
  assert.match(scanPage, /!state\.collectionsLoaded/);
  assert.doesNotMatch(discoverConnector, /saveConfig/);
  assert.doesNotMatch(source, /connectorUrlInput/);
});

test("popup disables imports until collections are loaded", () => {
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");
  const updateActionAvailability = extractFunctionSource(source, "updateActionAvailability");
  const renderCandidates = extractFunctionSource(source, "renderCandidates");

  assert.match(updateActionAvailability, /hasValidSelectedCollection\(\)/);
  assert.match(updateActionAvailability, /button\.disabled = state\.busy \|\| !hasCollection/);
  assert.match(renderCandidates, /button\.disabled = state\.busy \|\| !state\.collectionsLoaded/);
});

test("popup requires a valid saved collection before quick-save", () => {
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");
  const hasValidSelectedCollection = extractFunctionSource(source, "hasValidSelectedCollection");
  const renderCollections = extractFunctionSource(source, "renderCollections");

  assert.match(hasValidSelectedCollection, /state\.collectionsLoaded/);
  assert.match(hasValidSelectedCollection, /state\.collections\.some\(\(collection\) => collection\.id === selectedId\)/);
  assert.match(renderCollections, /hasLastCollection/);
  assert.match(renderCollections, /Choose collection/);
  assert.match(renderCollections, /hasLastCollection && row\.id === state\.config\?\.lastCollectionId/);
});

test("popup cancels and restarts quick-save on user actions", () => {
  const source = readFileSync(join(testDir, "../extension/popup/popup.js"), "utf8");
  const scheduleConnectorRetry = extractFunctionSource(source, "scheduleConnectorRetry");
  const scanPage = extractFunctionSource(source, "scanPage");
  const importCandidate = extractFunctionSource(source, "importCandidate");
  const cancelAutoImport = extractFunctionSource(source, "cancelAutoImport");

  assert.match(cancelAutoImport, /clearTimeout\(state\.autoImportTimer\)/);
  assert.match(scheduleConnectorRetry, /cancelAutoImport\(\)/);
  assert.match(scanPage, /cancelAutoImport\(\)/);
  assert.match(importCandidate, /cancelAutoImport\(\)/);
  assert.match(source, /#refreshButton[\s\S]*cancelAutoImport\(\);[\s\S]*scheduleConnectorRetry\(0\)/);
  assert.match(source, /#scanButton[\s\S]*cancelAutoImport\(\);[\s\S]*scanPage\(\)/);
  assert.match(source, /#rescanButton[\s\S]*cancelAutoImport\(\);[\s\S]*scanPage\(\)/);
  assert.match(source, /retryButton\.addEventListener[\s\S]*cancelAutoImport\(\);/);
  assert.match(source, /collectionSelect\.addEventListener[\s\S]*saveConfig\(\{ quiet: true \}\)[\s\S]*\.then\(\(\) => scheduleAutoImport\(\)\)/);
});
