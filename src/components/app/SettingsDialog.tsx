import { useState, type Dispatch, type SetStateAction } from "react";

import { CloseIcon, RefreshIcon, SaveIcon } from "./Icons";
import type { AIProvider, TranslationProvider } from "../../lib/contracts";
import type { AttachmentFilter, ItemSort, ReaderFitMode } from "../../lib/appView";

const TRANSLATION_TARGET_LANGS = [
  { value: "ZH-HANS", label: "Chinese (Simplified)" },
  { value: "ZH-HANT", label: "Chinese (Traditional)" },
  { value: "EN", label: "English" },
  { value: "JA", label: "Japanese" },
  { value: "KO", label: "Korean" },
  { value: "FR", label: "French" },
  { value: "DE", label: "German" },
  { value: "ES", label: "Spanish" },
  { value: "PT", label: "Portuguese" },
  { value: "RU", label: "Russian" },
  { value: "AR", label: "Arabic" },
  { value: "IT", label: "Italian" },
] as const;

export type GeneralSettingsDraft = {
  resourcesSidebarOpen: boolean;
  defaultItemSort: ItemSort;
  defaultAttachmentFilter: AttachmentFilter;
  defaultReaderFitMode: ReaderFitMode;
  defaultReaderZoom: number;
};

type SettingsSection = "general" | "translation" | "ai";

const settingsSections: Array<{ id: SettingsSection; title: string; meta: string }> = [
  { id: "general", title: "General", meta: "Workspace defaults" },
  { id: "translation", title: "Translation", meta: "Selection output" },
  { id: "ai", title: "AI Providers", meta: "Model profiles" },
];

const aiProviderCards: Array<{ id: AIProvider; title: string; meta: string; placeholder: string }> = [
  {
    id: "openai",
    title: "OpenAI",
    meta: "Chat, reading tasks, and OpenAI-compatible endpoints",
    placeholder: "OPENAI_MODEL=gpt-4.1\nOPENAI_API_KEY=sk-...\nOPENAI_BASE_URL=https://api.openai.com/v1",
  },
  {
    id: "anthropic",
    title: "Anthropic",
    meta: "Claude profile for active reading workflows",
    placeholder: "ANTHROPIC_MODEL=claude-...\nANTHROPIC_API_KEY=sk-...\nANTHROPIC_AUTH_TOKEN=sk-...\nANTHROPIC_BASE_URL=https://api.anthropic.com/v1",
  },
];

const translationProviderCards: Array<{ id: TranslationProvider; title: string; meta: string }> = [
  {
    id: "openai",
    title: "OpenAI",
    meta: "Translate using an OpenAI model with your saved provider key",
  },
  {
    id: "anthropic",
    title: "Anthropic",
    meta: "Translate using a Claude model with your saved provider key",
  },
  {
    id: "deepl",
    title: "DeepL",
    meta: "Translate using the DeepL API with a dedicated key",
  },
];

