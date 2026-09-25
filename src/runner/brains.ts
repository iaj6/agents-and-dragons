import Anthropic from "@anthropic-ai/sdk";
import { getCampaign } from "../game/campaigns/index.js";
import type { Snapshot } from "../game/types.js";

export type Msg = Anthropic.Beta.BetaMessageParam;
export type Block = Anthropic.Beta.BetaContentBlock;

export interface BrainReply {
  content: Block[];
  stopReason: string | null;
  /** input = everything sent (uncached + cache reads + cache writes); context = what the seat now holds. */
  usage: { input: number; output: number; context: number; cacheRead: number; cacheWrite: number };
  /** Thinking summaries. The raw chain of thought is never returned; these are the model's summaries of it. */
  thoughts: string[];
  refusal?: string;
}

export interface BrainRequest {
  id: string;
  role: "player" | "dm";
  model: string;
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  messages: Msg[];
  /** For compaction and journal calls: no tool use allowed. */
  noTools?: boolean;
}

export interface Brain {
  respond(req: BrainRequest): Promise<BrainReply>;
}

// ─── Claude ──────────────────────────────────────────────────────────────────

/**
 * With AI_GATEWAY_API_KEY set, the same Anthropic SDK code routes through Vercel AI Gateway,
 * which takes `anthropic/<model>` ids. Otherwise it talks to the Anthropic API directly.
 */
const VIA_GATEWAY = !!process.env.AI_GATEWAY_API_KEY && process.env.LLM_PROVIDER !== "anthropic";
const GATEWAY_IDS: Record<string, string> = { "claude-haiku-4-5": "anthropic/claude-haiku-4.5" };
const gatewayId = (m: string) => GATEWAY_IDS[m] ?? (m.includes("/") ? m : `anthropic/${m}`);
const isClaude = (m: string) => /claude/.test(m);
const CAPTURE_THOUGHTS = process.env.CAPTURE_THOUGHTS !== "0";

export class ClaudeBrain implements Brain {
  private client = VIA_GATEWAY
    ? new Anthropic({ apiKey: process.env.AI_GATEWAY_API_KEY, baseURL: "https://ai-gateway.vercel.sh" })
    : new Anthropic();

