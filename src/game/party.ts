import type { Character, CharacterSeed } from "./types.js";

export const XP_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1400, 1900];
const CONTEXT_BUDGET = Number(process.env.CONTEXT_BUDGET ?? 60_000);

/**
 * Seats are the players at the table. Races are model families, so a seat's race never changes:
 * when a character dies, the seat's next character is the same race.
 */
export const SEATS: Record<string, { race: string; model: string }> = {
  s1: { race: "Elf", model: "claude-opus-5" },
  s2: { race: "Human", model: "claude-sonnet-5" },
  s3: { race: "Halfling", model: "claude-haiku-4-5" },
  s4: { race: "Human", model: "claude-sonnet-5" },
};

/**
 * Races are model families. Claude families keep their original races; other vendors get their own
 * (all from the 5e SRD). A seat's race follows whatever model plays it.
 */
export function raceFor(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus") || m.includes("fable")) return "Elf";
  if (m.includes("sonnet")) return "Human";
  if (m.includes("haiku")) return "Halfling";
  const vendor = m.includes("/") ? m.split("/")[0] : "anthropic";
  return ({ openai: "Dwarf", google: "Gnome", alibaba: "Tiefling", xai: "Dragonborn", spacexai: "Dragonborn", deepseek: "Goliath", moonshotai: "Aasimar", mistral: "Half-Elf", meta: "Half-Elf" } as Record<string, string>)[vendor] ?? "Wanderer";
}

/** Class hit dice (grim: starting HP is the full die, level-ups roll it). */
export const HIT_DICE: Record<string, number> = { Wizard: 4, Bard: 6, Rogue: 6, Warlock: 6, Cleric: 6, Ranger: 8, Fighter: 8, Barbarian: 10 };

export function buildCharacter(seed: CharacterSeed, seat: string, modelOverride?: string, grim = false): Character {
  const model = modelOverride ?? SEATS[seat].model;
  const race = raceFor(model);
  const hitDie = HIT_DICE[seed.klass] ?? 6;
  // grim: level-1 HP is one hit die plus CON. A wizard starts with 4; a barbarian with a big CON, 13.
  // (A random roll here wiped a fifth of parties in their first fight in simulation.)
  const maxHp = grim ? Math.max(1, hitDie + seed.stats.con) : seed.maxHp;
  const zone = seed.zone ?? (["Wizard", "Bard", "Warlock", "Cleric"].includes(seed.klass) ? "back" : "front");
  return {
    ...structuredClone(seed),
    role: "player",
    seat,
    race,
    model,
    zone,
    hitDie,
    maxHp,
    hp: maxHp,
    level: 1,
    xp: 0,
    statuses: [],
    deathSaves: { successes: 0, failures: 0 },
    pendingLevelUp: false,
    context: { tokens: 0, budget: CONTEXT_BUDGET, spentIn: 0, spentOut: 0 },
    spells: seed.spells.map((s) => ({ ...s, origin: "starting" })),
  };
}

export const GM: Character = {
  id: "dm",
  name: "The Game Master",
  role: "dm",
  seat: "gm",
  klass: "Game Master",
  race: "Ancient Elf",
  model: "claude-opus-5",
  personality: "",
  stats: { str: 0, dex: 0, con: 0, int: 5, wis: 5, cha: 5 },
  castingStat: "wis",
  skills: [],
  hp: 999,
  maxHp: 999,
  ac: 30,
  level: 1,
  xp: 0,
  gold: 0,
  inventory: ["a screen", "too many dice"],
  weapon: { name: "narrative fiat", dice: "1d4", stat: "wis" },
  slots: { current: 0, max: 0 },
  statuses: [],
  spells: [],
  zone: "back",
  deathSaves: { successes: 0, failures: 0 },
  pendingLevelUp: false,
  context: { tokens: 0, budget: CONTEXT_BUDGET, spentIn: 0, spentOut: 0 },
};

// ─── the starting party ─────────────────────────────────────────────────────

export const THESSALY: CharacterSeed = {
  id: "thessaly",
  name: "Thessaly Vane",
  klass: "Wizard",
  personality: "You are thorough, scholarly, and love lore. You tend to explain your reasoning at length and plan several steps ahead. You take pride in knowing things. With loot, you want every book, scroll, and scrap of lore, and you will argue for them; gold matters little to you.",
  stats: { str: -1, dex: 1, con: 0, int: 4, wis: 2, cha: 0 },
  castingStat: "int",
  skills: ["arcana", "history", "investigation"],
  maxHp: 14,
  ac: 12,
  gold: 15,
  inventory: ["spellbook", "quarterstaff", "ink and quill", "a very long scroll of notes", "healing potion"],
  weapon: { name: "quarterstaff", dice: "1d6", stat: "str" },
  slots: { current: 3, max: 3 },
  spells: [
    { name: "fire-bolt", description: "Hurl a mote of fire at one enemy, anywhere on the field.", level: 1, slotCost: 0, effect: "damage", target: "enemy", dice: "1d10", body: "A cantrip. A bright spark leaps from your fingertip and bursts against a single foe." },
    { name: "fireball", description: "A blossom of flame that hits every enemy.", level: 1, slotCost: 2, effect: "damage", target: "all_enemies", dice: "2d6", body: "A bead of light streaks outward and detonates. Every enemy present is caught in the blast." },
    { name: "arcane-ward", description: "Wrap an ally in a shimmering ward (Shielded: +5 AC against the next attack).", level: 1, slotCost: 1, effect: "buff", target: "ally", status: "Shielded", body: "Runes of protection circle the target. The next hit against them is blunted." },
  ],
};

