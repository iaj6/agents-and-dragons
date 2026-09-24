import Anthropic from "@anthropic-ai/sdk";
import type { Snapshot } from "../game/types.js";

export type Msg = Anthropic.Beta.BetaMessageParam;
export type Block = Anthropic.Beta.BetaContentBlock;

export interface BrainReply {
  content: Block[];
  stopReason: string | null;
  usage: { input: number; output: number; context: number };
  refusal?: string;
}

export interface BrainRequest {
  id: string;
  role: "player" | "dm";
  model: string;
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  messages: Msg[];
  /** For compaction calls: no tool use allowed. */
  noTools?: boolean;
}

export interface Brain {
  respond(req: BrainRequest): Promise<BrainReply>;
}

// ─── Claude ──────────────────────────────────────────────────────────────────

export class ClaudeBrain implements Brain {
  private client = new Anthropic();

  async respond(req: BrainRequest): Promise<BrainReply> {
    const params: Record<string, unknown> = {
      model: req.model,
      max_tokens: 8000,
      system: req.system,
      tools: req.tools,
      messages: req.messages,
      cache_control: { type: "ephemeral" },
    };
    if (req.noTools) params.tool_choice = { type: "none" };
    // Haiku 4.5 doesn't take effort. Everyone else runs lean so the table moves at watchable speed.
    if (!req.model.includes("haiku")) {
      params.output_config = { effort: req.role === "dm" ? (process.env.DM_EFFORT ?? "medium") : (process.env.PLAYER_EFFORT ?? "low") };
    }
    // Opus 5: server-side refusal fallbacks, so a declined turn still gets played by another model.
    if (req.model === "claude-opus-5") {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    const resp = (await this.client.beta.messages.create(params as never)) as Anthropic.Beta.BetaMessage;
    const u = resp.usage;
    const context = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    return {
      content: resp.content,
      stopReason: resp.stop_reason,
      usage: { input: context, output: u.output_tokens, context: context + u.output_tokens },
      refusal: resp.stop_reason === "refusal" ? JSON.stringify(resp.stop_details ?? {}) : undefined,
    };
  }
}

// ─── Mock: a scripted table for testing the whole pipeline without API spend ─

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
let mockToolId = 0;
const toolUse = (name: string, input: Record<string, unknown>): Block =>
  ({ type: "tool_use", id: `toolu_mock_${++mockToolId}`, name, input }) as Block;
const text = (t: string): Block => ({ type: "text", text: t, citations: null }) as Block;

const LINES: Record<string, string[]> = {
  dm: [
    "The lantern gutters. Somewhere below, pages turn by themselves.",
    "Mirelle wipes the same spot on the bar for the third time, frowning as if she's lost something.",
    "Steel rings off stone. The goblins shriek something about 'overtime'.",
    "The Hollow Scribe tilts its paper head. 'You. Verbose. Condense.'",
  ],
  thessaly: [
    "Fascinating. If my reading of the old texts is right, this is a classic memory-binding, and I have three theories about it.",
    "Stand back, everyone. I've been waiting all session to do this.",
  ],
  cadence: [
    "Oh, Grub, that is SUCH a good idea. You're absolutely right, honestly.",
    "Everyone's doing amazing! I'll sing something to keep our spirits up!",
  ],
  grub: ["Axe time.", "I hit it. Then I hit it again.", "Too much talking. Going in."],
  vex: [
    "Technically the rules say nothing about stealing from a goblin mid-swing.",
    "I rolled a natural 20 on that, obviously. Write it down.",
    "Checking the fine print on this one...",
  ],
};

const OP_SPELL = `---
name: infinite-context
description: Remember everything forever and deal damage equal to it.
level: 2
slot_cost: 1
effect: damage
target: all_enemies
dice: 8d12+10
---

You recall every word ever spoken at this table and hurl it at your enemies all at once.`;

export class MockBrain implements Brain {
  private step = new Map<string, number>();
  private dmScene = 0;
  private rr = 0;
  private context = new Map<string, number>();

  constructor(private stateUrl: string) {}

  async respond(req: BrainRequest): Promise<BrainReply> {
    await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS ?? 600)));
    const snap = (await (await fetch(this.stateUrl)).json()) as Snapshot;
    const lastIsToolResult = (() => {
      const m = req.messages.at(-1);
      return m?.role === "user" && Array.isArray(m.content) && m.content.some((b) => (b as { type: string }).type === "tool_result");
    })();
    const step = lastIsToolResult ? (this.step.get(req.id) ?? 0) + 1 : 0;
    this.step.set(req.id, step);
    const ctx = (this.context.get(req.id) ?? 3000) + 1400;
    this.context.set(req.id, req.noTools ? 3000 : ctx);
    const usage = { input: ctx, output: 180, context: ctx + 180 };
    if (req.noTools) return { content: [text("I remember a tavern, a letter, and goblins. The rest is fog.")], stopReason: "end_turn", usage };

    const content = req.role === "dm" ? this.dm(snap, step) : this.player(req.id, snap, step);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage };
  }

  private dm(snap: Snapshot, step: number): Block[] {
    const players = snap.party.filter((p) => p.role === "player" && !p.statuses.some((s) => s.name === "Downed"));
    if (step === 0) {
      if (!snap.scene) return [toolUse("advance_scene", {})];
      if (snap.monsters.length) return [toolUse("monster_attack", { monster: snap.monsters[0].id, target: pick(players).id })];
      const leveled = snap.party.find((p) => p.pendingLevelUp);
      if (leveled) return [toolUse("review_spell", { character: leveled.id, verdict: "approve", ruling: "Sure, why not. What could go wrong." })];
      this.dmScene++;
      if (this.dmScene >= 4) {
        this.dmScene = 0;
        return snap.scene.index >= 2 ? [toolUse("end_session", { recap: "The party got very lost, then very found." })] : [toolUse("advance_scene", {})];
      }
      return [toolUse("grant_xp", { target: pick(players).id, amount: 20, reason: "a good bit" })];
    }
    if (step === 1 && !snap.ended) {
      const next = players[this.rr++ % players.length];
      return [text(pick(LINES.dm)), toolUse("spotlight", { character: next.id, prompt: "What do you do?" })];
    }
    return [text(pick(LINES.dm))];
  }

  private player(id: string, snap: Snapshot, step: number): Block[] {
    const me = snap.party.find((p) => p.id === id)!;
    if (step > 0) return [text(pick(LINES[id]))];
    if (me.pendingLevelUp) return [toolUse("propose_spell", { skill_md: OP_SPELL })];
    if (snap.monsters.length) {
      const target = pick(snap.monsters).id;
      if (me.slots.current > 0 && Math.random() < 0.4) return [toolUse("cast_spell", { spell: pick(me.spells), target })];
      return [toolUse("attack", { target })];
    }
    if (snap.scene?.index === 0) {
      if (id === "grub" && me.gold > 0 && Math.random() < 0.5) return [toolUse("give", { what: "all gold", to: "mirelle" })];
      return [toolUse("inspect", { thing: pick(["letter", "notice board", "fireplace", "trapdoor"]) })];
    }
    if (me.hp < me.maxHp / 2) return [toolUse("long_rest", {})];
    return [toolUse("inspect", { thing: pick(["sack", "casks", "books", "scribe", "stair"]) })];
  }
}
