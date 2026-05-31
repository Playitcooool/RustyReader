import { describe, expect, it } from "vitest";

import { pickPdfPageTextSource, shouldFallbackToPdfOcr } from "./pdfTextSource";

describe("pdfTextSource", () => {
  it("classifies empty and native text sources", () => {
    expect(pickPdfPageTextSource([])).toBe("none");
    expect(pickPdfPageTextSource([""])).toBe("native");
    expect(pickPdfPageTextSource(["Introduction"])).toBe("native");
  });

  it("falls back to OCR when extracted text is empty after trimming", () => {
    expect(shouldFallbackToPdfOcr([])).toBe(true);
    expect(shouldFallbackToPdfOcr(["", "  "])).toBe(true);
  });

  it("keeps native text when suspicious characters are absent or rare", () => {
    expect(shouldFallbackToPdfOcr(["This extracted sentence looks normal."])).toBe(false);
    expect(shouldFallbackToPdfOcr(["This has one replacement char \uFFFD in a long enough sentence."])).toBe(false);
  });

  it("falls back to OCR when suspicious characters dominate the text", () => {
    expect(shouldFallbackToPdfOcr(["\uFFFD\uFFFD\uFFFDabc"])).toBe(true);
    expect(shouldFallbackToPdfOcr(["\uE000\uE001 private use glyphs"])).toBe(false);
    expect(shouldFallbackToPdfOcr(["\uE000\uE001\uE002\uE003 short"])).toBe(true);
  });
});
