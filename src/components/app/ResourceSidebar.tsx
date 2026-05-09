import { childCollectionsFor, droppedPathsFromFileList, sortItems, type AttachmentFilter, type ItemSort } from "../../lib/appView";
import { isTauriRuntime } from "../../lib/api";
import type { Collection, ImportBatchResult, LibraryItem, Tag } from "../../lib/contracts";
import type { ResourceContextMenuState } from "../../hooks/useLibraryState";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

type Props = {
  activePaperId: number | null;
  attachmentFilter: AttachmentFilter;
  batchMoveTargetId: string;
  batchTagName: string;
  collectionDraftName: string;
  collections: Collection[];
  creatingCollectionParentId: number | "root" | null;
  draggedFileCount: number;
  expandedCollectionIds: number[];
  isManageOpen: boolean;
  itemSort: ItemSort;
  lastImportResult: ImportBatchResult | null;
  libraryItems: LibraryItem[];
  manageButtonRef: RefObject<HTMLButtonElement>;
  managePopoverRef: RefObject<HTMLDivElement>;
  newTagName: string;
  onActivateItem: (item: LibraryItem, options?: { focusPdf?: boolean }) => void;
  onBatchMove: () => void | Promise<void>;
  onBatchMoveTargetChange: (value: string) => void;
  onBatchTag: () => void | Promise<void>;
  onBatchTagNameChange: (value: string) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, detail: Exclude<ResourceContextMenuState, null>) => void;
  onCreateCollection: (parentId: number | null) => void | Promise<void>;
  onCreateTag: () => void | Promise<void>;
  onCancelCollectionInlineEdit: () => void;
  onDragCountChange: (value: number) => void;
  onImportPaths: (paths: string[], sourceLabel: string) => void | Promise<void>;
  onNewTagNameChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSelectedCollectionChange: (collectionId: number) => void;
  onSelectedTagChange: (tagId: number | null) => void;
  onSetCollectionDraftName: (value: string) => void;
  onStartCreateCollection: (parentId: number | null) => void;
  onStartRenameCollection: (collection: Collection) => void;
  onSubmitCollectionRename: () => void | Promise<void>;
  onToggleCollectionExpanded: (collectionId: number) => void;
  onToggleManage: () => void;
  renamingCollectionId: number | null;
  search: string;
  selectedCollectionId: number | null;
  selectedItemIds: number[];
  selectedTagId: number | null;
  setAttachmentFilter: (value: AttachmentFilter) => void;
  setItemSort: (value: ItemSort) => void;
  tags: Tag[];
  treeSearchFilter: { allowedItemIds: Set<number>; allowedCollectionIds: Set<number> } | null;
};

export function ResourceSidebar(props: Props) {
  const {
    activePaperId,
    attachmentFilter,
    batchMoveTargetId,
    batchTagName,
    collectionDraftName,
    collections,
    creatingCollectionParentId,
    draggedFileCount,
    isManageOpen,
    itemSort,
    lastImportResult,
    libraryItems,
    manageButtonRef,
    managePopoverRef,
    newTagName,
    onActivateItem,
    onBatchMove,
    onBatchMoveTargetChange,
    onBatchTag,
    onBatchTagNameChange,
    onContextMenu,
    onCreateCollection,
    onCreateTag,
    onCancelCollectionInlineEdit,
    onDragCountChange,
    onImportPaths,
    onNewTagNameChange,
    onSearchChange,
    onSelectedCollectionChange,
    onSelectedTagChange,
    onSetCollectionDraftName,
    onStartCreateCollection,
    onStartRenameCollection,
    onSubmitCollectionRename,
    onToggleCollectionExpanded,
    onToggleManage,
    renamingCollectionId,
    search,
    selectedCollectionId,
    selectedItemIds,
    selectedTagId,
    setAttachmentFilter,
    setItemSort,
    tags,
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
                {isExpanded ? "▾" : "▸"}
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
        <button aria-label="Manage library" className="icon-button" type="button" ref={manageButtonRef} onClick={onToggleManage}>
          ⚙
        </button>
      </div>
      <div className="toolbar-row">
        <input aria-label="Search papers" className="search-input" placeholder="Search papers, authors, years..." value={search} onChange={(event) => onSearchChange(event.target.value)} />
      </div>
      <section aria-label="Collection drop zone" className={`section-block resource-panel ${draggedFileCount > 0 ? "drop-zone-active" : ""}`} role="region" onDragEnter={(event) => event.dataTransfer?.files && onDragCountChange(droppedPathsFromFileList(event.dataTransfer.files).length)} onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragCountChange(0); }} onDrop={(event) => { event.preventDefault(); onDragCountChange(0); if (isTauriRuntime()) return; const files = event.dataTransfer?.files; void Promise.resolve(onImportPaths(files ? droppedPathsFromFileList(files) : [], "drag & drop")).finally(() => onDragCountChange(0)); }}>
        <div className="section-title-row">
          <h2>Resources</h2>
          <div className="section-title-actions">
            <span className="meta-count">{libraryItems.length}</span>
            <button aria-label="New folder" className="icon-button icon-button-small" type="button" onClick={() => onStartCreateCollection(null)}>
              ＋
            </button>
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
      {isManageOpen ? (
        <div className="manage-popover" ref={managePopoverRef} role="dialog" aria-label="Manage">
          <div className="manage-popover-body">
            <div className="collection-create-row">
              <select aria-label="Attachment filter" className="mode-select" value={attachmentFilter} onChange={(event) => setAttachmentFilter(event.target.value as AttachmentFilter)}>
                <option value="all">All Attachments</option>
                <option value="ready">Readable Files</option>
                <option value="missing">Missing Files</option>
                <option value="citation_only">Citation Only</option>
              </select>
              <select aria-label="Sort papers" className="mode-select" value={itemSort} onChange={(event) => setItemSort(event.target.value as ItemSort)}>
                <option value="recent">Recently Added</option>
                <option value="title">Title A-Z</option>
                <option value="year_desc">Year (Newest)</option>
              </select>
              <select aria-label="Filter tag" className="mode-select" value={selectedTagId ?? "all"} onChange={(event) => onSelectedTagChange(event.target.value === "all" ? null : Number(event.target.value))}>
                <option value="all">All Tags</option>
                {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </div>
            <div className="collection-create-row">
              <input aria-label="New tag name" className="search-input" placeholder="Tag the active paper..." value={newTagName} onChange={(event) => onNewTagNameChange(event.target.value)} />
              <button className="ghost-button" type="button" onClick={() => void onCreateTag()}>Add Tag</button>
            </div>
            {selectedItemIds.length > 0 ? (
              <div className="selection-toolbar">
                <div className="collection-create-row">
                  <input aria-label="Batch tag papers" className="search-input" placeholder="Tag selected papers..." value={batchTagName} onChange={(event) => onBatchTagNameChange(event.target.value)} />
                  <button className="ghost-button" type="button" onClick={() => void onBatchTag()}>Tag Selected</button>
                </div>
                <div className="collection-create-row">
                  <select aria-label="Batch move papers" className="mode-select" value={batchMoveTargetId} onChange={(event) => onBatchMoveTargetChange(event.target.value)}>
                    <option value="current">Current Collection</option>
                    {collections.filter((collection) => collection.id !== selectedCollectionId).map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
                  </select>
                  <button className="ghost-button" type="button" onClick={() => void onBatchMove()}>Move Selected</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
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
