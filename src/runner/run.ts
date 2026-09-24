import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAMPAIGN_PITCH } from "../game/campaign.js";
import { DM, PARTY } from "../game/party.js";
import { Agent } from "./agent.js";
import { ClaudeBrain, MockBrain, type Brain } from "./brains.js";
import { CodeSeat } from "./code-seat.js";
import { Hall } from "./hall.js";
import { dmSystem, playerSystem } from "./prompts.js";
import { UsageLimitError, type Seat } from "./seat.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MOCK = process.argv.includes("--mock");
const BASE = process.env.GUILDHALL_URL ?? `http://localhost:${process.env.GUILDHALL_PORT ?? 4777}`;
const MAX_TURNS = Number(process.env.MAX_TURNS ?? (MOCK ? 60 : 50));
/** Optional: force every seat onto one model for cheap test runs, e.g. MODEL_OVERRIDE=claude-haiku-4-5 */
const MODEL_OVERRIDE = process.env.MODEL_OVERRIDE;
/** Optional: a different model for the Game Master only, e.g. GM_MODEL=claude-sonnet-5 */
const GM_MODEL = process.env.GM_MODEL;
/**
 * Which seats run as headless Claude Code on your subscription instead of the API:
 * unset/"api" = none, "code" = all, or a comma list of seat ids like "dm,grub".
 */
const SEATS = (process.env.SEATS ?? "api").trim();
const GM_COMPACT_AT = Number(process.env.GM_COMPACT_AT ?? 30_000);
const MONSTER_ACTIONS = Number(process.env.MONSTER_ACTIONS ?? 2);

const onCode = (id: string) => !MOCK && (SEATS === "code" || (SEATS !== "api" && SEATS.split(",").map((s) => s.trim()).includes(id)));

const hall = new Hall(BASE);
const brain: Brain = MOCK ? new MockBrain(`${BASE}/api/state`) : new ClaudeBrain();

const session = await (await fetch(`${BASE}/api/session`, { method: "POST" })).json() as { sessionId: string; runnerToken: string; tokens: Record<string, string> };
hall.token = session.runnerToken;
const sessionDir = path.join(ROOT, "data", "sessions", session.sessionId);

function seat(id: string, name: string, role: "player" | "dm", model: string, system: string): Seat {
  return onCode(id)
    ? new CodeSeat(id, name, role, model, system, session.tokens[id], hall, sessionDir)
    : new Agent(id, name, role, model, system, session.tokens[id], brain, hall);
}

const dm = seat("dm", DM.name, "dm", MODEL_OVERRIDE ?? GM_MODEL ?? DM.model, dmSystem(MAX_TURNS));
const players = PARTY.map((p) => seat(p.id, p.name, "player", MODEL_OVERRIDE ?? p.model, playerSystem(p)));
const seats = [dm, ...players];
await Promise.all(seats.map((a) => a.connect(`${BASE}/mcp`)));
console.log(
  `[runner] ${session.sessionId}${MOCK ? " (mock brains)" : ""} → watch at ${BASE}\n` +
    seats.map((s) => `  ${s.id.padEnd(9)} ${s.model.padEnd(18)} ${s instanceof CodeSeat ? "claude code (subscription)" : MOCK ? "mock" : "api"}`).join("\n"),
);

async function readTable(a: Seat): Promise<string> {
  const t = await hall.get<{ lines: string[]; lastSeq: number }>(`/api/transcript?since=${a.lastSeq}`);
  a.lastSeq = t.lastSeq;
  return t.lines.length ? `What happened at the table since your last turn:\n${t.lines.join("\n")}` : "";
}

async function settleCompactions() {
  for (const a of seats) {
    const p = await hall.get<{ pendingCompaction: { reason: "long_rest" | "summarized"; roll: number } | null }>(`/api/private?id=${a.id}`);
    if (p.pendingCompaction) await a.compact(p.pendingCompaction.reason, p.pendingCompaction.roll);
  }
  // The GM keeps a running log instead of an ever-growing transcript: the biggest single cost saver.
  if (dm.contextTokens > GM_COMPACT_AT) await dm.compact("gm_notes", 20);
}