export function SettingsDialog({
  generalSettingsDraft,
  activeAiProvider,
  activeTranslationProvider,
  aiEnvDrafts,
  translationTargetLang,
  translationOpenaiModel,
  translationAnthropicModel,
  deeplApiKey,
  hasDeeplApiKey,
  deeplBaseUrl,
  readerMinZoom,
  readerMaxZoom,
  defaultReaderZoom,
  onGeneralSettingsDraftChange,
  onActiveAiProviderChange,
  onActiveTranslationProviderChange,
  onAiEnvDraftChange,
  onTranslationTargetLangChange,
  onTranslationOpenaiModelChange,
  onTranslationAnthropicModelChange,
  onDeeplApiKeyChange,
  onDeeplBaseUrlChange,
  onClampReaderZoom,
  onResetLayoutWidths,
  onReadSystemAiEnv,
  onCancel,
  onSave,
}: {
  generalSettingsDraft: GeneralSettingsDraft;
  activeAiProvider: AIProvider;
  activeTranslationProvider: TranslationProvider;
  aiEnvDrafts: Record<AIProvider, string>;
  translationTargetLang: string;
  translationOpenaiModel: string;
  translationAnthropicModel: string;
  deeplApiKey: string;
  hasDeeplApiKey: boolean;
  deeplBaseUrl: string;
  readerMinZoom: number;
  readerMaxZoom: number;
  defaultReaderZoom: number;
  onGeneralSettingsDraftChange: Dispatch<SetStateAction<GeneralSettingsDraft>>;
  onActiveAiProviderChange: (provider: AIProvider) => void;
  onActiveTranslationProviderChange: (provider: TranslationProvider) => void;
  onAiEnvDraftChange: (provider: AIProvider, value: string) => void;
  onTranslationTargetLangChange: (value: string) => void;
  onTranslationOpenaiModelChange: (value: string) => void;
  onTranslationAnthropicModelChange: (value: string) => void;
  onDeeplApiKeyChange: (value: string) => void;
  onDeeplBaseUrlChange: (value: string) => void;
  onClampReaderZoom: (value: number) => number;
  onResetLayoutWidths: () => void;
  onReadSystemAiEnv: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const activeAiProviderCard = aiProviderCards.find((provider) => provider.id === activeAiProvider) ?? aiProviderCards[0];
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
              Tune the reading workspace, translation, and AI provider profiles.
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
            <div className="settings-form-grid">
              <label className="settings-field">
                <span>Target language</span>
                <select
                  aria-label="Target language"
                  className="settings-input"
                  value={translationTargetLang}
                  onChange={(event) => onTranslationTargetLangChange(event.target.value)}
                >
                  {TRANSLATION_TARGET_LANGS.map((lang) => (
                    <option key={lang.value} value={lang.value}>{lang.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="settings-provider-cards" role="tablist" aria-label="Translation provider">
              {translationProviderCards.map((provider) => (
                <button
                  key={provider.id}
                  aria-selected={activeTranslationProvider === provider.id}
                  className={`settings-provider-card ${activeTranslationProvider === provider.id ? "settings-provider-card-active" : ""}`}
                  role="tab"
                  type="button"
                  onClick={() => onActiveTranslationProviderChange(provider.id)}
                >
                  <span className="settings-provider-card-title">{provider.title}</span>
                  <span className="settings-provider-card-meta">{provider.meta}</span>
                </button>
              ))}
            </div>
            {activeTranslationProvider === "openai" ? (
              <div className="settings-form-grid">
                <label className="settings-field">
                  <span>Model</span>
                  <input
                    aria-label="OpenAI translation model"
                    className="settings-input"
                    type="text"
                    placeholder="gpt-4.1-mini"
                    value={translationOpenaiModel}
                    onChange={(event) => onTranslationOpenaiModelChange(event.target.value)}
                  />
                </label>
              </div>
            ) : activeTranslationProvider === "anthropic" ? (
              <div className="settings-form-grid">
                <label className="settings-field">
                  <span>Model</span>
                  <input
                    aria-label="Anthropic translation model"
                    className="settings-input"
                    type="text"
                    placeholder="claude-haiku-4-5-20251001"
                    value={translationAnthropicModel}
                    onChange={(event) => onTranslationAnthropicModelChange(event.target.value)}
                  />
                </label>
              </div>
            ) : (
              <div className="settings-form-grid">
                <label className="settings-field">
                  <span>API key</span>
                  <input
                    aria-label="DeepL API key"
                    className="settings-input"
                    type="password"
                    placeholder={hasDeeplApiKey ? "API key is saved" : "Paste your DeepL API key"}
                    value={deeplApiKey}
                    onChange={(event) => onDeeplApiKeyChange(event.target.value)}
                  />
                </label>
                <label className="settings-field">
                  <span>Base URL</span>
                  <input
                    aria-label="DeepL base URL"
                    className="settings-input"
                    type="text"
                    placeholder="https://api-free.deepl.com"
                    value={deeplBaseUrl}
                    onChange={(event) => onDeeplBaseUrlChange(event.target.value)}
                  />
                </label>
              </div>
            )}
          </section>
          ) : null}

          {activeSection === "ai" ? (
          <section className="settings-section-card" aria-labelledby="settings-ai-heading">
            <div className="settings-section-heading">
              <p className="eyebrow">Provider Profiles</p>
              <h3 id="settings-ai-heading">Provider Setup</h3>
            </div>
            <div className="settings-provider-cards" role="tablist" aria-label="Active AI provider">
              {aiProviderCards.map((provider) => (
                <button
                  key={provider.id}
                  aria-selected={activeAiProvider === provider.id}
                  className={`settings-provider-card ${activeAiProvider === provider.id ? "settings-provider-card-active" : ""}`}
                  role="tab"
                  type="button"
                  onClick={() => onActiveAiProviderChange(provider.id)}
                >
                  <span className="settings-provider-card-title">{provider.title}</span>
                  <span className="settings-provider-card-meta">{provider.meta}</span>
                </button>
              ))}
            </div>
            <label className="settings-field">
              <span>Environment variables</span>
              <textarea
                aria-label="AI environment variables"
                className="settings-input settings-textarea"
                placeholder={activeAiProviderCard.placeholder}
                value={aiEnvDrafts[activeAiProvider]}
                onChange={(event) => onAiEnvDraftChange(activeAiProvider, event.target.value)}
              />
            </label>
            <div className="settings-provider-actions settings-provider-actions-inline">
              <span className="settings-inline-note">Only variables for the selected AI provider are shown here.</span>
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
