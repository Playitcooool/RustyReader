import type {
  PdfDocumentInfo,
  PdfInitialPageBundle,
  PdfOutlineItem,
  PdfPageBundle,
  PdfPageLink,
  PdfPageText,
  PdfSearchResult,
  PdfTextSpan,
} from "./contracts";

export const toUint8Array = (value: unknown): Uint8Array => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (
    value &&
    typeof value === "object" &&
    "data" in value &&
    Array.isArray((value as { data: unknown }).data)
  ) {
    return Uint8Array.from((value as { data: number[] }).data);
  }
  throw new Error("Unexpected attachment byte response.");
};

const asObject = (value: unknown, errorMessage: string): Record<string, unknown> => {
  if (!value || typeof value !== "object") throw new Error(errorMessage);
  return value as Record<string, unknown>;
};

export const toPdfSpans = (value: unknown): PdfTextSpan[] =>
  Array.isArray(value)
    ? value.map((span) => {
        const s = span && typeof span === "object" ? (span as Record<string, unknown>) : {};
        return {
          text: typeof s.text === "string" ? s.text : "",
          x0: Number(s.x0),
          y0: Number(s.y0),
          x1: Number(s.x1),
          y1: Number(s.y1),
        };
      })
    : [];

export const toPdfPageBundle = (value: unknown): PdfPageBundle => {
  const obj = asObject(value, "Unexpected PDF page bundle response.");
  return {
    png_bytes: toUint8Array(obj.png_bytes),
    width_px: Number(obj.width_px),
    height_px: Number(obj.height_px),
    page_width_pt: Number(obj.page_width_pt),
    page_height_pt: Number(obj.page_height_pt),
    spans: toPdfSpans(obj.spans),
  };
};

export const toPdfDocumentInfo = (value: unknown): PdfDocumentInfo => {
  const obj = asObject(value, "Unexpected PDF document info response.");
  return {
    page_count: Number(obj.page_count),
    pages: Array.isArray(obj.pages)
      ? obj.pages.map((page) => {
          const p = page && typeof page === "object" ? (page as Record<string, unknown>) : {};
          return {
            width_pt: Number(p.width_pt),
            height_pt: Number(p.height_pt),
          };
        })
      : [],
  };
};

export const toPdfPageText = (value: unknown): PdfPageText => {
  const obj = asObject(value, "Unexpected PDF page text response.");
  return {
    page_index0: Number(obj.page_index0),
    spans: toPdfSpans(obj.spans),
  };
};

export const toPdfInitialPageBundle = (value: unknown): PdfInitialPageBundle => {
  const obj = asObject(value, "Unexpected PDF initial bundle response.");
  return {
    document_info: toPdfDocumentInfo(obj.document_info),
    bundle: toPdfPageBundle(obj.bundle),
  };
};

export const toPdfOutlineItems = (value: unknown): PdfOutlineItem[] =>
  Array.isArray(value)
    ? value.map((item) => {
        const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return {
          id: typeof obj.id === "string" ? obj.id : "",
          title: typeof obj.title === "string" ? obj.title : "",
          page_index0: Number(obj.page_index0),
          children: toPdfOutlineItems(obj.children),
        };
      })
    : [];

export const toPdfPageLinks = (value: unknown): PdfPageLink[] =>
  Array.isArray(value)
    ? value.map((link) => {
        const obj = link && typeof link === "object" ? (link as Record<string, unknown>) : {};
        return {
          id: typeof obj.id === "string" ? obj.id : "",
          page_index0: Number(obj.page_index0),
          x0: Number(obj.x0),
          y0: Number(obj.y0),
          x1: Number(obj.x1),
          y1: Number(obj.y1),
          target_page_index0: Number(obj.target_page_index0),
        };
      })
    : [];

export const toPdfSearchResult = (value: unknown): PdfSearchResult => {
  const obj = asObject(value, "Unexpected PDF search response.");
  const matches = Array.isArray(obj.matches)
    ? obj.matches.map((match) => {
        const m = match && typeof match === "object" ? (match as Record<string, unknown>) : {};
        return {
          page_index0: Number(m.page_index0),
          span_index: Number(m.span_index),
          start: Number(m.start),
          end: Number(m.end),
        };
      })
    : [];
  return {
    total: Number(obj.total ?? matches.length),
    matches,
  };
};
