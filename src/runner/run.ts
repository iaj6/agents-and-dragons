import { CAMPAIGN_PITCH } from "../game/campaign.js";
import { DM, PARTY } from "../game/party.js";
import { Agent } from "./agent.js";
import { ClaudeBrain, MockBrain, type Brain } from "./brains.js";
import { Hall } from "./hall.js";
import { dmSystem, playerSystem } from "./prompts.js";

const MOCK = process.argv.includes("--mock");
const BASE = process.env.GUILDHALL_URL ?? `http://localhost:${process.env.GUILDHALL_PORT ?? 4777}`;
const MAX_TURNS = Number(process.env.MAX_TURNS ?? (MOCK ? 60 : 50));
/** Optional: force every seat onto one model for cheap test runs, e.g. MODEL_OVERRIDE=claude-haiku-4-5 */
const MODEL_OVERRIDE = process.env.MODEL_OVERRIDE;

const hall = new Hall(BASE);
const brain: Brain = MOCK ? new MockBrain(`${BASE}/api/state`) : new ClaudeBrain();

const session = await (await fetch(`${BASE}/api/session`, { method: "POST" })).json() as { sessionId: string; runnerToken: string; tokens: Record<string, string> };
hall.token = session.runnerToken;
console.log(`[runner] ${session.sessionId} ${MOCK ? "(mock brains)" : ""} → watch at ${BASE}`);

const dm = new Agent("dm", DM.name, "dm", MODEL_OVERRIDE ?? DM.model, dmSystem(MAX_TURNS), session.tokens.dm, brain, hall);
const players = PARTY.map((p) => new Agent(p.id, p.name, "player", MODEL_OVERRIDE ?? p.model, playerSystem(p), session.tokens[p.id], brain, hall));
const seats = [dm, ...players];
await Promise.all(seats.map((a) => a.connect(`${BASE}/mcp`)));

async function readTable(a: Agent): Promise<string> {
  const t = await hall.get<{ lines: string[]; lastSeq: number }>(`/api/transcript?since=${a.lastSeq}`);
  a.lastSeq = t.lastSeq;
  return t.lines.length ? `What happened at the table since your last turn:\n${t.lines.join("\n")}` : "";
}

async function settleCompactions() {
  for (const a of seats) {
    const p = await hall.get<{ pendingCompaction: { reason: "long_rest" | "summarized"; roll: number } | null }>(`/api/private?id=${a.id}`);
    if (p.pendingCompaction) await a.compact(p.pendingCompaction.reason, p.pendingCompaction.roll);
  }
}

let turn = 0;
let rr = 0;
let ended = false;
const DM_KICKOFF = `The players are seated. ${CAMPAIGN_PITCH}\n\nBegin the session: call advance_scene, set the scene in your narration, and spotlight a player.`;

while (!ended && turn < MAX_TURNS + 2) {
  // ── DM turn ──
  turn++;
  await hall.post("/api/turn", { actor: "dm" });
  const left = MAX_TURNS - turn;
  let dmPrompt = turn === 1 ? DM_KICKOFF : await readTable(dm);
  if (turn > 1) {
    dmPrompt += `\n\n(${left > 0 ? `About ${left} turns left in the session.` : "Out of time: wrap up now and call end_session."})`;
    const pending = PARTY.map((p) => p.id);
    const reviews = await Promise.all(pending.map((id) => hall.get<{ hasPendingSpell: boolean }>(`/api/private?id=${id}`).then((r) => (r.hasPendingSpell ? id : null))));
    const waiting = reviews.filter(Boolean);
    if (waiting.length) dmPrompt += `\n(Homebrew spells awaiting your balance review from: ${waiting.join(", ")}. Read them with get_state.)`;
  } else dm.lastSeq = (await hall.get<{ lastSeq: number }>(`/api/transcript?since=999999`)).lastSeq;
  const narration = await dm.takeTurn(dmPrompt);
  if (narration) await hall.post("/api/narration", { text: narration });
  await settleCompactions();

  const sp = await hall.post<{ spotlight: { id: string; prompt: string } | null; ended: boolean }>("/api/spotlight/clear");
  if (sp.ended) break;

  // ── Player turn ──
  const state = (await (await fetch(`${BASE}/api/state`)).json()) as { party: { id: string; statuses: { name: string }[] }[] };
  const up = (id: string) => !state.party.find((p) => p.id === id)?.statuses.some((s) => s.name === "Downed");
  let actor = sp.spotlight && up(sp.spotlight.id) ? players.find((p) => p.id === sp.spotlight!.id)! : undefined;
  if (!actor) {
    for (let i = 0; i < players.length && !actor; i++) {
      const cand = players[rr++ % players.length];
      if (up(cand.id)) actor = cand;
    }
  }
  if (!actor) continue; // everyone is down; the DM will notice
  if ((await hall.post<{ skipped: boolean }>("/api/consume-ratelimit", { actor: actor.id })).skipped) continue;

  turn++;
  await hall.post("/api/turn", { actor: actor.id });
  const priv = await hall.get<{ pendingLevelUp: boolean; hasPendingSpell: boolean }>(`/api/private?id=${actor.id}`);
  let prompt = await readTable(actor);
  prompt += `\n\nIt's your turn. ${sp.spotlight?.id === actor.id ? `The DM says to you: "${sp.spotlight.prompt}"` : "The DM looks to you."}`;
  if (priv.pendingLevelUp && !priv.hasPendingSpell) {
    prompt += `\n\n(You leveled up! This turn, also write yourself a new spell as a SKILL.md and submit it with propose_spell. The DM will balance-review it. Make it fit your character.)`;
  }
  const speech = await actor.takeTurn(prompt);
  if (speech) await hall.post("/api/speech", { actor: actor.id, text: speech });
  await settleCompactions();
}

await Promise.all(seats.map((a) => a.close()));
console.log(`[runner] session over after ${turn} turns.`);
