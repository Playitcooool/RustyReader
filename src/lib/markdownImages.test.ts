import { describe, expect, it } from "vitest";
import { markdownImagesToLinks } from "./markdownImages";

describe("markdownImagesToLinks", () => {
  it("converts markdown images to links for the rich text markdown editor", () => {
    expect(markdownImagesToLinks("Before ![figure](https://example.com/figure.png) after")).toBe(
      "Before [figure](https://example.com/figure.png) after",
    );
  });

  it("keeps alt text for images without a URL", () => {
    expect(markdownImagesToLinks("![N/A]()")).toBe("N/A");
  });

  it("keeps URL text when image alt text is empty", () => {
    expect(markdownImagesToLinks("![](https://example.com/figure.png)")).toBe("https://example.com/figure.png");
  });
});
