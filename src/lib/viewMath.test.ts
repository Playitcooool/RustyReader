import { describe, expect, it } from "vitest";

import { clamp } from "./viewMath";

describe("viewMath", () => {
  it("clamps values to inclusive bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
