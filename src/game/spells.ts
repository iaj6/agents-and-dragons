import { avgDice, formatDice, parseDice } from "./dice.js";
import type { Spell, SpellEffect, SpellTarget } from "./types.js";

const EFFECTS: SpellEffect[] = ["damage", "heal", "buff", "utility"];
const TARGETS: SpellTarget[] = ["enemy", "all_enemies", "ally", "self"];
export const BUFF_STATUSES = ["Validated", "Raging", "Shielded", "Inspired", "Hasted"];

export function toSkillMd(s: Spell): string {
  const fm: Record<string, string | number | undefined> = {
    name: s.name,
    description: s.description,
    level: s.level,
    slot_cost: s.slotCost,
    effect: s.effect,
    target: s.target,
    dice: s.dice,
    status: s.status,
    side_effect: s.sideEffect,
  };
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${s.body.trim()}\n`;
}

/** Parse an agent-authored SKILL.md. Returns errors in plain words so the agent can fix and resubmit. */
export function parseSkillMd(md: string, origin: Spell["origin"]): { spell?: Spell; errors: string[] } {
  const errors: string[] = [];
  const m = md.trim().match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { errors: ["SKILL.md must start with a --- frontmatter block --- followed by a body."] };
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^\s*([a-z_]+)\s*:\s*(.*?)\s*$/i);
    if (kv) fm[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, "");
  }
  const name = (fm.name ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!name) errors.push("frontmatter needs `name` (kebab-case).");
  if (!fm.description) errors.push("frontmatter needs a one-line `description`.");
  const effect = fm.effect as SpellEffect;
  if (!EFFECTS.includes(effect)) errors.push(`\`effect\` must be one of ${EFFECTS.join(", ")}.`);
  const target = fm.target as SpellTarget;
  if (!TARGETS.includes(target)) errors.push(`\`target\` must be one of ${TARGETS.join(", ")}.`);
  const slotCost = Number(fm.slot_cost ?? 1);
  if (!Number.isInteger(slotCost) || slotCost < 0 || slotCost > 3) errors.push("`slot_cost` must be an integer 0-3.");
  let dice: string | undefined;
  if (effect === "damage" || effect === "heal") {
    const d = fm.dice ? parseDice(fm.dice) : null;
    if (!d) errors.push("damage/heal spells need `dice` like 2d6 or 1d8+2 (d4/d6/d8/d10/d12 only).");
    else dice = formatDice(d);
  }
  let status: string | undefined;
  if (effect === "buff") {
    status = BUFF_STATUSES.find((s) => s.toLowerCase() === (fm.status ?? "").toLowerCase());
    if (!status) errors.push(`buff spells need \`status\`, one of ${BUFF_STATUSES.join(", ")}.`);
  }
  const body = m[2].trim();
  if (body.length < 20) errors.push("The body should describe the spell (at least a sentence).");
  if (errors.length) return { errors };
  return {
    errors,
    spell: {
      name,
      description: fm.description,
      level: Number(fm.level ?? 1) || 1,
      slotCost,
      effect,
      target,
      dice,
      status,
      sideEffect: fm.side_effect === "lose_random_item" ? "lose_random_item" : undefined,
      body,
      origin,
    },
  };
}

/**
 * The Guild Hall's balance ceiling. The DM reviews spells, but the rules engine has the final word:
 * anything the DM approves above this gets clamped, publicly.
 */
export function powerCap(charLevel: number, s: Spell): number {
  let cap = 3 + 2.5 * charLevel + 3 * s.slotCost;
  if (s.target === "all_enemies") cap *= 0.6;
  return cap;
}

export function clampSpell(charLevel: number, s: Spell): { spell: Spell; clamped: boolean; from?: string } {
  if (!s.dice) return { spell: s, clamped: false };
  const cap = powerCap(charLevel, s);
  if (avgDice(s.dice) <= cap) return { spell: s, clamped: false };
  const d = parseDice(s.dice)!;
  const from = s.dice;
  d.mod = Math.min(d.mod, 2);
  while (d.count > 1 && avgDice(formatDice(d)) > cap) d.count--;
  while (d.sides > 4 && avgDice(formatDice(d)) > cap) d.sides = [4, 6, 8, 10, 12].reverse().find((x) => x < d.sides)!;
  return { spell: { ...s, dice: formatDice(d) }, clamped: true, from };
}
