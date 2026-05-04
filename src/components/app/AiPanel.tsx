import type { ComponentProps, ReactNode, RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { noteHeading, sessionActions, sessionReferenceLabel, taskLabel } from "../../lib/appView";
import type {
  AIArtifact,
  AISession,
  AISessionReference,
  AITask,
  Collection,
  LibraryItem,
  ResearchNote,
} from "../../lib/contracts";
import type { AiDockSection, AiPendingMessage, AiReferencePickerResult } from "../../hooks/useAiSessionState";

const markdownComponents = {
  a: (props: ComponentProps<"a">) => <a {...props} rel="noreferrer" target="_blank" />,
  pre: (props: ComponentProps<"pre">) => <pre className="ai-markdown-pre" {...props} />,
  code({
    className,
    children,
    ...props
  }: ComponentProps<"code"> & { inline?: boolean }) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

function AiIcon({
  children,
  viewBox = "0 0 20 20",
}: {
  children: ReactNode;
  viewBox?: string;
}) {
  return (
    <svg aria-hidden="true" className="ai-icon" viewBox={viewBox}>
      {children}
    </svg>
  );
}

export const ChatHistoryIcon = () => (
  <AiIcon>
    <path d="M4 5.5h7.5A2.5 2.5 0 0 1 14 8v2A2.5 2.5 0 0 1 11.5 12.5H8l-3 2v-2H4A2.5 2.5 0 0 1 1.5 10V8A2.5 2.5 0 0 1 4 5.5Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    <circle cx="15.25" cy="6.25" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M15.25 4.75v1.7l1.15.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
  </AiIcon>
);

export const NewSessionIcon = () => (
  <AiIcon>
    <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
  </AiIcon>
);

export const ArtifactIcon = () => (
  <AiIcon>
    <path d="M6 2.5h5l3 3V16A1.5 1.5 0 0 1 12.5 17.5h-6A1.5 1.5 0 0 1 5 16V4A1.5 1.5 0 0 1 6.5 2.5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
    <path d="M11 2.5V6h3" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
    <path d="M7.5 9.25h4.5M7.5 12h4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
  </AiIcon>
);

export const TaskHistoryIcon = () => (
  <AiIcon>
    <rect x="3" y="3.5" width="14" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M6.5 7.5h7M6.5 10.5h7M6.5 13.5h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
  </AiIcon>
);

export const ResearchNotesIcon = () => (
  <AiIcon>
    <path d="M5 3.5h8A2 2 0 0 1 15 5.5v11l-4-2-4 2v-11A2 2 0 0 1 9 3.5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
    <path d="M8 7.5h5M8 10.25h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
  </AiIcon>
);

export const CloseCopilotIcon = () => (
  <AiIcon>
    <path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
  </AiIcon>
);

export const DeleteSessionIcon = () => (
  <AiIcon>
    <path d="M8 5.5h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    <path d="M9 5.5l.75-1.5h.5L11 5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    <path d="M5.5 7.5h9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    <path d="m7 7.5.75 8h4.5l.75-8" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
    <path d="M9.25 10.25v3M10.75 10.25v3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
  </AiIcon>
);

export function MarkdownMessage({ markdown }: { markdown: string }) {
  return (
    <div className="ai-markdown">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

const pickerResultLabel = (result: AiReferencePickerResult, badges: string[]) =>
  [result.label, result.meta, badges.length > 0 ? badges.join(", ") : null].filter(Boolean).join(" — ");

type Props = {
  activeAiPending: AiPendingMessage | null;
  activeAiSession: AISession | null;
  activeAiSessionId: number | null;
  activeNoteId: number | null;
  aiChatHistoryRef: RefObject<HTMLDivElement>;
  aiComposerValue: string;
  aiDockOpen: Record<AiDockSection, boolean>;
  aiPanelCanSend: boolean;
  aiReferenceButtonRef: RefObject<HTMLButtonElement>;
  aiReferenceCollectionIds: Set<number>;
  aiReferenceItemIds: Set<number>;
  aiReferencePickerResults: AiReferencePickerResult[];
  aiReferencePopoverRef: RefObject<HTMLDivElement>;
  aiReferenceQuery: string;
  aiReferenceSearchError: string | null;
  aiReferenceSearchInputRef: RefObject<HTMLInputElement>;
  aiReferenceSearchLoading: boolean;
  aiSessionArtifact: AIArtifact | null;
  aiSessionReferences: AISessionReference[];
  aiSessionTaskRuns: AITask[];
  aiSessionThreadRuns: AITask[];
  aiSessions: AISession[];
  areQuickActionsDisabled: boolean;
  collections: Collection[];
  compareEnabled: boolean;
  isAiPanelOpen: boolean;
  isAiSessionHistoryOpen: boolean;
  isReferencePickerOpen: boolean;
  libraryItems: LibraryItem[];
  noteDraft: string;
  notes: ResearchNote[];
  onAiComposerChange: (value: string) => void;
  onAiReferenceQueryChange: (value: string) => void;
  onClosePanel: () => void;
  onCreateResearchNote: () => void | Promise<void>;
  onCreateSession: () => void | Promise<void>;
  onDeleteSession: (session: AISession) => void;
  onExportMarkdown: () => void | Promise<void>;
  onOpenSession: (sessionId: number) => void;
  onQuickAction: (kind: string) => void | Promise<void>;
  onAddReference: (kind: "item" | "collection", targetId: number) => void | Promise<void>;
  onRemoveReference: (referenceId: number) => void | Promise<void>;
  onSaveNoteEdits: () => void | Promise<void>;
  onSelectNote: (note: ResearchNote) => void;
  onSendPrompt: () => void | Promise<void>;
  onToggleDockSection: (section: AiDockSection) => void;
  onToggleReferencePicker: () => void;
  onToggleSessionHistory: () => void;
  onUpdateNoteDraft: (value: string) => void;
};

export function AiPanel(props: Props) {
  const {
    activeAiPending,
    activeAiSession,
    activeAiSessionId,
    activeNoteId,
    aiChatHistoryRef,
    aiComposerValue,
    aiDockOpen,
    aiPanelCanSend,
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
    collections,
    compareEnabled,
    isAiSessionHistoryOpen,
    isReferencePickerOpen,
    libraryItems,
    noteDraft,
    notes,
    onAiComposerChange,
    onAiReferenceQueryChange,
    onClosePanel,
    onCreateResearchNote,
    onCreateSession,
    onDeleteSession,
    onExportMarkdown,
    onOpenSession,
    onQuickAction,
    onAddReference,
    onRemoveReference,
    onSaveNoteEdits,
    onSelectNote,
    onSendPrompt,
    onToggleDockSection,
    onToggleReferencePicker,
    onToggleSessionHistory,
    onUpdateNoteDraft,
  } = props;

  return (
    <aside className="ai-shell" aria-label="AI panel">
      <div className="ai-shell-header">
        <div className="ai-copilot-header">
          <div className="ai-copilot-heading">
            <span className="ai-copilot-title">Copilot</span>
            {activeAiSession ? (
              <span className="meta-count ai-session-title" title={activeAiSession.title}>
                {activeAiSession.title}
              </span>
            ) : null}
          </div>
          <div className="ai-copilot-controls">
            <button aria-label="Chat History" aria-pressed={isAiSessionHistoryOpen} className="icon-button icon-button-small" type="button" onClick={onToggleSessionHistory}>
              <ChatHistoryIcon />
            </button>
            <button aria-label="New Session" className="icon-button icon-button-small" type="button" onClick={() => void onCreateSession()}>
              <NewSessionIcon />
            </button>
            <button aria-label="Artifacts" aria-pressed={aiDockOpen.artifacts} className="icon-button icon-button-small" type="button" onClick={() => onToggleDockSection("artifacts")}>
              <ArtifactIcon />
            </button>
            <button aria-label="Task History" aria-pressed={aiDockOpen.history} className="icon-button icon-button-small" type="button" onClick={() => onToggleDockSection("history")}>
              <TaskHistoryIcon />
            </button>
            <button aria-label="Research Notes" aria-pressed={aiDockOpen.notes} className="icon-button icon-button-small" type="button" onClick={() => onToggleDockSection("notes")}>
              <ResearchNotesIcon />
            </button>
            <button aria-label="Close Copilot" className="icon-button icon-button-small" type="button" onClick={onClosePanel}>
              <CloseCopilotIcon />
            </button>
          </div>
        </div>
        <div className="ai-floating-panels">
          {aiDockOpen.artifacts ? (
            <div className="management-panel-body ai-dock-panel-body ai-floating-panel" aria-label="Artifacts panel">
              {aiSessionArtifact ? <MarkdownMessage markdown={aiSessionArtifact.markdown} /> : <p>No artifact yet.</p>}
              {aiSessionArtifact ? (
                <button className="ghost-button" type="button" onClick={() => void onCreateResearchNote()}>
                  Save as Research Note
                </button>
              ) : null}
            </div>
          ) : null}
          {aiDockOpen.history ? (
            <div className="management-panel-body ai-dock-panel-body ai-floating-panel" aria-label="Task History panel">
              {aiSessionTaskRuns.length > 0 ? (
                aiSessionTaskRuns.map((task) => (
                  <div key={`history-${task.id}`} className="export-row">
                    <span>{taskLabel(task.kind)}</span>
                    <span className="meta-count">{task.status}</span>
                  </div>
                ))
              ) : (
                <p>No tasks yet.</p>
              )}
            </div>
          ) : null}
          {aiDockOpen.notes ? (
            <div className="management-panel-body ai-dock-panel-body ai-floating-panel" aria-label="Research Notes panel">
              {activeNoteId ? (
                <>
                  <textarea aria-label="Research note editor" className="note-editor" value={noteDraft} onChange={(event) => onUpdateNoteDraft(event.target.value)} />
                  <div className="export-row">
                    <button className="ghost-button" type="button" onClick={() => void onSaveNoteEdits()}>
                      Save Note Edits
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void onExportMarkdown()}>
                      Export Markdown
                    </button>
                  </div>
                </>
              ) : null}
              {notes.length > 0 ? (
                notes.map((note) => (
                  <button key={note.id} className={`nav-item ${note.id === activeNoteId ? "nav-item-active" : ""}`} type="button" onClick={() => onSelectNote(note)}>
                    {noteHeading(note)}
                  </button>
                ))
              ) : (
                <p>No notes yet.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {isAiSessionHistoryOpen ? (
        <aside className="ai-session-history-panel ai-session-history-panel-open">
          <div className="ai-session-history-panel-header">
            <strong>Chat History</strong>
          </div>
          <div className="ai-session-history-list" role="list" aria-label="Chat History panel">
            {aiSessions.map((session) => (
              <div key={session.id} className={`nav-item ai-session-history-item ${session.id === activeAiSessionId ? "nav-item-active" : ""}`} role="listitem">
                <button aria-label={`${session.title} ${session.id === activeAiSessionId ? "Active" : "Open"}`} className="ai-session-history-open-button" title={session.title} type="button" onClick={() => onOpenSession(session.id)}>
                  <span className="ai-session-history-item-title">{session.title}</span>
                  <span className="meta-count">{session.id === activeAiSessionId ? "Active" : "Open"}</span>
                </button>
                <button aria-label={`Delete ${session.title}`} className="icon-button icon-button-small ai-session-history-delete" title={`Delete ${session.title}`} type="button" onClick={() => onDeleteSession(session)}>
                  <DeleteSessionIcon />
                </button>
              </div>
            ))}
          </div>
        </aside>
      ) : null}

      <div ref={aiChatHistoryRef} className="ai-chat-history">
        {aiSessionThreadRuns.map((task) => (
          <article key={task.id} className="ai-thread-entry">
            <div className="ai-message ai-message-user">
              <div className="ai-message-meta" />
              <p>{task.input_prompt ?? taskLabel(task.kind)}</p>
            </div>
            <div className="ai-message ai-message-assistant">
              <MarkdownMessage markdown={task.output_markdown} />
            </div>
          </article>
        ))}

        {activeAiPending ? (
          <article className="ai-thread-entry">
            <div className="ai-message ai-message-user">
              <div className="ai-message-meta" />
              <p>{activeAiPending.inputPrompt ?? taskLabel(activeAiPending.kind)}</p>
            </div>
            <div className="ai-message ai-message-assistant">
              {activeAiPending.error ? <p className="ai-error-text">{activeAiPending.error}</p> : null}
              {activeAiPending.markdown ? <MarkdownMessage markdown={activeAiPending.markdown} /> : null}
              {activeAiPending.status === "streaming" ? (
                <div className="ai-loading-indicator" aria-label="AI response streaming">
                  <span aria-label="AI response loading" className="sr-only" />
                  <span className="ai-loading-dot" />
                  <span className="ai-loading-dot" />
                  <span className="ai-loading-dot" />
                </div>
              ) : null}
            </div>
          </article>
        ) : null}
      </div>

      <div className="ai-bottom-dock">
        <div className="ai-quick-actions" aria-label="AI quick actions">
          {sessionActions.map((action) => (
            <button key={action.kind} className="ghost-button ai-quick-action" disabled={areQuickActionsDisabled || (action.kind === "session.compare" ? !compareEnabled : !aiPanelCanSend)} type="button" onClick={() => void onQuickAction(action.kind)}>
              {action.label}
            </button>
          ))}
        </div>

        <div className="ai-composer">
          <div className="ai-composer-header">
            <div className="ai-reference-chip-list" aria-label="Active AI references">
              {aiSessionReferences.map((reference) => {
                const referenceLabel = sessionReferenceLabel(reference, libraryItems, collections);
                return (
                  <span key={reference.id} className="annotation-chip ai-reference-chip" title={referenceLabel}>
                    <span className="ai-reference-chip-label">{referenceLabel}</span>
                    <button aria-label={`Remove ${referenceLabel}`} className="ai-reference-chip-remove" type="button" onClick={() => void onRemoveReference(reference.id)}>
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            <div className="ai-reference-picker-shell">
              <button ref={aiReferenceButtonRef} aria-label="Add AI reference" className="icon-button icon-button-small" type="button" onClick={onToggleReferencePicker}>
                <NewSessionIcon />
              </button>
              {isReferencePickerOpen ? (
                <div ref={aiReferencePopoverRef} className="ai-reference-popover" role="dialog" aria-label="Add AI reference">
                  <label className="ai-reference-search-label" htmlFor="ai-reference-search">
                    Search context
                  </label>
                  <input id="ai-reference-search" ref={aiReferenceSearchInputRef} aria-label="Search context" className="search-input ai-reference-search-input" placeholder="Search papers and collections" type="search" value={aiReferenceQuery} onChange={(event) => onAiReferenceQueryChange(event.target.value)} />
                  <div className="ai-reference-results" aria-live="polite">
                    {aiReferencePickerResults.map((result) => {
                      const added = result.kind === "item" ? aiReferenceItemIds.has(result.targetId) : aiReferenceCollectionIds.has(result.targetId);
                      const badges = added ? [...result.badges, "Added"] : result.badges;
                      const accessibleLabel = pickerResultLabel(result, badges);
                      return (
                        <button key={result.key} aria-label={accessibleLabel} className="ai-reference-result" disabled={added} title={accessibleLabel} type="button" onClick={() => void onAddReference(result.kind, result.targetId)}>
                          <span className="ai-reference-result-main">
                            <span className="ai-reference-result-label">{result.label}</span>
                            {result.meta ? <span className="ai-reference-result-meta">{result.meta}</span> : null}
                          </span>
                          <span className="ai-reference-result-badges">
                            {badges.map((badge) => (
                              <span key={`${result.key}-${badge}`} className={`meta-count ai-reference-result-badge ${badge === "Added" ? "ai-reference-result-badge-added" : ""}`}>
                                {badge}
                              </span>
                            ))}
                          </span>
                        </button>
                      );
                    })}
                    {aiReferenceSearchLoading ? <p className="ai-reference-results-empty">Searching…</p> : null}
                    {aiReferenceSearchError ? <p className="ai-error-text">{aiReferenceSearchError}</p> : null}
                    {!aiReferenceSearchLoading && !aiReferenceSearchError && aiReferencePickerResults.length === 0 ? (
                      <p className="ai-reference-results-empty">
                        {aiReferenceQuery.trim().length === 0 ? "No papers or collections available." : "No matching context found."}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <textarea
            aria-label="AI prompt"
            className="note-editor ai-composer-input"
            placeholder="Ask about the current references..."
            rows={4}
            value={aiComposerValue}
            onChange={(event) => onAiComposerChange(event.target.value)}
            onKeyDown={(event) => {
              const isComposing = event.nativeEvent.isComposing;
              if (event.key === "Enter" && !event.shiftKey && !isComposing) {
                event.preventDefault();
                void onSendPrompt();
              }
            }}
          />
          <button aria-label="Send AI prompt" className="primary-button" disabled={!aiPanelCanSend || aiComposerValue.trim().length === 0} type="button" onClick={() => void onSendPrompt()}>
            Send
          </button>
        </div>
      </div>
    </aside>
  );
}
