export type PdfTextBoxAnchor = {
  type: "pdf_text_box";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: PdfTextBoxColor;
  fontSize?: number;
};

export const pdfTextBoxColors = ["black", "red", "green", "blue", "purple"] as const;
export type PdfTextBoxColor = (typeof pdfTextBoxColors)[number];
export const DEFAULT_PDF_TEXT_BOX_COLOR: PdfTextBoxColor = "black";
export const DEFAULT_PDF_TEXT_BOX_FONT_SIZE = 13;
export const MIN_PDF_TEXT_BOX_FONT_SIZE = 10;
export const MAX_PDF_TEXT_BOX_FONT_SIZE = 24;

export const clampAnchorUnit = (value: number) => Math.max(0, Math.min(1, value));
export const clampPdfTextBoxFontSize = (value: number) =>
  Math.max(MIN_PDF_TEXT_BOX_FONT_SIZE, Math.min(MAX_PDF_TEXT_BOX_FONT_SIZE, Math.round(value)));

export function normalizePdfTextBoxColor(value: unknown): PdfTextBoxColor {
  return typeof value === "string" && (pdfTextBoxColors as readonly string[]).includes(value)
    ? value as PdfTextBoxColor
    : DEFAULT_PDF_TEXT_BOX_COLOR;
}

export function normalizePdfTextBoxFontSize(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clampPdfTextBoxFontSize(value)
    : DEFAULT_PDF_TEXT_BOX_FONT_SIZE;
}

export function parsePdfTextBoxAnchor(anchor: string): PdfTextBoxAnchor | null {
  try {
    const parsed = JSON.parse(anchor) as Partial<PdfTextBoxAnchor>;
    if (!parsed || parsed.type !== "pdf_text_box") return null;
    const values = [parsed.page, parsed.x, parsed.y, parsed.width, parsed.height];
    if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
    if ((parsed.width ?? 0) <= 0 || (parsed.height ?? 0) <= 0) return null;
    return {
      type: "pdf_text_box",
      page: parsed.page!,
      x: clampAnchorUnit(parsed.x!),
      y: clampAnchorUnit(parsed.y!),
      width: clampAnchorUnit(parsed.width!),
      height: clampAnchorUnit(parsed.height!),
      color: normalizePdfTextBoxColor(parsed.color),
      fontSize: normalizePdfTextBoxFontSize(parsed.fontSize),
    };
  } catch {
    return null;
  }
}
