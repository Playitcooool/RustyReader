import { childCollectionsFor, droppedPathsFromFileList } from "../../lib/appView";
import { isTauriRuntime } from "../../lib/api";
import type { Collection, ImportBatchResult, LibraryItem, PdfOutlineItem } from "../../lib/contracts";
import type { ResourceContextMenuState } from "../../hooks/useLibraryState";
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronLeftIcon, PlusIcon } from "./Icons";

type Props = {
  collectionDraftName: string;
  collections: Collection[];
  creatingCollectionParentId: number | "root" | null;
  draggedFileCount: number;
  lastImportResult: ImportBatchResult | null;
  libraryItems: LibraryItem[];
  activePdfOutlinePage?: number;
  focusPdfAttachmentId?: number | null;
  focusPanel?: "library" | "outline";
  onGetPdfOutline?: (primaryAttachmentId: number) => Promise<PdfOutlineItem[]>;
  onFocusPanelChange?: (panel: "library" | "outline") => void;
  onHideFocusSidebar?: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, detail: Exclude<ResourceContextMenuState, null>) => void;
  onCreateCollection: (parentId: number | null) => void | Promise<void>;
  onCancelCollectionInlineEdit: () => void;
  onDragCountChange: (value: number) => void;
  onImportPaths: (paths: string[], sourceLabel: string) => void | Promise<void>;
  onNavigatePdfOutline?: (pageIndex0: number) => void;
  onSearchChange: (value: string) => void;
  onSelectedCollectionChange: (collectionId: number) => void;
  onSetCollectionDraftName: (value: string) => void;
  onStartCreateCollection: (parentId: number | null) => void;
  onStartRenameCollection: (collection: Collection) => void;
  onSubmitCollectionRename: () => void | Promise<void>;
  renamingCollectionId: number | null;
  search: string;
  selectedCollectionId: number | null;
  treeSearchFilter: { allowedItemIds: Set<number>; allowedCollectionIds: Set<number> } | null;
};

