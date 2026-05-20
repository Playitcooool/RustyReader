import { useState, type Dispatch, type SetStateAction } from "react";

import { CloseIcon, RefreshIcon, SaveIcon } from "./Icons";
import type { ConnectorSettings } from "../../lib/contracts";
import type { AttachmentFilter, ItemSort, ReaderFitMode } from "../../lib/appView";

export type GeneralSettingsDraft = {
  resourcesSidebarOpen: boolean;
  defaultItemSort: ItemSort;
  defaultAttachmentFilter: AttachmentFilter;
  defaultReaderFitMode: ReaderFitMode;
  defaultReaderZoom: number;
};

type SettingsSection = "general" | "translation" | "connector" | "ai";

const settingsSections: Array<{ id: SettingsSection; title: string; meta: string }> = [
  { id: "general", title: "General", meta: "Workspace defaults" },
  { id: "translation", title: "Translation", meta: "Selection output" },
  { id: "connector", title: "Chrome Connector", meta: "Local import" },
  { id: "ai", title: "AI Providers", meta: "Model profiles" },
];

export function SettingsDialog({
  generalSettingsDraft,
  connectorSettings,
  aiEnvDraft,
  translationEnvDraft,
  readerMinZoom,
  readerMaxZoom,
  defaultReaderZoom,
  onGeneralSettingsDraftChange,
  onAiEnvDraftChange,
  onTranslationEnvDraftChange,
  onClampReaderZoom,
  onResetLayoutWidths,
  onReadSystemAiEnv,
  onReadSystemTranslationEnv,
  onRegenerateConnectorToken,
  onCancel,
  onSave,
}: {
  generalSettingsDraft: GeneralSettingsDraft;
  connectorSettings: ConnectorSettings | null;
  aiEnvDraft: string;
  translationEnvDraft: string;
  readerMinZoom: number;
  readerMaxZoom: number;
  defaultReaderZoom: number;
  onGeneralSettingsDraftChange: Dispatch<SetStateAction<GeneralSettingsDraft>>;
  onAiEnvDraftChange: (value: string) => void;
  onTranslationEnvDraftChange: (value: string) => void;
  onClampReaderZoom: (value: number) => number;
  onResetLayoutWidths: () => void;
  onReadSystemAiEnv: () => void;
  onReadSystemTranslationEnv: () => void;
  onRegenerateConnectorToken: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const cancelSettings = () => {
    onCancel();
  };

  return (
    <div className="modal-scrim" role="presentation">
      <section className="settings-dialog" role="dialog" aria-label="Settings">
        <div className="settings-dialog-hero">
          <div className="settings-dialog-copy">
            <p className="eyebrow">Settings</p>
            <h2>Preferences</h2>
            <p className="settings-dialog-summary">
              Tune the reading workspace, integrations, translation, and AI provider profiles.
            </p>
          </div>
          <button aria-label="Cancel" className="icon-button" title="Cancel" type="button" onClick={cancelSettings}>
            <CloseIcon />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {settingsSections.map((section) => (
              <button
                key={section.id}
                aria-current={activeSection === section.id ? "page" : undefined}
                className={`settings-nav-item ${activeSection === section.id ? "settings-nav-item-active" : ""}`}
                type="button"
                onClick={() => setActiveSection(section.id)}
              >
                <span className="settings-nav-title" role="heading" aria-level={3}>{section.title}</span>
                <span className="settings-nav-meta">{section.meta}</span>
              </button>
            ))}
          </nav>

          <div className="settings-sections">
            {activeSection === "general" ? (
            <section className="settings-section-card" aria-labelledby="settings-general-heading">
            <div className="settings-section-heading">
              <p className="eyebrow">Workspace</p>
              <h3 id="settings-general-heading">Workspace Defaults</h3>
            </div>
            <div className="settings-form-grid">
              <label className="settings-field">
                <span>Resources sidebar</span>
                <select
                  aria-label="Resources sidebar default"
                  className="settings-input"
                  value={generalSettingsDraft.resourcesSidebarOpen ? "open" : "closed"}
                  onChange={(event) =>
                    onGeneralSettingsDraftChange((current) => ({
                      ...current,
                      resourcesSidebarOpen: event.target.value === "open",
                    }))
                  }
                >
                  <option value="open">Open by default</option>
                  <option value="closed">Closed by default</option>
                </select>
              </label>
              <label className="settings-field">
                <span>Default paper sort</span>
                <select
                  aria-label="Default paper sort"
                  className="settings-input"
                  value={generalSettingsDraft.defaultItemSort}
                  onChange={(event) =>
                    onGeneralSettingsDraftChange((current) => ({
                      ...current,
                      defaultItemSort: event.target.value as ItemSort,
                    }))
                  }
                >
                  <option value="recent">Recently added</option>
                  <option value="title">Title</option>
                  <option value="year_desc">Year</option>
                </select>
              </label>
              <label className="settings-field">
                <span>Default attachment filter</span>
                <select
                  aria-label="Default attachment filter"
                  className="settings-input"
                  value={generalSettingsDraft.defaultAttachmentFilter}
                  onChange={(event) =>
                    onGeneralSettingsDraftChange((current) => ({
                      ...current,
                      defaultAttachmentFilter: event.target.value as AttachmentFilter,
                    }))
                  }
                >
                  <option value="all">All attachments</option>
                  <option value="ready">Ready</option>
                  <option value="missing">Missing</option>
                  <option value="citation_only">Citation only</option>
                </select>
              </label>
              <label className="settings-field">
                <span>PDF default fit mode</span>
                <select
                  aria-label="PDF default fit mode"
                  className="settings-input"
                  value={generalSettingsDraft.defaultReaderFitMode}
                  onChange={(event) =>
                    onGeneralSettingsDraftChange((current) => ({
                      ...current,
                      defaultReaderFitMode: event.target.value as ReaderFitMode,
                    }))
                  }
                >
                  <option value="fit_width">Fit width</option>
                  <option value="manual">Manual zoom</option>
                </select>
              </label>
              <label className="settings-field settings-field-compact">
                <span>PDF default zoom</span>
                <input
                  aria-label="PDF default zoom"
                  className="settings-input"
                  type="number"
                  min={readerMinZoom}
                  max={readerMaxZoom}
                  value={generalSettingsDraft.defaultReaderZoom}
                  onChange={(event) =>
                    onGeneralSettingsDraftChange((current) => ({
                      ...current,
                      defaultReaderZoom: onClampReaderZoom(Number(event.target.value) || defaultReaderZoom),
                    }))
                  }
                />
              </label>
            </div>
            <div className="settings-provider-actions">
              <button aria-label="Reset layout widths" className="icon-button" title="Reset layout widths" type="button" onClick={onResetLayoutWidths}>
                <RefreshIcon />
              </button>
            </div>
          </section>
            ) : null}

          {activeSection === "translation" ? (
          <section className="settings-section-card" aria-labelledby="settings-translation-heading">
            <div className="settings-section-heading">
              <p className="eyebrow">Translation</p>
              <h3 id="settings-translation-heading">Selection Translation</h3>
            </div>
            <label className="settings-field">
              <span>Environment variables</span>
              <textarea
                aria-label="Translation environment variables"
                className="settings-input settings-textarea"
                placeholder={"TRANSLATION_PROVIDER=openai\nTRANSLATION_TARGET_LANG=ZH-HANS\nTRANSLATION_OPENAI_MODEL=gpt-4.1-mini\nTRANSLATION_ANTHROPIC_MODEL=claude-...\nDEEPL_API_KEY=...\nDEEPL_BASE_URL=https://api-free.deepl.com"}
                value={translationEnvDraft}
                onChange={(event) => onTranslationEnvDraftChange(event.target.value)}
              />
            </label>
            <div className="settings-provider-actions settings-provider-actions-inline">
              <span className="settings-inline-note">Paste KEY=value lines for the translation provider, target language, and optional DeepL profile.</span>
              <button aria-label="Read system translation env variables" className="icon-button" title="Read system translation env variables" type="button" onClick={onReadSystemTranslationEnv}>
                <RefreshIcon />
              </button>
            </div>
          </section>
          ) : null}

          {activeSection === "connector" ? (
          <section className="settings-section-card" aria-labelledby="settings-connector-heading">
            <div className="settings-section-heading">
              <p className="eyebrow">Chrome Connector</p>
              <h3 id="settings-connector-heading">Local Import</h3>
            </div>
            <div className="settings-form-grid">
              <label className="settings-field">
                <span>Connector URL</span>
                <input
                  aria-label="Connector URL"
                  className="settings-input"
                  readOnly
                  value={connectorSettings?.connector_url ?? ""}
                />
              </label>
              <label className="settings-field">
                <span>Status</span>
                <input
                  aria-label="Connector status"
                  className="settings-input"
                  readOnly
                  value={connectorSettings?.status ?? "error"}
                />
              </label>
              <label className="settings-field settings-field-full">
                <span>Connector token</span>
                <input
                  aria-label="Connector token"
                  className="settings-input"
                  readOnly
                  value={connectorSettings?.token ?? ""}
                />
              </label>
            </div>
            <div className="settings-provider-actions settings-provider-actions-inline">
              <span className="settings-inline-note">
                Paste this token into the Chrome extension popup to enable local imports.
              </span>
              <button aria-label="Regenerate token" className="icon-button" title="Regenerate token" type="button" onClick={onRegenerateConnectorToken}>
                <RefreshIcon />
              </button>
            </div>
          </section>
          ) : null}

          {activeSection === "ai" ? (
          <section className="settings-section-card" aria-labelledby="settings-ai-heading">
            <div className="settings-section-heading">
              <p className="eyebrow">Provider Profiles</p>
              <h3 id="settings-ai-heading">Provider Setup</h3>
            </div>
            <label className="settings-field">
              <span>Environment variables</span>
              <textarea
                aria-label="AI environment variables"
                className="settings-input settings-textarea"
                placeholder={"AI_PROVIDER=openai\nOPENAI_MODEL=gpt-4.1\nOPENAI_API_KEY=sk-...\nOPENAI_BASE_URL=https://api.openai.com/v1\nANTHROPIC_MODEL=claude-...\nANTHROPIC_API_KEY=sk-...\nANTHROPIC_BASE_URL=https://api.anthropic.com/v1"}
                value={aiEnvDraft}
                onChange={(event) => onAiEnvDraftChange(event.target.value)}
              />
            </label>
            <div className="settings-provider-actions settings-provider-actions-inline">
              <span className="settings-inline-note">Paste KEY=value lines for OpenAI or Anthropic; saved values override the matching provider profile.</span>
              <button aria-label="Read system AI env variables" className="icon-button" title="Read system AI env variables" type="button" onClick={onReadSystemAiEnv}>
                <RefreshIcon />
              </button>
            </div>
          </section>
          ) : null}
          </div>
        </div>

        <div className="settings-dialog-actions">
          <button aria-label="Cancel" className="icon-button" title="Cancel" type="button" onClick={cancelSettings}>
            <CloseIcon />
          </button>
          <button aria-label="Save" className="primary-button icon-command-button" title="Save" type="button" onClick={onSave}>
            <SaveIcon />
          </button>
        </div>
      </section>
    </div>
  );
}
