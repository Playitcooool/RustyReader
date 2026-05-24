import type { ComponentProps, RefObject } from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";

import {
  CloseIcon,
  DownloadIcon,
  MessageIcon,
  NoteIcon,
  PlusIcon,
  SaveIcon,
  SendIcon,
  TrashIcon,
} from "./Icons";
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

const evidenceMarkerPattern = /\[E\d+\]/g;

// LaTeX commands that indicate display-worthy standalone math
const DISPLAY_MATH_PATTERN = /\\(?:frac|sum|prod|int|iint|iiint|oint|sqrt|left|right|begin|end|lim|max|min|sup|inf|partial|nabla|infty|forall|exists|times|cdot|div|pm|mp|oplus|otimes|equiv|approx|propto|sim|neq|leq|geq|mapsto|to|Rightarrow|Leftrightarrow|longrightarrow|bar|hat|tilde|vec|dot|ddot|overline|underline|widehat|widetilde|text|textbf|textit|mathrm|mathbf|mathcal|mathbb|mathfrak|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|kappa|lambda|mu|nu|pi|rho|sigma|tau|phi|chi|psi|omega)\b/;

const isMathDisplayLine = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 300) return false;
  // Skip markdown syntax, existing math, and code spans
  if (/^(```|~~~|\$\$|#|>|[-*+]\s|\d+\.\s|\||<)/.test(trimmed)) return false;
  if (/[`$]/.test(trimmed)) return false;
  // Skip lines ending with sentence-ending punctuation
  if (/[。！？.!?]\s*$/.test(trimmed)) return false;
  // LaTeX commands
  if (DISPLAY_MATH_PATTERN.test(trimmed)) return true;
  // Math operators/symbols with surrounding context
  if (/[=≈≃≅≠≤≥<>±×÷∑∏√∞∫∂∇]/.test(trimmed) && /[A-Za-z0-9)\]}"]/.test(trimmed)) return true;
  // Subscript/superscript: x_i, x^2, x^{ab}, x_{ab}
  if (/[a-zA-Z]\^[a-zA-Z0-9{(\[]/.test(trimmed) || /[a-zA-Z]_[a-zA-Z0-9{(\[]/.test(trimmed)) return true;
  return false;
};

const looksLikeInlineMath = (content: string) => {
  const trimmed = content.trim();
  if (!trimmed || /^\d+(\.\d+)?$/.test(trimmed)) return false;
  return /\\[a-zA-Z]+|[\^_]\{?[a-zA-Z0-9]|[=±×÷∑∏∫]/.test(trimmed);
};

const normalizeMathDelimitersInText = (text: string) =>
  text
    .split(/(`+[^`]*`+)/g)
    .map((part) => {
      if (part.startsWith("`")) return part;
      return part
        .replace(/\\\[([\s\S]*?)\\\]/g, (_match, content: string) => `$$\n${content.trim()}\n$$`)
        .replace(/\\\(([^`\n]*?)\\\)/g, (match, content: string) =>
          looksLikeInlineMath(content) ? `$${content.trim()}$` : match,
        );
    })
    .join("");

const normalizeLatexDelimiters = (markdown: string) => {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let inFence = false;
  let textBlock: string[] = [];

  const flushTextBlock = () => {
    if (textBlock.length > 0) {
      result.push(normalizeMathDelimitersInText(textBlock.join("\n")));
      textBlock = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      flushTextBlock();
      inFence = !inFence;
      result.push(line);
      continue;
    }
    if (inFence) {
      result.push(line);
      continue;
    }

    textBlock.push(line);
  }

  flushTextBlock();
  return result.join("\n");
};

// Wrap standalone math lines in $$...$$, preserving code fences and existing math blocks.
const normalizeDisplayMath = (markdown: string) => {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let inFence = false;
  let inDollarMath = false;
  let inBeginBlock = false;
  let beginDepth = 0;
  let mathLines: string[] = [];

  const flush = () => {
    const block = mathLines.join("\n").trim();
    if (block) result.push(`$$\n${block}\n$$`);
    mathLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      if (inDollarMath || inBeginBlock) flush();
      inDollarMath = false;
      inBeginBlock = false;
      beginDepth = 0;
      inFence = !inFence;
      result.push(line);
      continue;
    }

    if (inFence) {
      result.push(line);
      continue;
    }

    if (trimmed === "$$") {
      inDollarMath = !inDollarMath;
      result.push(line);
      continue;
    }

    if (inDollarMath) {
      result.push(line);
      continue;
    }

    const begins = (trimmed.match(/\\begin\{/g) || []).length;
    const ends = (trimmed.match(/\\end\{/g) || []).length;

    if (begins > ends) {
      if (!inBeginBlock) {
        if (mathLines.length > 0) flush();
        inBeginBlock = true;
      }
      beginDepth += begins - ends;
      mathLines.push(line);
      continue;
    }

    if (ends > begins && inBeginBlock) {
      mathLines.push(line);
      beginDepth -= ends - begins;
      if (beginDepth <= 0) {
        flush();
        inBeginBlock = false;
        beginDepth = 0;
      }
      continue;
    }

    if (inBeginBlock) {
      mathLines.push(line);
      continue;
    }

    if (isMathDisplayLine(line)) {
      result.push(`$$\n${trimmed}\n$$`);
    } else {
      result.push(line);
    }
  }

  // Flush any unclosed block at end of input
  flush();
  return result.join("\n");
};

const removeLegacyEvidenceMarkers = (markdown: string) =>
  markdown.replace(evidenceMarkerPattern, "").replace(/[ \t]+([,.;:])/g, "$1");

const displayMarkdown = (markdown: string) =>
  normalizeDisplayMath(normalizeLatexDelimiters(removeLegacyEvidenceMarkers(markdown)));

const markdownComponents = {
  a: ({ href, children, ...props }: ComponentProps<"a">) => {
    return <a href={href} {...props} rel="noreferrer" target="_blank">{children}</a>;
  },
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

const rehypePlugins: PluggableList = [[rehypeKatex, { strict: false, throwOnError: false }]];

export const ChatHistoryIcon = MessageIcon;
export const NewSessionIcon = PlusIcon;
export const ArtifactIcon = NoteIcon;
export const TaskHistoryIcon = NoteIcon;
export const ResearchNotesIcon = NoteIcon;
export const CloseChatIcon = CloseIcon;
export const ClosePanelIcon = CloseIcon;
export const DeleteSessionIcon = TrashIcon;

export function MarkdownMessage({ markdown, onCitationClick }: { markdown: string; onCitationClick?: (evidenceId: number) => void }) {
  return (
    <div className="ai-message-with-evidence">
      <div className="ai-markdown">
        <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={rehypePlugins}>
          {displayMarkdown(markdown)}
        </ReactMarkdown>
      </div>
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
  aiComposerInputRef: RefObject<HTMLTextAreaElement>;
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
  onOpenEvidenceCitation?: (evidenceId: number) => void;
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
    aiComposerInputRef,
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
    onOpenEvidenceCitation,
    onRemoveReference,
    onSaveNoteEdits,
    onSelectNote,
    onSendPrompt,
    onToggleDockSection,
    onToggleReferencePicker,
    onToggleSessionHistory,
    onUpdateNoteDraft,
  } = props;
  const hasThreadContent = aiSessionThreadRuns.length > 0 || Boolean(activeAiPending);

  return (
    <aside className="ai-shell" aria-label="AI panel">
      <div className="ai-shell-header">
        <div className="ai-copilot-header">
          <div className="ai-copilot-heading">
            <span className="ai-copilot-title">Chat</span>
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
            <button aria-label="Close Chat" className="icon-button icon-button-small" type="button" onClick={onClosePanel}>
              <CloseChatIcon />
            </button>
          </div>
        </div>
        <div className="ai-floating-panels">
          {aiDockOpen.artifacts ? (
            <div className="management-panel-body ai-dock-panel-body ai-floating-panel" aria-label="Artifacts panel">
              {aiSessionArtifact ? <MarkdownMessage markdown={aiSessionArtifact.markdown} onCitationClick={onOpenEvidenceCitation} /> : <p>No artifact yet.</p>}
              {aiSessionArtifact ? (
                <button aria-label="Save as Research Note" className="icon-button" title="Save as Research Note" type="button" onClick={() => void onCreateResearchNote()}>
                  <SaveIcon />
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
                    <button aria-label="Save Note Edits" className="icon-button" title="Save Note Edits" type="button" onClick={() => void onSaveNoteEdits()}>
                      <SaveIcon />
                    </button>
                    <button aria-label="Export Markdown" className="icon-button" title="Export Markdown" type="button" onClick={() => void onExportMarkdown()}>
                      <DownloadIcon />
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
            <button aria-label="Close Chat History" className="icon-button icon-button-small" type="button" onClick={onToggleSessionHistory}>
              <ClosePanelIcon />
            </button>
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

      <div ref={aiChatHistoryRef} className={`ai-chat-history ${hasThreadContent ? "" : "ai-chat-history-empty"}`.trim()}>
        {aiSessionThreadRuns.map((task) => (
          <article key={task.id} className="ai-thread-entry">
            <div className="ai-message ai-message-user">
              <div className="ai-message-meta" />
              <p>{task.input_prompt ?? taskLabel(task.kind)}</p>
            </div>
            <div className="ai-message ai-message-assistant">
              <MarkdownMessage markdown={task.output_markdown} onCitationClick={onOpenEvidenceCitation} />
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
              {activeAiPending.markdown ? <MarkdownMessage markdown={activeAiPending.markdown} onCitationClick={onOpenEvidenceCitation} /> : null}
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
                      <CloseIcon />
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
            ref={aiComposerInputRef}
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
          <button aria-label="Send AI prompt" className="primary-button icon-command-button" disabled={!aiPanelCanSend || aiComposerValue.trim().length === 0} title="Send AI prompt" type="button" onClick={() => void onSendPrompt()}>
            <SendIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}