export function ResourceSidebar(props: Props) {
  const {
    collectionDraftName,
    collections,
    creatingCollectionParentId,
    draggedFileCount,
    lastImportResult,
    libraryItems,
    activePdfOutlinePage,
    focusPanel: controlledFocusPanel,
    focusPdfAttachmentId,
    onContextMenu,
    onCreateCollection,
    onCancelCollectionInlineEdit,
    onDragCountChange,
    onFocusPanelChange,
    onHideFocusSidebar,
    onGetPdfOutline,
    onImportPaths,
    onNavigatePdfOutline,
    onSearchChange,
    onSelectedCollectionChange,
    onSetCollectionDraftName,
    onStartCreateCollection,
    onStartRenameCollection,
    onSubmitCollectionRename,
    renamingCollectionId,
    search,
    selectedCollectionId,
    treeSearchFilter,
  } = props;

  const importHasIssues = Boolean(lastImportResult && (lastImportResult.duplicates.length > 0 || lastImportResult.failed.length > 0));
  const focusSidebarEnabled = Boolean(onHideFocusSidebar && focusPdfAttachmentId && onGetPdfOutline && onNavigatePdfOutline);
  const [uncontrolledFocusPanel, setUncontrolledFocusPanel] = useState<"library" | "outline">("library");
  const focusPanel = focusSidebarEnabled ? controlledFocusPanel ?? uncontrolledFocusPanel : "library";
  const [outlineItems, setOutlineItems] = useState<PdfOutlineItem[]>([]);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);

  const setFocusPanel = (panel: "library" | "outline") => {
    setUncontrolledFocusPanel(panel);
    onFocusPanelChange?.(panel);
  };

  useEffect(() => {
    if (!focusSidebarEnabled || focusPanel !== "outline" || !focusPdfAttachmentId || !onGetPdfOutline) return;
    let cancelled = false;
    setOutlineLoading(true);
    setOutlineError(null);
    void onGetPdfOutline(focusPdfAttachmentId)
      .then((items) => {
        if (!cancelled) setOutlineItems(items);
      })
      .catch((error) => {
        if (!cancelled) setOutlineError(error instanceof Error ? error.message : "Could not load outline.");
      })
      .finally(() => {
        if (!cancelled) setOutlineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [focusPanel, focusPdfAttachmentId, focusSidebarEnabled, onGetPdfOutline]);

  const flatOutlineItems = useMemo(() => {
    const flattened: PdfOutlineItem[] = [];
    const visit = (items: PdfOutlineItem[]) => {
      for (const item of items) {
        flattened.push(item);
        visit(item.children);
      }
    };
    visit(outlineItems);
    return flattened;
  }, [outlineItems]);

  const activeOutlineId = useMemo(() => {
    const activePage = activePdfOutlinePage ?? 0;
    let active: PdfOutlineItem | null = null;
    for (const item of flatOutlineItems) {
      if (item.page_index0 <= activePage && (!active || item.page_index0 >= active.page_index0)) active = item;
    }
    return active?.id ?? null;
  }, [activePdfOutlinePage, flatOutlineItems]);

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
        const collectionChildren = renderTreeNodes(collection.id, depth + 1);
        const isRenaming = renamingCollectionId === collection.id;
        return [
          <div key={`collection-${collection.id}`} role="none">
            <div className={`resource-tree-row resource-tree-collection ${selectedCollectionId === collection.id ? "resource-tree-row-active" : ""}`} role="treeitem" aria-label={collection.name} style={{ paddingLeft: `${10 + depth * 18}px` }} onContextMenu={(event) => onContextMenu(event, { x: event.clientX, y: event.clientY, kind: "collection", targetId: collection.id })}>
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
            <div className="resource-tree-group" role="group">
              {creatingCollectionParentId === collection.id ? renderInlineCollectionEditor(collection.id) : null}
              {collectionChildren}
            </div>
          </div>,
        ];
      });

  const renderOutlineNodes = (items: PdfOutlineItem[], depth = 0): JSX.Element[] =>
    items.flatMap((item) => [
      <div key={item.id} role="none">
        <div
          className={`resource-tree-row resource-tree-collection ${activeOutlineId === item.id ? "resource-tree-row-active" : ""}`}
          role="treeitem"
          aria-label={`${item.title} page ${item.page_index0 + 1}`}
          style={{ paddingLeft: `${10 + depth * 18}px` }}
        >
          <button className="resource-tree-label resource-tree-collection-button pdf-outline-button" type="button" onClick={() => onNavigatePdfOutline?.(item.page_index0)}>
            <span>{item.title}</span>
            <span className="meta-count">{item.page_index0 + 1}</span>
          </button>
        </div>
        {item.children.length > 0 ? (
          <div className="resource-tree-group" role="group">
            {renderOutlineNodes(item.children, depth + 1)}
          </div>
        ) : null}
      </div>,
    ]);

  return (
    <aside className="sidebar">
      <div className="panel-header panel-header-row">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>{focusPanel === "outline" ? "Outline" : "Library"}</h1>
        </div>
      </div>
      {focusSidebarEnabled ? (
        <div className="toolbar-row" role="tablist" aria-label="PDF focus sidebar">
          <button aria-selected={focusPanel === "library"} className={`ghost-button ${focusPanel === "library" ? "ghost-button-active" : ""}`} role="tab" type="button" onClick={() => setFocusPanel("library")}>
            Library
          </button>
          <button aria-selected={focusPanel === "outline"} className={`ghost-button ${focusPanel === "outline" ? "ghost-button-active" : ""}`} role="tab" type="button" onClick={() => setFocusPanel("outline")}>
            Outline
          </button>
        </div>
      ) : null}
      {focusPanel === "library" ? <div className="toolbar-row">
        <input aria-label="Search papers" className="search-input" placeholder="Search papers, authors, years..." value={search} onChange={(event) => onSearchChange(event.target.value)} />
      </div> : null}
      {focusPanel === "outline" ? (
        <section aria-label="PDF outline" className="section-block resource-panel" role="region">
          <div className="section-title-row">
            <h2>Outline</h2>
            <div className="section-title-actions">
              {onHideFocusSidebar ? (
                <button aria-label="Hide outline" aria-pressed="true" className="icon-button icon-button-small focus-sidebar-embedded-toggle" title="Hide outline" type="button" onClick={onHideFocusSidebar}>
                  <ChevronLeftIcon />
                </button>
              ) : null}
            </div>
          </div>
          {outlineLoading ? <p className="secondary-copy">Loading outline...</p> : null}
          {outlineError ? <p className="secondary-copy">{outlineError}</p> : null}
          {!outlineLoading && !outlineError && outlineItems.length === 0 ? <p className="secondary-copy">No outline in this PDF.</p> : null}
          {outlineItems.length > 0 ? (
            <div className="resource-tree" role="tree" aria-label="PDF outline">
              {renderOutlineNodes(outlineItems)}
            </div>
          ) : null}
        </section>
      ) : (
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
            {treeSearchFilter && treeSearchFilter.allowedCollectionIds.size === 0 ? <p className="secondary-copy">No matches.</p> : <>{creatingCollectionParentId === "root" ? renderInlineCollectionEditor(null) : null}{renderTreeNodes(null)}</>}
          </div>
        )}
        </section>
      )}
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
