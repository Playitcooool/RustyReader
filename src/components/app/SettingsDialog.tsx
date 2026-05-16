import { useState, type Dispatch, type SetStateAction } from "react";

import { CloseIcon, RefreshIcon, SaveIcon, TrashIcon } from "./Icons";
import type { AIProvider, AISettings, ConnectorSettings, TranslationProvider, UpdateAISettingsInput } from "../../lib/contracts";
import type { AttachmentFilter, ItemSort, ReaderFitMode } from "../../lib/appView";

export type GeneralSettingsDraft = {
  resourcesSidebarOpen: boolean;
  defaultItemSort: ItemSort;
  defaultAttachmentFilter: AttachmentFilter;
  defaultReaderFitMode: ReaderFitMode;
  defaultReaderZoom: number;
};

export function SettingsDialog({
  generalSettingsDraft,
  aiSettings,
  connectorSettings,
  aiSettingsDraft,
  openAiApiKeyDraft,
  anthropicApiKeyDraft,
  deeplApiKeyDraft,
  readerMinZoom,
  readerMaxZoom,
  defaultReaderZoom,
  onGeneralSettingsDraftChange,
  onAiSettingsDraftChange,
  onOpenAiApiKeyDraftChange,
  onAnthropicApiKeyDraftChange,
  onDeeplApiKeyDraftChange,
  onClampReaderZoom,
  onResetLayoutWidths,
  onClearSavedKey,
  onRegenerateConnectorToken,
  onCancel,
  onSave,
}: {
  generalSettingsDraft: GeneralSettingsDraft;
  aiSettings: AISettings | null;
  connectorSettings: ConnectorSettings | null;
  aiSettingsDraft: UpdateAISettingsInput;
  openAiApiKeyDraft: string;
  anthropicApiKeyDraft: string;
  deeplApiKeyDraft: string;
  readerMinZoom: number;
  readerMaxZoom: number;
  defaultReaderZoom: number;
  onGeneralSettingsDraftChange: Dispatch<SetStateAction<GeneralSettingsDraft>>;
  onAiSettingsDraftChange: Dispatch<SetStateAction<UpdateAISettingsInput>>;
  onOpenAiApiKeyDraftChange: (value: string) => void;
  onAnthropicApiKeyDraftChange: (value: string) => void;
  onDeeplApiKeyDraftChange: (value: string) => void;
  onClampReaderZoom: (value: number) => number;
  onResetLayoutWidths: () => void;
  onClearSavedKey: (provider: AIProvider | "deepl") => void;
  onRegenerateConnectorToken: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [pendingClearKeyProvider, setPendingClearKeyProvider] = useState<AIProvider | "deepl" | null>(null);
  const cancelSettings = () => {
    setPendingClearKeyProvider(null);
    onCancel();
  };
  const updateAiSettingsDraft: Dispatch<SetStateAction<UpdateAISettingsInput>> = (value) => {
    setPendingClearKeyProvider(null);
    onAiSettingsDraftChange(value);
  };
  const renderClearKeyButton = (provider: AIProvider | "deepl", label: string) => (
    <button
      aria-label={pendingClearKeyProvider === provider ? "Confirm clear key" : label}
      className={`icon-button ${pendingClearKeyProvider === provider ? "danger-icon-button" : ""}`}
      title={pendingClearKeyProvider === provider ? "Confirm clear key" : label}
      type="button"
      onClick={() => {
        if (pendingClearKeyProvider === provider) {
          setPendingClearKeyProvider(null);
          onClearSavedKey(provider);
          return;
        }
        setPendingClearKeyProvider(provider);
      }}
    >
      <TrashIcon />
    </button>
  );

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
            <a className="settings-nav-item settings-nav-item-active" href="#settings-general-heading">
              <span className="settings-nav-title" role="heading" aria-level={3}>General</span>
              <span className="settings-nav-meta">Workspace defaults</span>
            </a>
            <a className="settings-nav-item" href="#settings-translation-heading">
              <span className="settings-nav-title" role="heading" aria-level={3}>Translation</span>
              <span className="settings-nav-meta">Selection output</span>
            </a>
            <a className="settings-nav-item" href="#settings-connector-heading">
              <span className="settings-nav-title" role="heading" aria-level={3}>Chrome Connector</span>
              <span className="settings-nav-meta">Local import</span>
            </a>
            <a className="settings-nav-item" href="#settings-ai-heading">
              <span className="settings-nav-title" role="heading" aria-level={3}>AI Providers</span>
              <span className="settings-nav-meta">Model profiles</span>
            </a>
          </nav>

          <div className="settings-sections">
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

          <section className="settings-section-card" aria-labelledby="settings-translation-heading">
            <div className="settings-section-heading">
              <p className="eyebrow">Translation</p>
              <h3 id="settings-translation-heading">Selection Translation</h3>
            </div>
            <div className="settings-form-grid">
              <label className="settings-field">
                <span>Provider</span>
                <select
                  aria-label="Translation provider"
                  className="settings-input"
                  value={aiSettingsDraft.translation_provider}
                  onChange={(event) =>
                    updateAiSettingsDraft((current) => ({
                      ...current,
                      translation_provider: event.target.value as TranslationProvider,
                    }))
                  }
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="deepl">DeepL</option>
                </select>
              </label>
              <label className="settings-field">
                <span>Target language</span>
                <input
                  aria-label="Translation target language"
                  className="settings-input"
                  value={aiSettingsDraft.translation_target_lang}
                  onChange={(event) =>
                    updateAiSettingsDraft((current) => ({ ...current, translation_target_lang: event.target.value }))
                  }
                />
              </label>
              {aiSettingsDraft.translation_provider === "openai" ? (
                <label className="settings-field">
                  <span>Translation OpenAI model</span>
                  <input
                    aria-label="Translation OpenAI model"
                    className="settings-input"
                    placeholder={aiSettingsDraft.openai_model || "Fallback to OpenAI model"}
                    value={aiSettingsDraft.translation_openai_model}
                    onChange={(event) =>
                      updateAiSettingsDraft((current) => ({ ...current, translation_openai_model: event.target.value }))
                    }
                  />
                </label>
              ) : null}
              {aiSettingsDraft.translation_provider === "anthropic" ? (
                <label className="settings-field">
                  <span>Translation Anthropic model</span>
                  <input
                    aria-label="Translation Anthropic model"
                    className="settings-input"
                    placeholder={aiSettingsDraft.anthropic_model || "Fallback to Anthropic model"}
                    value={aiSettingsDraft.translation_anthropic_model}
                    onChange={(event) =>
                      updateAiSettingsDraft((current) => ({ ...current, translation_anthropic_model: event.target.value }))
                    }
                  />
                </label>
              ) : null}
              {aiSettingsDraft.translation_provider === "deepl" ? (
                <>
                  <label className="settings-field">
                    <span>DeepL Base URL</span>
                    <input
                      aria-label="DeepL base URL"
                      className="settings-input"
                      placeholder="https://api-free.deepl.com"
                      value={aiSettingsDraft.deepl_base_url}
                      onChange={(event) =>
                        updateAiSettingsDraft((current) => ({ ...current, deepl_base_url: event.target.value }))
                      }
                    />
                  </label>
                  <label className="settings-field">
                    <span>DeepL API key</span>
                    <input
                      aria-label="DeepL API key"
                      className="settings-input"
                      type="password"
                      value={deeplApiKeyDraft}
                      placeholder={aiSettings?.has_deepl_api_key ? "Replace saved key" : "Paste API key"}
                      onChange={(event) => onDeeplApiKeyDraftChange(event.target.value)}
                    />
                  </label>
                </>
              ) : null}
            </div>
            <div className="settings-provider-actions settings-provider-actions-inline">
              <span className="settings-inline-note">OpenAI and Anthropic reuse their saved provider keys; DeepL uses its own key.</span>
              {renderClearKeyButton("deepl", "Clear DeepL key")}
            </div>
          </section>

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

          <section className="settings-section-card" aria-labelledby="settings-ai-heading">
            <div className="settings-section-heading">
              <p className="eyebrow">Provider Profiles</p>
              <h3 id="settings-ai-heading">Provider Setup</h3>
            </div>
            <div className="settings-provider-tabs" role="tablist" aria-label="Active AI provider">
              {(["openai", "anthropic"] as const).map((provider) => (
                <button
                  key={provider}
                  aria-selected={aiSettingsDraft.active_provider === provider}
                  className={`reader-tab settings-provider-tab ${
                    aiSettingsDraft.active_provider === provider ? "reader-tab-active" : ""
                  }`}
                  role="tab"
                  type="button"
                  onClick={() => updateAiSettingsDraft((current) => ({ ...current, active_provider: provider }))}
                >
                  {provider === "openai" ? "OpenAI" : "Anthropic"}
                </button>
              ))}
            </div>

            {aiSettingsDraft.active_provider === "openai" ? (
              <div className="settings-provider-panel">
                <div className="settings-provider-panel-header">
                  <div>
                    <p className="eyebrow">OpenAI</p>
                    <p className="settings-provider-description">Default chat and reading tasks route through this profile.</p>
                  </div>
                  <span className="meta-count">{aiSettings?.has_openai_api_key ? "Saved key" : "No saved key"}</span>
                </div>
                <div className="settings-form-grid">
                  <label className="settings-field">
                    <span>Model</span>
                    <input
                      aria-label="OpenAI model"
                      className="settings-input"
                      value={aiSettingsDraft.openai_model}
                      onChange={(event) =>
                        updateAiSettingsDraft((current) => ({ ...current, openai_model: event.target.value }))
                      }
                    />
                  </label>
                  <label className="settings-field">
                    <span>Base URL</span>
                    <input
                      aria-label="OpenAI base URL"
                      className="settings-input"
                      placeholder="https://api.openai.com/v1"
                      value={aiSettingsDraft.openai_base_url}
                      onChange={(event) =>
                        updateAiSettingsDraft((current) => ({ ...current, openai_base_url: event.target.value }))
                      }
                    />
                  </label>
                  <label className="settings-field settings-field-full">
                    <span>API key</span>
                    <input
                      aria-label="OpenAI API key"
                      className="settings-input"
                      type="password"
                      value={openAiApiKeyDraft}
                      placeholder={aiSettings?.has_openai_api_key ? "Replace saved key" : "Paste API key"}
                      onChange={(event) => onOpenAiApiKeyDraftChange(event.target.value)}
                    />
                  </label>
                </div>
                <div className="settings-provider-actions settings-provider-actions-inline">
                  <span className="settings-inline-note">The key stays in secure storage and never reappears in plain text.</span>
                  {renderClearKeyButton("openai", "Clear saved key")}
                </div>
              </div>
            ) : (
              <div className="settings-provider-panel">
                <div className="settings-provider-panel-header">
                  <div>
                    <p className="eyebrow">Anthropic</p>
                    <p className="settings-provider-description">Use this profile when Claude should handle the active reading workflow.</p>
                  </div>
                  <span className="meta-count">{aiSettings?.has_anthropic_api_key ? "Saved key" : "No saved key"}</span>
                </div>
                <div className="settings-form-grid">
                  <label className="settings-field">
                    <span>Model</span>
                    <input
                      aria-label="Anthropic model"
                      className="settings-input"
                      value={aiSettingsDraft.anthropic_model}
                      onChange={(event) =>
                        updateAiSettingsDraft((current) => ({ ...current, anthropic_model: event.target.value }))
                      }
                    />
                  </label>
                  <label className="settings-field">
                    <span>Base URL</span>
                    <input
                      aria-label="Anthropic base URL"
                      className="settings-input"
                      placeholder="https://api.anthropic.com/v1"
                      value={aiSettingsDraft.anthropic_base_url}
                      onChange={(event) =>
                        updateAiSettingsDraft((current) => ({ ...current, anthropic_base_url: event.target.value }))
                      }
                    />
                  </label>
                  <label className="settings-field settings-field-full">
                    <span>API key</span>
                    <input
                      aria-label="Anthropic API key"
                      className="settings-input"
                      type="password"
                      value={anthropicApiKeyDraft}
                      placeholder={aiSettings?.has_anthropic_api_key ? "Replace saved key" : "Paste API key"}
                      onChange={(event) => onAnthropicApiKeyDraftChange(event.target.value)}
                    />
                  </label>
                </div>
                <div className="settings-provider-actions settings-provider-actions-inline">
                  <span className="settings-inline-note">The key stays in secure storage and never reappears in plain text.</span>
                  {renderClearKeyButton("anthropic", "Clear saved key")}
                </div>
              </div>
            )}
          </section>
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
