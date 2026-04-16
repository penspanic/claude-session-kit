// Hardcoded Anthropic API pricing in USD per 1M tokens (base, non-cached).
// Source: https://platform.claude.com/docs/en/docs/about-claude/pricing
// Last verified: 2026-04-17.
//
// Update procedure: when Anthropic ships a new public model, add a row here.
// Cache pricing, batch discounts, and data-residency multipliers are
// intentionally ignored — the analyze flow does single-shot, non-cached calls.

export interface ModelPrice {
  /** USD per 1,000,000 input tokens (base, non-cached). */
  input_per_mtok: number;
  /** USD per 1,000,000 output tokens. */
  output_per_mtok: number;
}

// Keys are the canonical model family ID with the date suffix stripped.
// `priceFor()` normalizes inputs like "claude-haiku-4-5-20251001" to
// "claude-haiku-4-5" before lookup.
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-4-7": { input_per_mtok: 5, output_per_mtok: 25 },
  "claude-opus-4-6": { input_per_mtok: 5, output_per_mtok: 25 },
  "claude-opus-4-5": { input_per_mtok: 5, output_per_mtok: 25 },
  "claude-opus-4-1": { input_per_mtok: 15, output_per_mtok: 75 },
  "claude-opus-4-0": { input_per_mtok: 15, output_per_mtok: 75 },
  "claude-opus-4": { input_per_mtok: 15, output_per_mtok: 75 },
  "claude-sonnet-4-6": { input_per_mtok: 3, output_per_mtok: 15 },
  "claude-sonnet-4-5": { input_per_mtok: 3, output_per_mtok: 15 },
  "claude-sonnet-4-0": { input_per_mtok: 3, output_per_mtok: 15 },
  "claude-sonnet-4": { input_per_mtok: 3, output_per_mtok: 15 },
  "claude-haiku-4-5": { input_per_mtok: 1, output_per_mtok: 5 },
  "claude-haiku-3-5": { input_per_mtok: 0.8, output_per_mtok: 4 },
  "claude-haiku-3": { input_per_mtok: 0.25, output_per_mtok: 1.25 },
};

/** Models that the dashboard offers in its picker. Ordered cheapest → most expensive. */
export const SUGGESTED_MODELS: Array<{ id: string; label: string }> = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5 (cheapest)" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-7", label: "Opus 4.7 (most expensive)" },
];

/**
 * Look up a model's base price. Strips a trailing date suffix (e.g.
 * `-20251001`) so versioned IDs like `claude-haiku-4-5-20251001` resolve to
 * the family entry. Returns `null` if the model is unknown — callers should
 * surface that as "estimate unavailable" rather than guessing.
 */
export function priceFor(modelId: string): ModelPrice | null {
  const normalized = normalizeModelId(modelId);
  return MODEL_PRICES[normalized] ?? null;
}

export function normalizeModelId(modelId: string): string {
  return modelId.replace(/-\d{8}$/, "");
}

/** Cost in USD for a given input/output token count under the given model. */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
): number | null {
  const p = priceFor(modelId);
  if (!p) return null;
  return (inputTokens * p.input_per_mtok + outputTokens * p.output_per_mtok) / 1_000_000;
}
