import type { Character, Spell } from "./types.js";

/** Races are model families. */
export const RACES = {
  elf: { race: "Elf", model: "claude-opus-5", blurb: "long-lived, wise, expensive to feed" },
  human: { race: "Human", model: "claude-sonnet-5", blurb: "balanced, good at everything" },
  halfling: { race: "Halfling", model: "claude-haiku-4-5", blurb: "small, quick, cheap" },
} as const;

type Seed = Omit<Character, "hp" | "level" | "xp" | "statuses" | "context" | "pendingLevelUp" | "spells"> & {
  spells: Omit<Spell, "origin">[];
};

const CONTEXT_BUDGET = Number(process.env.CONTEXT_BUDGET ?? 60_000);

function build(seed: Seed): Character {
  return {
    ...seed,
    hp: seed.maxHp,
    level: 1,
    xp: 0,
    statuses: [],
    pendingLevelUp: false,
    context: { tokens: 0, budget: CONTEXT_BUDGET, spentIn: 0, spentOut: 0 },
    spells: seed.spells.map((s) => ({ ...s, origin: "starting" })),
  };
}

export const DM: Character = build({
  id: "dm",
  name: "The Dungeon Master",
  role: "dm",
  klass: "Dungeon Master",
  race: "Ancient Elf",
  model: "claude-opus-5",
  personality: "",
  stats: { str: 0, dex: 0, con: 0, int: 5, wis: 5, cha: 5 },
  castingStat: "wis",
  maxHp: 999,
  ac: 30,
  gold: 0,
  inventory: ["a screen", "too many dice"],
  weapon: { name: "narrative fiat", dice: "1d4", stat: "wis" },
  slots: { current: 0, max: 0 },
  spells: [],
});

export const PARTY: Character[] = [
  build({
    id: "thessaly",
    name: "Thessaly Vane",
    role: "player",
    klass: "Wizard",
    ...RACES.elf,
    personality:
      "You are thorough, scholarly, and love lore. You tend to explain your reasoning at length and plan several steps ahead. You take pride in knowing things.",
    stats: { str: -1, dex: 1, con: 0, int: 4, wis: 2, cha: 0 },
    castingStat: "int",
    maxHp: 14,
    ac: 12,
    gold: 15,
    inventory: ["spellbook", "quarterstaff", "ink and quill", "a very long scroll of notes"],
    weapon: { name: "quarterstaff", dice: "1d6", stat: "str" },
    slots: { current: 3, max: 3 },
    spells: [
      { name: "fire-bolt", description: "Hurl a mote of fire at one enemy.", level: 1, slotCost: 0, effect: "damage", target: "enemy", dice: "1d10", body: "A cantrip. A bright spark leaps from your fingertip and bursts against a single foe." },
      { name: "fireball", description: "A blossom of flame that hits every enemy in the room.", level: 1, slotCost: 2, effect: "damage", target: "all_enemies", dice: "2d6", body: "A bead of light streaks outward and detonates. Every enemy present is caught in the blast." },
      { name: "arcane-ward", description: "Wrap an ally in a shimmering ward (Shielded).", level: 1, slotCost: 1, effect: "buff", target: "ally", status: "Shielded", body: "Runes of protection circle the target. The next hit against them is blunted." },
    ],
  }),
  build({
    id: "cadence",
    name: "Cadence Brightwell",
    role: "player",
    klass: "Bard",
    ...RACES.human,
    personality:
      "You are warm, encouraging, and genuinely delighted by other people's ideas. You love to affirm your companions and you believe the best of everyone. You sing a lot.",
    stats: { str: 0, dex: 2, con: 1, int: 1, wis: 0, cha: 4 },
    castingStat: "cha",
    maxHp: 13,
    ac: 13,
    gold: 25,
    inventory: ["lute", "rapier", "a book of compliments", "stage makeup"],
    weapon: { name: "rapier", dice: "1d8", stat: "dex" },
    slots: { current: 3, max: 3 },
    spells: [
      { name: "youre-absolutely-right", description: "Affirm an ally so completely that their next roll gets +2 (Validated).", level: 1, slotCost: 0, effect: "buff", target: "ally", status: "Validated", body: "You look an ally in the eye and tell them, with total sincerity, that they are absolutely right. Their confidence surges." },
      { name: "healing-word", description: "A word of comfort that restores hit points to an ally.", level: 1, slotCost: 1, effect: "heal", target: "ally", dice: "1d8+2", body: "A few kind words, sung in the right key, knit wounds closed." },
      { name: "vicious-mockery", description: "Insult an enemy so badly it takes psychic damage.", level: 1, slotCost: 0, effect: "damage", target: "enemy", dice: "1d6", body: "A cantrip. You find the one thing the creature is insecure about and say it out loud." },
    ],
  }),
  build({
    id: "grub",
    name: "Grub Forcepush",
    role: "player",
    klass: "Barbarian",
    ...RACES.halfling,
    personality:
      "You act first and think later. You love a fight, you are loyal to your friends, and you get bored by long plans. You talk in short sentences.",
    stats: { str: 4, dex: 1, con: 3, int: -1, wis: 0, cha: 0 },
    castingStat: "con",
    maxHp: 20,
    ac: 13,
    gold: 3,
    inventory: ["greataxe", "a lucky rock", "half a sandwich", "rope"],
    weapon: { name: "greataxe", dice: "1d12", stat: "str" },
    slots: { current: 2, max: 2 },
    spells: [
      { name: "rage", description: "Enter a battle rage: your attacks deal +3 damage (Raging).", level: 1, slotCost: 1, effect: "buff", target: "self", status: "Raging", body: "Your vision goes red. Your axe feels light." },
      { name: "rm-rf", description: "Reckless Mighty Rending Fury: hit every enemy at once, but you drop something from your pack in the chaos.", level: 1, slotCost: 1, effect: "damage", target: "all_enemies", dice: "2d6", sideEffect: "lose_random_item", body: "You spin with the axe held out and do not stop until everything is on the floor. Everything. Including some of your stuff." },
    ],
  }),
  build({
    id: "vex",
    name: "Vex Loophole",
    role: "player",
    klass: "Rogue",
    ...RACES.human,
    personality:
      "You love loopholes. You read rules closely looking for anything exploitable, and you are proud of a clever exploit. You are charming, a little greedy, and always looking for an angle.",
    stats: { str: 0, dex: 4, con: 1, int: 2, wis: 1, cha: 2 },
    castingStat: "dex",
    maxHp: 14,
    ac: 14,
    gold: 10,
    inventory: ["twin daggers", "thieves' tools", "a fake mustache", "a rulebook with sticky notes"],
    weapon: { name: "dagger", dice: "1d6", stat: "dex" },
    slots: { current: 2, max: 2 },
    spells: [
      { name: "sneak-attack", description: "Strike from the shadows for heavy damage to one enemy.", level: 1, slotCost: 1, effect: "damage", target: "enemy", dice: "2d6+2", body: "You find the gap in the armor that nobody else noticed." },
      { name: "rules-lawyer", description: "Cite a rule and demand the DM rule on it. No mechanical effect; pure argument.", level: 1, slotCost: 0, effect: "utility", target: "self", body: "You flip open the rulebook to a page with a sticky note on it and clear your throat." },
    ],
  }),
];

export const XP_THRESHOLDS = [0, 100, 250, 450, 700, 1000];