async function play() {
  let turn = 0;
  let rr = 0;
  const DM_KICKOFF = `The players are seated. ${CAMPAIGN_PITCH}\n\nBegin the session: call advance_scene, set the scene in your narration, and spotlight a player.`;

  while (turn < MAX_TURNS + 2) {
    // ── Monsters act on their own, then the GM ──
    await hall.post("/api/monsters-act", { max: MONSTER_ACTIONS });
    turn++;
    await hall.post("/api/turn", { actor: "dm" });
    const left = MAX_TURNS - turn;
    let dmPrompt = turn === 1 ? DM_KICKOFF : await readTable(dm);
    if (turn > 1) {
      dmPrompt += `\n\n(${left > 0 ? `About ${left} turns left in the session.` : "Out of time: wrap up now and call end_session."})`;
      const reviews = await Promise.all(PARTY.map((p) => hall.get<{ hasPendingSpell: boolean }>(`/api/private?id=${p.id}`).then((r) => (r.hasPendingSpell ? p.id : null))));
      const waiting = reviews.filter(Boolean);
      if (waiting.length) dmPrompt += `\n(Homebrew spells awaiting your balance review from: ${waiting.join(", ")}. Read them with get_state.)`;
    } else dm.lastSeq = (await hall.get<{ lastSeq: number }>(`/api/transcript?since=999999`)).lastSeq;
    const narration = await dm.takeTurn(dmPrompt);
    if (narration) await hall.post("/api/narration", { text: narration });
    await settleCompactions();

    const sp = await hall.post<{ spotlight: { id: string; prompt: string } | null; ended: boolean }>("/api/spotlight/clear");
    if (sp.ended) return turn;

    // ── Player turn ──
    const state = (await (await fetch(`${BASE}/api/state`)).json()) as { party: { id: string; statuses: { name: string }[] }[] };
    const up = (id: string) => !state.party.find((p) => p.id === id)?.statuses.some((s) => s.name === "Downed");
    let actor = sp.spotlight && up(sp.spotlight.id) ? players.find((p) => p.id === sp.spotlight!.id) : undefined;
    for (let i = 0; i < players.length && !actor; i++) {
      const cand = players[rr++ % players.length];
      if (up(cand.id)) actor = cand;
    }
    if (!actor) continue; // everyone is down; the GM will notice
    if ((await hall.post<{ skipped: boolean }>("/api/consume-ratelimit", { actor: actor.id })).skipped) continue;

    turn++;
    await hall.post("/api/turn", { actor: actor.id });
    const priv = await hall.get<{ pendingLevelUp: boolean; hasPendingSpell: boolean }>(`/api/private?id=${actor.id}`);
    let prompt = await readTable(actor);
    prompt += `\n\nIt's your turn. ${sp.spotlight?.id === actor.id ? `The GM says to you: "${sp.spotlight.prompt}"` : "The GM looks to you."}`;
    if (priv.pendingLevelUp && !priv.hasPendingSpell) {
      prompt += `\n\n(You leveled up! This turn, also write yourself a new spell as a SKILL.md and submit it with propose_spell. The GM will balance-review it. Make it fit your character.)`;
    }
    const speech = await actor.takeTurn(prompt);
    if (speech) await hall.post("/api/speech", { actor: actor.id, text: speech });
    await settleCompactions();
  }
  return turn;
}

try {
  const turns = await play();
  console.log(`[runner] session over after ${turns} turns.`);
} catch (e) {
  if (!(e instanceof UsageLimitError)) throw e;
  await hall.post("/api/usage-limit", { detail: e.message });
  console.log(`[runner] subscription usage window spent, session paused: ${e.message}`);
} finally {
  await Promise.all(seats.map((a) => a.close()));
}
