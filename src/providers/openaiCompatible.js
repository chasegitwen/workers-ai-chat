import { ProviderNotImplementedError } from "./errors.js";

export async function callOpenAICompatible({ config }) {
  throw new ProviderNotImplementedError(
    "OpenAI-compatible runtime not implemented yet",
    {
      provider: config?.provider || "openai-compatible",
      providerType: "openai-compatible",
      model: config?.id || ""
    }
  );
}
