import type { AIProvider, AISettings, UpdateAISettingsInput } from "./contracts";

export const emptyAiSettingsDraft = (): UpdateAISettingsInput => ({
  active_provider: "openai",
  openai_model: "",
  openai_base_url: "",
  anthropic_model: "",
  anthropic_base_url: "",
  translation_provider: "openai",
  translation_openai_model: "",
  translation_anthropic_model: "",
  translation_target_lang: "ZH-HANS",
  deepl_base_url: "https://api-free.deepl.com",
});

export const draftFromAiSettings = (settings: AISettings): UpdateAISettingsInput => ({
  active_provider: settings.active_provider,
  openai_model: settings.openai_model,
  openai_base_url: settings.openai_base_url,
  provider_env_openai: settings.provider_env_openai,
  anthropic_model: settings.anthropic_model,
  anthropic_base_url: settings.anthropic_base_url,
  provider_env_anthropic: settings.provider_env_anthropic,
  translation_provider: settings.translation_provider,
  translation_openai_model: settings.translation_openai_model,
  translation_anthropic_model: settings.translation_anthropic_model,
  translation_target_lang: settings.translation_target_lang,
  deepl_base_url: settings.deepl_base_url,
});

export const parseAiEnvSettings = (text: string) => {
  const env: Record<string, string> = {};
  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) return;
    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();
    const quote = value[0];
    if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  });
  const aliases: Record<string, string> = {
    OPENAI_AUTH_TOKEN: "OPENAI_API_KEY",
    OPENAI_MODLE: "OPENAI_MODEL",
    ANTHROPIC_AUTH_TOKEN: "ANTHROPIC_API_KEY",
    ANTHROPIC_MODLE: "ANTHROPIC_MODEL",
  };
  Object.entries(aliases).forEach(([alias, canonical]) => {
    if (env[alias] && !env[canonical]) env[canonical] = env[alias];
  });
  return env;
};

export const applyAiEnvSettings = (draft: UpdateAISettingsInput, text: string): UpdateAISettingsInput => {
  const env = parseAiEnvSettings(text);
  const activeProvider = env.AI_PROVIDER ?? env.ACTIVE_PROVIDER;
  const hasOpenAiEnv = Boolean(env.OPENAI_MODEL ?? env.OPENAI_BASE_URL ?? env.OPENAI_API_KEY);
  const hasAnthropicEnv = Boolean(env.ANTHROPIC_MODEL ?? env.ANTHROPIC_BASE_URL ?? env.ANTHROPIC_API_KEY);
  return {
    ...draft,
    active_provider:
      activeProvider === "openai" || activeProvider === "anthropic"
        ? activeProvider
        : hasAnthropicEnv && !hasOpenAiEnv
          ? "anthropic"
          : hasOpenAiEnv && !hasAnthropicEnv
            ? "openai"
            : draft.active_provider,
    openai_model: env.OPENAI_MODEL ?? draft.openai_model,
    openai_base_url: env.OPENAI_BASE_URL ?? draft.openai_base_url,
    anthropic_model: env.ANTHROPIC_MODEL ?? draft.anthropic_model,
    anthropic_base_url: env.ANTHROPIC_BASE_URL ?? draft.anthropic_base_url,
  };
};

export const filterEnvText = (text: string, keys: string[]) => {
  const allowed = new Set(keys);
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const normalized = line.trim().startsWith("export ") ? line.trim().slice("export ".length).trim() : line.trim();
      const separatorIndex = normalized.indexOf("=");
      return separatorIndex > 0 && allowed.has(normalized.slice(0, separatorIndex).trim());
    })
    .join("\n");
};

export const providerEnvKeysByProvider: Record<AIProvider, string[]> = {
  openai: ["OPENAI_MODEL", "OPENAI_MODLE", "OPENAI_API_KEY", "OPENAI_AUTH_TOKEN", "OPENAI_BASE_URL"],
  anthropic: ["ANTHROPIC_MODEL", "ANTHROPIC_MODLE", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"],
};

export const providerEnvKeys = [
  "AI_PROVIDER",
  "ACTIVE_PROVIDER",
  "OPENAI_MODEL",
  "OPENAI_MODLE",
  "OPENAI_API_KEY",
  "OPENAI_AUTH_TOKEN",
  "OPENAI_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_MODLE",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
];

export const emptyProviderEnvDrafts = (): Record<AIProvider, string> => ({
  openai: "",
  anthropic: "",
});
