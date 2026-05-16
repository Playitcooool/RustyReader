import { childCollectionsFor, droppedPathsFromFileList, sortItems } from "../../lib/appView";
import { isTauriRuntime } from "../../lib/api";
import type { Collection, ImportBatchResult, LibraryItem } from "../../lib/contracts";
import type { ResourceContextMenuState } from "../../hooks/useLibraryState";
import type { MouseEvent as ReactMouseEvent } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "./Icons";

type Props = {
  activePaperId: number | null;
  collectionDraftName: string;
  collections: Collection[];
  creatingCollectionParentId: number | "root" | null;
  draggedFileCount: number;
  expandedCollectionIds: number[];
  lastImportResult: ImportBatchResult | null;
  libraryItems: LibraryItem[];
  onHideFocusSidebar?: () => void;
  onActivateItem: (item: LibraryItem, options?: { focusPdf?: boolean }) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, detail: Exclude<ResourceContextMenuState, null>) => void;
  onCreateCollection: (parentId: number | null) => void | Promise<void>;
  onCancelCollectionInlineEdit: () => void;
  onDragCountChange: (value: number) => void;
  onImportPaths: (paths: string[], sourceLabel: string) => void | Promise<void>;
  onSearchChange: (value: string) => void;
  onSelectedCollectionChange: (collectionId: number) => void;
  onSetCollectionDraftName: (value: string) => void;
  onStartCreateCollection: (parentId: number | null) => void;
  onStartRenameCollection: (collection: Collection) => void;
  onSubmitCollectionRename: () => void | Promise<void>;
  onToggleCollectionExpanded: (collectionId: number) => void;
  renamingCollectionId: number | null;
  search: string;
  selectedCollectionId: number | null;
  treeSearchFilter: { allowedItemIds: Set<number>; allowedCollectionIds: Set<number> } | null;
};

