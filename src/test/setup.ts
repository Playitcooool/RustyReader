import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Readers may call the Tauri shell plugin to open external links.
// In unit tests we stub it out and assert calls where needed.
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => undefined),
}));

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: vi.fn(() => ({})),
  configurable: true,
});

Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
  value: vi.fn((callback: BlobCallback) => {
    callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
  }),
  configurable: true,
});
