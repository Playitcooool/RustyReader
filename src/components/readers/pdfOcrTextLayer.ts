import type { OcrLine } from "../../lib/contracts";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function buildOcrTextLayer(input: {
  host: HTMLElement;
  viewportWidth: number;
  viewportHeight: number;
  lines: OcrLine[];
}): { divs: HTMLElement[]; strings: string[] } {
  const { host, viewportWidth, viewportHeight, lines } = input;
  host.replaceChildren();

  const divs: HTMLElement[] = [];
  const strings: string[] = [];
  const pendingScale: Array<{ span: HTMLElement; targetWidth: number }> = [];
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const text = (line.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const left = clamp01(line.bbox.left) * viewportWidth;
    const top = clamp01(line.bbox.top) * viewportHeight;
    const width = clamp01(line.bbox.width) * viewportWidth;
    const height = clamp01(line.bbox.height) * viewportHeight;

    const span = document.createElement("span");
    span.setAttribute("role", "presentation");
    span.dataset.divIndex = String(divs.length);
    span.textContent = text;
    span.style.position = "absolute";
    span.style.left = `${left}px`;
    span.style.top = `${top}px`;

    // Keep selection reasonably aligned; we don't care about visual appearance (text is transparent).
    span.style.fontSize = `${Math.max(1, height)}px`;
    span.style.lineHeight = "1";
    span.style.display = "inline-block";
    span.style.transformOrigin = "0 0";
    span.style.transform = "none";

    // Keep the element box close to the OCR bbox to improve hit testing and highlight overlays.
    if (Number.isFinite(width) && width > 0) span.style.width = `${width}px`;
    if (Number.isFinite(height) && height > 0) span.style.height = `${height}px`;
    if (Number.isFinite(width) && width > 0) pendingScale.push({ span, targetWidth: width });

    divs.push(span);
    strings.push(text);
    fragment.appendChild(span);
  }

  const end = document.createElement("div");
  end.className = "endOfContent";
  fragment.appendChild(end);
  host.appendChild(fragment);

  // pdf.js' TextLayer uses horizontal scaling to better match the underlying glyph boxes.
  // Measure after the batch insert so OCR pages do not force layout once per appended node.
  for (const item of pendingScale) {
    const naturalWidth = item.span.getBoundingClientRect().width;
    if (Number.isFinite(naturalWidth) && naturalWidth > 0.5) {
      const scaleX = Math.max(0.01, item.targetWidth / naturalWidth);
      item.span.style.transform = `scaleX(${scaleX})`;
    }
  }

  return { divs, strings };
}
