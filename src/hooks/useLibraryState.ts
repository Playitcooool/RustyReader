import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  applyTagFilter,
  childCollectionsFor,
  collectionDeleteSummary,
  descendantIdsForCollection,
  droppedPathsFromFileList,
  filterItemsByAttachment,
  isSupportedPath,
  matchesSearch,
  readStoredString,
  sortItems,
  type AttachmentFilter,
  type ItemSort,
} from "../lib/appView";
import { isTauriRuntime } from "../lib/api";
import type { AppApi, Collection, ImportBatchResult, LibraryItem, Tag } from "../lib/contracts";
import { useAppApi } from "./useAppApi";

export type ResourceContextMenuState =
  | { x: number; y: number; kind: "collection" | "item"; targetId: number }
  | null;

const DEFAULT_ITEM_SORT: ItemSort = "recent";
const DEFAULT_ATTACHMENT_FILTER: AttachmentFilter = "all";
const ITEM_SORT_KEY = "paper-reader.item-sort";
const ATTACHMENT_FILTER_KEY = "paper-reader.attachment-filter";

export function useLibraryState({
  api,
  onActivateItem,
  setStatusMessage,
}: {
  api: AppApi;
  onActivateItem: (item: LibraryItem, options?: { focusPdf?: boolean }) => void;
  setStatusMessage: (value: string) => void;
}) {
  const getApi = useAppApi(api);
  const importDocumentsRef = useRef<() => void>(() => {});
  const importCitationsRef = useRef<() => void>(() => {});
  const importPathsRef = useRef<(paths: string[], sourceLabel: string) => void>(() => {});
  const manageButtonRef = useRef<HTMLButtonElement | null>(null);
  const managePopoverRef = useRef<HTMLDivElement | null>(null);
  const resourceContextMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedCollectionIdRef = useRef<number | null>(null);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<number[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [itemSort, setItemSort] = useState<ItemSort>(() =>
    readStoredString(ITEM_SORT_KEY, DEFAULT_ITEM_SORT, ["recent", "title", "year_desc"] as const),
  );
  const [attachmentFilter, setAttachmentFilter] = useState<AttachmentFilter>(() =>
    readStoredString(ATTACHMENT_FILTER_KEY, DEFAULT_ATTACHMENT_FILTER, ["all", "ready", "missing", "citation_only"] as const),
  );
  const [lastImportResult, setLastImportResult] = useState<ImportBatchResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [draggedFileCount, setDraggedFileCount] = useState(0);
  const [newTagName, setNewTagName] = useState("");
  const [batchTagName, setBatchTagName] = useState("");
  const [batchMoveTargetId, setBatchMoveTargetId] = useState("current");
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [creatingCollectionParentId, setCreatingCollectionParentId] = useState<number | "root" | null>(null);
  const [collectionDraftName, setCollectionDraftName] = useState("");
  const [renamingCollectionId, setRenamingCollectionId] = useState<number | null>(null);
  const [resourceContextMenu, setResourceContextMenu] = useState<ResourceContextMenuState>(null);

  const hasCollections = collections.length > 0;
  const activeCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId],
  );
  const selectedCollectionScope = useMemo(() => {
    if (selectedCollectionId === null) return null;
    const scope = descendantIdsForCollection(collections, selectedCollectionId);
    scope.add(selectedCollectionId);
    return scope;
  }, [collections, selectedCollectionId]);
  const activeCollectionItems = useMemo(() => {
    if (!selectedCollectionScope) return [];
    return libraryItems.filter((item) => selectedCollectionScope.has(item.collection_id) && matchesSearch(item, search));
  }, [libraryItems, search, selectedCollectionScope]);
  const visibleItems = useMemo(
    () => sortItems(filterItemsByAttachment(applyTagFilter(activeCollectionItems, tags, selectedTagId), attachmentFilter), itemSort),
    [activeCollectionItems, attachmentFilter, itemSort, selectedTagId, tags],
  );
  const importHasIssues = Boolean(lastImportResult && (lastImportResult.duplicates.length > 0 || lastImportResult.failed.length > 0));

  useEffect(() => {
    selectedCollectionIdRef.current = selectedCollectionId;
  }, [selectedCollectionId]);

  const loadLibrary = useCallback(async (options: { refreshStatuses?: boolean } = {}) => {
    const runtimeApi = await getApi();
    if (options.refreshStatuses ?? false) {
      await runtimeApi.refreshAttachmentStatuses();
    }
    const loadedItems = await runtimeApi.listItems();
    setLibraryItems(loadedItems);
    return loadedItems;
  }, [getApi]);

  const refreshCollections = useCallback(async (preferredCollectionId?: number | null) => {
    const loadedCollections = await (await getApi()).listCollections();
    setCollections(loadedCollections);
    const rootIds = childCollectionsFor(loadedCollections, null).map((collection) => collection.id);
    setExpandedCollectionIds((current) => (current.length > 0 ? Array.from(new Set([...current, ...rootIds])) : rootIds));
    setSelectedCollectionId((current) =>
      preferredCollectionId && loadedCollections.some((collection) => collection.id === preferredCollectionId)
        ? preferredCollectionId
        : current && loadedCollections.some((collection) => collection.id === current)
          ? current
          : loadedCollections[0]?.id ?? null,
    );
    if (loadedCollections.length === 0) setStatusMessage("Create your first collection to start building the desktop library.");
  }, [getApi, setStatusMessage]);

  useEffect(() => {
    void refreshCollections();
    void loadLibrary({ refreshStatuses: true });
  }, [loadLibrary, refreshCollections]);

  useEffect(() => {
    let disposed = false;
    let dispose: null | (() => void) = null;

    void (async () => {
      const runtimeApi = await getApi();
      dispose = await runtimeApi.listenLibraryChanged((event) => {
        if (disposed) return;
        void (async () => {
          const loadedItems = await loadLibrary();
          const duplicateItem = loadedItems.find((item) => event.duplicate_item_ids?.includes(item.id));
          const importedItem = loadedItems.find((item) => event.imported_item_ids?.includes(item.id));
          const preferredCollectionId =
            importedItem?.collection_id ?? duplicateItem?.collection_id ?? event.collection_id ?? selectedCollectionIdRef.current;
          await refreshCollections(preferredCollectionId);
          if ((event.imported_count ?? 0) > 0) {
            setStatusMessage("Library updated from browser extension.");
          } else if ((event.duplicate_count ?? 0) > 0) {
            setStatusMessage("Browser extension found this item already exists in the library.");
          }
        })();
      });
      if (disposed) dispose();
    })();

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [getApi, loadLibrary, refreshCollections, setStatusMessage]);

  useEffect(() => {
    if (selectedCollectionId === null) {
      setTags([]);
      setSelectedTagId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const loadedTags = await (await getApi()).listTags(selectedCollectionId);
      if (!cancelled) {
        setTags(loadedTags);
        setSelectedTagId((current) => (current && loadedTags.some((tag) => tag.id === current) ? current : null));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getApi, selectedCollectionId]);

  useEffect(() => {
    setSelectedItemIds((current) => current.filter((itemId) => visibleItems.some((item) => item.id === itemId)));
  }, [visibleItems]);

  useEffect(() => {
    if (!isManageOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsManageOpen(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const popover = managePopoverRef.current;
      const button = manageButtonRef.current;
      if (popover && popover.contains(target)) return;
      if (button && button.contains(target)) return;
      setIsManageOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [isManageOpen]);

  useEffect(() => {
    if (!resourceContextMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setResourceContextMenu(null);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const menu = resourceContextMenuRef.current;
      if (menu && menu.contains(target)) return;
      setResourceContextMenu(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [resourceContextMenu]);

  const importPaths = useCallback(async (paths: string[], sourceLabel: string) => {
    if (!selectedCollectionId || !activeCollection || isImporting) {
      if (!hasCollections) setStatusMessage("Create a collection before importing files.");
      return;
    }
    const acceptedPaths = paths.filter(isSupportedPath);
    if (acceptedPaths.length === 0) {
      setStatusMessage("Only PDF, DOCX, and EPUB files can be imported.");
      return;
    }
    setIsImporting(true);
    try {
      const result = await (await getApi()).importFiles({ collection_id: selectedCollectionId, paths: acceptedPaths });
      setLastImportResult(result);
      const loadedItems = await loadLibrary();
      const importedItem = result.imported[0];
      if (importedItem) {
        const item = loadedItems.find((entry) => entry.id === importedItem.id);
        if (item) onActivateItem(item);
      }
      setStatusMessage(`Imported ${result.imported.length} files (duplicates ${result.duplicates.length}, failed ${result.failed.length}) into ${activeCollection.name} from ${sourceLabel}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsImporting(false);
      setDraggedFileCount(0);
    }
  }, [activeCollection, getApi, hasCollections, isImporting, loadLibrary, onActivateItem, selectedCollectionId, setStatusMessage]);

  useEffect(() => {
    importPathsRef.current = (paths: string[], sourceLabel: string) => {
      void importPaths(paths, sourceLabel);
    };
    importDocumentsRef.current = () => {
      void handleImport();
    };
    importCitationsRef.current = () => {
      void handleImportCitations();
    };
  });

  const handleImport = useCallback(async () => {
    if (!selectedCollectionId || !activeCollection || isImporting) {
      if (!hasCollections) setStatusMessage("Create a collection before importing files.");
      return;
    }
    let paths: string[];
    try {
      paths = await (await getApi()).pickImportPaths();
      if (paths.length === 0) {
        setStatusMessage("Import cancelled.");
        return;
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not open the import picker.");
      return;
    }
    await importPaths(paths, "picker");
  }, [activeCollection, getApi, hasCollections, importPaths, isImporting, selectedCollectionId, setStatusMessage]);

  const handleImportCitations = useCallback(async () => {
    if (!selectedCollectionId || !activeCollection || isImporting) {
      if (!hasCollections) setStatusMessage("Create a collection before importing citation files.");
      return;
    }
    const runtimeApi = await getApi();
    try {
      const paths = await runtimeApi.pickCitationPaths();
      if (paths.length === 0) {
        setStatusMessage("Citation import cancelled.");
        return;
      }
      const result = await runtimeApi.importCitations({ collection_id: selectedCollectionId, paths });
      setLastImportResult(result);
      await loadLibrary();
      setStatusMessage(`Imported ${result.imported.length} citation records (duplicates ${result.duplicates.length}, failed ${result.failed.length}) into ${activeCollection.name}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Citation import failed.");
    }
  }, [activeCollection, getApi, hasCollections, isImporting, loadLibrary, selectedCollectionId, setStatusMessage]);

  const toggleCollectionExpanded = useCallback((collectionId: number) => {
    setExpandedCollectionIds((current) => (current.includes(collectionId) ? current.filter((id) => id !== collectionId) : [...current, collectionId]));
  }, []);

  const startCreateCollection = useCallback((parentId: number | null) => {
    setCreatingCollectionParentId(parentId === null ? "root" : parentId);
    setRenamingCollectionId(null);
    setCollectionDraftName("");
    setResourceContextMenu(null);
  }, []);

  const startRenameCollection = useCallback((collection: Collection) => {
    setRenamingCollectionId(collection.id);
    setCreatingCollectionParentId(null);
    setCollectionDraftName(collection.name);
    setResourceContextMenu(null);
  }, []);

  const handleCreateCollection = useCallback(async (parentId: number | null) => {
    const name = collectionDraftName.trim();
    if (!name) {
      setCollectionDraftName("");
      setCreatingCollectionParentId(null);
      return;
    }
    const collection = await (await getApi()).createCollection({ name, parent_id: parentId });
    await refreshCollections(collection.id);
    setCollectionDraftName("");
    setCreatingCollectionParentId(null);
    setStatusMessage(`Created collection ${collection.name}.`);
  }, [collectionDraftName, getApi, refreshCollections, setStatusMessage]);

  const submitCollectionRename = useCallback(async () => {
    if (!renamingCollectionId) return;
    const name = collectionDraftName.trim();
    if (!name) {
      setRenamingCollectionId(null);
      setCollectionDraftName("");
      return;
    }
    await (await getApi()).renameCollection({ collection_id: renamingCollectionId, name });
    await refreshCollections(renamingCollectionId);
    setRenamingCollectionId(null);
    setCollectionDraftName("");
    setStatusMessage(`Renamed collection to ${name}.`);
  }, [collectionDraftName, getApi, refreshCollections, renamingCollectionId, setStatusMessage]);

  const cancelCollectionInlineEdit = useCallback(() => {
    setCreatingCollectionParentId(null);
    setRenamingCollectionId(null);
    setCollectionDraftName("");
  }, []);

  const openResourceContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>, detail: Exclude<ResourceContextMenuState, null>) => {
    event.preventDefault();
    setResourceContextMenu(detail);
  }, []);

  const handleCreateTag = useCallback(async (activePaper: LibraryItem | null) => {
    if (!activePaper) {
      setStatusMessage("Open a paper before tagging it.");
      return;
    }
    const name = newTagName.trim();
    if (!name) {
      setStatusMessage("Enter a tag name first.");
      return;
    }
    const runtimeApi = await getApi();
    const tag = await runtimeApi.createTag({ name });
    await runtimeApi.assignTag({ item_id: activePaper.id, tag_id: tag.id });
    await loadLibrary();
    setTags(await runtimeApi.listTags(selectedCollectionId ?? undefined));
    setNewTagName("");
    setStatusMessage(`Tagged ${activePaper.title} with ${tag.name}.`);
  }, [getApi, loadLibrary, newTagName, selectedCollectionId, setStatusMessage]);

  const handleBatchTag = useCallback(async () => {
    if (selectedItemIds.length === 0) {
      setStatusMessage("Select at least one paper first.");
      return;
    }
    const name = batchTagName.trim();
    if (!name) {
      setStatusMessage("Enter a tag name first.");
      return;
    }
    const runtimeApi = await getApi();
    const tag = await runtimeApi.createTag({ name });
    await Promise.all(selectedItemIds.map((itemId) => runtimeApi.assignTag({ item_id: itemId, tag_id: tag.id })));
    await loadLibrary();
    setBatchTagName("");
    setStatusMessage(`Tagged ${selectedItemIds.length} papers with ${tag.name}.`);
  }, [batchTagName, getApi, loadLibrary, selectedItemIds, setStatusMessage]);

  const handleBatchMove = useCallback(async () => {
    if (selectedItemIds.length === 0) {
      setStatusMessage("Select at least one paper first.");
      return;
    }
    const destinationId = batchMoveTargetId === "current" ? selectedCollectionId : Number(batchMoveTargetId);
    if (!destinationId) {
      setStatusMessage("Choose a destination collection first.");
      return;
    }
    const runtimeApi = await getApi();
    await Promise.all(selectedItemIds.map((itemId) => runtimeApi.moveItem({ item_id: itemId, collection_id: destinationId })));
    await loadLibrary();
    setSelectedItemIds([]);
    setStatusMessage(`Moved ${selectedItemIds.length} papers.`);
  }, [batchMoveTargetId, getApi, loadLibrary, selectedCollectionId, selectedItemIds, setStatusMessage]);

  const treeSearchFilter = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (normalized.length === 0) return null;
    const matchingItems = activeCollectionItems;
    const allowedItemIds = new Set(matchingItems.map((item) => item.id));
    const parentById = new Map(collections.map((collection) => [collection.id, collection.parent_id]));
    const allowedCollectionIds = new Set<number>();
    for (const item of matchingItems) {
      let cursor: number | null = item.collection_id;
      while (cursor !== null && !allowedCollectionIds.has(cursor)) {
        allowedCollectionIds.add(cursor);
        cursor = parentById.get(cursor) ?? null;
      }
    }
    return { allowedItemIds, allowedCollectionIds };
  }, [activeCollectionItems, collections, search]);

  const contextMenuCollection = resourceContextMenu?.kind === "collection" ? collections.find((collection) => collection.id === resourceContextMenu.targetId) ?? null : null;
  const contextMenuItem = resourceContextMenu?.kind === "item" ? libraryItems.find((item) => item.id === resourceContextMenu.targetId) ?? null : null;

  return {
    activeCollection,
    attachmentFilter,
    batchMoveTargetId,
    batchTagName,
    cancelCollectionInlineEdit,
    collectionDraftName,
    collections,
    contextMenuCollection,
    contextMenuItem,
    creatingCollectionParentId,
    draggedFileCount,
    expandedCollectionIds,
    hasCollections,
    handleBatchMove,
    handleBatchTag,
    handleCreateCollection,
    handleCreateTag,
    handleImport,
    handleImportCitations,
    importCitationsRef,
    importDocumentsRef,
    importHasIssues,
    importPaths,
    importPathsRef,
    isImporting,
    isManageOpen,
    itemSort,
    lastImportResult,
    libraryItems,
    loadLibrary,
    manageButtonRef,
    managePopoverRef,
    newTagName,
    openResourceContextMenu,
    refreshCollections,
    renamingCollectionId,
    resourceContextMenu,
    resourceContextMenuRef,
    search,
    selectedCollectionId,
    selectedItemIds,
    selectedTagId,
    setAttachmentFilter,
    setBatchMoveTargetId,
    setBatchTagName,
    setCollectionDraftName,
    setDraggedFileCount,
    setIsManageOpen,
    setItemSort,
    setNewTagName,
    setResourceContextMenu,
    setSearch,
    setSelectedCollectionId,
    setSelectedItemIds,
    setSelectedTagId,
    startCreateCollection,
    startRenameCollection,
    submitCollectionRename,
    tags,
    toggleCollectionExpanded,
    treeSearchFilter,
    visibleItems,
  };
}
