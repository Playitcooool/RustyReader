import { describe, expect, it } from "vitest";

import type { AISettings } from "./contracts";
import {
  applyAiEnvSettings,
  draftFromAiSettings,
  emptyAiSettingsDraft,
  emptyProviderEnvDrafts,
  filterEnvText,
  parseAiEnvSettings,
} from "./aiSettingsView";

describe("aiSettingsView", () => {
  it("parses env text with exports, quotes, comments, and aliases", () => {
    expect(
      parseAiEnvSettings(`
        # ignored
        export OPENAI_MODLE="gpt-5"
        OPENAI_AUTH_TOKEN='token'
        MALFORMED
        ANTHROPIC_BASE_URL=https://example.test
      `),
    ).toMatchObject({
      OPENAI_MODLE: "gpt-5",
      OPENAI_MODEL: "gpt-5",
      OPENAI_AUTH_TOKEN: "token",
      OPENAI_API_KEY: "token",
      ANTHROPIC_BASE_URL: "https://example.test",
    });
  });

  it("applies env settings without overwriting unrelated fields", () => {
    const draft = emptyAiSettingsDraft();
    const next = applyAiEnvSettings(draft, "ANTHROPIC_MODEL=claude\nANTHROPIC_BASE_URL=https://anthropic.test");

    expect(next.active_provider).toBe("anthropic");
    expect(next.anthropic_model).toBe("claude");
    expect(next.anthropic_base_url).toBe("https://anthropic.test");
    expect(next.translation_provider).toBe(draft.translation_provider);
  });

  it("filters provider env text and creates draft shapes", () => {
    expect(filterEnvText("OPENAI_MODEL=gpt\nANTHROPIC_MODEL=claude\nexport OPENAI_API_KEY=key", ["OPENAI_MODEL", "OPENAI_API_KEY"]))
      .toBe("OPENAI_MODEL=gpt\nexport OPENAI_API_KEY=key");

    expect(emptyProviderEnvDrafts()).toEqual({ openai: "", anthropic: "" });

    const settings: AISettings = {
      active_provider: "anthropic",
      openai_model: "gpt",
      openai_base_url: "https://openai.test",
      provider_env_openai: "",
      anthropic_model: "claude",
      anthropic_base_url: "https://anthropic.test",
      provider_env_anthropic: "ANTHROPIC_API_KEY=secret",
      has_openai_api_key: false,
      has_anthropic_api_key: true,
      translation_provider: "deepl",
      translation_openai_model: "gpt-mini",
      translation_anthropic_model: "claude-haiku",
      translation_target_lang: "JA",
      deepl_base_url: "https://deepl.test",
      has_deepl_api_key: true,
    };

    expect(draftFromAiSettings(settings)).toMatchObject({
      active_provider: "anthropic",
      anthropic_model: "claude",
      provider_env_anthropic: "ANTHROPIC_API_KEY=secret",
      translation_provider: "deepl",
    });
  });
});
