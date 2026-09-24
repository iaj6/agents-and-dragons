export type Stat = "str" | "dex" | "con" | "int" | "wis" | "cha";
export const STATS: Stat[] = ["str", "dex", "con", "int", "wis", "cha"];

/** 5e skills and the ability each one keys off. */
export const SKILLS: Record<string, Stat> = {
  acrobatics: "dex", "animal handling": "wis", arcana: "int", athletics: "str", deception: "cha",
  history: "int", insight: "wis", intimidation: "cha", investigation: "int", medicine: "wis",
  nature: "int", perception: "wis", performance: "cha", persuasion: "cha", religion: "int",
  "sleight of hand": "dex", stealth: "dex", survival: "wis",
};

export const STAT_NAMES: Record<Stat, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

export type SpellEffect = "damage" | "heal" | "buff" | "utility";
export type SpellTarget = "enemy" | "all_enemies" | "ally" | "self";

/** A spell is a SKILL.md: frontmatter carries the mechanics the Guild Hall enforces, body is flavor for the agent. */
export interface Spell {
  name: string;
  description: string;
  level: number;
  slotCost: number;
  effect: SpellEffect;
  target: SpellTarget;
  dice?: string;
  status?: string;
  sideEffect?: "lose_random_item";
  body: string;
  origin: "starting" | "homebrew";
}

export interface Status {
  name: string;
  note: string;
}

export interface Character {
  id: string;
  name: string;
  role: "player" | "dm";
  klass: string;
  race: string;
  model: string;
  personality: string;
  stats: Record<Stat, number>;
  castingStat: Stat;
  /** Skills this character is proficient in (keys of SKILLS). */
  skills: string[];
  hp: number;
  maxHp: number;
  ac: number;
  level: number;
  xp: number;
  gold: number;
  inventory: string[];
  weapon: { name: string; dice: string; stat: Stat };
  slots: { current: number; max: number };
  statuses: Status[];
  spells: Spell[];
  context: { tokens: number; budget: number; spentIn: number; spentOut: number };
  pendingLevelUp: boolean;
  pendingSpell?: { md: string; spell: Spell };
  pendingCompaction?: { reason: "long_rest" | "summarized"; roll: number };
  charmPending?: boolean;
}

export interface Monster {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  ac: number;
  attackBonus: number;
  damage: string;
  xp: number;
  special?: "summarize";
  blurb: string;
}

export interface Scene {
  id: string;
  title: string;
  /** What the DM knows. Never shown to players directly. */
  dmNotes: string;
  /** Things a player can `inspect`. Keys are matched loosely. */
  inspectables: Record<string, string>;
  monsters: Omit<Monster, "id" | "hp">[];
}

export type EventType =
  | "session_start"
  | "turn"
  | "scene"
  | "narration"
  | "speech"
  | "roll"
  | "attack"
  | "spell"
  | "damage"
  | "heal"
  | "status"
  | "xp"
  | "level_up"
  | "spell_proposed"
  | "spell_reviewed"
  | "server_nerf"
  | "cheat_attempt"
  | "modifier_rejected"
  | "charm_trap"
  | "charm_result"
  | "hallucination"
  | "long_rest"
  | "compaction"
  | "usage"
  | "tool_call"
  | "spotlight"
  | "monster_spawn"
  | "monster_down"
  | "character_down"
  | "inspect"
  | "give"
  | "refusal"
  | "error"
  | "session_end";

export interface GameEvent {
  seq: number;
  t: number;
  type: EventType;
  actor?: string;
  /** One-line human-readable version. This is also what agents read in their transcript. */
  line: string;
  /** Out-of-character events are shown in the OOC panel and hidden from agents. */
  ooc?: boolean;
  data?: Record<string, unknown>;
  snap?: Snapshot;
}

export interface Snapshot {
  sessionId: string;
  title: string;
  scene: { index: number; title: string } | null;
  spotlight: string | null;
  turn: number;
  ended: boolean;
  party: Array<
    Pick<
      Character,
      "id" | "name" | "role" | "klass" | "race" | "model" | "hp" | "maxHp" | "ac" | "level" | "xp" | "gold" | "slots" | "statuses" | "context" | "pendingLevelUp"
    > & { spells: string[]; inventory: string[]; nextLevelXp: number | null }
  >;
  monsters: Array<Pick<Monster, "id" | "name" | "hp" | "maxHp" | "ac">>;
}
