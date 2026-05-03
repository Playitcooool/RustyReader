export type DeleteConfirmTarget =
  | {
      kind: "collection";
      targetId: number;
      label: string;
      parentCollectionId: number | null;
      paperCount?: number;
      nestedCollectionCount?: number;
      deletedCollectionIds?: number[];
      deletedItemIds?: number[];
    }
  | {
      kind: "item";
      targetId: number;
      label: string;
      parentCollectionId: number | null;
    }
  | {
      kind: "ai_session";
      targetId: number;
      label: string;
    };

export function DeleteConfirmDialog({
  target,
  onCancel,
  onConfirm,
}: {
  target: DeleteConfirmTarget;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-scrim" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-label="Confirm delete">
        <div>
          <p className="eyebrow">Delete</p>
          <h2>{target.label}</h2>
        </div>
        <p>
          {target.kind === "item"
            ? "This removes the paper from the library and clears any matching AI references."
            : target.kind === "ai_session"
              ? "This deletes the chat history, tasks, artifacts, references, and research notes for this session."
              : `This removes ${target.paperCount ?? 0} paper${target.paperCount === 1 ? "" : "s"} and ${target.nestedCollectionCount ?? 0} nested collection${target.nestedCollectionCount === 1 ? "" : "s"}, then clears matching AI references and related notes.`}
        </p>
        <div className="settings-dialog-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </section>
    </div>
  );
}
