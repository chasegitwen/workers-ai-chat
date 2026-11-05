import { describe, expect, it } from "vitest";
import {
  buildHermesRunSettingsPanel,
  parseHermesModelOptions,
  HERMES_REASONING_EFFORTS
} from "../src/hermes/settings.js";
import { HERMES_APPROVAL_POLICY } from "../src/hermes/permissions.js";

describe("Hermes run settings parsing", () => {
  it("inherits when model_options is absent or empty", () => {
    expect(parseHermesModelOptions(undefined)).toMatchObject({ ok: true, inherit: true, modelOptions: null });
    expect(parseHermesModelOptions({})).toMatchObject({ ok: true, inherit: true, modelOptions: null });
    expect(parseHermesModelOptions({ reasoning: null })).toMatchObject({ ok: true, inherit: true, modelOptions: null });
  });

  it("accepts reasoning effort overrides Hermes documents", () => {
    for (const effort of HERMES_REASONING_EFFORTS) {
      const parsed = parseHermesModelOptions({ reasoning: { effort } });
      expect(parsed).toMatchObject({
        ok: true,
        inherit: false,
        modelOptions: {
          reasoning: {
            effort,
            enabled: effort !== "none"
          }
        }
      });
    }
  });

  it("rejects unknown fields and invalid efforts instead of no-op saves", () => {
    expect(parseHermesModelOptions({ temperature: 0.2 }).code).toBe("hermes_unsupported_model_option");
    expect(parseHermesModelOptions({ reasoning: { effort: "ludicrous" } }).code).toBe("hermes_invalid_reasoning_effort");
    expect(parseHermesModelOptions({ reasoning: "high" }).code).toBe("hermes_invalid_reasoning");
  });

  it("accepts service_tier / fast and builds an honest settings panel", () => {
    expect(parseHermesModelOptions({ service_tier: "priority", fast: true })).toMatchObject({
      ok: true,
      modelOptions: { service_tier: "priority", fast: true }
    });
    const panel = buildHermesRunSettingsPanel({
      catalog: {
        agents: [{ id: "hermes-agent", defaultProvider: "openai-codex", defaultModel: "gpt-5.6-luna" }],
        capabilities: { features: { model_options: true } }
      }
    });
    expect(panel.fields.reasoning_effort.writable).toBe(true);
    expect(panel.fields.max_turns.writable).toBe(false);
    expect(panel.fields.approval_policy).toMatchObject({
      writable: false,
      policy: HERMES_APPROVAL_POLICY,
      displayOnly: true
    });
    expect(panel.gaps.map(item => item.id)).toEqual(expect.arrayContaining([
      "max_turns",
      "session_model_lock_write",
      "config_yaml"
    ]));
    expect(panel.defaults).toMatchObject({ inherit: true, provider: "openai-codex", model: "gpt-5.6-luna" });
  });
});
