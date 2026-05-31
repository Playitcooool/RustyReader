import { describe, expect, it } from "vitest";

import { escapeHtml } from "./htmlEscape";

describe("escapeHtml", () => {
  it("escapes characters used by PDF text layer markup", () => {
    expect(escapeHtml('&<>"plain')).toBe("&amp;&lt;&gt;&quot;plain");
  });

  it("does not double-handle unrelated characters", () => {
    expect(escapeHtml("Apostrophe ' and slash / stay readable")).toBe("Apostrophe ' and slash / stay readable");
  });
});
