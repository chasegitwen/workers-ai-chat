import { ProviderNotImplementedError } from "./errors.js";

export async function callAnthropic({ config }) {
  throw new ProviderNotImplementedError(
    "Anthropic runtime not implemented yet",
    {
      provider: config?.provider || "anthropic",
      providerType: "anthropic",
      model: config?.id || ""
    }
  );
}
