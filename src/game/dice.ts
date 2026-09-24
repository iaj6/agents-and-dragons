import { randomInt } from "node:crypto";

/** Dice live on the server. Nobody else gets to roll. */
export function die(sides: number): number {
  return randomInt(1, sides + 1);
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
