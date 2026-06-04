import { describe, expect, it } from "vitest";

import {
  toPdfDocumentInfo,
  toPdfInitialPageBundle,
  toPdfOutlineItems,
  toPdfPageBundle,
  toPdfPageLinks,
  toPdfPageText,
  toPdfSearchResult,
  toUint8Array,
} from "./pdfEngineResponses";

describe("pdfEngineResponses", () => {
  it("normalizes byte payload shapes to Uint8Array", () => {
    expect(Array.from(toUint8Array(new Uint8Array([1, 2])))).toEqual([1, 2]);
    expect(Array.from(toUint8Array([3, 4]))).toEqual([3, 4]);
    expect(Array.from(toUint8Array({ data: [5, 6] }))).toEqual([5, 6]);
  });

  it("normalizes page bundle and text responses", () => {
    const bundle = toPdfPageBundle({
      png_bytes: [137, 80],
      width_px: "800",
      height_px: 1000,
      page_width_pt: 612,
      page_height_pt: "792",
      spans: [{ text: "hello", x0: "1", y0: 2, x1: 3, y1: "4" }],
    });

    expect(Array.from(bundle.png_bytes)).toEqual([137, 80]);
    expect(bundle.width_px).toBe(800);
    expect(bundle.page_height_pt).toBe(792);
    expect(bundle.spans).toEqual([{ text: "hello", x0: 1, y0: 2, x1: 3, y1: 4 }]);

    expect(toPdfPageText({ page_index0: "2", spans: [{ text: "page", x0: 0, y0: 1, x1: 2, y1: 3 }] })).toEqual({
      page_index0: 2,
      spans: [{ text: "page", x0: 0, y0: 1, x1: 2, y1: 3 }],
    });
  });

  it("normalizes document info, outline, initial bundle, and search responses", () => {
    expect(toPdfDocumentInfo({ page_count: "2", pages: [{ width_pt: "612", height_pt: 792 }] })).toEqual({
      page_count: 2,
      pages: [{ width_pt: 612, height_pt: 792 }],
    });

    expect(
      toPdfOutlineItems([
        {
          id: "root",
          title: "Root",
          page_index0: "0",
          children: [{ id: "child", title: "Child", page_index0: 1 }],
        },
      ]),
    ).toEqual([{ id: "root", title: "Root", page_index0: 0, children: [{ id: "child", title: "Child", page_index0: 1, children: [] }] }]);

    expect(toPdfPageLinks([{ id: "link", page_index0: "0", x0: "1", y0: 2, x1: 3, y1: "4", target_page_index0: "5" }])).toEqual([
      { id: "link", page_index0: 0, x0: 1, y0: 2, x1: 3, y1: 4, target_page_index0: 5 },
    ]);

    const initial = toPdfInitialPageBundle({
      document_info: { page_count: 1, pages: [{ width_pt: 612, height_pt: 792 }] },
      bundle: { png_bytes: [1], width_px: 10, height_px: 20, page_width_pt: 612, page_height_pt: 792, spans: [] },
    });
    expect(initial.document_info.page_count).toBe(1);
    expect(initial.bundle.width_px).toBe(10);

    expect(toPdfSearchResult({ matches: [{ page_index0: "1", span_index: 2, start: "3", end: 4 }] })).toEqual({
      total: 1,
      matches: [{ page_index0: 1, span_index: 2, start: 3, end: 4 }],
    });
  });
});
