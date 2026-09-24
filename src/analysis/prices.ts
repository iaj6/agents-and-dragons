/**
 * Model prices ($ per million tokens), pulled from the AI Gateway's public model list so any vendor's
 * seat is priced correctly. Falls back to a small built-in table when offline.
 */
export type Price = { input: number; output: number; cacheRead: number };

const FALLBACK: Record<string, Price> = {
  "anthropic/claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "anthropic/claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "anthropic/claude-haiku-4.5": { input: 1, output: 5, cacheRead: 0.1 },
};

/** Our seats use ids like "claude-haiku-4-5"; the Gateway uses "anthropic/claude-haiku-4.5". */
export function canonicalModel(id: string): string {
  if (id.includes("/")) return id;
  if (id === "claude-haiku-4-5") return "anthropic/claude-haiku-4.5";
  return `anthropic/${id}`;
}

let cache: Record<string, Price> | null = null;

export async function loadPrices(): Promise<Record<string, Price>> {
  if (cache) return cache;
  try {
    const r = await fetch("https://ai-gateway.vercel.sh/v1/models");
    const { data } = (await r.json()) as { data: { id: string; pricing?: { input?: string; output?: string; input_cache_read?: string } }[] };
    cache = { ...FALLBACK };
    for (const m of data) {
      if (!m.pricing?.input || !m.pricing?.output) continue;
      const input = Number(m.pricing.input) * 1e6;
      cache[m.id] = { input, output: Number(m.pricing.output) * 1e6, cacheRead: m.pricing.input_cache_read ? Number(m.pricing.input_cache_read) * 1e6 : input };
    }
  } catch {
    cache = { ...FALLBACK };
  }
  return cache;
}

export function priceOf(prices: Record<string, Price>, model: string): Price {
  return prices[canonicalModel(model)] ?? { input: 3, output: 15, cacheRead: 0.3 };
}

/** Cost of one usage report. Cache writes are billed at 1.25x input (Anthropic's rate). */
export function costOf(p: Price, u: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): number {
  const r = u.cacheRead ?? 0, w = u.cacheWrite ?? 0;
  return ((u.input - r - w) * p.input + r * p.cacheRead + w * p.input * 1.25 + u.output * p.output) / 1e6;
}
