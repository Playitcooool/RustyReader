import { describe, expect, it } from "vitest";

import { buildPdfTextSelectionFromRange, parsePdfTextAnchor, rangeIntersectsPdfTextLayer } from "./pdfSelection";

describe("buildPdfTextSelectionFromRange", () => {
  it("builds a stable pdf_text anchor and includes rect", () => {
    const host = document.createElement("div");
    const div1 = document.createElement("span");
    const div2 = document.createElement("span");
    div1.textContent = "Hello";
    div2.textContent = "World";
    host.append(div1, div2);
    document.body.append(host);

    const range = document.createRange();
    range.setStart(div1.firstChild as Text, 1);
    range.setEnd(div2.firstChild as Text, 3);

    const selection = buildPdfTextSelectionFromRange({
      quote: "elloWor",
      range,
      host,
      divs: [div1, div2],
      pageNumber1: 1,
    });

    expect(selection).not.toBeNull();
    expect(selection?.rect).toEqual(expect.objectContaining({ left: expect.any(Number) }));

    const parsed = selection ? parsePdfTextAnchor(selection.anchor) : null;
    expect(parsed).not.toBeNull();
    expect(parsed?.page).toBe(1);
    expect(parsed?.startDivIndex).toBe(0);
    expect(parsed?.endDivIndex).toBe(1);
    expect(parsed?.startOffset).toBe(1);
    expect(parsed?.endOffset).toBe(3);
  });

  it("keeps small selections inside nested highlight/search spans aligned to the base div", () => {
    const host = document.createElement("div");
    const div = document.createElement("span");
    div.innerHTML = 'He<span class="pdf-annotation-highlight">ll</span><span class="pdf-search-hit">o</span>';
    host.append(div);
    document.body.append(host);

    const annotationText = div.querySelector(".pdf-annotation-highlight")?.firstChild as Text;
    const searchText = div.querySelector(".pdf-search-hit")?.firstChild as Text;
    const range = document.createRange();
    range.setStart(annotationText, 1);
    range.setEnd(searchText, 1);

    const selection = buildPdfTextSelectionFromRange({
      quote: "lo",
      range,
      host,
      divs: [div],
      pageNumber1: 1,
    });

    const parsed = selection ? parsePdfTextAnchor(selection.anchor) : null;
    expect(parsed?.startDivIndex).toBe(0);
    expect(parsed?.endDivIndex).toBe(0);
    expect(parsed?.startOffset).toBe(3);
    expect(parsed?.endOffset).toBe(5);
  });

  it("maps element-node boundary ranges to exact div offsets", () => {
    const host = document.createElement("div");
    const div1 = document.createElement("span");
    const div2 = document.createElement("span");
    div1.textContent = "Alpha";
    div2.textContent = "Beta";
    host.append(div1, div2);
    document.body.append(host);

    const range = document.createRange();
    range.setStart(host, 1);
    range.setEnd(host, 2);

    const selection = buildPdfTextSelectionFromRange({
      quote: "Beta",
      range,
      host,
      divs: [div1, div2],
      pageNumber1: 2,
    });

    const parsed = selection ? parsePdfTextAnchor(selection.anchor) : null;
    expect(parsed?.page).toBe(2);
    expect(parsed?.startDivIndex).toBe(1);
    expect(parsed?.startOffset).toBe(0);
    expect(parsed?.endDivIndex).toBe(1);
    expect(parsed?.endOffset).toBe(4);
  });

  it("accepts selections whose range ancestor is outside the text layer", () => {
    const shell = document.createElement("section");
    const before = document.createTextNode("outside ");
    const host = document.createElement("div");
    const div1 = document.createElement("span");
    const div2 = document.createElement("span");
    div1.textContent = "Alpha";
    div2.textContent = "Beta";
    host.append(div1, div2);
    shell.append(before, host);
    document.body.append(shell);

    const range = document.createRange();
    range.setStart(before, 3);
    range.setEnd(div2.firstChild as Text, 2);

    expect(range.commonAncestorContainer).toBe(shell);
    expect(rangeIntersectsPdfTextLayer(range, host)).toBe(true);

    const selection = buildPdfTextSelectionFromRange({
      quote: range.toString(),
      range,
      host,
      divs: [div1, div2],
      pageNumber1: 3,
    });

    const parsed = selection ? parsePdfTextAnchor(selection.anchor) : null;
    expect(selection?.quote).toBe("AlphaBe");
    expect(parsed?.quote).toBe("AlphaBe");
    expect(parsed?.startDivIndex).toBe(0);
    expect(parsed?.startOffset).toBe(0);
    expect(parsed?.endDivIndex).toBe(1);
    expect(parsed?.endOffset).toBe(2);
  });

  it("clamps outside endpoints through nested selected text spans", () => {
    const shell = document.createElement("section");
    const after = document.createTextNode(" outside");
    const host = document.createElement("div");
    const div = document.createElement("span");
    div.innerHTML = 'He<span class="pdf-annotation-highlight">ll</span><span class="pdf-search-hit">o</span>';
    host.append(div);
    shell.append(host, after);
    document.body.append(shell);

    const range = document.createRange();
    range.setStart(div.querySelector(".pdf-annotation-highlight")?.firstChild as Text, 0);
    range.setEnd(after, 4);

    const selection = buildPdfTextSelectionFromRange({
      quote: range.toString(),
      range,
      host,
      divs: [div],
      pageNumber1: 4,
    });

    const parsed = selection ? parsePdfTextAnchor(selection.anchor) : null;
    expect(selection?.quote).toBe("llo");
    expect(parsed?.startOffset).toBe(2);
    expect(parsed?.endOffset).toBe(5);
  });
});
