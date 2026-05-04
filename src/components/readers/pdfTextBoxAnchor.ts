export type PdfTextBoxAnchor = {
  type: "pdf_text_box";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const clampAnchorUnit = (value: number) => Math.max(0, Math.min(1, value));

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
    };
  } catch {
    return null;
  }
}
