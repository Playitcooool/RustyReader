import type { CSSProperties, RefObject } from "react";

import type { PdfHighlightColor } from "../readers/pdfSelection";

const highlightColors = ["yellow", "red", "green", "blue", "purple"] as const;

export function PdfFocusHighlightBar({
  barRef,
  style,
  onCreateHighlight,
}: {
  barRef: RefObject<HTMLDivElement>;
  style: CSSProperties;
  onCreateHighlight: (color: PdfHighlightColor) => void;
}) {
  return (
    <div
      className="pdf-focus-highlight-bar"
      ref={barRef}
      role="toolbar"
      aria-label="PDF highlight colors"
      style={style}
    >
      {highlightColors.map((color) => (
        <button
          key={color}
          type="button"
          className="pdf-focus-highlight-swatch"
          data-color={color}
          aria-label={`Highlight ${color}`}
          onClick={() => onCreateHighlight(color)}
        />
      ))}
    </div>
  );
}

export function ActivePdfHighlightBar({
  barRef,
  style,
  onRemoveHighlight,
}: {
  barRef: RefObject<HTMLDivElement>;
  style: CSSProperties;
  onRemoveHighlight: () => void;
}) {
  return (
    <div
      className="pdf-highlight-action-bar"
      ref={barRef}
      role="toolbar"
      aria-label="PDF highlight actions"
      style={style}
    >
      <button type="button" className="ghost-button" onClick={onRemoveHighlight}>
        Remove Highlight
      </button>
    </div>
  );
}
