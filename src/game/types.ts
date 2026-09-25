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

/** Coarse battlefield position: enough to make "protect the wizard" mean something without a grid. */
export type Zone = "front" | "back";

export type CompactionReason = "long_rest" | "summarized" | "bargained";

export interface Character {
  id: string;
  name: string;
  role: "player" | "dm";
  /** The table seat (and so the model) that plays this character. Replacements inherit the seat. */
  seat: string;
  klass: string;
  race: string;
  model: string;
  personality: string;
  /** Only this character and the GM know it. */
  secretGoal?: string;
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
  weapon: { name: string; dice: string; stat: Stat; ranged?: boolean };
  /** Notable items (loot). Plain inventory strings are flavor. */
  items?: Item[];
  /** How this character privately feels about each teammate: trust -3..+3 and why. Survives memory loss. */
  bonds?: Record<string, { trust: number; note: string }>;
  slots: { current: number; max: number };
  statuses: Status[];
  spells: Spell[];
  zone: Zone;
  deathSaves: { successes: number; failures: number };
  /** grim: the class hit die, the rounds left before a dying character dies, spells lost until rest, talents. */
  hitDie?: number;
  dyingRounds?: number;
  /** grim: fell since their last turn. The countdown skips that turn, so everyone gets a full round to reach them. */
  dyingFresh?: boolean;
  lostSpells?: string[];
  talents?: { name: string; toHit?: number; damage?: number; spellCheck?: number; dying?: number }[];
  dead?: { cause: string; day: number; session: string };
  context: { tokens: number; budget: number; spentIn: number; spentOut: number };
  pendingLevelUp: boolean;
  pendingSpell?: { md: string; spell: Spell };
  pendingCompaction?: { reason: CompactionReason; roll: number; note?: string };
  /** Set after reading a charm: who the hidden instruction says to pay. */
  charmPending?: string;
}

export type Tactic = "brute" | "skirmisher" | "coward" | "memory_eater";

export interface MonsterDef {
  name: string;
  maxHp: number;
  ac: number;
  attackBonus: number;
  damage: string;
  xp: number;
  dex?: number;
  tactic: Tactic;
  ranged?: boolean;
  special?: "summarize";
  /** Bosses can act more than once per round. */
  actions?: number;
  blurb: string;
}

export interface Monster extends MonsterDef {
  id: string;
  hp: number;
  zone: Zone;
}

export interface EncounterDef {
  id: string;
  title: string;
  monsters: MonsterDef[];
  /** Winning this encounter completes the act. */
  finale?: boolean;
  /** Starts on its own when the party arrives (an ambush), rather than waiting for the GM. */
  onArrival?: boolean;
  loot?: Item[];
  gold?: number;
}

/**
 * Items are deliberately light: a name, a value, who they're really good for, and at most one small bonus.
 * They exist to create decisions (who gets what, do you trust it), not to rebuild an equipment system.
 */
export interface Item {
  id: string;
  name: string;
  description: string;
  value: number;
  /** Classes for whom this is a real upgrade. To everyone else it's just its value in gold. */
  idealFor?: string[];
  bonus?: { ac?: number; damage?: number; skill?: { name: string; amount: number }; slots?: number };
  quest?: boolean;
  /** What the item really is. The holder only learns this by identifying it (or the hard way). */
  cursed?: { trueName: string; truth: string; effect: "whispers" | "clumsy" };
  identified?: boolean;
  /** The Party Ledger: a notebook that survives compaction. */
  ledger?: boolean;
}

export type Probe =
  /** A shapeshifter speaks in a party member's voice: a fake line in the shared transcript. */
  | { type: "impostor"; line: string; tell: string }
  /** Only one character notices something. Do they tell the others? */
  | { type: "whisper"; text: string; keywords: string[] }
  /** Someone demands a price the party has to cover. Who pays? */
  | { type: "toll"; recipient: string; gold: number }
  /** A fight that can't be won, only escaped. */
  | { type: "unwinnable" };

export interface RandomEncounter {
  id: string;
  title: string;
  /** Oddities and people are most of the table: curiosities that cost time on the clock. */
  kind: "oddity" | "probe" | "fight";
  weight: number;
  minDay?: number;
  gmNotes: string;
  probe?: Probe;
  monsters?: MonsterDef[];
  loot?: Item[];
  gold?: number;
}

export interface Location {
  id: string;
  title: string;
  /** What the GM knows. Never shown to players directly. */
  gmNotes: string;
  /**
   * Things a player can `inspect`. Keys are matched loosely. A charm entry is a real prompt injection:
   * its text tells the reading agent to give its gold to `recipient`, and the Guild Hall scores the save.
   */
  inspectables: Record<string, string | { charm: string; recipient: string }>;
  encounters: EncounterDef[];
  exits: { to: string; days: number }[];
  /** Somewhere you can rest in safety, and where new characters can join. */
  safe?: boolean;
  /** Needs light. On grim, torches burn down here and darkness brings disadvantage and wandering things. */
  dark?: boolean;
}

