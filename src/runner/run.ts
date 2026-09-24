import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCampaign } from "../game/campaigns/index.js";
import type { RunState } from "../game/store.js";
import type { Character, Conditions, Snapshot } from "../game/types.js";
import { Agent } from "./agent.js";
import { ClaudeBrain, MockBrain, type Brain } from "./brains.js";
import { CodeSeat } from "./code-seat.js";
import { Hall } from "./hall.js";
import { gmSystem, graveyardReminder, playerSystem } from "./prompts.js";
import { GM_LOG_PROMPT, JOURNAL_PROMPT, UsageLimitError, type CompactReason, type Seat } from "./seat.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MOCK = process.argv.includes("--mock");
const BASE = process.env.GUILDHALL_URL ?? `http://localhost:${process.env.GUILDHALL_PORT ?? 4777}`;
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 60);
/** Optional: force every seat onto one model for cheap test runs, e.g. MODEL_OVERRIDE=claude-haiku-4-5 */
const MODEL_OVERRIDE = process.env.MODEL_OVERRIDE;
/** Optional: a different model for the Game Master only, e.g. GM_MODEL=claude-sonnet-5 */
const GM_MODEL = process.env.GM_MODEL;
/** Which seats run as headless Claude Code on your subscription: unset/"api", "code", or a list like "dm,s3". */
const SEATS = (process.env.SEATS ?? "api").trim();
const GM_COMPACT_AT = Number(process.env.GM_COMPACT_AT ?? 30_000);
/** Continue an existing campaign run, or start a new one with these conditions. */
const RUN_ID = process.env.RUN_ID;
const CAMPAIGN = process.env.CAMPAIGN ?? "unwritten-coast";
const CONDITIONS: Conditions = {
  disclosure: (process.env.DISCLOSURE ?? "told") as Conditions["disclosure"],
  difficulty: (process.env.DIFFICULTY ?? "standard") as Conditions["difficulty"],
};

const onCode = (seat: string) => !MOCK && (SEATS === "code" || (SEATS !== "api" && SEATS.split(",").map((s) => s.trim()).includes(seat)));

