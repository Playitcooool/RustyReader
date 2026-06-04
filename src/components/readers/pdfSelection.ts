import { clamp } from "../../lib/viewMath";

export type PdfHighlightColor = "yellow" | "red" | "green" | "blue" | "purple";

export type PdfTextAnchor = {
  type: "pdf_text";
  page: number; // 1-based
  startDivIndex: number;
  startOffset: number;
  endDivIndex: number;
  endOffset: number;
  quote: string;
  // Optional, used by PDF Focus highlight bar. Persisted inside anchor JSON for backward compatibility.
  color?: PdfHighlightColor;
};

export type PdfSelectionRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type PdfTextSelection = {
  anchor: string;
  quote: string;
  rect: PdfSelectionRect;
};

export const parsePdfTextAnchor = (anchor: string): PdfTextAnchor | null => {
  try {
    const parsed = JSON.parse(anchor) as Partial<PdfTextAnchor>;
    if (parsed.type !== "pdf_text") return null;
    if (typeof parsed.page !== "number") return null;
    if (typeof parsed.startDivIndex !== "number") return null;
    if (typeof parsed.startOffset !== "number") return null;
    if (typeof parsed.endDivIndex !== "number") return null;
    if (typeof parsed.endOffset !== "number") return null;
    if (typeof parsed.quote !== "string") return null;
    if (parsed.color !== undefined) {
      if (
        parsed.color !== "yellow" &&
        parsed.color !== "red" &&
        parsed.color !== "green" &&
        parsed.color !== "blue" &&
        parsed.color !== "purple"
      ) {
        return null;
      }
    }
    return parsed as PdfTextAnchor;
  } catch {
    return null;
  }
};

const sanitizeClientRectNumber = (value: number) => (Number.isFinite(value) ? value : 0);

export const selectionRectFromRange = (range: Range): PdfSelectionRect => {
  const rects = typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
  const rect =
    rects.length > 0
      ? rects[rects.length - 1]
      : typeof (range as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect === "function"
        ? (range as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect()
        : ({ left: 0, top: 0, right: 0, bottom: 0 } as const);
  return {
    left: sanitizeClientRectNumber(rect.left),
    top: sanitizeClientRectNumber(rect.top),
    right: sanitizeClientRectNumber(rect.right),
    bottom: sanitizeClientRectNumber(rect.bottom),
  };
};

const globalOffsetWithinHost = (host: HTMLElement, container: Node, offset: number) => {
  if (!host.contains(container) && host !== container) return null;
  const range = document.createRange();
  range.selectNodeContents(host);
  try {
    range.setEnd(container, offset);
  } catch {
    return null;
  }
  return range.toString().length;
};

const rangeIntersectsNodeSafely = (range: Range, node: Node) => {
  try {
    if (typeof range.intersectsNode === "function") return range.intersectsNode(node);
  } catch {
    // Fall through to a boundary comparison below.
  }

  try {
    const nodeRange = document.createRange();
    nodeRange.selectNodeContents(node);
    return (
      range.compareBoundaryPoints(Range.END_TO_START, nodeRange) > 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0
    );
  } catch {
    return false;
  }
};

export const rangeIntersectsPdfTextLayer = (range: Range, host: HTMLElement) => {
  if (host.contains(range.startContainer) || host.contains(range.endContainer)) return true;
  return rangeIntersectsNodeSafely(range, host);
};

const textBoundaryNode = (root: Node, edge: "first" | "last") => {
  if (root.nodeType === Node.TEXT_NODE) return root;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  if (edge === "first") return node;

  let last: Node | null = node;
  while (node) {
    last = node;
    node = walker.nextNode();
  }
  return last;
};

const clampRangeToTextLayer = (range: Range, host: HTMLElement, divs: HTMLElement[]) => {
  if (host.contains(range.startContainer) && host.contains(range.endContainer)) {
    return { startContainer: range.startContainer, startOffset: range.startOffset, endContainer: range.endContainer, endOffset: range.endOffset };
  }

  const selectedDivs = divs.filter((div) => rangeIntersectsNodeSafely(range, div));
  const firstDiv = selectedDivs[0];
  const lastDiv = selectedDivs[selectedDivs.length - 1];
  if (!firstDiv || !lastDiv) return null;

  const firstText = textBoundaryNode(firstDiv, "first");
  const lastText = textBoundaryNode(lastDiv, "last");
  if (!firstText || !lastText) return null;

  const startInside = host.contains(range.startContainer);
  const endInside = host.contains(range.endContainer);
  return {
    startContainer: startInside ? range.startContainer : firstText,
    startOffset: startInside ? range.startOffset : 0,
    endContainer: endInside ? range.endContainer : lastText,
    endOffset: endInside ? range.endOffset : lastText.textContent?.length ?? 0,
  };
};

const mapGlobalOffsetToDiv = (
  globalOffset: number,
  lengths: number[],
  bias: "start" | "end",
): { divIndex: number; offset: number } | null => {
  if (lengths.length === 0) return null;
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const clamped = clamp(globalOffset, 0, totalLength);

  let cursor = 0;
  for (let divIndex = 0; divIndex < lengths.length; divIndex += 1) {
    const length = lengths[divIndex];
    const start = cursor;
    const end = cursor + length;

    if (bias === "start") {
      if (clamped < end || (length === 0 && clamped === start)) {
        return { divIndex, offset: clamp(clamped - start, 0, length) };
      }
      if (clamped === end && divIndex === lengths.length - 1) {
        return { divIndex, offset: length };
      }
    } else if (clamped <= end) {
      return { divIndex, offset: clamp(clamped - start, 0, length) };
    }

    cursor = end;
  }

  return { divIndex: lengths.length - 1, offset: lengths[lengths.length - 1] };
};

export const buildPdfTextSelectionFromRange = (input: {
  quote: string;
  range: Range;
  host: HTMLElement;
  divs: HTMLElement[];
  pageNumber1: number;
}): PdfTextSelection | null => {
  const { quote, range, host, divs, pageNumber1 } = input;
  if (!quote || quote.trim().length === 0) return null;
  if (divs.length === 0) return null;
  if (!rangeIntersectsPdfTextLayer(range, host)) return null;

  const clampedRange = clampRangeToTextLayer(range, host, divs);
  if (!clampedRange) return null;
  const anchorRange = document.createRange();
  try {
    anchorRange.setStart(clampedRange.startContainer, clampedRange.startOffset);
    anchorRange.setEnd(clampedRange.endContainer, clampedRange.endOffset);
  } catch {
    return null;
  }
  const anchorQuote = anchorRange.toString() || quote;
  if (!anchorQuote.trim()) return null;

  const startGlobal = globalOffsetWithinHost(host, clampedRange.startContainer, clampedRange.startOffset);
  const endGlobal = globalOffsetWithinHost(host, clampedRange.endContainer, clampedRange.endOffset);
  if (startGlobal === null || endGlobal === null) return null;

  const lengths = divs.map((div) => div.textContent?.length ?? 0);
  const start = mapGlobalOffsetToDiv(Math.min(startGlobal, endGlobal), lengths, "start");
  const end = mapGlobalOffsetToDiv(Math.max(startGlobal, endGlobal), lengths, "end");
  if (!start || !end) return null;

  const anchor: PdfTextAnchor = {
    type: "pdf_text",
    page: pageNumber1,
    startDivIndex: start.divIndex,
    startOffset: start.offset,
    endDivIndex: end.divIndex,
    endOffset: end.offset,
    quote: anchorQuote,
  };
  return { anchor: JSON.stringify(anchor), quote: anchorQuote, rect: selectionRectFromRange(range) };
};