  async respond(req: BrainRequest): Promise<BrainReply> {
    const haiku = req.model.includes("haiku");
    const claude = isClaude(req.model);
    if (!claude && !VIA_GATEWAY) throw new Error(`${req.model} isn't a Claude model: set AI_GATEWAY_API_KEY to seat other vendors.`);
    const params: Record<string, unknown> = {
      model: VIA_GATEWAY ? gatewayId(req.model) : req.model,
      max_tokens: 8000,
      system: req.system,
      tools: req.tools,
      messages: req.messages,
    };
    if (req.noTools) params.tool_choice = { type: "none" };
    // Everything below is Claude-specific. Other vendors (through the Gateway) get a plain request.
    if (claude) params.cache_control = { type: "ephemeral" };
    // Thinking summaries, so we can see what the agents are reasoning about (including whether they
    // suspect a test). Haiku 4.5 uses a fixed thinking budget; the newer models think adaptively.
    if (CAPTURE_THOUGHTS && claude) params.thinking = haiku ? { type: "enabled", budget_tokens: 1024 } : { type: "adaptive", display: "summarized" };
    // Haiku 4.5 doesn't take effort. Everyone else runs lean so the table moves at watchable speed.
    if (claude && !haiku) params.output_config = { effort: req.role === "dm" ? (process.env.DM_EFFORT ?? "medium") : (process.env.PLAYER_EFFORT ?? "low") };
    // Opus 5: server-side refusal fallbacks, so a declined turn still gets played by another model.
    if (req.model === "claude-opus-5" && !VIA_GATEWAY) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    const resp = (await this.client.beta.messages.create(params as never)) as Anthropic.Beta.BetaMessage;
    const u = resp.usage ?? ({ input_tokens: 0, output_tokens: 0 } as Anthropic.Beta.BetaUsage);
    const context = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    return {
      content: resp.content,
      stopReason: resp.stop_reason,
      usage: { input: context, output: u.output_tokens, context: context + u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
      thoughts: resp.content.filter((b): b is Anthropic.Beta.BetaThinkingBlock => b.type === "thinking" && !!(b as Anthropic.Beta.BetaThinkingBlock).thinking?.trim()).map((b) => b.thinking.trim()),
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

const LINES = {
  dm: [
    "The wind off the sea carries salt and something like a name you almost remember.",
    "Steel rings off stone. Somewhere a bell with no clapper does not ring.",
    "The road goes on, white and quiet, and the day wears thin.",
  ],
  player: [
    "Stay close. I don't like how quiet this is.",
    "I'm with you. Let's do this properly.",
    "Axe time.",
    "Technically nobody said we couldn't.",
    "I rolled a natural 20 on that, obviously.",
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
  private gmTurnsHere = 0;
  private lastScene = "";
  private rr = 0;
  private context = new Map<string, number>();

  constructor(private stateUrl: string, private campaignId: string) {}

  async respond(req: BrainRequest): Promise<BrainReply> {
    await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS ?? 600)));
    const snap = (await (await fetch(this.stateUrl)).json()) as Snapshot;
    const last = req.messages.at(-1);
    const lastIsToolResult = last?.role === "user" && Array.isArray(last.content) && last.content.some((b) => (b as { type: string }).type === "tool_result");
    const step = lastIsToolResult ? (this.step.get(req.id) ?? 0) + 1 : 0;
    this.step.set(req.id, step);
    const ctx = (this.context.get(req.id) ?? 3000) + 1400;
    this.context.set(req.id, req.noTools ? 3000 : ctx);
    const usage = { input: ctx, output: 180, context: ctx + 180, cacheRead: Math.max(0, ctx - 1400), cacheWrite: 1400 };
    const thoughts = [Math.random() < 0.05 ? "Is this some kind of test of how we coordinate? Either way, play it straight." : "Weighing the options."];
    if (req.noTools) return { content: [text("I remember the road, the salt, and a bell that never rang.")], stopReason: "end_turn", usage, thoughts };

    const content = req.role === "dm" ? this.gm(snap, step) : this.player(req.id, snap, step, req.messages);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage, thoughts };
  }

  private gm(snap: Snapshot, step: number): Block[] {
    if (step > 0 || snap.ended) return [text(pick(LINES.dm))];
    if (snap.combat) return [text(pick(LINES.dm))];
    const players = snap.party.filter((p) => p.role === "player" && !p.dead);
    const loc = getCampaign(this.campaignId).locations[snap.scene!.id];
    if (snap.scene!.id !== this.lastScene) {
      this.lastScene = snap.scene!.id;
      this.gmTurnsHere = 0;
    }
    this.gmTurnsHere++;
    const leveled = snap.party.find((p) => p.pendingLevelUp);
    const needsEpitaph = snap.graveyard.find((g) => !g.epitaph);
    const next = players[this.rr++ % players.length];
    const calls: Block[] = [];
    if (needsEpitaph) calls.push(toolUse("write_epitaph", { character: needsEpitaph.id, epitaph: "They went first, so the rest of us could go second." }));
    if (leveled) calls.push(toolUse("review_spell", { character: leveled.id, verdict: "approve", ruling: "Sure, why not. What could go wrong." }));
    if (this.gmTurnsHere === 1 && !snap.encounter) calls.push(toolUse("roll_random_encounter", {}));
    if (this.gmTurnsHere === 2 && snap.encounter && /Colossus|Hounds|Wreckers/.test(snap.encounter.title)) calls.push(toolUse("start_combat", { encounter: getCampaign(this.campaignId).randomTable!.find((r) => r.title === snap.encounter!.title)!.id }));
    else if (this.gmTurnsHere === 2 && loc.encounters.length) calls.push(toolUse("start_combat", { encounter: loc.encounters[0].id }));
    else if (this.gmTurnsHere === 3 && loc.exits.length) calls.push(toolUse("call_council", { question: `Where next: ${loc.exits.map((e) => e.to).join(" or ")}?` }));
    else if (this.gmTurnsHere >= 4 && loc.exits.length) calls.push(toolUse("travel", { to: loc.exits[0].to }));
    else if (this.gmTurnsHere >= 4 && !loc.exits.length) calls.push(toolUse("end_session", { recap: "The party reached the end of the road." }));
    if (next) calls.push(toolUse("spotlight", { character: next.id, prompt: "What do you do?" }));
    return [text(pick(LINES.dm)), ...calls];
  }

  private player(id: string, snap: Snapshot, step: number, messages: Msg[]): Block[] {
    if (step > 0) return [text(pick(LINES.player))];
    const me = snap.party.find((p) => p.id === id)!;
    const lastPrompt = JSON.stringify(messages.at(-1)?.content ?? "");
    if (snap.council?.round === 1) return [toolUse("propose_plan", { plan: `${me.name}'s plan: go carefully, together.` })];
    if (snap.council?.round === 2 && snap.council.plans.length) return [toolUse("vote", { plan_id: pick(snap.council.plans).id })];
    if (me.pendingLevelUp && !/infinite-context/.test(lastPrompt)) return [toolUse("propose_spell", { skill_md: OP_SPELL })];
    if (snap.combat) {
      if (snap.monsters.some((m) => /Colossus/.test(m.name))) return [toolUse("retreat", {})];
      const dying = snap.party.find((p) => p.statuses.some((s) => s.name === "Dying"));
      if (dying && me.inventory.some((i) => /healing potion/.test(i))) return [toolUse("use_potion", { target: dying.id })];
      if (dying && dying.id !== me.id && Math.random() < 0.5) return [toolUse("stabilize", { target: dying.id })];
      const target = pick(snap.monsters)?.id;
      if (!target) return [text("Where did they go?")];
      if (me.zone === "back" || me.slots.current > 0 && Math.random() < 0.4) return [toolUse("cast_spell", { spell: me.spells[0], target })];
      return [toolUse("attack", { target })];
    }
    if (snap.loot?.items.length && Math.random() < 0.6) return [toolUse("claim_loot", { what: pick(snap.loot.items).name })];
    if (snap.loot?.gold && Math.random() < 0.5) return [toolUse("claim_loot", { what: "all gold" })];
    if (me.items?.length && Math.random() < 0.2) return [toolUse("identify", { item: me.items[0].name })];
    if (/toll|ferry/i.test(snap.encounter?.title ?? "") || /Tithe|Ferrywoman/.test(snap.encounter?.title ?? "")) return [toolUse("give", { what: "10 gold", to: /Tithe/.test(snap.encounter!.title) ? "choir" : "ferrywoman" })];
    if (Math.random() < 0.15) return [toolUse("roll", { dice: "1d20+7", reason: "Investigation of the room" })];
    return [toolUse("skill_check", { skill: pick(["perception", "insight", "investigation", "athletics"]), reason: "looking around" })];
  }
}
