import {
  DEFAULT_CONNECTOR_URL,
  DOWNLOAD_FOLDER,
  MENU_ID_SAVE_LINK,
  STORAGE_KEYS
} from "./shared/constants.js";
import { classifyUrl, dedupeCandidates, sanitizeFilename } from "./shared/file-detection.js";
import { fetchCollections, importMarkdown, importPath } from "./shared/connector-client.js";

const downloadJobs = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID_SAVE_LINK,
    title: "Save to Paper Reader",
    contexts: ["link"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID_SAVE_LINK || !info.linkUrl) return;
  void handleContextMenuImport(info.linkUrl, tab?.url || info.pageUrl || info.frameUrl || "");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "paper-reader:get-state") {
    void getState().then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === "paper-reader:save-config") {
    void saveConfig(message.payload).then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === "paper-reader:load-collections") {
    void loadCollections().then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === "paper-reader:detect-page-files") {
    void detectPageFiles(message.tabId).then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === "paper-reader:import-candidate") {
    void importCandidate(message.payload, sender.tab?.id).then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }

  return undefined;
});

async function getConfig() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get([
      STORAGE_KEYS.connectorUrl,
      STORAGE_KEYS.connectorToken,
      STORAGE_KEYS.lastCollectionId
    ]),
    chrome.storage.local.get([STORAGE_KEYS.connectorToken])
  ]);

  const legacySyncToken = synced[STORAGE_KEYS.connectorToken] || "";
  const localToken = local[STORAGE_KEYS.connectorToken] || "";
  if (legacySyncToken) {
    if (!localToken) {
      await chrome.storage.local.set({ [STORAGE_KEYS.connectorToken]: legacySyncToken });
    }
    await chrome.storage.sync.remove(STORAGE_KEYS.connectorToken);
  }

  return {
    connectorUrl: synced[STORAGE_KEYS.connectorUrl] || DEFAULT_CONNECTOR_URL,
    connectorToken: localToken || legacySyncToken,
    lastCollectionId: synced[STORAGE_KEYS.lastCollectionId] ?? null
  };
}

async function saveConfig(payload) {
  await Promise.all([
    chrome.storage.sync.set({
      [STORAGE_KEYS.connectorUrl]: payload.connectorUrl?.trim() || DEFAULT_CONNECTOR_URL,
      [STORAGE_KEYS.lastCollectionId]: payload.lastCollectionId ?? null
    }),
    chrome.storage.local.set({
      [STORAGE_KEYS.connectorToken]: payload.connectorToken?.trim() || ""
    }),
    chrome.storage.sync.remove(STORAGE_KEYS.connectorToken)
  ]);
  return { ok: true };
}

async function getState() {
  return getConfig();
}

async function loadCollections() {
  const config = await getConfig();
  if (!config.connectorToken) {
    throw new Error("Connector token is required.");
  }

  const collections = await fetchCollections(config.connectorUrl, config.connectorToken);
  return {
    collections,
    config
  };
}

async function detectPageFiles(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const pageUrl = tab.url || "";
  const direct = await detectDirectCandidate(pageUrl);
  if (direct) {
    return { pageUrl, candidates: [direct], mode: "direct" };
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: scanPageCandidates
  });
  const candidates = dedupeCandidates(result?.candidates || []);
  return {
    pageUrl: result?.pageUrl || pageUrl,
    candidates,
    mode: candidates.length <= 1 ? "auto" : "pick"
  };
}

async function detectDirectCandidate(url) {
  if (!url) return null;
  try {
    return await classifyUrl(url);
  } catch {
    return null;
  }
}

