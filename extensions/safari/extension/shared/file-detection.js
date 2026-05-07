import { SUPPORTED_CONTENT_TYPES, SUPPORTED_EXTENSIONS } from "./constants.js";

const EXTENSION_LABELS = {
  pdf: "PDF",
  docx: "DOCX",
  epub: "EPUB"
};

function normalizeUrl(candidate) {
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

export function extensionFromPathname(pathname = "") {
  const match = pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;
  return SUPPORTED_EXTENSIONS.includes(match[1]) ? match[1] : null;
}

export function extensionFromContentDisposition(value = "") {
  const match = value.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  if (!match) return null;
  const decoded = decodeURIComponent(match[1].replace(/"/g, "").trim());
  return extensionFromPathname(decoded);
}

export function extensionFromContentType(value = "") {
  const normalized = value.split(";")[0].trim().toLowerCase();
  if (!SUPPORTED_CONTENT_TYPES.includes(normalized)) return null;
  if (normalized === "application/pdf") return "pdf";
  if (normalized === "application/epub+zip") return "epub";
  return "docx";
}

export function detectFileType({ url, contentDisposition = "", contentType = "" }) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;

  const parsedUrl = new URL(normalizedUrl);
  const extension =
    extensionFromPathname(parsedUrl.pathname) ||
    extensionFromContentDisposition(contentDisposition) ||
    extensionFromContentType(contentType);

  if (!extension) return null;

  return {
    extension,
    label: EXTENSION_LABELS[extension] ?? extension.toUpperCase()
  };
}

export function sanitizeFilename(value, fallback = "download") {
  const base = (value || fallback)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (base || fallback).slice(0, 120);
}

export function deriveFilename(url, contentDisposition = "") {
  const fromHeaderMatch = contentDisposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  if (fromHeaderMatch) {
    return sanitizeFilename(decodeURIComponent(fromHeaderMatch[1].replace(/"/g, "")));
  }

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.split("/").filter(Boolean).pop();
    if (pathname) return sanitizeFilename(decodeURIComponent(pathname));
  } catch {
    return sanitizeFilename(fallbackFromUrl(url));
  }

  return sanitizeFilename(fallbackFromUrl(url));
}

function fallbackFromUrl(url) {
  return url.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "download";
}

export async function classifyUrl(url, fetchImpl = fetch) {
  const directType = detectFileType({ url });
  if (directType) {
    return {
      url,
      title: deriveFilename(url),
      fileType: directType.extension,
      fileLabel: directType.label,
      reason: "url-extension"
    };
  }

  const response = await fetchImpl(url, {
    method: "HEAD",
    redirect: "follow"
  });

  const contentDisposition = response.headers.get("content-disposition") || "";
  const contentType = response.headers.get("content-type") || "";
  const detected = detectFileType({
    url: response.url || url,
    contentDisposition,
    contentType
  });

  if (!detected) return null;

  return {
    url: response.url || url,
    title: deriveFilename(response.url || url, contentDisposition),
    fileType: detected.extension,
    fileLabel: detected.label,
    reason: contentDisposition ? "content-disposition" : "content-type"
  };
}

export function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate?.url || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}
