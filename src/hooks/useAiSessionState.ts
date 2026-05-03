import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  expandSessionReferenceItemIds,
  filenameStem,
  formatItemMetadata,
  itemCountForCollection,
  noteHeading,
  sessionReferenceLabel,
  taskLabel,
} from "../lib/appView";
import type {
  AIArtifact,
  AISession,
  AISessionReference,
  AITask,
  AITaskStreamEvent,
  AppApi,
  Collection,
  LibraryItem,
  ResearchNote,
} from "../lib/contracts";

export type AiDockSection = "artifacts" | "history" | "notes";

export type AiPendingMessage = {
  sessionId?: number;
  itemId?: number;
  collectionId?: number;
  scopeItemIds?: number[] | null;
  streamId: string;
  kind: string;
  inputPrompt: string | null;
  markdown: string;
  error: string | null;
  status: "streaming" | "failed";
  taskId?: number;
};

export type AiReferencePickerResult =
  | { key: string; kind: "item"; targetId: number; label: string; meta: string | null; badges: string[] }
  | { key: string; kind: "collection"; targetId: number; label: string; meta: string | null; badges: string[] };

const initialAiDockState = (): Record<AiDockSection, boolean> => ({
  artifacts: false,
  history: false,
  notes: false,
});

const createStreamId = () =>
  globalThis.crypto?.randomUUID?.() ?? `stream-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function useAiSessionState({
  api,
  collections,
  libraryItems,
  selectedCollectionId,
  activePaper,
  openPapers,
  setStatusMessage,
}: {
  api: AppApi;
  collections: Collection[];
  libraryItems: LibraryItem[];
  selectedCollectionId: number | null;
  activePaper: LibraryItem | null;
  openPapers: LibraryItem[];
  setStatusMessage: (value: string) => void;
}) {
  const getApi = useCallback(() => Promise.resolve(api), [api]);
  const [aiSessions, setAiSessions] = useState<AISession[]>([]);
  const [activeAiSessionId, setActiveAiSessionId] = useState<number | null>(null);
  const [aiSessionReferences, setAiSessionReferences] = useState<AISessionReference[]>([]);
  const [aiSessionTaskRuns, setAiSessionTaskRuns] = useState<AITask[]>([]);
  const [aiSessionArtifact, setAiSessionArtifact] = useState<AIArtifact | null>(null);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [aiPendingBySession, setAiPendingBySession] = useState<Record<number, AiPendingMessage | undefined>>({});
  const [aiPendingByPaper, setAiPendingByPaper] = useState<Record<number, AiPendingMessage | undefined>>({});
  const [aiPendingByCollection, setAiPendingByCollection] = useState<Record<number, AiPendingMessage | undefined>>({});
  const [aiDockOpen, setAiDockOpen] = useState(initialAiDockState);
  const [isAiSessionHistoryOpen, setIsAiSessionHistoryOpen] = useState(false);
  const [isReferencePickerOpen, setIsReferencePickerOpen] = useState(false);
  const [aiReferenceQuery, setAiReferenceQuery] = useState("");
  const [aiReferenceSearchResults, setAiReferenceSearchResults] = useState<LibraryItem[]>([]);
  const [aiReferenceSearchLoading, setAiReferenceSearchLoading] = useState(false);
  const [aiReferenceSearchError, setAiReferenceSearchError] = useState<string | null>(null);
  const [aiComposerValue, setAiComposerValue] = useState("");

  const aiReferenceButtonRef = useRef<HTMLButtonElement | null>(null);
  const aiReferencePopoverRef = useRef<HTMLDivElement | null>(null);
  const aiChatHistoryRef = useRef<HTMLDivElement | null>(null);
  const aiReferenceSearchInputRef = useRef<HTMLInputElement | null>(null);
  const aiReferenceSearchRequestIdRef = useRef(0);

  const closeAiReferencePicker = useCallback(() => {
    setIsReferencePickerOpen(false);
  }, []);

  const toggleAiReferencePicker = useCallback(() => {
    setIsReferencePickerOpen((current) => !current);
  }, []);

  const refreshAiSessions = useCallback(async () => {
    const runtimeApi = await getApi();
    const sessions = await runtimeApi.listAiSessions();
    setAiSessions(sessions);
    setActiveAiSessionId((current) => current ?? sessions[0]?.id ?? null);
    return sessions;
  }, [getApi]);

  const refreshActiveAiSession = useCallback(
    async (sessionId: number) => {
      const runtimeApi = await getApi();
      const [references, taskRuns, artifact, sessionNotes, sessions] = await Promise.all([
        runtimeApi.listAiSessionReferences(sessionId),
        runtimeApi.listAiSessionTaskRuns(sessionId),
        runtimeApi.getAiSessionArtifact(sessionId),
        runtimeApi.listAiSessionNotes(sessionId),
        runtimeApi.listAiSessions(),
      ]);
      setAiSessionReferences(references);
      setAiSessionTaskRuns(taskRuns);
      setAiSessionArtifact(artifact);
      setNotes(sessionNotes);
      setActiveNoteId(sessionNotes[0]?.id ?? null);
      setNoteDraft(sessionNotes[0]?.markdown ?? "");
      setAiSessions(sessions);
      return { references, taskRuns, artifact, sessionNotes, sessions };
    },
    [getApi],
  );

  const ensureSessionHasCurrentPaper = useCallback(
    async (sessionId: number, references?: AISessionReference[]) => {
      if (!activePaper) return;
      const currentReferences = references ?? (await (await getApi()).listAiSessionReferences(sessionId));
      if (currentReferences.length > 0) return;
      const runtimeApi = await getApi();
      await runtimeApi.addAiSessionReference({ session_id: sessionId, kind: "item", target_id: activePaper.id });
    },
    [activePaper, getApi],
  );

  useEffect(() => {
    void refreshAiSessions();
  }, [refreshAiSessions]);

  useEffect(() => {
    if (activeAiSessionId === null) {
      setAiSessionReferences([]);
      setAiSessionTaskRuns([]);
      setAiSessionArtifact(null);
      setNotes([]);
      setActiveNoteId(null);
      setNoteDraft("");
      return;
    }
    let cancelled = false;
    void (async () => {
      const sessionState = await refreshActiveAiSession(activeAiSessionId);
      if (cancelled) return;
      if (sessionState.references.length === 0 && activePaper) {
        await ensureSessionHasCurrentPaper(activeAiSessionId, sessionState.references);
        if (!cancelled) await refreshActiveAiSession(activeAiSessionId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAiSessionId, activePaper, ensureSessionHasCurrentPaper, refreshActiveAiSession]);

  useEffect(() => {
    if (!isReferencePickerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAiReferencePicker();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const popover = aiReferencePopoverRef.current;
      const button = aiReferenceButtonRef.current;
      if (popover && popover.contains(target)) return;
      if (button && button.contains(target)) return;
      closeAiReferencePicker();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [closeAiReferencePicker, isReferencePickerOpen]);

  useEffect(() => {
    if (!isReferencePickerOpen) {
      aiReferenceSearchRequestIdRef.current += 1;
      setAiReferenceQuery("");
      setAiReferenceSearchResults([]);
      setAiReferenceSearchLoading(false);
      setAiReferenceSearchError(null);
      return;
    }
    aiReferenceSearchInputRef.current?.focus();
  }, [isReferencePickerOpen]);

  useEffect(() => {
    if (!isReferencePickerOpen) return;
    const query = aiReferenceQuery.trim();
    if (!query) {
      aiReferenceSearchRequestIdRef.current += 1;
      setAiReferenceSearchResults([]);
      setAiReferenceSearchLoading(false);
      setAiReferenceSearchError(null);
      return;
    }

    const requestId = aiReferenceSearchRequestIdRef.current + 1;
    aiReferenceSearchRequestIdRef.current = requestId;
    let cancelled = false;
    setAiReferenceSearchLoading(true);
    setAiReferenceSearchError(null);

    void (async () => {
      try {
        const results = await (await getApi()).searchItems(query);
        if (cancelled || aiReferenceSearchRequestIdRef.current !== requestId) return;
        setAiReferenceSearchResults(results);
        setAiReferenceSearchLoading(false);
      } catch (error) {
        if (cancelled || aiReferenceSearchRequestIdRef.current !== requestId) return;
        setAiReferenceSearchResults([]);
        setAiReferenceSearchLoading(false);
        setAiReferenceSearchError(error instanceof Error ? error.message : "Search failed.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [aiReferenceQuery, getApi, isReferencePickerOpen]);

  const handleAiTaskStreamEvent = useCallback((event: AITaskStreamEvent) => {
    if (event.scope === "paper" && typeof event.item_id === "number") {
      const itemId = event.item_id;
      if (event.phase === "started") {
        setAiPendingByPaper((current) => ({
          ...current,
          [itemId]: { itemId, collectionId: event.collection_id, streamId: event.stream_id, kind: event.kind, inputPrompt: event.input_prompt ?? null, markdown: "", error: null, status: "streaming" },
        }));
        return;
      }
      if (event.phase === "delta") {
        setAiPendingByPaper((current) => {
          const existing = current[itemId];
          if (!existing || existing.streamId !== event.stream_id) return current;
          return { ...current, [itemId]: { ...existing, markdown: `${existing.markdown}${event.delta_markdown ?? ""}` } };
        });
        return;
      }
      if (event.phase === "completed") {
        void (async () => {
          const runtimeApi = await getApi();
          const [taskRuns, artifact] = await Promise.all([runtimeApi.listTaskRuns({ item_id: itemId }), runtimeApi.getArtifact({ item_id: itemId })]);
          if (activePaper?.id === itemId) {
            void taskRuns;
            void artifact;
          }
          setAiPendingByPaper((current) => {
            const existing = current[itemId];
            if (!existing || existing.streamId !== event.stream_id) return current;
            const next = { ...current };
            delete next[itemId];
            return next;
          });
        })();
        return;
      }
      if (event.phase === "failed") {
        setAiPendingByPaper((current) => {
          const existing = current[itemId];
          if (!existing || existing.streamId !== event.stream_id) return current;
          return { ...current, [itemId]: { ...existing, error: event.error ?? "AI task failed.", status: "failed" } };
        });
      }
      return;
    }

    if (event.scope === "collection" && typeof event.collection_id === "number") {
      const collectionId = event.collection_id;
      if (event.phase === "started") {
        setAiPendingByCollection((current) => ({
          ...current,
          [collectionId]: { collectionId, scopeItemIds: event.scope_item_ids ?? null, streamId: event.stream_id, kind: event.kind, inputPrompt: event.input_prompt ?? null, markdown: "", error: null, status: "streaming" },
        }));
        return;
      }
      if (event.phase === "delta") {
        setAiPendingByCollection((current) => {
          const existing = current[collectionId];
          if (!existing || existing.streamId !== event.stream_id) return current;
          return { ...current, [collectionId]: { ...existing, markdown: `${existing.markdown}${event.delta_markdown ?? ""}` } };
        });
        return;
      }
      if (event.phase === "completed") {
        setAiPendingByCollection((current) => {
          const existing = current[collectionId];
          if (!existing || existing.streamId !== event.stream_id) return current;
          const next = { ...current };
          delete next[collectionId];
          return next;
        });
        return;
      }
      if (event.phase === "failed") {
        setAiPendingByCollection((current) => {
          const existing = current[collectionId];
          if (!existing || existing.streamId !== event.stream_id) return current;
          return { ...current, [collectionId]: { ...existing, error: event.error ?? "AI task failed.", status: "failed" } };
        });
      }
      return;
    }

    if (event.scope !== "session" || typeof event.session_id !== "number") return;
    const sessionId = event.session_id;
    if (event.phase === "started") {
      setAiPendingBySession((current) => ({
        ...current,
        [sessionId]: { sessionId, collectionId: event.collection_id, scopeItemIds: event.scope_item_ids ?? null, streamId: event.stream_id, kind: event.kind, inputPrompt: event.input_prompt ?? null, markdown: "", error: null, status: "streaming" },
      }));
      return;
    }
    if (event.phase === "delta") {
      setAiPendingBySession((current) => {
        const existing = current[sessionId];
        if (!existing || existing.streamId !== event.stream_id) return current;
        return { ...current, [sessionId]: { ...existing, markdown: `${existing.markdown}${event.delta_markdown ?? ""}` } };
      });
      return;
    }
    if (event.phase === "completed") {
      void (async () => {
        const runtimeApi = await getApi();
        const [taskRuns, artifact, sessions] = await Promise.all([
          runtimeApi.listAiSessionTaskRuns(sessionId),
          runtimeApi.getAiSessionArtifact(sessionId),
          runtimeApi.listAiSessions(),
        ]);
        setAiSessions(sessions);
        setAiPendingBySession((current) => {
          const pending = current[sessionId];
          if (!pending || pending.streamId !== event.stream_id) return current;
          const next = { ...current };
          delete next[sessionId];
          return next;
        });
        setStatusMessage(`Completed ${taskLabel(event.kind)}.`);
        if (activeAiSessionId === sessionId) {
          setAiSessionTaskRuns(taskRuns);
          setAiSessionArtifact(artifact);
        }
      })();
      return;
    }
    if (event.phase === "failed") {
      setAiPendingBySession((current) => {
        const existing = current[sessionId];
        if (!existing || existing.streamId !== event.stream_id) return current;
        return { ...current, [sessionId]: { ...existing, error: event.error ?? "AI task failed.", status: "failed" } };
      });
      setStatusMessage(event.error ?? `Failed ${taskLabel(event.kind)}.`);
    }
  }, [activeAiSessionId, activePaper?.id, getApi, setStatusMessage]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const unlisten = await (await getApi()).listenAiTaskStream(handleAiTaskStreamEvent);
      if (cancelled) {
        unlisten();
        return;
      }
      dispose = unlisten;
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [getApi, handleAiTaskStreamEvent]);

  useEffect(() => {
    const container = aiChatHistoryRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [aiSessionTaskRuns, activeAiSessionId, aiPendingBySession]);

  const activeAiSession = useMemo(
    () => aiSessions.find((session) => session.id === activeAiSessionId) ?? null,
    [activeAiSessionId, aiSessions],
  );
  const sortedReferenceItems = useMemo(() => [...libraryItems].sort((a, b) => a.title.localeCompare(b.title)), [libraryItems]);
  const sortedReferenceCollections = useMemo(() => [...collections].sort((a, b) => a.name.localeCompare(b.name)), [collections]);
  const expandedAiReferenceItemIds = useMemo(
    () => expandSessionReferenceItemIds(aiSessionReferences, collections, libraryItems),
    [aiSessionReferences, collections, libraryItems],
  );
  const aiReferenceItemIds = useMemo(
    () => new Set(aiSessionReferences.filter((reference) => reference.kind === "item").map((reference) => reference.target_id)),
    [aiSessionReferences],
  );
  const aiReferenceCollectionIds = useMemo(
    () => new Set(aiSessionReferences.filter((reference) => reference.kind === "collection").map((reference) => reference.target_id)),
    [aiSessionReferences],
  );
  const activeAiPending = activeAiSessionId ? aiPendingBySession[activeAiSessionId] ?? null : null;
  const isActiveAiSessionStreaming = activeAiPending?.status === "streaming";
  const aiSessionThreadRuns = useMemo(() => [...aiSessionTaskRuns].reverse(), [aiSessionTaskRuns]);
  const aiPanelCanSend = expandedAiReferenceItemIds.length > 0 && !isActiveAiSessionStreaming;
  const compareEnabled = expandedAiReferenceItemIds.length >= 2 && !isActiveAiSessionStreaming;
  const areQuickActionsDisabled = isActiveAiSessionStreaming;
  const filteredReferenceCollections = useMemo(() => {
    const query = aiReferenceQuery.trim().toLowerCase();
    return sortedReferenceCollections.filter((collection) => (query.length === 0 ? true : collection.name.toLowerCase().includes(query)));
  }, [aiReferenceQuery, sortedReferenceCollections]);
  const aiReferencePickerResults = useMemo<AiReferencePickerResult[]>(() => {
    const query = aiReferenceQuery.trim();
    const output: AiReferencePickerResult[] = [];
    const seen = new Set<string>();
    const pushResult = (entry: AiReferencePickerResult) => {
      if (seen.has(entry.key)) return;
      seen.add(entry.key);
      output.push(entry);
    };
    for (const paper of openPapers) {
      pushResult({
        key: `item-${paper.id}`,
        kind: "item",
        targetId: paper.id,
        label: paper.title,
        meta: formatItemMetadata(paper),
        badges: paper.id === activePaper?.id ? ["Current", "Paper"] : ["Paper"],
      });
    }
    if (activePaper && !openPapers.some((paper) => paper.id === activePaper.id)) {
      pushResult({
        key: `item-${activePaper.id}`,
        kind: "item",
        targetId: activePaper.id,
        label: activePaper.title,
        meta: formatItemMetadata(activePaper),
        badges: ["Current", "Paper"],
      });
    }
    for (const item of query.length > 0 ? aiReferenceSearchResults : sortedReferenceItems) {
      pushResult({
        key: `item-${item.id}`,
        kind: "item",
        targetId: item.id,
        label: item.title,
        meta: formatItemMetadata(item),
        badges: ["Paper"],
      });
    }
    for (const collection of filteredReferenceCollections) {
      pushResult({
        key: `collection-${collection.id}`,
        kind: "collection",
        targetId: collection.id,
        label: collection.name,
        meta: `${itemCountForCollection(libraryItems, collection.id)} papers`,
        badges: ["Collection"],
      });
    }
    return output;
  }, [activePaper, aiReferenceQuery, aiReferenceSearchResults, filteredReferenceCollections, libraryItems, openPapers, sortedReferenceItems]);

  const handleSessionTask = useCallback(async (kind: string, prompt?: string) => {
    if (!activeAiSessionId) return;
    const runtimeApi = await getApi();
    const sessionId = activeAiSessionId;
    const streamId = createStreamId();
    const inputPrompt = prompt?.trim() || null;
    setAiPendingBySession((current) => ({
      ...current,
      [sessionId]: { sessionId, streamId, kind, inputPrompt, markdown: "", error: null, status: "streaming" },
    }));
    try {
      await runtimeApi.runAiSessionTask({ session_id: sessionId, kind, prompt, stream_id: streamId });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed ${taskLabel(kind)}.`;
      setAiPendingBySession((current) => {
        const existing = current[sessionId];
        if (!existing || existing.streamId !== streamId) return current;
        return { ...current, [sessionId]: { ...existing, error: message, status: "failed" } };
      });
      setStatusMessage(message);
      throw error;
    }
  }, [activeAiSessionId, getApi, setStatusMessage]);

  const handleAiSubmit = useCallback(async () => {
    const prompt = aiComposerValue.trim();
    if (!prompt) return;
    setAiComposerValue("");
    try {
      await handleSessionTask("session.ask", prompt);
    } catch {
      setAiComposerValue(prompt);
    }
  }, [aiComposerValue, handleSessionTask]);

  const handleQuickAction = useCallback(async (kind: string) => {
    try {
      await handleSessionTask(kind);
    } catch {
      // Rendered in thread.
    }
  }, [handleSessionTask]);

  const handleCreateResearchNote = useCallback(async () => {
    if (!aiSessionArtifact) return;
    const runtimeApi = await getApi();
    const note = await runtimeApi.createAiSessionNoteFromArtifact(aiSessionArtifact.id);
    const sessionNotes = activeAiSessionId ? await runtimeApi.listAiSessionNotes(activeAiSessionId) : [];
    setNotes(sessionNotes);
    setActiveNoteId(note.id);
    setNoteDraft(note.markdown);
  }, [activeAiSessionId, aiSessionArtifact, getApi]);

  const handleSaveNoteEdits = useCallback(async () => {
    if (!activeNoteId || !activeAiSessionId) return;
    const runtimeApi = await getApi();
    await runtimeApi.updateNote({ note_id: activeNoteId, markdown: noteDraft });
    setNotes(await runtimeApi.listAiSessionNotes(activeAiSessionId));
  }, [activeAiSessionId, activeNoteId, getApi, noteDraft]);

  const handleExportMarkdown = useCallback(async () => {
    const note = notes.find((entry) => entry.id === activeNoteId);
    if (!note) return;
    const runtimeApi = await getApi();
    const markdown = await runtimeApi.exportNoteMarkdown(note.id);
    const exportTarget = await runtimeApi.requestExportPath({
      defaultPath: `${filenameStem(noteHeading(note), "research-note")}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!exportTarget) return;
    await runtimeApi.writeExportFile({ ...exportTarget, contents: markdown });
    setStatusMessage(`Saved Markdown to ${exportTarget.path}.`);
  }, [activeNoteId, getApi, notes, setStatusMessage]);

  const handleCreateAiSession = useCallback(async () => {
    const runtimeApi = await getApi();
    const session = await runtimeApi.createAiSession();
    setAiSessions((current) => [session, ...current]);
    setActiveAiSessionId(session.id);
    setIsAiSessionHistoryOpen(false);
    if (activePaper) {
      await runtimeApi.addAiSessionReference({ session_id: session.id, kind: "item", target_id: activePaper.id });
    }
    await refreshActiveAiSession(session.id);
    setStatusMessage(`Created ${session.title}.`);
  }, [activePaper, getApi, refreshActiveAiSession, setStatusMessage]);

  const handleAddAiReference = useCallback(async (kind: AISessionReference["kind"], targetId: number) => {
    if (!activeAiSessionId) return;
    const runtimeApi = await getApi();
    await runtimeApi.addAiSessionReference({ session_id: activeAiSessionId, kind, target_id: targetId });
    await refreshActiveAiSession(activeAiSessionId);
    setAiReferenceQuery("");
    setAiReferenceSearchResults([]);
    setAiReferenceSearchLoading(false);
    setAiReferenceSearchError(null);
    setIsReferencePickerOpen(false);
  }, [activeAiSessionId, getApi, refreshActiveAiSession]);

  const handleRemoveAiReference = useCallback(async (referenceId: number) => {
    await (await getApi()).removeAiSessionReference(referenceId);
    if (activeAiSessionId) await refreshActiveAiSession(activeAiSessionId);
  }, [activeAiSessionId, getApi, refreshActiveAiSession]);

  const ensureSessionReady = useCallback(async () => {
    setIsAiPanelOpen(true);
    if (activeAiSessionId) return activeAiSessionId;
    const runtimeApi = await getApi();
    const existing = await runtimeApi.listAiSessions();
    const session = existing[0] ?? (await runtimeApi.createAiSession());
    setAiSessions(existing[0] ? existing : [session]);
    setActiveAiSessionId(session.id);
    return session.id;
  }, [activeAiSessionId, getApi]);

  const cleanupAfterItemDelete = useCallback((deletedItemId: number) => {
    setAiSessionReferences((current) => current.filter((reference) => !(reference.kind === "item" && reference.target_id === deletedItemId)));
    setAiPendingByPaper((current) => {
      const next = { ...current };
      delete next[deletedItemId];
      return next;
    });
  }, []);

  const cleanupAfterCollectionDelete = useCallback((deletedCollectionIds: Set<number>, deletedItemIds: Set<number>) => {
    setAiSessionReferences((current) =>
      current.filter((reference) => (reference.kind === "item" ? !deletedItemIds.has(reference.target_id) : !deletedCollectionIds.has(reference.target_id))),
    );
    setAiPendingByCollection((current) => {
      const next = { ...current };
      for (const id of deletedCollectionIds) delete next[id];
      return next;
    });
    setAiPendingByPaper((current) => {
      const next = { ...current };
      for (const id of deletedItemIds) delete next[id];
      return next;
    });
  }, []);

  return {
    activeAiPending,
    activeAiSession,
    activeAiSessionId,
    activeNoteId,
    aiChatHistoryRef,
    aiComposerValue,
    aiDockOpen,
    aiPanelCanSend,
    aiPendingByCollection,
    aiPendingByPaper,
    aiReferenceButtonRef,
    aiReferenceCollectionIds,
    aiReferenceItemIds,
    aiReferencePickerResults,
    aiReferencePopoverRef,
    aiReferenceQuery,
    aiReferenceSearchError,
    aiReferenceSearchInputRef,
    aiReferenceSearchLoading,
    aiSessionArtifact,
    aiSessionReferences,
    aiSessionTaskRuns,
    aiSessionThreadRuns,
    aiSessions,
    areQuickActionsDisabled,
    compareEnabled,
    isAiPanelOpen,
    isAiSessionHistoryOpen,
    isReferencePickerOpen,
    noteDraft,
    notes,
    openAiPanel: ensureSessionReady,
    refreshActiveAiSession,
    setActiveAiSessionId,
    setAiSessions,
    setAiComposerValue,
    setAiDockOpen,
    setIsAiPanelOpen,
    setIsAiSessionHistoryOpen,
    setNoteDraft,
    setActiveNoteId,
    setAiReferenceQuery,
    toggleAiDockSection: (section: AiDockSection) =>
      setAiDockOpen((current) => ({ ...current, [section]: !current[section] })),
    toggleAiReferencePicker,
    handleAddAiReference,
    handleAiSubmit,
    handleCreateAiSession,
    handleCreateResearchNote,
    handleExportMarkdown,
    handleQuickAction,
    handleRemoveAiReference,
    handleSaveNoteEdits,
    cleanupAfterCollectionDelete,
    cleanupAfterItemDelete,
    closeAiReferencePicker,
    ensureSessionReady,
    selectedCollectionId,
  };
}
