import { useEffect, useMemo, useRef } from "react";

import { safeScrollIntoView } from "../../lib/dom";
import type { ReaderTextSelection } from "../../hooks/useReaderState";

type NormalizedReaderProps = {
  pageHtml: string;
  zoom: number;
  searchQuery?: string;
  activeSearchMatchIndex?: number;
  onSearchMatchesChange?: (state: { total: number; activeIndex: number }) => void;
  onSelectionChange?: (selection: ReaderTextSelection | null) => void;
};

const highlightHtml = (html: string, query: string, activeIndex: number) => {
  const needle = query.trim();
  if (needle.length === 0) return { html, total: 0 };
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return { html, total: 0 };

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const loweredNeedle = needle.toLowerCase();
  const nodes: Text[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      const value = current.nodeValue ?? "";
      const parent = (current as Text).parentElement;
      // Avoid highlighting the document title (typically duplicated in the UI chrome).
      if (parent?.closest("h1")) {
        current = walker.nextNode();
        continue;
      }
      if (value.toLowerCase().includes(loweredNeedle)) {
        nodes.push(current as Text);
      }
    }
    current = walker.nextNode();
  }

  let hitIndex = 0;
  for (const textNode of nodes) {
    const value = textNode.nodeValue ?? "";
    const lowered = value.toLowerCase();
    if (!lowered.includes(loweredNeedle)) continue;

    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    while (cursor < value.length) {
      const index = lowered.indexOf(loweredNeedle, cursor);
      if (index === -1) break;
      if (index > cursor) {
        fragment.appendChild(doc.createTextNode(value.slice(cursor, index)));
      }
      const mark = doc.createElement("mark");
      const active = hitIndex === activeIndex ? " reader-search-hit-active" : "";
      mark.className = `reader-search-hit${active}`;
      mark.dataset.hitIndex = String(hitIndex);
      mark.textContent = value.slice(index, index + needle.length);
      fragment.appendChild(mark);
      hitIndex += 1;
      cursor = index + needle.length;
    }
    if (cursor < value.length) {
      fragment.appendChild(doc.createTextNode(value.slice(cursor)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return { html: doc.body.innerHTML, total: hitIndex };
};

export function NormalizedReader({
  pageHtml,
  zoom,
  searchQuery = "",
  activeSearchMatchIndex = 0,
  onSearchMatchesChange,
  onSelectionChange,
}: NormalizedReaderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const highlighted = useMemo(() => highlightHtml(pageHtml, searchQuery, activeSearchMatchIndex), [
    activeSearchMatchIndex,
    pageHtml,
    searchQuery,
  ]);

  useEffect(() => {
    if (!onSearchMatchesChange) return;
    const total = highlighted.total;
    const normalized = total > 0 ? ((activeSearchMatchIndex % total) + total) % total : -1;
    onSearchMatchesChange({ total, activeIndex: normalized });
  }, [activeSearchMatchIndex, highlighted.total, onSearchMatchesChange]);

  useEffect(() => {
    if (!searchQuery.trim()) return;
    if (highlighted.total <= 0) return;
    const normalized = ((activeSearchMatchIndex % highlighted.total) + highlighted.total) % highlighted.total;
    const active = containerRef.current?.querySelector(
      `mark.reader-search-hit[data-hit-index="${normalized}"]`,
    );
    if (active) safeScrollIntoView(active, { block: "center" });
  }, [activeSearchMatchIndex, highlighted.total, searchQuery]);

  useEffect(() => {
    if (!onSelectionChange) return;
    const handleSelectionChange = () => {
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
        onSelectionChange(null);
        return;
      }
      const quote = selection.toString().trim();
      if (!quote) {
        onSelectionChange(null);
        return;
      }
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if (!anchorNode || !focusNode || !container.contains(anchorNode) || !container.contains(focusNode)) {
        onSelectionChange(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        onSelectionChange(null);
        return;
      }
      onSelectionChange({
        quote,
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
      });
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [onSelectionChange]);

  return (
    <div
      className="reader-html"
      data-testid="normalized-reader"
      ref={containerRef}
      style={{ fontSize: `${zoom}%` }}
      dangerouslySetInnerHTML={{
        __html: highlighted.html,
      }}
    />
  );
}