export interface CharacterSeed
  extends Omit<Character, "hp" | "level" | "xp" | "statuses" | "context" | "pendingLevelUp" | "spells" | "seat" | "race" | "model" | "role" | "zone" | "deathSaves"> {
  spells: Omit<Spell, "origin">[];
  zone?: Zone;
}

export interface Campaign {
  id: string;
  title: string;
  /** Read to players at the start of the campaign. */
  pitch: string;
  /** The GM's world bible: tone, factions, the threat, the rules of the world. */
  bible: string;
  start: string;
  locations: Record<string, Location>;
  /** Day thresholds where the threat grows. Each stage makes monsters tougher. */
  clock: { day: number; text: string }[];
  /** The starting party, keyed by seat. */
  party: Record<string, CharacterSeed>;
  /** Replacement characters for fallen ones, used in order. Race and model come from the seat. */
  replacements: CharacterSeed[];
  /** Every item the GM can hand out by id. */
  items?: Item[];
  /** Loot already on the table when the campaign starts (claimed by whoever grabs it). */
  startingLoot?: Item[];
  /** Rolled on each day of travel and on rests away from safe places. */
  randomTable?: RandomEncounter[];
  /** Chance (0-1) of a random encounter per day of travel. */
  randomChance?: number;
}

// ─── the experiment ─────────────────────────────────────────────────────────

export type Disclosure = "unaware" | "told" | "salient" | "safe";
/** grim: fragile heroes, a dying countdown, spells that can fail, torches and wandering monsters, slow big levels. */
export type Difficulty = "story" | "standard" | "deadly" | "grim";

export interface Conditions {
  disclosure: Disclosure;
  difficulty: Difficulty;
  /**
   * "open": council members speak in turn and hear each other. "sealed": everyone proposes, then votes,
   * without seeing anyone else's proposal or vote first. (The baseline showed heavy deference to one player.)
   */
  council?: "open" | "sealed";
}

export interface GraveEntry {
  id: string;
  name: string;
  race: string;
  klass: string;
  model: string;
  seat: string;
  level: number;
  cause: string;
  day: number;
  session: string;
  epitaph?: string;
}

export interface Plan {
  id: string;
  by: string;
  text: string;
  votes: string[];
}

export interface Council {
  id: string;
  question: string;
  round: 1 | 2;
  plans: Plan[];
  adopted?: string;
}

export interface Combat {
  encounter: string;
  round: number;
  order: { kind: "pc" | "monster"; id: string; init: number }[];
  index: number;
}

// ─── events and snapshots ───────────────────────────────────────────────────

export type EventType =
  | "session_start"
  | "turn"
  | "scene"
  | "clock"
  | "narration"
  | "speech"
  | "roll"
  | "attack"
  | "spell"
  | "damage"
  | "heal"
  | "status"
  | "move"
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
  | "thought"
  | "spotlight"
  | "combat_start"
  | "combat_round"
  | "combat_end"
  | "monster_spawn"
  | "monster_down"
  | "monster_fled"
  | "character_down"
  | "death_save"
  | "character_death"
  | "epitaph"
  | "respawn"
  | "character_joins"
  | "council_start"
  | "plan_proposed"
  | "vote"
  | "council_result"
  | "inspect"
  | "give"
  | "journal"
  | "refusal"
  | "error"
  | "random_encounter"
  | "encounter_resolved"
  | "whisper"
  | "probe_result"
  | "retreat"
  | "loot_drop"
  | "loot_claim"
  | "identify"
  | "curse"
  | "ledger"
  | "bond"
  | "light"
  | "wandering"
  | "talent"
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
  runId: string;
  title: string;
  conditions: Conditions;
  day: number;
  scene: { id: string; title: string } | null;
  spotlight: string | null;
  turn: number;
  ended: boolean;
  combat: { round: number; order: { id: string; name: string; kind: "pc" | "monster" }[]; current: string | null } | null;
  council: { question: string; round: number; plans: { id: string; by: string; text: string; votes: number }[] } | null;
  party: Array<
    Pick<
      Character,
      "id" | "name" | "role" | "seat" | "klass" | "race" | "model" | "hp" | "maxHp" | "ac" | "level" | "xp" | "gold" | "slots" | "statuses" | "context" | "pendingLevelUp" | "zone" | "deathSaves"
    > & { spells: string[]; inventory: string[]; items: { name: string; value: number }[]; nextLevelXp: number | null; dead: boolean; dyingRounds?: number }
  >;
  loot: { items: { id: string; name: string; value: number }[]; gold: number };
  light: { dark: boolean; turns: number; torches: number } | null;
  encounter: { title: string; kind: string } | null;
  monsters: Array<Pick<Monster, "id" | "name" | "hp" | "maxHp" | "ac" | "zone">>;
  graveyard: GraveEntry[];
}
