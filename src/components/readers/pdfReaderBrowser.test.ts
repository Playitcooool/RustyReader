import { describe, expect, it, vi } from "vitest";

import { findScrollFallbackTarget, isScrollableElement, schedulePdfReaderIdle } from "./pdfReaderBrowser";

const setElementMetrics = (element: HTMLElement, metrics: { scrollHeight: number; clientHeight: number }) => {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: metrics.clientHeight });
};

describe("pdfReaderBrowser", () => {
  it("detects scrollable ancestor fallback targets", () => {
    const ancestor = document.createElement("div");
    const child = document.createElement("div");
    ancestor.style.overflowY = "auto";
    setElementMetrics(ancestor, { scrollHeight: 200, clientHeight: 100 });
    ancestor.appendChild(child);
    document.body.appendChild(ancestor);

    expect(isScrollableElement(ancestor)).toBe(true);
    expect(findScrollFallbackTarget(child)).toBe(ancestor);

    ancestor.remove();
  });

  it("falls back to window when no scrollable ancestor exists", () => {
    const child = document.createElement("div");
    document.body.appendChild(child);

    expect(findScrollFallbackTarget(child)).toBe(window);

    child.remove();
  });

  it("schedules idle work through timeout when requestIdleCallback is unavailable", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const cancel = schedulePdfReaderIdle(callback);

    vi.advanceTimersByTime(23);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    cancel();
    vi.useRealTimers();
  });
});
