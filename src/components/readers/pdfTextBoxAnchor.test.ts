import { describe, expect, it } from "vitest";

import { parsePdfTextBoxAnchor } from "./pdfTextBoxAnchor";

describe("parsePdfTextBoxAnchor", () => {
  it("parses valid text box anchors", () => {
    expect(parsePdfTextBoxAnchor(JSON.stringify({
      type: "pdf_text_box",
      page: 2,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    }))).toEqual({
      type: "pdf_text_box",
      page: 2,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    });
  });

  it("rejects invalid anchors", () => {
    expect(parsePdfTextBoxAnchor("not json")).toBeNull();
    expect(parsePdfTextBoxAnchor(JSON.stringify({ type: "pdf_text_box", page: 1, x: 0, y: 0, width: 0, height: 1 }))).toBeNull();
    expect(parsePdfTextBoxAnchor(JSON.stringify({ type: "pdf_highlight", page: 1, x: 0, y: 0, width: 1, height: 1 }))).toBeNull();
  });

  it("clamps geometry to the page bounds", () => {
    expect(parsePdfTextBoxAnchor(JSON.stringify({
      type: "pdf_text_box",
      page: 1,
      x: -0.1,
      y: 1.2,
      width: 2,
      height: 0.5,
    }))).toEqual({
      type: "pdf_text_box",
      page: 1,
      x: 0,
      y: 1,
      width: 1,
      height: 0.5,
    });
  });
});