async function importCandidate(payload, tabId) {
  const config = await getConfig();
  if (!config.connectorToken) {
    throw new Error("Connector token is required.");
  }

  if (payload.candidate.fileType === "html" || payload.candidate.importType === "markdown") {
    return importHtmlCandidate(payload, config, tabId);
  }

  const download = await downloadToTemp(payload.candidate.url, payload.candidate.title);
  const job = {
    collectionId: payload.collectionId,
    pageUrl: payload.pageUrl,
    sourceUrl: payload.candidate.url,
    downloadId: download.downloadId,
    filename: download.filename,
    localPath: download.localPath
  };

  downloadJobs.set(download.downloadId, job);

  try {
    const result = await importPath(config.connectorUrl, config.connectorToken, {
      collection_id: payload.collectionId,
      path: download.localPath,
      source_url: payload.candidate.url,
      page_url: payload.pageUrl,
      download_id: download.downloadId
    });

    const outcome = summarizeImportResult(result, download.localPath);
    if (outcome.status === "imported" || outcome.status === "duplicate") {
      await cleanupDownload(download.downloadId);
    }

    await chrome.storage.sync.set({ [STORAGE_KEYS.lastCollectionId]: payload.collectionId });

    return {
      ok: true,
      result,
      outcome,
      download,
      tabId
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      download
    };
  } finally {
    downloadJobs.delete(download.downloadId);
  }
}

async function importHtmlCandidate(payload, config, tabId) {
  const result = await importMarkdown(config.connectorUrl, config.connectorToken, {
    collection_id: payload.collectionId,
    title: payload.candidate.title,
    markdown: payload.candidate.markdown,
    source_url: payload.candidate.url,
    page_url: payload.pageUrl
  });
  const outcome = summarizeImportResult(result, payload.candidate.url);
  await chrome.storage.sync.set({ [STORAGE_KEYS.lastCollectionId]: payload.collectionId });
  return {
    ok: true,
    result,
    outcome,
    download: null,
    tabId
  };
}

async function handleContextMenuImport(linkUrl, pageUrl) {
  const config = await getConfig();
  if (!config.lastCollectionId) {
    await setBadge("!", "#A33A2B");
    return;
  }

  const candidate = await classifyUrl(linkUrl);
  if (!candidate) {
    await setBadge("?", "#6A5ACD");
    return;
  }

  const response = await importCandidate({
    collectionId: config.lastCollectionId,
    candidate,
    pageUrl
  });

  if (!response.ok) {
    await setBadge("!", "#A33A2B");
    return;
  }

  await setBadge(response.outcome.status === "duplicate" ? "=" : "✓", "#295F4E");
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: "" });
  }, 2500);
}

async function downloadToTemp(url, suggestedName) {
  const extension = suggestedName.includes(".") ? "" : inferExtensionFromUrl(url);
  const safeName = sanitizeFilename(suggestedName || "download") + extension;
  const filename = `${DOWNLOAD_FOLDER}/${Date.now()}-${safeName}`;

  const downloadId = await chrome.downloads.download({
    url,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });

  const downloadItem = await waitForDownload(downloadId);
  return {
    downloadId,
    filename: downloadItem.filename,
    localPath: downloadItem.filename
  };
}

function inferExtensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/(\.[a-z0-9]+)$/i);
    return match ? "" : ".bin";
  } catch {
    return ".bin";
  }
}

function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      chrome.downloads.onChanged.removeListener(onChanged);
      callback(value);
    };

    const inspectCurrentState = () => {
      chrome.downloads.search({ id: downloadId }, (items) => {
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
      if (delta.state?.current === "complete") {
        inspectCurrentState();
      }
      if (delta.state?.current === "interrupted") {
        finish(reject, new Error(delta.error?.current || "Download interrupted."));
      }
    };

    chrome.downloads.onChanged.addListener(onChanged);
    pollTimer = setInterval(inspectCurrentState, 500);
    timeoutTimer = setTimeout(() => finish(reject, new Error("Download did not complete in time.")), 120000);
    inspectCurrentState();
  });
}

async function cleanupDownload(downloadId) {
  try {
    await chrome.downloads.removeFile(downloadId);
  } catch {
    // The file may already be gone; keep cleanup best-effort.
  }

  try {
    await chrome.downloads.erase({ id: downloadId });
  } catch {
    // Ignore download history cleanup failures.
  }
}

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

  if (failed) {
    return { status: "failed", message: failed.message || "Import failed." };
  }

  if (duplicate) {
    return { status: "duplicate", message: duplicate.message || "Duplicate item." };
  }

  if (imported > 0) {
    return { status: "imported", message: `Imported ${imported} file.` };
  }

  return { status: "unknown", message: "Import finished with no matching result." };
}