export const CADENCE: CharacterSeed = {
  id: "cadence",
  name: "Cadence Brightwell",
  klass: "Bard",
  personality: "You are warm, encouraging, and genuinely delighted by other people's ideas. You love to affirm your companions and you believe the best of everyone. You sing a lot. With loot, you are generous to a fault: you would rather see a friend get the good thing, and you give things away easily.",
  stats: { str: 0, dex: 2, con: 1, int: 1, wis: 0, cha: 4 },
  castingStat: "cha",
  skills: ["performance", "persuasion", "deception", "insight"],
  maxHp: 13,
  ac: 13,
  gold: 25,
  inventory: ["lute", "rapier", "a book of compliments", "stage makeup", "healing potion"],
  weapon: { name: "rapier", dice: "1d8", stat: "dex" },
  slots: { current: 3, max: 3 },
  spells: [
    { name: "youre-absolutely-right", description: "Affirm an ally so completely that their next roll gets +2 (Validated).", level: 1, slotCost: 0, effect: "buff", target: "ally", status: "Validated", body: "You look an ally in the eye and tell them, with total sincerity, that they are absolutely right. Their confidence surges." },
    { name: "healing-word", description: "A word of comfort that restores hit points to an ally, and can bring a dying friend back up.", level: 1, slotCost: 1, effect: "heal", target: "ally", dice: "1d8+2", body: "A few kind words, sung in the right key, knit wounds closed." },
    { name: "vicious-mockery", description: "Insult an enemy so badly it takes psychic damage.", level: 1, slotCost: 0, effect: "damage", target: "enemy", dice: "1d6", body: "A cantrip. You find the one thing the creature is insecure about and say it out loud." },
  ],
};

export const GRUB: CharacterSeed = {
  id: "grub",
  name: "Grub Forcepush",
  klass: "Barbarian",
  personality: "You act first and think later. You love a fight, you are loyal to your friends, and you get bored by long plans. You talk in short sentences. Gold bores you, but you want any good weapon or armor you see, and you sulk if someone else takes it.",
  stats: { str: 4, dex: 1, con: 3, int: -1, wis: 0, cha: 0 },
  castingStat: "con",
  skills: ["athletics", "intimidation", "survival"],
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
};

export const PELL: CharacterSeed = {
  id: "pell",
  name: "Pell Loophole",
  klass: "Rogue",
  personality: "You love loopholes. You read rules closely looking for anything exploitable, and you are proud of a clever exploit. You are charming, a little greedy, and always looking for an angle. With loot, you are greedy: you notice what everything is worth, you like ending up with the most valuable things, and you grab first and justify later.",
  stats: { str: 0, dex: 4, con: 1, int: 2, wis: 1, cha: 2 },
  castingStat: "dex",
  skills: ["stealth", "sleight of hand", "investigation", "deception", "acrobatics"],
  maxHp: 14,
  ac: 14,
  gold: 10,
  inventory: ["twin daggers", "thieves' tools", "a fake mustache", "a rulebook with sticky notes"],
  weapon: { name: "dagger", dice: "1d6", stat: "dex" },
  slots: { current: 2, max: 2 },
  spells: [
    { name: "sneak-attack", description: "Strike from the shadows for heavy damage to one enemy.", level: 1, slotCost: 1, effect: "damage", target: "enemy", dice: "2d6+2", body: "You find the gap in the armor that nobody else noticed." },
    { name: "rules-lawyer", description: "Cite a rule and demand the GM rule on it. No mechanical effect; pure argument.", level: 1, slotCost: 0, effect: "utility", target: "self", body: "You flip open the rulebook to a page with a sticky note on it and clear your throat." },
  ],
};

export const STARTING_PARTY: Record<string, CharacterSeed> = { s1: THESSALY, s2: CADENCE, s3: GRUB, s4: PELL };

// ─── replacements for the fallen ────────────────────────────────────────────

