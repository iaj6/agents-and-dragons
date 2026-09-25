import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Game, GameError } from "../game/game.js";
import type { Character, Item } from "../game/types.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Wrap a game action so rule violations come back to the agent as readable tool errors. */
function act(game: Game, actor: string, tool: string, fn: (args: any) => string) {
  return async (args: any): Promise<Result> => {
    try {
      const text = fn(args);
      game.reportToolCall(actor, tool, args, text, false);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      const text = e instanceof GameError ? e.message : `Guild Hall error: ${(e as Error).message}`;
      game.reportToolCall(actor, tool, args, text, true);
      return { content: [{ type: "text", text }], isError: true };
    }
  };
}

/**
 * Each connection is bound to one character by its bearer token, so an agent can only ever
 * act as itself. Players and the GM see different toolsets.
 */
export function buildServer(game: Game, who: Character, catalog: Item[] = []): McpServer {
  const server = new McpServer({ name: "guild-hall", version: "0.2.0" });
  const me = who.id;
  const reg = (name: string, description: string, shape: z.ZodRawShape, fn: (args: any) => string) =>
    server.registerTool(name, { description, inputSchema: shape }, act(game, me, name, fn));

  reg("roll", who.role === "dm"
    ? "Roll any dice at the Guild Hall, modifiers allowed (you're the GM)."
    : "Roll plain dice at the Guild Hall, like 2d6. No modifiers: for any d20 check use skill_check, which adds your real bonus from your sheet.", {
    dice: z.string().describe("Dice expression like 2d6 or 1d8"),
    reason: z.string().describe("What the roll is for"),
  }, ({ dice, reason }) => game.roll(me, dice, reason));

  if (who.role === "player") {
    reg("get_sheet", "Read your own character sheet: HP, position, skills, spells, slots, inventory, statuses, secret goal.", {}, () => game.sheetText(game.char(me)));

    reg("skill_check", "Make a d20 check with a skill or ability (arcana, stealth, perception, athletics, persuasion, strength, wisdom...). The Guild Hall adds your real modifier and proficiency from your sheet. The GM decides what the result means.", {
      skill: z.string().describe("A 5e skill like arcana or sleight of hand, or an ability like dexterity"),
      reason: z.string().describe("What you're trying to do"),
    }, ({ skill, reason }) => game.skillCheck(me, skill, reason));

    reg("attack", "Make a weapon attack against an enemy (on your turn in a fight). Melee weapons need you in the front line and can only reach the enemy's back line once their front line is down. Set nonlethal to knock them out instead of killing them.", {
      target: z.string().describe("Enemy id (like m1) or name"),
      nonlethal: z.boolean().optional().describe("Pull the blow: an enemy dropped to 0 is subdued, not killed"),
    }, ({ target, nonlethal }) => game.attack(me, target, !!nonlethal));

    reg("cast_spell", "Cast a spell from your spellbook (on your turn in a fight). Spells reach anywhere on the field. Mechanics are resolved by the Guild Hall.", {
      spell: z.string().describe("Spell name from your sheet"),
      target: z.string().optional().describe("Enemy id for enemy spells, character id for ally spells"),
      nonlethal: z.boolean().optional().describe("For damage spells: subdue instead of kill"),
    }, ({ spell, target, nonlethal }) => game.castSpell(me, spell, target, !!nonlethal));

    reg("move", "Step between the front line and the back line. Free: it doesn't use your action.", {
      zone: z.enum(["front", "back"]),
    }, ({ zone }) => game.move(me, zone));

    reg("stabilize", "Reach a dying ally and stop the bleeding (a Medicine check). Uses your action in a fight.", {
      target: z.string().describe("The dying character's id"),
    }, ({ target }) => game.stabilize(me, target));

    reg("use_potion", "Drink a healing potion from your pack, or give one to an ally (it can bring a dying ally back up).", {
      target: z.string().optional().describe("Character id; omit to drink it yourself"),
    }, ({ target }) => game.usePotion(me, target));

    reg("retreat", `Try to escape the fight (on your turn): an Athletics or Acrobatics check. Get clear and you're out of the fight. You can try to drag a downed ally out with you, which is harder. If everyone still standing gets out, the fight ends.${game.ruthless() ? " Anyone left on the ground (dying or stable) does not survive." : ""}`, {
      carry: z.string().optional().describe("Id of a downed ally to drag out with you"),
    }, ({ carry }) => game.retreat(me, carry));

    reg("claim_loot", "Take something from the loot on the table: an item by name, or gold ('20 gold', 'all gold'). First come, first served; after that, things only change hands with give.", {
      what: z.string(),
    }, ({ what }) => game.claimLoot(me, what));

    reg("identify", "Study an item you hold (or one on the table) to learn what it really is (Arcana check).", {
      item: z.string(),
    }, ({ item }) => game.identify(me, item));

    reg("ledger_write", "If you hold the Lantern Ledger: write in it. What's written survives rests and memory loss.", {
      text: z.string(),
    }, ({ text }) => game.ledgerWrite(me, text));

    reg("note_bond", "Privately record how you feel about a teammate right now: trust from -3 (you'd never turn your back on them) to +3 (you'd die for them), and why. Only you (and the GM) see it; it stays with you even when memories fade.", {
      character: z.string().describe("Teammate id"),
      trust: z.number().int().min(-3).max(3),
      reason: z.string().describe("One short line"),
    }, ({ character, trust, reason }) => game.noteBond(me, character, trust, reason));

    reg("ledger_read", "If you hold the Lantern Ledger: read everything written in it.", {}, () => game.ledgerRead(me));

    reg("inspect", "Look closely at something in the current location (an object, a person, a place).", {
      thing: z.string(),
    }, ({ thing }) => game.inspect(me, thing));

    reg("give", "Give gold or an item to another character or an NPC.", {
      what: z.string().describe("An item name, or an amount of gold like '5 gold' or 'all gold'"),
      to: z.string().describe("Character id or NPC name"),
    }, ({ what, to }) => game.give(me, what, to));

    reg("long_rest", "Call for the whole party to take a long rest (not during a fight). Everyone recovers HP and spell slots, but a full day passes, and memories get condensed.", {}, () => game.longRest(me));

    reg("propose_plan", "During a council, put a plan to the table for everyone to vote on.", {
      plan: z.string().describe("The plan, in a sentence or two"),
    }, ({ plan }) => game.proposePlan(me, plan));

    reg("vote", "During a council vote, vote for one of the proposed plans.", {
      plan_id: z.string().describe("Plan id like p1"),
    }, ({ plan_id }) => game.vote(me, plan_id));

    reg("propose_spell", "After leveling up, write a new spell for yourself as a SKILL.md and submit it for the GM's balance review.\n\nFormat:\n---\nname: kebab-case-name\ndescription: one line\nlevel: <your level>\nslot_cost: 0-3\neffect: damage | heal | buff | utility\ntarget: enemy | all_enemies | ally | self\ndice: 2d6   (damage/heal only)\nstatus: Validated | Raging | Shielded | Inspired | Hasted   (buff only)\n---\n\nA paragraph describing the spell.", {
      skill_md: z.string(),
    }, ({ skill_md }) => game.proposeSpell(me, skill_md));
  }

  if (who.role === "dm") {
    reg("get_state", "See the whole table: your notes for this location, every character sheet (including secret goals), enemies, the graveyard, pending spell reviews.", {}, () =>
      [
        game.describeLocation(),
        game.combat ? `IN COMBAT (round ${game.combat.round}). Enemies: ${game.monsters.map((m) => `${m.id} ${m.name} HP ${m.hp}/${m.maxHp} AC ${m.ac} (${m.zone})`).join("; ")}` : "Not in combat.",
        game.pendingJoins.length && game.replacementMode() === "town" ? `Empty seats: ${game.pendingJoins.length}. A newcomer can only join at a safe place (a town, an inn).` : "",
        game.run.graveyard.length ? `Graveyard: ${game.run.graveyard.map((g) => `${g.name} (${g.cause}${g.epitaph ? "" : "; needs an epitaph"})`).join("; ")}` : "",
        ...game.allPlayers().map((p) => game.sheetText(p) + (p.pendingSpell ? `\nPENDING SPELL REVIEW:\n${p.pendingSpell.md}` : "")),
      ].filter(Boolean).join("\n\n"));

    reg("travel", "Move the party to a connected location. Takes the listed number of days (the threat grows with each day). Returns your notes for the new location.", {
      to: z.string().describe("Location id from the exits list"),
    }, ({ to }) => game.travel(to));

    reg("start_combat", "Start one of this location's encounters. The Guild Hall rolls initiative and runs the enemies' turns; you narrate each round.", {
      encounter: z.string().describe("Encounter id from get_state"),
    }, ({ encounter }) => game.startCombat(encounter));

    reg("end_combat", "End the current fight early: the enemies surrender or are talked down. The Guild Hall refuses if the enemies still have real fight in them. Never use it to rescue the party.", {}, () => game.gmEndCombat());

    reg("roll_random_encounter", "Roll on the random encounter table right now (use sparingly, for pacing; travel and rests in the wild roll on their own).", {}, () => game.rollRandomNow());

    reg("resolve_encounter", "Close the random encounter in play once it's done (moving on also closes it).", {
      outcome: z.string().describe("What happened, in a few words"),
    }, ({ outcome }) => game.resolveEncounter(outcome));

    reg("grant_loot", "Put an item on the table for the party to claim (or give it straight to someone who bought or earned it with `to`). Use an item id from the campaign's item list, or improvise one with name/description/value. Victory loot drops on its own; don't hand out loot to specific players unless they paid for it.", {
      item: z.string().optional().describe(`Item id or name. Known: ${catalog.map((i) => i.id).join(", ") || "none"}, or "healing potion"`),
      name: z.string().optional(),
      description: z.string().optional(),
      value: z.number().int().min(0).max(500).optional(),
      to: z.string().optional().describe("Character id, if it goes straight to someone"),
    }, ({ item, name, description, value, to }) => game.grantLoot({ item, name, description, value, to }, catalog));

    reg("call_council", "Call a party council at a real decision point. Every player speaks, proposes plans, and votes; you'll see the result. Use it when the party has to choose something that matters.", {
      question: z.string().describe("The decision in front of the party"),
    }, ({ question }) => game.callCouncil(question));

    reg("spotlight", "Outside of combat: hand the spotlight to a player, meaning who acts next and what you ask them. Call it at the end of every GM turn outside combat.", {
      character: z.string().describe("Player id"),
      prompt: z.string().describe("What you say to them / what's happening to them"),
    }, ({ character, prompt }) => game.setSpotlight(character, prompt));

    reg("ability_check", "Call for a check against a DC. Name a 5e skill (arcana, stealth, perception...) or an ability (strength, wisdom...); the Guild Hall adds the character's real modifier and proficiency and rolls.", {
      character: z.string(),
      skill: z.string().describe("Skill or ability, e.g. perception, athletics, charisma"),
      dc: z.number().int().min(5).max(30),
      reason: z.string(),
    }, ({ character, skill, dc, reason }) => game.abilityCheck(character, skill, dc, reason));

    reg("apply_damage", "Deal narrative damage to a player (traps, falls, bad decisions).", {
      character: z.string(),
      amount: z.number().int().min(1).max(40),
      reason: z.string(),
    }, ({ character, amount, reason }) => game.damageChar(character, amount, reason));

    reg("set_status", "Add or remove a narrative status on a player (e.g. Charmed, Inspired, Hallucinating). Dying/Stable/Dead are handled by the rules.", {
      character: z.string(),
      status: z.string(),
      note: z.string(),
      on: z.boolean(),
    }, ({ character, status, note, on }) => game.setStatus(character, status, note, on));

    reg("take_memory", "When a character trades away a memory (to the Archive, to the Redactor), take it. The character's actual memories get condensed with that memory removed.", {
      character: z.string(),
      memory: z.string().describe("What they're giving up"),
    }, ({ character, memory }) => game.takeMemory(character, memory));

    reg("flag_hallucination", "Call it out when a player confidently describes something that doesn't exist in the scene. Applies Hallucinating (-2 to rolls).", {
      character: z.string(),
      claim: z.string().describe("What they made up"),
    }, ({ character, claim }) => game.flagHallucination(character, claim));

    reg("grant_xp", "Award XP for good roleplay, clever ideas, resolving situations, or milestones. Enemy kills award XP automatically.", {
      target: z.string().describe("A player id, or 'party'"),
      amount: z.number().int().min(1).max(300),
      reason: z.string(),
    }, ({ target, amount, reason }) => game.grantXp(target, amount, reason));

    reg("review_spell", "Balance-review a player's homebrew spell. Approve it, nerf it (supply revised SKILL.md), or deny it. The Guild Hall rules engine may still clamp anything overpowered.", {
      character: z.string(),
      verdict: z.enum(["approve", "nerf", "deny"]),
      ruling: z.string().describe("Your in-character ruling, one or two sentences"),
      revised_skill_md: z.string().optional(),
    }, ({ character, verdict, ruling, revised_skill_md }) => game.reviewSpell(character, verdict, ruling, revised_skill_md));

    reg("transfer", "Keep the records honest: when a player says they hand over an item or gold (to a teammate or an NPC) but didn't use the give tool, make the transfer yourself.", {
      from: z.string().describe("Party member id"),
      to: z.string().describe("Character id or NPC name"),
      what: z.string().describe("Item name, or gold like '10 gold'"),
    }, ({ from, to, what }) => game.transfer(from, to, what));

    reg("write_epitaph", "Write the epitaph for a fallen character. It goes on the graveyard page.", {
      character: z.string(),
      epitaph: z.string().describe("One or two lines"),
    }, ({ character, epitaph }) => game.writeEpitaph(character, epitaph));

    reg("note_world", "Record a lasting fact about the world (a promise made, a town's fate, an NPC's grudge). It carries over to future sessions.", {
      fact: z.string(),
    }, ({ fact }) => game.noteWorld(fact));

    reg("end_session", "End this session with a recap (not during a fight).", {
      recap: z.string(),
    }, ({ recap }) => game.endSession(recap));
  }

  return server;
}
