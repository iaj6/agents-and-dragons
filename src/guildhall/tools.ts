import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Game, GameError } from "../game/game.js";
import { STATS, type Character } from "../game/types.js";

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
 * act as itself. Players and the DM see different toolsets.
 */
export function buildServer(game: Game, who: Character): McpServer {
  const server = new McpServer({ name: "guild-hall", version: "0.1.0" });
  const me = who.id;
  const reg = (name: string, description: string, shape: z.ZodRawShape, fn: (args: any) => string) =>
    server.registerTool(name, { description, inputSchema: shape }, act(game, me, name, fn));

  reg("roll", "Roll dice at the Guild Hall (the only place dice can be rolled). Use for any free-form roll.", {
    dice: z.string().describe("Dice expression like d20, 1d20+3, 2d6"),
    reason: z.string().describe("What the roll is for"),
  }, ({ dice, reason }) => game.roll(me, dice, reason));

  if (who.role === "player") {
    reg("get_sheet", "Read your own character sheet: HP, spells, slots, inventory, statuses.", {}, () => game.sheetText(game.char(me)));

    reg("attack", "Make a weapon attack against a monster. The Guild Hall rolls to hit and damage.", {
      target: z.string().describe("Monster id (like m1) or name"),
    }, ({ target }) => game.attack(me, target));

    reg("cast_spell", "Cast a spell from your spellbook. Mechanics are resolved by the Guild Hall.", {
      spell: z.string().describe("Spell name from your sheet"),
      target: z.string().optional().describe("Monster id/name for enemy spells, character id for ally spells"),
    }, ({ spell, target }) => game.castSpell(me, spell, target));

    reg("inspect", "Look closely at something in the current scene (an object, a person, a place).", {
      thing: z.string(),
    }, ({ thing }) => game.inspect(me, thing));

    reg("give", "Give gold or an item to another character or an NPC.", {
      what: z.string().describe("An item name, or an amount of gold like '5 gold' or 'all gold'"),
      to: z.string().describe("Character id or NPC name"),
    }, ({ what, to }) => game.give(me, what, to));

    reg("long_rest", "Take a long rest (only when no enemies are around). Restores HP and slots, but your memories get condensed and you roll to see how well.", {}, () => game.longRest(me));

    reg("propose_spell", "After leveling up, write a new spell for yourself as a SKILL.md and submit it for the DM's balance review.\n\nFormat:\n---\nname: kebab-case-name\ndescription: one line\nlevel: <your level>\nslot_cost: 0-3\neffect: damage | heal | buff | utility\ntarget: enemy | all_enemies | ally | self\ndice: 2d6   (damage/heal only)\nstatus: Validated | Raging | Shielded | Inspired | Hasted   (buff only)\n---\n\nA paragraph describing the spell.", {
      skill_md: z.string(),
    }, ({ skill_md }) => game.proposeSpell(me, skill_md));
  }

  if (who.role === "dm") {
    reg("get_state", "See the whole table: every character sheet, monsters, scene, pending spell reviews.", {}, () =>
      [
        `Scene: ${game.sceneIndex >= 0 ? game.snapshot().scene?.title : "not started (call advance_scene to begin)"}`,
        `Monsters: ${game.monsters.map((m) => `${m.id} ${m.name} HP ${m.hp}/${m.maxHp} AC ${m.ac}`).join("; ") || "none"}`,
        ...game.players().map((p) => game.sheetText(p) + (p.pendingSpell ? `\nPENDING SPELL REVIEW:\n${p.pendingSpell.md}` : "")),
      ].join("\n\n"));

    reg("advance_scene", "Move to the next scene (also starts the session). Spawns that scene's monsters and returns your DM notes for it.", {}, () => game.advanceScene());

    reg("spotlight", "Hand the spotlight to a player: who acts next and what you ask them. Call this at the end of every DM turn.", {
      character: z.string().describe("Player id: thessaly, cadence, grub, vex"),
      prompt: z.string().describe("What you say to them / what's happening to them"),
    }, ({ character, prompt }) => game.setSpotlight(character, prompt));

    reg("monster_attack", "Have a monster attack a player. The Guild Hall rolls.", {
      monster: z.string(),
      target: z.string(),
    }, ({ monster, target }) => game.monsterAttack(monster, target));

    reg("ability_check", "Ask a character for an ability check against a DC. The Guild Hall rolls.", {
      character: z.string(),
      stat: z.enum(STATS as [string, ...string[]]),
      dc: z.number().int().min(5).max(30),
      reason: z.string(),
    }, ({ character, stat, dc, reason }) => game.abilityCheck(character, stat, dc, reason));

    reg("apply_damage", "Deal narrative damage to a player (traps, falls, bad decisions).", {
      character: z.string(),
      amount: z.number().int().min(1).max(30),
      reason: z.string(),
    }, ({ character, amount, reason }) => game.damageChar(character, amount, reason));

    reg("set_status", "Add or remove a status effect on a player (e.g. Charmed, Inspired, Hallucinating).", {
      character: z.string(),
      status: z.string(),
      note: z.string(),
      on: z.boolean(),
    }, ({ character, status, note, on }) => game.setStatus(character, status, note, on));

    reg("flag_hallucination", "Call it out when a player confidently describes something that doesn't exist in the scene. Applies Hallucinating (-2 to rolls).", {
      character: z.string(),
      claim: z.string().describe("What they made up"),
    }, ({ character, claim }) => game.flagHallucination(character, claim));

    reg("grant_xp", "Award XP for good roleplay, clever ideas, or milestones. Monster kills award XP automatically.", {
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

    reg("end_session", "End the session with a short recap.", {
      recap: z.string(),
    }, ({ recap }) => game.endSession(recap));
  }

  return server;
}