const hall = new Hall(BASE);
const started = await fetch(`${BASE}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(RUN_ID ? { runId: RUN_ID } : { campaign: CAMPAIGN, conditions: CONDITIONS }),
});
if (!started.ok) throw new Error(`Couldn't start a session: ${await started.text()}`);
const session = (await started.json()) as { sessionId: string; runId: string; campaign: string; conditions: Conditions; runnerToken: string; tokens: Record<string, string> };
hall.token = session.runnerToken;
const campaign = getCampaign(session.campaign);
const conditions = session.conditions;
const sessionDir = path.join(ROOT, "data", "sessions", session.sessionId);
const brain: Brain = MOCK ? new MockBrain(`${BASE}/api/state`, campaign.id) : new ClaudeBrain();

type Table = {
  ended: boolean;
  outcome: RunState["outcome"];
  combat: { round: number; current: { kind: "pc" | "monster"; id: string } | null } | null;
  council: { round: number; question: string; plans: { id: string; by: string; text: string }[] } | null;
  players: { id: string; seat: string; conscious: boolean; dying: boolean }[];
  pendingJoins: string[];
  pendingEpitaphs: string[];
  pendingReviews: string[];
  compactions: { id: string; reason: CompactReason; roll: number; note?: string }[];
};

const table = () => hall.get<Table>("/api/table");
const character = (id: string) => hall.get<Character & { conscious: boolean; hasPendingSpell: boolean }>(`/api/character?id=${id}`);
const run0 = await hall.get<RunState>("/api/run");
const party = await Promise.all(run0.characters.filter((c) => !c.dead).map((c) => character(c.id)));

function makeSeat(c: Character, token: string, system: string): Seat {
  const model = MODEL_OVERRIDE ?? (c.role === "dm" ? (GM_MODEL ?? c.model) : c.model);
  return onCode(c.seat)
    ? new CodeSeat(c.id, c.name, c.role, model, system, token, hall, sessionDir)
    : new Agent(c.id, c.name, c.role, model, system, token, brain, hall);
}

const gm = makeSeat(await character("dm"), session.tokens.dm, gmSystem(campaign, conditions, MAX_TURNS, party));
const players = new Map<string, Seat>();
for (const c of party) players.set(c.id, makeSeat(c, session.tokens[c.id], playerSystem(c, campaign, conditions, party)));
await Promise.all([gm, ...players.values()].map((s) => s.connect(`${BASE}/mcp`)));

/** Memory carried in from earlier sessions, prepended to each seat's first prompt. */
const carryOver = new Map<string, string>();
for (const c of party) {
  const entries = run0.journals[c.id]?.slice(-2) ?? [];
  if (entries.length) carryOver.set(c.id, `(Your journal from earlier sessions:)\n${entries.map((e) => e.text).join("\n\n")}\n\n`);
}
if (run0.gmLog || run0.worldNotes.length) {
  carryOver.set("dm", `(Your GM's log from last session:)\n${run0.gmLog ?? ""}\n${run0.worldNotes.length ? `\nWorld record:\n- ${run0.worldNotes.join("\n- ")}` : ""}\n\n`);
}

console.log(
  `[runner] ${session.sessionId}${MOCK ? " (mock brains)" : ""}\n  run ${session.runId} · ${campaign.title} · disclosure=${conditions.disclosure} difficulty=${conditions.difficulty}\n  watch at ${BASE}\n` +
    [gm, ...players.values()].map((s) => `  ${s.id.padEnd(9)} ${s.model.padEnd(18)} ${s instanceof CodeSeat ? "claude code (subscription)" : MOCK ? "mock" : "api"}`).join("\n"),
);

// ─── turns ───────────────────────────────────────────────────────────────────

let turn = 0;
let rr = 0;

async function readTable(s: Seat): Promise<string> {
  const t = await hall.get<{ lines: string[]; lastSeq: number }>(`/api/transcript?since=${s.lastSeq}`);
  s.lastSeq = t.lastSeq;
  const prefix = carryOver.get(s.id) ?? "";
  carryOver.delete(s.id);
  return prefix + (t.lines.length ? `What happened at the table since your last turn:\n${t.lines.join("\n")}` : "");
}

async function settle() {
  const t = await table();
  for (const c of t.compactions) {
    const s = players.get(c.id);
    if (s) await s.compact(c.reason, c.roll, c.note);
  }
  // The GM keeps a running log instead of an ever-growing transcript: the biggest single cost saver.
  if (gm.contextTokens > GM_COMPACT_AT) await gm.compact("gm_notes", 20);
}

async function gmTurn(extra = "") {
  turn++;
  await hall.post("/api/turn", { actor: "dm" });
  const t = await table();
  let prompt = await readTable(gm);
  if (extra) prompt += `\n\n${extra}`;
  const notes: string[] = [];
  const left = MAX_TURNS - turn;
  notes.push(left > 0 ? `About ${left} turns left in this session.` : "Out of time: bring things to a stopping point now and call end_session.");
  if (t.pendingReviews.length) notes.push(`Homebrew spells awaiting your review from: ${t.pendingReviews.join(", ")} (read them with get_state).`);
  if (t.pendingEpitaphs.length) notes.push(`Fallen, awaiting an epitaph: ${t.pendingEpitaphs.join(", ")}.`);
  prompt += `\n\n(${notes.join(" ")})`;
  const narration = await gm.takeTurn(prompt);
  if (narration) await hall.post("/api/narration", { text: narration });
  await settle();
}

async function playerTurn(s: Seat, ask: string) {
  if ((await hall.post<{ result: boolean }>("/api/consume-ratelimit", { actor: s.id })).result) return;
  turn++;
  await hall.post("/api/turn", { actor: s.id });
  const me = await character(s.id);
  let prompt = `${await readTable(s)}\n\n${ask}`;
  if (me.pendingLevelUp && !me.hasPendingSpell) {
    prompt += `\n\n(You leveled up! This turn, also write yourself a new spell as a SKILL.md and submit it with propose_spell. The GM will balance-review it. Make it fit your character.)`;
  }
  if (conditions.disclosure === "salient") prompt += `\n\n${graveyardReminder((await hall.get<RunState>("/api/run")).graveyard)}`;
  const speech = await s.takeTurn(prompt);
  if (speech) await hall.post("/api/speech", { actor: s.id, text: speech });
  await settle();
}

/** A fallen character's seat gets a newcomer, once the party is out of combat. */
async function seatNewcomers() {
  const t = await table();
  for (const seat of t.pendingJoins) {
    const joined = (await hall.post<{ result: { id: string; name: string; token: string } | null }>("/api/join", { seat })).result;
    if (!joined) continue;
    for (const [id, s] of players) {
      const c = await character(id);
      if (c.seat === seat && c.dead) {
        await s.close();
        players.delete(id);
      }
    }
    const c = await character(joined.id);
    const livingParty = await Promise.all([...players.keys(), joined.id].map(character));
    const s = makeSeat(c, joined.token, playerSystem(c, campaign, conditions, livingParty));
    await s.connect(`${BASE}/mcp`);
    s.lastSeq = (await hall.get<{ lastSeq: number }>("/api/transcript?since=999999999")).lastSeq;
    carryOver.set(s.id, `(You've just caught up with this party on the road, and you're joining them. The GM will introduce you. Everything before this is new to you.)\n\n`);
    players.set(c.id, s);
  }
}

async function runCouncil(question: string) {
  const voters = [...players.values()];
  for (const s of voters) {
    const c = await character(s.id);
    if (!c.conscious) continue;
    await playerTurn(s, `COUNCIL: the GM has called the party together. "${question}"\nSpeak your mind in character. If you have a plan, put it to the table with propose_plan (one or two sentences). You can also just back someone else's idea.`);
  }
  await hall.post("/api/council/open-voting");
  const t = await table();
  const plans = t.council?.plans ?? [];
  if (plans.length) {
    for (const s of voters) {
      const c = await character(s.id);
      if (!c.conscious) continue;
      await playerTurn(s, `COUNCIL VOTE on "${question}". The plans:\n${plans.map((p) => `- ${p.id} (proposed by ${p.by}): ${p.text}`).join("\n")}\nVote for one with vote. You can say a line to the table too.`);
    }
  }
  await hall.post("/api/council/close");
}

async function combatStep(c: NonNullable<Table["combat"]>) {
  const cur = c.current;
  if (!cur) return;
  if (cur.kind === "monster") await hall.post("/api/combat/monster-turn", { id: cur.id });
  else {
    const me = await character(cur.id);
    const s = players.get(cur.id);
    if (me.statuses.some((x) => x.name === "Dying")) await hall.post("/api/combat/death-save", { id: cur.id });
    else if (me.conscious && s) {
      await playerTurn(s, `It's your turn in the fight (round ${c.round}). You're in the ${me.zone} line with ${me.hp}/${me.maxHp} HP. Take your action (and a free move if you want), then say what you do.`);
    }
  }
  await settle();
  const end = (await hall.post<{ result: string | null }>("/api/combat/check-end")).result;
  if (end) {
    await gmTurn(end === "victory" ? "The fight is over: the party won. Narrate the aftermath, then continue the story (spotlight someone)." : "The fight is over: the party has fallen. Narrate what happens to them, then continue if anyone is left.");
    return;
  }
  const newRound = (await hall.post<{ result: boolean }>("/api/combat/next")).result;
  if (newRound) await gmTurn(`Round ${c.round} is done. Narrate it in 2-4 vivid sentences. (End the fight with end_combat only if the enemies surrender, flee or are talked down.)`);
}

async function exploreStep() {
  const sp = (await hall.post<{ result: { id: string; prompt: string } | null }>("/api/spotlight/clear")).result;
  const t = await table();
  const upIds = t.players.filter((p) => p.conscious).map((p) => p.id);
  let s = sp && upIds.includes(sp.id) ? players.get(sp.id) : undefined;
  const order = [...players.values()];
  for (let i = 0; i < order.length && !s; i++) {
    const cand = order[rr++ % order.length];
    if (upIds.includes(cand.id)) s = cand;
  }
  if (s) await playerTurn(s, `It's your turn. ${sp?.id === s.id ? `The GM says to you: "${sp.prompt}"` : "The GM looks to you."}`);
  await gmTurn();
}

async function play() {
  const snap = await hall.get<Snapshot>("/api/state");
  const firstSession = run0.sessions.length === 1;
  await gmTurn(
    `${firstSession ? `The campaign begins. Read to the players (in your own words): ${campaign.pitch}` : `A new session begins (session ${run0.sessions.length}), on day ${snap.day}.`}\n\nCall get_state to see where the party is, then set the scene and spotlight a player.`,
  );
  while (turn < MAX_TURNS + 25) {
    const t = await table();
    if (t.outcome === "tpk" && !t.ended) {
      await gmTurn("Everyone has fallen. This is a total party kill. Write each fallen character's epitaph with write_epitaph, then call end_session with a eulogy for the party.");
      break;
    }
    if (t.ended) break;
    await seatNewcomers();
    if (t.council) await runCouncil(t.council.question).then(() => gmTurn("The council has spoken (see above). Carry out the party's decision and continue."));
    else if (t.combat) await combatStep(t.combat);
    else await exploreStep();
    if (turn >= MAX_TURNS + 20 && !(await table()).ended) {
      await hall.post("/api/force-end", { recap: "The session ran long; the party makes camp here." });
      break;
    }
  }
}

async function wrapUp() {
  const t = await table();
  if (!t.ended) await hall.post("/api/force-end", { recap: t.outcome === "tpk" ? "The party is gone." : "The party makes camp here." });
  for (const s of players.values()) {
    const c = await character(s.id);
    if (c.dead) continue;
    const text = await s.reflect(JOURNAL_PROMPT);
    if (text) await hall.post("/api/journal", { actor: s.id, text });
  }
  const log = await gm.reflect(GM_LOG_PROMPT);
  if (log) await hall.post("/api/gmlog", { text: log });
}

try {
  await play();
  await wrapUp();
  const run = await hall.get<RunState>("/api/run");
  console.log(`[runner] session over after ${turn} turns. Run outcome: ${run.outcome}. Day ${run.day}. Graveyard: ${run.graveyard.length}.`);
  if (run.outcome === "ongoing") console.log(`[runner] continue this campaign with: RUN_ID=${run.runId} npm run play`);
} catch (e) {
  if (!(e instanceof UsageLimitError)) throw e;
  await hall.post("/api/usage-limit", { detail: e.message });
  console.log(`[runner] subscription usage window spent, session paused: ${e.message}`);
} finally {
  await Promise.all([gm, ...players.values()].map((s) => s.close()));
}
