/**
 * Dice live on the server. Nobody else gets to roll. They're seeded per session, so experiments can be
 * replayed like for like (the stream still diverges once agents make different choices).
 */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix numbers and strings into a 32-bit seed. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

let stream = mulberry32(hashSeed(Date.now()));

export function seedDice(seed: number) {
  stream = mulberry32(seed);
}

/** A separate, independent stream (e.g. the encounter schedule for a given day). */
export function rngFor(...parts: (string | number)[]): () => number {
  return mulberry32(hashSeed(...parts));
}

export function die(sides: number): number {
  return 1 + Math.floor(stream() * sides);
}

export interface DiceExpr {
  count: number;
  sides: number;
  mod: number;
}

export function parseDice(expr: string): DiceExpr | null {
  const m = expr.replace(/\s+/g, "").match(/^(\d{0,2})d(\d{1,3})([+-]\d{1,3})?$/i);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  if (count < 1 || count > 20 || ![4, 6, 8, 10, 12, 20, 100].includes(sides)) return null;
  return { count, sides, mod: m[3] ? Number(m[3]) : 0 };
}

export function formatDice(d: DiceExpr): string {
  return `${d.count}d${d.sides}${d.mod ? (d.mod > 0 ? `+${d.mod}` : d.mod) : ""}`;
}

export function rollDice(expr: string, crit = false): { rolls: number[]; mod: number; total: number } {
  const d = parseDice(expr);
  if (!d) throw new Error(`Bad dice expression: ${expr}`);
  const n = crit ? d.count * 2 : d.count;
  const rolls = Array.from({ length: n }, () => die(d.sides));
  return { rolls, mod: d.mod, total: Math.max(0, rolls.reduce((a, b) => a + b, 0) + d.mod) };
}

export function avgDice(expr: string): number {
  const d = parseDice(expr);
  if (!d) return 0;
  return (d.count * (d.sides + 1)) / 2 + d.mod;
}
