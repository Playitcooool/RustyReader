import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function summarizeImportResult(result, path) {
  const imported = result.imported?.length || 0;
  const matchingResult = (result.results || []).find((entry) => entry.path === path);
  const duplicate = (result.duplicates || []).find((entry) => entry.path === path);
  const failed = (result.failed || []).find((entry) => entry.path === path);

  if (matchingResult) {
    return {
      status: matchingResult.status,
      message: matchingResult.message || defaultImportMessage(matchingResult.status, imported)
    };
  }

  if (failed) return { status: "failed", message: failed.message || "Import failed." };
  if (duplicate) return { status: "duplicate", message: duplicate.message || "Duplicate item." };
  if (imported > 0) return { status: "imported", message: `Imported ${imported} file.` };
  return { status: "unknown", message: "Import finished with no matching result." };
}

function defaultImportMessage(status, imported) {
  if (status === "failed") return "Import failed.";
  if (status === "duplicate") return "Duplicate item.";
  if (status === "imported") return `Imported ${imported || 1} file.`;
  return "Import finished.";
}

function waitForDownloadWithChrome(chromeApi, downloadId, { pollMs = 10, timeoutMs = 500 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      chromeApi.downloads.onChanged.removeListener(onChanged);
      callback(value);
    };

    const inspectCurrentState = () => {
      chromeApi.downloads.search({ id: downloadId }, (items) => {
        if (settled) return;
        const item = items?.[0];
        if (!item) return;
        if (item.state === "complete") {
          if (!item.filename) {
            finish(reject, new Error("Download completed without a local filename."));
            return;
          }
          finish(resolve, item);
        } else if (item.state === "interrupted") {
          finish(reject, new Error(item.error || "Download interrupted."));
        }
      });
    };

    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") inspectCurrentState();
      if (delta.state?.current === "interrupted") {
        finish(reject, new Error(delta.error?.current || "Download interrupted."));
      }
    };

    chromeApi.downloads.onChanged.addListener(onChanged);
    pollTimer = setInterval(inspectCurrentState, pollMs);
    timeoutTimer = setTimeout(() => finish(reject, new Error("Download did not complete in time.")), timeoutMs);
    inspectCurrentState();
  });
}

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

test("summarizeImportResult reports duplicate for matching path", () => {
  const result = summarizeImportResult(
    {
      imported: [],
      duplicates: [{ path: "/tmp/example.pdf", message: "Already imported" }],
      failed: []
    },
    "/tmp/example.pdf"
  );

  assert.equal(result.status, "duplicate");
});

test("summarizeImportResult reports failure before imported count", () => {
  const result = summarizeImportResult(
    {
      imported: [{ id: 1 }],
      duplicates: [],
      failed: [{ path: "/tmp/example.pdf", message: "collection missing" }]
    },
    "/tmp/example.pdf"
  );

  assert.equal(result.status, "failed");
  assert.equal(result.message, "collection missing");
});

test("summarizeImportResult prefers matching results entry", () => {
  const result = summarizeImportResult(
    {
      imported: [{ id: 1 }],
      duplicates: [],
      failed: [],
      results: [{ path: "/tmp/example.pdf", status: "duplicate", message: "Already present" }]
    },
    "/tmp/example.pdf"
  );

  assert.equal(result.status, "duplicate");
  assert.equal(result.message, "Already present");
});

test("waitForDownload recovers when completion event was missed", async () => {
  const listeners = new Set();
  const chromeApi = {
    downloads: {
      onChanged: {
        addListener(listener) {
          listeners.add(listener);
        },
        removeListener(listener) {
          listeners.delete(listener);
        }
      },
      search(_query, callback) {
        callback([{ id: 42, state: "complete", filename: "/tmp/example.pdf" }]);
      }
    }
  };

  const item = await waitForDownloadWithChrome(chromeApi, 42);
  assert.equal(item.filename, "/tmp/example.pdf");
  assert.equal(listeners.size, 0);
});

test("injected page scanner is self-contained", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(testDir, "../extension/background.js"), "utf8");
  const scanner = extractFunctionSource(source, "scanPageCandidates");

  assert.match(scanner, /function domNodeToMarkdown\(/);
  assert.match(scanner, /function tableToMarkdown\(/);
  assert.equal((source.match(/function domNodeToMarkdown\(/g) || []).length, 1);
  assert.equal((source.match(/function tableToMarkdown\(/g) || []).length, 1);
});

test("readable page scanner emits markdown image nodes", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(testDir, "../extension/background.js"), "utf8");
  const scanner = extractFunctionSource(source, "scanPageCandidates");

  assert.match(scanner, /if \(!src\) return alt/);
  assert.match(scanner, /return `!\[\$\{alt\}\]\(\$\{url\}\)`/);
  assert.doesNotMatch(scanner, /return alt \? `\[\$\{alt\}\]\(\$\{url\}\)` : url/);
});

test("background falls back to upload mode when downloads API is unavailable", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(testDir, "../extension/background.js"), "utf8");

  assert.match(source, /function hasDownloadsApi\(\)/);
  assert.match(source, /paper-reader:get-capabilities/);
  assert.match(source, /if \(!hasDownloadsApi\(\)\) \{\s*return importFileCandidate/);
  assert.match(source, /fetch\(url, \{ credentials: "include" \}\)/);
});

test("background no longer blocks collection load or import on connector token", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(testDir, "../extension/background.js"), "utf8");
  const saveConfig = extractFunctionSource(source, "saveConfig");
  const getConfig = extractFunctionSource(source, "getConfig");

  assert.doesNotMatch(source, /Connector token is required/);
  assert.match(source, /fetchCollections\(DEFAULT_CONNECTOR_URL, config\.connectorToken\)/);
  assert.match(source, /importPath\(DEFAULT_CONNECTOR_URL, config\.connectorToken,/);
  assert.match(source, /importFile\(DEFAULT_CONNECTOR_URL, config\.connectorToken,/);
  assert.match(source, /importMarkdown\(DEFAULT_CONNECTOR_URL, config\.connectorToken,/);
  assert.match(saveConfig, /api\.storage\.sync\.remove\(STORAGE_KEYS\.connectorToken\)/);
  assert.doesNotMatch(saveConfig, /api\.storage\.local\.set/);
  assert.doesNotMatch(getConfig, /STORAGE_KEYS\.connectorUrl/);
  assert.doesNotMatch(saveConfig, /STORAGE_KEYS\.connectorUrl/);
});

test("Safari upload filenames preserve detected file type", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(testDir, "../extension/background.js"), "utf8");
  const filenameFunction = extractFunctionSource(source, "candidateFilename");

  assert.match(source, /candidateFilename\(payload\.candidate\.url, payload\.candidate\.title, payload\.candidate\.fileType\)/);
  assert.match(filenameFunction, /\["pdf", "docx", "epub"\]\.includes\(fileType\)/);
  assert.match(filenameFunction, /`\$\{safeName\}\.\$\{fileType\}`/);
});

test("Safari manifest removes downloads and grants remote host permissions", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(readFileSync(join(testDir, "../../safari/manifest.json"), "utf8"));

  assert.equal(manifest.permissions.includes("downloads"), false);
  assert.ok(manifest.host_permissions.includes("http://*/*"));
  assert.ok(manifest.host_permissions.includes("https://*/*"));
});
