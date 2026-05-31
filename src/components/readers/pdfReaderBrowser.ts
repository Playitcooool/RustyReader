export const supportsRequestIdleCallback = () =>
  typeof window !== "undefined" && typeof window.requestIdleCallback === "function";

export const schedulePdfReaderIdle = (callback: () => void) => {
  if (typeof window === "undefined") return () => {};
  if (supportsRequestIdleCallback()) {
    const id = window.requestIdleCallback(() => callback(), { timeout: 180 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 24);
  return () => window.clearTimeout(id);
};

export const isScrollableElement = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY || style.overflow;
  if (!/(auto|scroll|overlay)/.test(overflowY)) return false;
  return element.scrollHeight > element.clientHeight + 1;
};

export const findScrollFallbackTarget = (element: HTMLElement | null): EventTarget | null => {
  if (typeof window === "undefined" || !element) return null;
  let current = element.parentElement;
  while (current) {
    if (isScrollableElement(current)) return current;
    current = current.parentElement;
  }
  return window;
};