export function ResourceSidebar(props: Props) {
  const {
    activePaperId,
    collectionDraftName,
    collections,
    creatingCollectionParentId,
    draggedFileCount,
    lastImportResult,
    libraryItems,
    onActivateItem,
    onContextMenu,
    onCreateCollection,
    onCancelCollectionInlineEdit,
    onDragCountChange,
    onHideFocusSidebar,
    onImportPaths,
    onSearchChange,
    onSelectedCollectionChange,
    onSetCollectionDraftName,
    onStartCreateCollection,
    onStartRenameCollection,
    onSubmitCollectionRename,
    onToggleCollectionExpanded,
    renamingCollectionId,
    search,
    selectedCollectionId,
    treeSearchFilter,
  } = props;

  const importHasIssues = Boolean(lastImportResult && (lastImportResult.duplicates.length > 0 || lastImportResult.failed.length > 0));

  const renderInlineCollectionEditor = (parentId: number | null) => (
    <div className="resource-tree-row resource-tree-row-editing" role="none" key={`inline-editor-${parentId ?? "root"}`}>
      <input
        aria-label={renamingCollectionId ? "Rename collection" : "New collection name"}
        autoFocus
        className="resource-tree-inline-input"
        value={collectionDraftName}
        onBlur={() => (renamingCollectionId ? void onSubmitCollectionRename() : void onCreateCollection(parentId))}
        onChange={(event) => onSetCollectionDraftName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            renamingCollectionId ? void onSubmitCollectionRename() : void onCreateCollection(parentId);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancelCollectionInlineEdit();
          }
        }}
        placeholder={renamingCollectionId ? "Rename collection" : "New collection"}
      />
    </div>
  );

  const renderTreeNodes = (parentId: number | null, depth = 0): JSX.Element[] =>
    childCollectionsFor(collections, parentId)
      .filter((collection) => (treeSearchFilter ? treeSearchFilter.allowedCollectionIds.has(collection.id) : true))
      .flatMap((collection) => {
        const isExpanded = props.expandedCollectionIds.includes(collection.id);
        const collectionChildren = renderTreeNodes(collection.id, depth + 1);
        const directItems = sortItems(
          libraryItems
            .filter((item) => item.collection_id === collection.id)
            .filter((item) => (treeSearchFilter ? treeSearchFilter.allowedItemIds.has(item.id) : true)),
          "title",
        );
        const isRenaming = renamingCollectionId === collection.id;
        return [
          <div key={`collection-${collection.id}`} role="none">
            <div className={`resource-tree-row resource-tree-collection ${selectedCollectionId === collection.id ? "resource-tree-row-active" : ""}`} role="treeitem" aria-expanded={isExpanded} aria-label={collection.name} style={{ paddingLeft: `${10 + depth * 18}px` }} onContextMenu={(event) => onContextMenu(event, { x: event.clientX, y: event.clientY, kind: "collection", targetId: collection.id })}>
              <button aria-label={isExpanded ? `Collapse ${collection.name}` : `Expand ${collection.name}`} className="resource-tree-toggle" type="button" onClick={() => onToggleCollectionExpanded(collection.id)}>
                {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </button>
              {isRenaming ? (
                <input
                  aria-label="Rename collection"
                  autoFocus
                  className="resource-tree-inline-input"
                  value={collectionDraftName}
                  onBlur={() => void onSubmitCollectionRename()}
                  onChange={(event) => onSetCollectionDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void onSubmitCollectionRename();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelCollectionInlineEdit();
                    }
                  }}
                />
              ) : (
                <button className="resource-tree-label resource-tree-collection-button" type="button" onClick={() => onSelectedCollectionChange(collection.id)}>
                  {collection.name}
                </button>
              )}
            </div>
            {isExpanded ? (
              <div className="resource-tree-group" role="group">
                {creatingCollectionParentId === collection.id ? renderInlineCollectionEditor(collection.id) : null}
                {collectionChildren}
                {directItems.map((item) => (
                  <button key={`item-${item.id}`} aria-label={item.title} className={`resource-tree-row resource-tree-item ${activePaperId === item.id ? "resource-tree-row-active" : ""}`} role="treeitem" style={{ paddingLeft: `${28 + depth * 18}px` }} type="button" onClick={() => onActivateItem(item)} onContextMenu={(event) => onContextMenu(event, { x: event.clientX, y: event.clientY, kind: "item", targetId: item.id })} onDoubleClick={() => item.attachment_format === "pdf" && onActivateItem(item, { focusPdf: true })}>
                    <span className="resource-tree-item-title">{item.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>,
        ];
      });

  return (
    <aside className="sidebar">
      <div className="panel-header panel-header-row">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Library</h1>
        </div>
      </div>
      <div className="toolbar-row">
        <input aria-label="Search papers" className="search-input" placeholder="Search papers, authors, years..." value={search} onChange={(event) => onSearchChange(event.target.value)} />
      </div>
      <section aria-label="Collection drop zone" className={`section-block resource-panel ${draggedFileCount > 0 ? "drop-zone-active" : ""}`} role="region" onDragEnter={(event) => event.dataTransfer?.files && onDragCountChange(droppedPathsFromFileList(event.dataTransfer.files).length)} onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragCountChange(0); }} onDrop={(event) => { event.preventDefault(); onDragCountChange(0); if (isTauriRuntime()) return; const files = event.dataTransfer?.files; void Promise.resolve(onImportPaths(files ? droppedPathsFromFileList(files) : [], "drag & drop")).finally(() => onDragCountChange(0)); }}>
        <div className="section-title-row">
          <h2>Collections</h2>
          <div className="section-title-actions">
            <span className="meta-count">{libraryItems.length}</span>
            <button aria-label="New folder" className="icon-button icon-button-small" title="New folder" type="button" onClick={() => onStartCreateCollection(null)}>
              <PlusIcon />
            </button>
            {onHideFocusSidebar ? (
              <button aria-label="Hide collections" aria-pressed="true" className="icon-button icon-button-small focus-sidebar-embedded-toggle" title="Hide collections" type="button" onClick={onHideFocusSidebar}>
                <ChevronLeftIcon />
              </button>
            ) : null}
          </div>
        </div>
        {collections.length === 0 ? (
          <div className="citation-card">
            <p className="eyebrow">Empty Library</p>
            <h3>Start with a collection</h3>
            <p>Create a root collection on the left, then import PDF, DOCX, EPUB, or citation files.</p>
            <p>No collection selected</p>
          </div>
        ) : (
          <div className="resource-tree" role="tree" aria-label="Library resources">
            {treeSearchFilter && treeSearchFilter.allowedItemIds.size === 0 ? <p className="secondary-copy">No matches.</p> : <>{creatingCollectionParentId === "root" ? renderInlineCollectionEditor(null) : null}{renderTreeNodes(null)}</>}
          </div>
        )}
      </section>
      {importHasIssues && lastImportResult ? (
        <details className="management-panel" open>
          <summary>Show Import Issues</summary>
          <div className="management-panel-body">
            {lastImportResult.results.filter((result) => result.status !== "imported").map((result) => <div key={`${result.path}-${result.status}`} className="export-row"><span>{result.status}</span><span>{result.message}</span></div>)}
          </div>
        </details>
      ) : null}
    </aside>
  );
}
