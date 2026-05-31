import type { AITaskStreamEvent, AppApi, LibraryChangedEvent } from "./contracts";
import {
  toPdfDocumentInfo,
  toPdfInitialPageBundle,
  toPdfOutlineItems,
  toPdfPageBundle,
  toPdfPageText,
  toPdfSearchResult,
  toUint8Array,
} from "./pdfEngineResponses";

export const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function createTauriApi(): Promise<AppApi> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { open } = await import("@tauri-apps/plugin-dialog");

  return {
    listCollections: () => invoke("list_collections"),
    createCollection: (input) => invoke("create_collection", { input }),
    moveCollection: (input) => invoke("move_collection", { input }),
    renameCollection: (input) => invoke("rename_collection", { input }),
    removeCollection: (input) => invoke("remove_collection", { input }),
    collectionDeleteSummary: (input) => invoke("collection_delete_summary", { input }),
    listTags: (collectionId) => invoke("list_tags", { collectionId }),
    createTag: (input) => invoke("create_tag", { input }),
    assignTag: (input) => invoke("assign_tag", { input }),
    pickCitationPaths: async () => {
      const selection = await open({
        multiple: true,
        filters: [
          {
            name: "Citations",
            extensions: ["bib", "ris"],
          },
        ],
      });
      if (!selection) return [];
      return Array.isArray(selection) ? selection : [selection];
    },
    pickRelinkPath: async () => {
      const selection = await open({
        multiple: false,
      });
      if (!selection || Array.isArray(selection)) return null;
      return selection;
    },
    pickImportPaths: async () => {
      const selection = await open({
        multiple: true,
        filters: [
          {
            name: "Documents",
            extensions: ["pdf", "docx", "epub", "md", "markdown"],
          },
        ],
      });
      if (!selection) return [];
      return Array.isArray(selection) ? selection : [selection];
    },
    importFiles: (input) => invoke("import_files", { input }),
    importCitations: (input) => invoke("import_citations", { input }),
    refreshAttachmentStatuses: () => invoke("refresh_attachment_statuses"),
    relinkAttachment: (input) => invoke("relink_attachment", { input }),
    updateItemMetadata: (input) => invoke("update_item_metadata", { input }),
    removeItem: (input) => invoke("remove_item", { input }),
    moveItem: (input) => invoke("move_item", { input }),
    listItems: (collectionId) => invoke("list_items", { collectionId }),
    queryLibraryItems: (input) => invoke("query_library_items", { input }),
    libraryTreeSearchFilter: (input) => invoke("library_tree_search_filter", { input }),
    searchItems: (query) => invoke("search_items", { input: { query } }),
    getReaderView: (itemId) => invoke("get_reader_view", { itemId }),
    updateMarkdownItem: (input) => invoke("update_markdown_item", { input }),
    readPrimaryAttachmentBytes: async (primaryAttachmentId) =>
      toUint8Array(
        await invoke("read_primary_attachment_bytes", {
          primaryAttachmentId,
        }),
      ),
    listAnnotations: (itemId) => invoke("list_annotations", { itemId }),
    createAnnotation: (input) => invoke("create_annotation", { input }),
    updateAnnotation: (input) => invoke("update_annotation", { input }),
    colorPdfTextAnchor: (input) => invoke("color_pdf_text_anchor", { input }),
    normalizePdfTextBoxAnchor: (input) => invoke("normalize_pdf_text_box_anchor", { input }),
    normalizePdfInkAnchor: (input) => invoke("normalize_pdf_ink_anchor", { input }),
    removeAnnotation: (input) => invoke("remove_annotation", { input }),
    getAiSettings: () => invoke("get_ai_settings"),
    getSystemAiEnv: () => invoke("get_system_ai_env"),
    updateAiSettings: (input) => invoke("update_ai_settings", { input }),
    getConnectorSettings: () => invoke("get_connector_settings"),
    regenerateConnectorToken: () => invoke("regenerate_connector_token"),
    translateSelection: (input) => invoke("translate_selection", { input }),
    listAiSessions: () => invoke("list_ai_sessions"),
    findItemOnlyAiSession: (itemId) => invoke("find_item_only_ai_session", { itemId }),
    createAiSession: () => invoke("create_ai_session"),
    deleteAiSession: (sessionId) =>
      invoke("delete_ai_session", {
        sessionId,
      }),
    listAiSessionReferences: (sessionId) =>
      invoke("list_ai_session_references", {
        sessionId,
      }),
    getAiSessionScope: (sessionId) =>
      invoke("get_ai_session_scope", {
        sessionId,
      }),
    addAiSessionReference: (input) => invoke("add_ai_session_reference", { input }),
    removeAiSessionReference: (referenceId) =>
      invoke("remove_ai_session_reference", {
        referenceId,
      }),
    runAiSessionTask: (input) => invoke("run_ai_session_task", { input }),
    listAiSessionTaskRuns: (sessionId) =>
      invoke("list_ai_session_task_runs", {
        sessionId,
      }),
    queryEvidenceChunks: (input) => invoke("query_evidence_chunks", { input }),
    getEvidenceChunk: (evidenceId) => invoke("get_evidence_chunk", { evidenceId }),
    locateEvidenceChunk: (evidenceId) => invoke("locate_evidence_chunk", { evidenceId }),
    getAiSessionArtifact: (sessionId) =>
      invoke("get_ai_session_artifact", {
        sessionId,
      }),
    listAiSessionNotes: (sessionId) =>
      invoke("list_ai_session_notes", {
        sessionId,
      }),
    createAiSessionNoteFromArtifact: (artifactId) =>
      invoke("create_ai_session_note_from_artifact", {
        artifactId,
      }),
    createResearchNote: (input) => invoke("create_research_note", { input }),
    runItemTask: (input) => invoke("run_item_task", { input }),
    runCollectionTask: (input) => invoke("run_collection_task", { input }),
    listenAiTaskStream: async (handler) => {
      const unlisten = await listen<AITaskStreamEvent>("ai-task-stream", (event) => {
        handler(event.payload);
      });
      return () => {
        void unlisten();
      };
    },
    listenLibraryChanged: async (handler) => {
      const unlisten = await listen<LibraryChangedEvent>("library:changed", (event) => {
        handler(event.payload);
      });
      return () => {
        void unlisten();
      };
    },
    listTaskRuns: (input) =>
      invoke("list_task_runs", {
        itemId: input.item_id,
        collectionId: input.collection_id,
      }),
    getArtifact: (input) =>
      invoke("get_artifact", {
        itemId: input.item_id,
        collectionId: input.collection_id,
      }),
    listNotes: (collectionId) => invoke("list_notes", { collectionId }),
    createNoteFromArtifact: (input) =>
      invoke("create_note_from_artifact", { artifactId: input.artifact_id }),
    updateNote: (input) => invoke("update_note", { input }),
    exportNoteMarkdown: (noteId) => invoke("export_note_markdown", { noteId }),
    exportCitation: (itemId, format) => invoke("export_citation", { itemId, format }),
    requestExportPath: (input) => invoke("request_export_path", { input }),
    writeExportFile: (input) => invoke("write_export_file", { input }),
    ocrPdfPage: (input) => invoke("ocr_pdf_page", { input }),
    pdfEngineGetDocumentInfo: async (input) =>
      toPdfDocumentInfo(
        await invoke("pdf_engine_get_document_info", {
          input,
        }),
      ),
    pdfEngineGetOutline: async (input) =>
      toPdfOutlineItems(
        await invoke("pdf_engine_get_outline", {
          input,
        }),
      ),
    pdfEngineGetInitialPageBundle: async (input) =>
      toPdfInitialPageBundle(
        await invoke("pdf_engine_get_initial_page_bundle", {
          input,
        }),
      ),
    pdfEngineGetPageBundle: async (input) =>
      toPdfPageBundle(
        await invoke("pdf_engine_get_page_bundle", {
          input,
        }),
      ),
    pdfEngineGetPageBundlesBatch: async (input) => {
      const raw = await invoke("pdf_engine_get_page_bundles_batch", { input });
      if (!Array.isArray(raw)) throw new Error("Unexpected PDF page bundles batch response.");
      return raw.map(toPdfPageBundle);
    },
    pdfEngineGetPageText: async (input) =>
      toPdfPageText(
        await invoke("pdf_engine_get_page_text", {
          input,
        }),
      ),
    pdfEngineGetPageTextsBatch: async (input) => {
      const raw = await invoke("pdf_engine_get_page_texts_batch", { input });
      if (!Array.isArray(raw)) throw new Error("Unexpected PDF page texts batch response.");
      return raw.map(toPdfPageText);
    },
    pdfEngineSearch: async (input) =>
      toPdfSearchResult(
        await invoke("pdf_engine_search", {
          input,
        }),
      ),
  };
}