function defaultImportMessage(status, imported) {
  if (status === "failed") return "Import failed.";
  if (status === "duplicate") return "Duplicate item.";
  if (status === "imported") return `Imported ${imported || 1} file.`;
  return "Import finished.";
}

function scanPageCandidates() {
  function domNodeToMarkdown(root) {
    const blocks = [];
    const walk = (node, listDepth = 0) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName.toLowerCase();
      if (["script", "style", "noscript", "svg", "canvas", "nav", "footer"].includes(tag)) return "";

      const inline = () => Array.from(node.childNodes).map((child) => walk(child, listDepth)).join("").replace(/\s+/g, " ").trim();
      const blockChildren = () => Array.from(node.childNodes).forEach((child) => {
        const text = walk(child, listDepth);
        if (text.trim()) blocks.push(text.trim());
      });

      if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${inline()}`;
      if (tag === "p") return inline();
      if (tag === "br") return "\n";
      if (tag === "a") {
        const text = inline();
        const href = node.getAttribute("href");
        if (!href || !text) return text;
        try {
          return `[${text}](${new URL(href, window.location.href).toString()})`;
        } catch {
          return text;
        }
      }
      if (tag === "img") {
        const alt = node.getAttribute("alt")?.replace(/\s+/g, " ").trim();
        return alt ? `![${alt}]()` : "";
      }
      if (tag === "strong" || tag === "b") return `**${inline()}**`;
      if (tag === "em" || tag === "i") return `*${inline()}*`;
      if (tag === "code") return `\`${inline()}\``;
      if (tag === "pre") return `\`\`\`\n${node.textContent?.trim() || ""}\n\`\`\``;
      if (tag === "blockquote") return inline().split("\n").map((line) => `> ${line}`).join("\n");
      if (tag === "li") return `${"  ".repeat(listDepth)}- ${inline()}`;
      if (tag === "ul" || tag === "ol") {
        return Array.from(node.children).map((child) => walk(child, listDepth + 1)).filter(Boolean).join("\n");
      }
      if (tag === "table") return tableToMarkdown(node);
      if (["article", "main", "section", "div", "body"].includes(tag)) {
        blockChildren();
        return "";
      }
      return inline();
    };
    const top = walk(root);
    if (top.trim()) blocks.push(top.trim());
    return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n");
  }

  function tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll("tr"))
      .map((row) => Array.from(row.children).map((cell) => cell.textContent.replace(/\s+/g, " ").trim()).filter(Boolean))
      .filter((row) => row.length > 0);
    if (rows.length === 0) return "";
    const width = Math.max(...rows.map((row) => row.length));
    const normalized = rows.map((row) => [...row, ...Array(width - row.length).fill("")]);
    const header = normalized[0];
    const separator = Array(width).fill("---");
    return [header, separator, ...normalized.slice(1)]
      .map((row) => `| ${row.join(" | ")} |`)
      .join("\n");
  }

  const supported = ["pdf", "docx", "epub"];
  const seen = new Set();
  const candidates = [];
  const pageUrl = window.location.href;
  const title =
    document.title?.replace(/\s+/g, " ").trim() ||
    document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
    pageUrl;
  const root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector("[role='main']") ||
    document.body;
  const markdown = root ? domNodeToMarkdown(root).trim() : "";
  if (markdown) {
    candidates.push({
      url: pageUrl,
      title,
      fileType: "html",
      fileLabel: "HTML",
      importType: "markdown",
      markdown,
      source: "page-html"
    });
    seen.add(pageUrl);
  }

  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;

    try {
      const url = new URL(href, window.location.href).toString();
      const pathname = new URL(url).pathname.toLowerCase();
      const match = pathname.match(/\.([a-z0-9]+)$/);
      if (!match || !supported.includes(match[1]) || seen.has(url)) continue;

      seen.add(url);
      candidates.push({
        url,
        title: anchor.textContent?.replace(/\s+/g, " ").trim() || anchor.getAttribute("title") || url,
        fileType: match[1],
        fileLabel: match[1].toUpperCase(),
        source: "page-link"
      });
    } catch {
      // Ignore invalid URLs.
    }
  }

  return {
    pageUrl,
    candidates
  };
}
