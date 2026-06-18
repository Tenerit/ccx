import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ModelPrice, PricingTable, Usage } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

// pricing.json sits at the package root (one level up from dist/ or src/).
function defaultPricingPath(): string {
  return join(here, "..", "pricing.json");
}

export function loadPricing(path?: string): PricingTable {
  const raw = readFileSync(path ?? defaultPricingPath(), "utf8");
  const parsed = JSON.parse(raw) as PricingTable;
  if (!parsed.models || typeof parsed.models !== "object") {
    throw new Error("pricing file missing a 'models' object");
  }
  return parsed;
}

// Match a model id against the pricing keys by substring (first match wins).
export function priceFor(model: string, table: PricingTable): ModelPrice | null {
  const id = model.toLowerCase();
  for (const [key, price] of Object.entries(table.models)) {
    if (id.includes(key.toLowerCase())) return price;
  }
  return null;
}

// Cache-aware cost of a single assistant message, in USD.
export function usageCost(usage: Usage, price: ModelPrice): number {
  const m = 1_000_000;
  const w5 = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const w1 = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  // Fall back to the undifferentiated counter only when no split is present,
  // so we never double-count the same tokens.
  const wFlat = w5 + w1 > 0 ? 0 : usage.cache_creation_input_tokens ?? 0;
  return (
    ((usage.input_tokens ?? 0) * price.input +
      (usage.output_tokens ?? 0) * price.output +
      w5 * price.cacheWrite5m +
      w1 * price.cacheWrite1h +
      wFlat * price.cacheWrite5m +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead) /
    m
  );
}
