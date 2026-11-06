// Fixed-precision Hermes run cost grading. Prices come only from the sanitized
// /api/model/options catalog cache; usage collection never performs a pricing fetch.

import { readCachedHermesCatalog } from "./catalog.js";

const MAX_SAFE_MICROS = BigInt(Number.MAX_SAFE_INTEGER);
const DECIMAL_PATTERN = /^\d{1,18}(?:\.\d{1,12})?$/;
const ACTUAL_SOURCES = new Set(["provider", "provider_response", "provider_invoice", "gateway_billing"]);

function decimalParts(value) {
  const text = String(value ?? "").trim();
  if (!DECIMAL_PATTERN.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return { numerator: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) };
}

function addDecimalTerm(total, value, multiplier = 1n) {
  const parsed = decimalParts(value);
  if (!parsed) return null;
  const scale = total?.scale && total.scale > parsed.scale ? total.scale : parsed.scale;
  const prior = total ? total.numerator * (scale / total.scale) : 0n;
  return { numerator: prior + parsed.numerator * multiplier * (scale / parsed.scale), scale };
}

function roundedInteger(total) {
  if (!total) return 0n;
  return (total.numerator + total.scale / 2n) / total.scale;
}

function costNote(code, detail) {
  return { code, detail };
}

function actualCharge(snapshot) {
  const candidates = [snapshot?.billing, snapshot?.usage?.billing];
  for (const value of candidates) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const source = String(value.source || "").trim().toLowerCase();
    if (String(value.status || "").toLowerCase() !== "actual" || !ACTUAL_SOURCES.has(source)) continue;
    if (String(value.currency || "USD").toUpperCase() !== "USD") continue;
    const amount = decimalParts(value.amount_usd);
    if (!amount) continue;
    const micros = roundedInteger({ numerator: amount.numerator * 1000000n, scale: amount.scale });
    if (micros > MAX_SAFE_MICROS) return { overflow: true };
    return { micros: Number(micros), source };
  }
  return null;
}

function findModel(catalog, provider, model) {
  const providerRow = (catalog?.providers || []).find(row => row.id === provider);
  const modelRow = (providerRow?.models || []).find(row => row.id === model);
  return providerRow && modelRow ? { providerRow, modelRow } : null;
}

function selectedRates(pricing, serviceTier) {
  const tier = String(serviceTier || "").trim().toLowerCase();
  if (!tier || tier === "default" || tier === "standard") {
    return pricing?.serviceTiers?.[tier] || pricing?.rates || null;
  }
  return pricing?.serviceTiers?.[tier] || null;
}

