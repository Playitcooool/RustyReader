import type { RefObject } from "react";

export function FindHud({
  inputRef,
  query,
  matchCount,
  activeMatchIndex,
  onQueryChange,
  onMoveMatch,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement>;
  query: string;
  matchCount: number;
  activeMatchIndex: number;
  onQueryChange: (query: string) => void;
  onMoveMatch: (direction: -1 | 1, source: "button" | "enter") => void;
  onClose: () => void;
}) {
  return (
    <div className="find-hud" role="dialog" aria-label="Find in document">
      <input
        aria-label="Find in document"
        className="find-hud-input"
        placeholder="Find in document..."
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onMoveMatch(event.shiftKey ? -1 : 1, "enter");
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <span className="meta-count">
        {matchCount > 0 && activeMatchIndex >= 0 ? `${activeMatchIndex + 1} / ${matchCount}` : "0 / 0"}
      </span>
      <button
        aria-label="Previous match"
        className="ghost-button"
        type="button"
        onClick={() => onMoveMatch(-1, "button")}
      >
        Prev
      </button>
      <button
        aria-label="Next match"
        className="ghost-button"
        type="button"
        onClick={() => onMoveMatch(1, "button")}
      >
        Next
      </button>
      <button aria-label="Close find" className="ghost-button" type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
