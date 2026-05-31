import { clamp } from "../../lib/viewMath";

export type PdfInkPoint = {
  x: number;
  y: number;
};

export type PdfInkAnchor = {
  type: "pdf_ink";
  page: number;
  color: string;
  width: number;
  points: PdfInkPoint[];
};

export const DEFAULT_PDF_INK_COLOR = "#f28b53";
export const DEFAULT_PDF_INK_WIDTH = 4;
export const DEFAULT_PDF_ERASER_SIZE = 24;
export const MIN_PDF_INK_WIDTH = 1;
export const MAX_PDF_INK_WIDTH = 24;
export const MIN_PDF_ERASER_SIZE = 8;
export const MAX_PDF_ERASER_SIZE = 72;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const normalizePdfInkColor = (value: unknown) => {
  if (typeof value !== "string") return DEFAULT_PDF_INK_COLOR;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : DEFAULT_PDF_INK_COLOR;
};

export const normalizePdfInkWidth = (value: unknown) =>
  isFiniteNumber(value) ? Math.round(clamp(value, MIN_PDF_INK_WIDTH, MAX_PDF_INK_WIDTH)) : DEFAULT_PDF_INK_WIDTH;

export const normalizePdfEraserSize = (value: unknown) =>
  isFiniteNumber(value) ? Math.round(clamp(value, MIN_PDF_ERASER_SIZE, MAX_PDF_ERASER_SIZE)) : DEFAULT_PDF_ERASER_SIZE;

export const parsePdfInkAnchor = (anchor: string): PdfInkAnchor | null => {
  try {
    const parsed = JSON.parse(anchor) as Record<string, unknown>;
    if (!parsed || parsed.type !== "pdf_ink") return null;
    if (!isFiniteNumber(parsed.page) || parsed.page < 1) return null;
    if (!Array.isArray(parsed.points) || parsed.points.length < 2) return null;
    const points = parsed.points
      .map((point) => {
        if (!point || typeof point !== "object") return null;
        const record = point as Record<string, unknown>;
        if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y)) return null;
        return {
          x: clamp(record.x, 0, 1),
          y: clamp(record.y, 0, 1),
        };
      })
      .filter((point): point is PdfInkPoint => Boolean(point));
    if (points.length < 2) return null;
    return {
      type: "pdf_ink",
      page: Math.max(1, Math.floor(parsed.page)),
      color: normalizePdfInkColor(parsed.color),
      width: normalizePdfInkWidth(parsed.width),
      points,
    };
  } catch {
    return null;
  }
};