export function gradeHermesCost({ normalized, attribution, snapshot, catalog, priorPriceSnapshot = null }) {
  const actual = actualCharge(snapshot);
  if (actual?.overflow) {
    return { costStatus: "unknown", costMicros: null, currency: "USD", priceSnapshot: null,
      note: costNote("actual_cost_overflow", "Provider-charged amount exceeds safe integer precision."), overflow: true };
  }
  if (actual) {
    return {
      costStatus: "actual", costMicros: actual.micros, currency: "USD",
      priceSnapshot: { kind: "actual_charge", source: actual.source, currency: "USD" },
      note: costNote("provider_charged", "Trusted provider-charged amount reported by the runtime."), overflow: false
    };
  }

  const provider = attribution.actualProvider;
  const model = attribution.actualModel;
  const matched = findModel(catalog, provider, model);
  const billingMode = matched?.providerRow?.billingMode || (provider === "openai-codex" ? "subscription_included" : null);
  if (billingMode === "subscription_included" || billingMode === "fixed_quota") {
    return {
      costStatus: "included", costMicros: null, currency: "USD", priceSnapshot: null,
      note: costNote("subscription_included", "Usage is included in a subscription or fixed quota; no spend amount is inferred."), overflow: false
    };
  }
  if (billingMode === "reference_only") {
    return { costStatus: "n_a", costMicros: null, currency: null, priceSnapshot: null,
      note: costNote("reference_price_not_spend", "OAuth or coding-plan reference prices are not treated as money spent."), overflow: false };
  }
  if (billingMode === "custom_unknown") {
    return { costStatus: "n_a", costMicros: null, currency: null, priceSnapshot: null,
      note: costNote("custom_pricing_unknown", "Custom endpoint billing is not known."), overflow: false };
  }
  if (!provider || !model) {
    return { costStatus: "n_a", costMicros: null, currency: null, priceSnapshot: null,
      note: costNote("runtime_attribution_missing", "Actual provider/model attribution is unavailable."), overflow: false };
  }
  if (billingMode !== "metered") {
    return { costStatus: "n_a", costMicros: null, currency: null, priceSnapshot: null,
      note: costNote("reference_price_not_spend", "Provider billing is not explicitly known to be metered; reference prices are not treated as money spent."), overflow: false };
  }

  const priceSnapshot = priorPriceSnapshot || (matched?.modelRow?.pricing ? {
    provider, model, serviceTier: attribution.serviceTier || null, ...matched.modelRow.pricing
  } : null);
  if (!priceSnapshot) {
    return { costStatus: "n_a", costMicros: null, currency: null, priceSnapshot: null,
      note: costNote("price_unavailable", "No sanitized model/options price is available."), overflow: false };
  }
  if (priceSnapshot.free === true) {
    return { costStatus: "included", costMicros: null, currency: "USD", priceSnapshot,
      note: costNote("price_explicitly_free", "The model/options entry explicitly marks this model as free; no spend amount is stored."), overflow: false };
  }
  const rates = selectedRates(priceSnapshot, attribution.serviceTier || priceSnapshot.serviceTier);
  if (!rates) {
    return { costStatus: "unknown", costMicros: null, currency: priceSnapshot.currency || "USD", priceSnapshot,
      note: costNote("service_tier_price_unknown", "The served service tier has no matching price metadata."), overflow: false };
  }
  if (normalized.input === null || normalized.output === null) {
    return { costStatus: "unknown", costMicros: null, currency: priceSnapshot.currency || "USD", priceSnapshot,
      note: costNote("token_coverage_incomplete", "Required input/output token buckets are unavailable."), overflow: false };
  }
  if (normalized.validationFlags?.includes("usage_cache_convention_unverified")) {
    return { costStatus: "unknown", costMicros: null, currency: priceSnapshot.currency || "USD", priceSnapshot,
      note: costNote("usage_cache_convention_unverified", "Provider token details were present without canonical Hermes cache buckets."), overflow: false };
  }
  const buckets = [
    ["input", normalized.input, rates.input], ["output", normalized.output, rates.output],
    ["cache_read", normalized.cacheRead, rates.cacheRead], ["cache_write", normalized.cacheWrite, rates.cacheWrite]
  ];
  let total = null;
  for (const [name, tokens, rate] of buckets) {
    if (tokens === null || tokens === 0) continue;
    if (rate === null || rate === undefined) {
      return { costStatus: "unknown", costMicros: null, currency: priceSnapshot.currency || "USD", priceSnapshot,
        note: costNote(name + "_price_missing", "A reported token bucket has no matching rate."), overflow: false };
    }
    total = addDecimalTerm(total, rate, BigInt(tokens));
    if (!total) {
      return { costStatus: "unknown", costMicros: null, currency: priceSnapshot.currency || "USD", priceSnapshot,
        note: costNote(name + "_price_invalid", "Price metadata is invalid."), overflow: false };
    }
  }
  if (rates.request !== null && rates.request !== undefined) {
    total = addDecimalTerm(total, rates.request, 1000000n);
  }
  let micros = roundedInteger(total);
  if (micros > MAX_SAFE_MICROS) {
    return { costStatus: "unknown", costMicros: null, currency: priceSnapshot.currency || "USD", priceSnapshot,
      note: costNote("estimated_cost_overflow", "Estimated cost exceeds safe integer precision."), overflow: true };
  }
  if (micros === 0n && total?.numerator > 0n) micros = 1n;
  if (micros === 0n) {
    return { costStatus: "unknown", costMicros: null, currency: priceSnapshot.currency || "USD", priceSnapshot,
      note: costNote("zero_reference_price_untrusted", "Zero rates are not treated as free unless model/options explicitly marks the model free."), overflow: false };
  }
  return {
    costStatus: "estimated", costMicros: Number(micros), currency: priceSnapshot.currency || "USD", priceSnapshot,
    note: costNote("reference_price_estimate", "Estimated from token buckets and a historical model/options price snapshot."), overflow: false
  };
}

export async function priceHermesUsage(env, run, normalized, attribution, snapshot, priorPriceSnapshot = null) {
  let catalog = null;
  try { catalog = await readCachedHermesCatalog(env?.DB, run.instance_id); } catch (err) { catalog = null; }
  return gradeHermesCost({ normalized, attribution, snapshot, catalog, priorPriceSnapshot });
}

export { MAX_SAFE_MICROS };
