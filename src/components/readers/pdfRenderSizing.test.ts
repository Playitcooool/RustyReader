import { describe, expect, it } from "vitest";

import { bucketPdfRenderWidth } from "./pdfRenderSizing";

describe("pdfRenderSizing", () => {
  it("rounds requested render widths up to stable buckets", () => {
    expect(bucketPdfRenderWidth(0)).toBe(1);
    expect(bucketPdfRenderWidth(1)).toBe(64);
    expect(bucketPdfRenderWidth(64)).toBe(64);
    expect(bucketPdfRenderWidth(65)).toBe(128);
    expect(bucketPdfRenderWidth(127.2)).toBe(128);
  });
});