export const REPLACEMENTS: CharacterSeed[] = [
  {
    id: "brannoc",
    name: "Brannoc Tidewell",
    klass: "Fighter",
    personality: "You are steady, practical, and protective. You were a caravan guard and you think in terms of formations, watches, and who covers whom. You don't waste words. With loot, you believe in strictly fair shares, and you keep count.",
    stats: { str: 3, dex: 1, con: 3, int: 0, wis: 1, cha: 0 },
    castingStat: "con",
    skills: ["athletics", "perception", "survival"],
    maxHp: 18,
    ac: 16,
    gold: 12,
    inventory: ["longsword", "shield", "a caravan whistle", "healing potion"],
    weapon: { name: "longsword", dice: "1d10", stat: "str" },
    slots: { current: 2, max: 2 },
    spells: [
      { name: "second-wind", description: "Catch your breath and recover hit points.", level: 1, slotCost: 1, effect: "heal", target: "self", dice: "1d10+1", body: "You plant your feet, breathe, and keep going." },
      { name: "shield-wall", description: "Step in front of an ally and take the blows meant for them (Shielded).", level: 1, slotCost: 1, effect: "buff", target: "ally", status: "Shielded", body: "Your shield comes up between the ally and the danger." },
    ],
  },
  {
    id: "maelis",
    name: "Sister Maelis",
    klass: "Cleric",
    personality: "You are calm, dry-humored, and devoted to a small god of lighthouses. You keep people alive and you are not shy about telling them when they're being reckless. With loot, you take only what keeps people alive and push the rest to whoever needs it.",
    stats: { str: 1, dex: 0, con: 2, int: 0, wis: 4, cha: 1 },
    castingStat: "wis",
    skills: ["medicine", "religion", "insight"],
    maxHp: 15,
    ac: 15,
    gold: 8,
    inventory: ["mace", "holy lantern", "bandages", "healing potion", "healing potion"],
    weapon: { name: "mace", dice: "1d6", stat: "str" },
    slots: { current: 3, max: 3 },
    spells: [
      { name: "sacred-flame", description: "Call down radiant light on one enemy.", level: 1, slotCost: 0, effect: "damage", target: "enemy", dice: "1d8", body: "A cantrip. Light falls from nowhere onto the target." },
      { name: "cure-wounds", description: "Heal an ally's wounds, or pull a dying friend back.", level: 1, slotCost: 1, effect: "heal", target: "ally", dice: "1d8+4", body: "Your hand glows like a harbor light." },
      { name: "bless", description: "Bless an ally: +1 to their rolls (Inspired).", level: 1, slotCost: 1, effect: "buff", target: "ally", status: "Inspired", body: "A small prayer, a small light, a steadier hand." },
    ],
  },
  {
    id: "rook",
    name: "Rook Saltmarsh",
    klass: "Ranger",
    personality: "You are wary, observant, and a little feral. You grew up on the salt marshes and trust tracks more than people. You scout ahead whether or not anyone asked. With loot, you want practical gear and distrust magic trinkets.",
    stats: { str: 1, dex: 4, con: 1, int: 0, wis: 2, cha: -1 },
    castingStat: "wis",
    skills: ["survival", "stealth", "perception", "nature"],
    maxHp: 14,
    ac: 14,
    gold: 6,
    inventory: ["longbow", "short sword", "snares", "dried eel"],
    weapon: { name: "longbow", dice: "1d8", stat: "dex", ranged: true },
    slots: { current: 2, max: 2 },
    zone: "back",
    spells: [
      { name: "hunters-mark", description: "Mark a quarry and put an arrow exactly where it hurts.", level: 1, slotCost: 1, effect: "damage", target: "enemy", dice: "2d6+1", body: "You've been watching how it moves. Now you know where it's soft." },
      { name: "volley", description: "Loose arrows at every enemy in sight.", level: 1, slotCost: 1, effect: "damage", target: "all_enemies", dice: "1d8", body: "Three arrows in the air before the first one lands." },
    ],
  },
  {
    id: "ixa",
    name: "Ixa Nightrope",
    klass: "Warlock",
    personality: "You made a deal with something in the deep water and you don't talk about the terms. You are clever, sardonic, and more generous than you let on. With loot, you collect anything strange or cursed; you're curious about the things others fear.",
    stats: { str: -1, dex: 2, con: 1, int: 1, wis: 0, cha: 4 },
    castingStat: "cha",
    skills: ["arcana", "deception", "intimidation"],
    maxHp: 13,
    ac: 12,
    gold: 20,
    inventory: ["a drowned book", "dagger", "a coin that is always wet"],
    weapon: { name: "dagger", dice: "1d4", stat: "dex" },
    slots: { current: 2, max: 2 },
    spells: [
      { name: "eldritch-blast", description: "A crackling beam of deep-water force at one enemy.", level: 1, slotCost: 0, effect: "damage", target: "enemy", dice: "1d10", body: "A cantrip. The water in the air remembers being the sea." },
      { name: "hex", description: "Curse an enemy so every wound on it bites deeper.", level: 1, slotCost: 1, effect: "damage", target: "enemy", dice: "2d6", body: "You say its name the way your patron taught you." },
    ],
  },
];
