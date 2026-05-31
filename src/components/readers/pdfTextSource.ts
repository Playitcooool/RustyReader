export type PdfPageTextSource = "native" | "ocr" | "none";

const SUSPICIOUS_TEXT_RATIO_THRESHOLD = 0.12;
const SUSPICIOUS_CHAR_RE = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uE000-\uF8FF]/g;

export function pickPdfPageTextSource(strings: string[]): PdfPageTextSource {
  if (strings.length === 0) return "none";
  return "native";
}

export function shouldFallbackToPdfOcr(strings: string[]): boolean {
  const normalized = strings.map((value) => value.trim()).filter(Boolean);
  if (normalized.length === 0) return true;

  const joined = normalized.join(" ");
  if (!joined) return true;

  const suspiciousChars = joined.match(SUSPICIOUS_CHAR_RE) ?? [];
  if (suspiciousChars.length === 0) return false;

  const totalChars = Array.from(joined).length;
  if (totalChars <= 0) return true;
  return suspiciousChars.length / totalChars >= SUSPICIOUS_TEXT_RATIO_THRESHOLD;
}
