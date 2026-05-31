import { describe, expect, it } from "vitest";

import { createAiStreamId, initialAiDockState, taskLabel } from "./aiView";

describe("aiView", () => {
  it("creates a closed dock state for all AI sections", () => {
    expect(initialAiDockState()).toEqual({
      artifacts: false,
      history: false,
      notes: false,
    });
  });

  it("labels known task kinds and falls back to raw kinds", () => {
    expect(taskLabel("session.theme_map")).toBe("Theme Map");
    expect(taskLabel("custom.task")).toBe("custom.task");
  });

  it("creates stream ids", () => {
    expect(createAiStreamId()).toEqual(expect.any(String));
    expect(createAiStreamId().length).toBeGreaterThan(0);
  });
});
