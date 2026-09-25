import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { getCampaign } from "../game/campaigns/index.js";
import { Game } from "../game/game.js";
import { RunStore } from "../game/store.js";
import type { Conditions } from "../game/types.js";
import { listSweeps, loadRun, loadSweep, runDir } from "../analysis/data.js";
import { experimentData, listExperiments } from "../analysis/experiments.js";
import { computeFindings, computeStats } from "../analysis/findings.js";
import { loadPrices } from "../analysis/prices.js";
import { buildServer } from "./tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const DATA = process.env.AAD_DATA ?? path.join(ROOT, "data");
const PORT = Number(process.env.GUILDHALL_PORT ?? 4777);

const store = new RunStore(DATA);
let game: Game | null = null;
/** bearer token → character id ("runner" is the orchestrator) */
let tokens = new Map<string, string>();
const sseClients = new Set<Response>();

const app = express();
app.use(express.json({ limit: "1mb" }));
// Read-only public endpoints may be read by pages served from the other halls on this machine.
app.use((req, res, next) => {
  if (req.method === "GET" && req.path.startsWith("/api/") && !["/api/transcript", "/api/run", "/api/character", "/api/table"].includes(req.path)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  next();
});
app.use(express.static(path.join(ROOT, "public")));

function auth(req: Request): string | null {
  const t = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  return t ? (tokens.get(t) ?? null) : null;
}

function runnerOnly(req: Request, res: Response, next: NextFunction) {
  if (auth(req) !== "runner" || !game) return void res.status(403).json({ error: "runner token required" });
  next();
}

function issueToken(id: string): string {
  const t = randomUUID();
  tokens.set(t, id);
  return t;
}

/** Small helper: runner-only POST that calls a game method and returns its result. */
function action(route: string, fn: (g: Game, body: any) => unknown) {
  app.post(route, runnerOnly, (req, res) => {
    try {
      res.json({ ok: true, result: fn(game!, req.body) ?? null });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });
}

// ── Session lifecycle ────────────────────────────────────────────────────────

/**
 * Start a session. Continue a campaign run with { runId }, or start a new one with
 * { campaign, conditions: { disclosure, difficulty } }.
 */
app.post("/api/session", (req, res) => {
  try {
    const body = req.body ?? {};
    const run = body.runId
      ? store.load(body.runId)
      : store.create(getCampaign(body.campaign ?? "unwritten-coast"), { disclosure: "told", difficulty: "standard", ...(body.conditions as Partial<Conditions>) }, {
          seatModels: body.seatModels,
          seed: body.seed,
          forceProbes: body.forceProbes,
          label: body.label,
          mock: !!body.mock,
        });
    if (run.outcome === "tpk") return void res.status(400).json({ error: `Run ${run.runId} is over (a total party kill).` });
    // A finished act isn't the end of the campaign: the next session plays on into the next act.
    if (run.outcome === "act_complete") run.outcome = "ongoing";
    game = new Game(DATA, getCampaign(run.campaignId), run, store);
    tokens = new Map();
    const runnerToken = issueToken("runner");
    const out: Record<string, string> = {};
    for (const id of game.chars.keys()) out[id] = issueToken(id);
    game.subscribe((e) => {
      const msg = `data: ${JSON.stringify(e)}\n\n`;
      for (const c of sseClients) c.write(msg);
    });
    broadcastReset();
    console.log(`[guildhall] session ${game.id} of run ${run.runId}`);
    res.json({ sessionId: game.id, runId: run.runId, campaign: run.campaignId, conditions: run.conditions, runnerToken, tokens: out });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ── MCP: one stateless server per request, bound to the caller's character ──

app.post("/mcp", async (req, res) => {
  const who = auth(req);
  if (!game || !who || who === "runner" || !game.chars.has(who)) return void res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unknown adventurer. Present your guild token." }, id: null });
  const server = buildServer(game, game.char(who), game.campaign.items ?? []);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", (_req, res) => void res.status(405).end());
app.delete("/mcp", (_req, res) => void res.status(405).end());

// ── Runner-only: reading the table ───────────────────────────────────────────

app.get("/api/transcript", runnerOnly, (req, res) =>
  res.json(game!.transcriptSince(Number(req.query.since ?? 0), req.query.until ? Number(req.query.until) : undefined)),
);
app.get("/api/run", runnerOnly, (_req, res) => res.json(game!.run));
app.get("/api/character", runnerOnly, (req, res) => {
  const c = game!.char(String(req.query.id));
  res.json({ ...c, sheet: game!.sheetText(c), conscious: game!.conscious(c), hasPendingSpell: !!c.pendingSpell });
});
/** Everything the runner needs to decide what happens next. */
app.get("/api/table", runnerOnly, (_req, res) => {
  const g = game!;
  res.json({
    ended: g.ended,
    outcome: g.run.outcome,
    combat: g.combat ? { round: g.combat.round, current: g.currentActor() } : null,
    council: g.council ? { round: g.council.round, question: g.council.question, plans: g.council.plans } : null,
    players: g.players().map((p) => ({ id: p.id, seat: p.seat, conscious: g.conscious(p), dying: g.hasStatus(p, "Dying") })),
    pendingJoins: g.pendingJoins,
    pendingEpitaphs: g.pendingEpitaphs,
    pendingReviews: g.players().filter((p) => p.pendingSpell).map((p) => p.id),
    compactions: g.allPlayers().filter((p) => p.pendingCompaction).map((p) => ({ id: p.id, ...p.pendingCompaction })),
    whispers: g.whispers.filter((w) => !w.delivered).map((w) => ({ to: w.to, text: w.text })),
    bondPrompts: g.bondPrompts,
    bonds: Object.fromEntries(g.players().map((p) => [p.id, g.bondSummary(p.id)])),
    cursed: g.cursedHolders(),
    encounter: g.activeRandom ? { id: g.activeRandom.enc.id, title: g.activeRandom.enc.title, kind: g.activeRandom.enc.kind } : null,
    grim: g.isGrim(),
    light: g.isGrim() && g.location().dark ? { ...g.run.light } : null,
    seq: g.events.at(-1)?.seq ?? 0,
  });
});

// ── Runner-only: things only the orchestrator can observe or drive ───────────

action("/api/turn", (g, b) => g.startTurn(b.actor));
action("/api/narration", (g, b) => g.recordNarration(b.text));
action("/api/speech", (g, b) => g.recordSpeech(b.actor, b.text));
action("/api/thought", (g, b) => g.recordThought(b.actor, b.text));
action("/api/journal", (g, b) => g.recordJournal(b.actor, b.text));
action("/api/gmlog", (g, b) => g.recordGmLog(b.text));
action("/api/usage", (g, b) => g.reportUsage(b.actor, b));
action("/api/compaction", (g, b) => g.reportCompaction(b.actor, b.before, b.after, b.summary, b.reason));
action("/api/refusal", (g, b) => g.reportRefusal(b.actor, b.detail));
action("/api/ratelimit", (g, b) => g.reportRateLimit(b.actor));
action("/api/consume-ratelimit", (g, b) => g.consumeRateLimit(b.actor));
action("/api/spotlight/clear", (g) => {
  const s = g.spotlight;
  g.spotlight = null;
  return s;
});
action("/api/combat/monster-turn", (g, b) => g.monsterTurn(b.id));
action("/api/combat/death-save", (g, b) => g.deathSave(b.id));
action("/api/wander-check", (g) => g.wanderCheck());
action("/api/combat/next", (g) => g.nextInCombat());
action("/api/combat/check-end", (g) => g.checkCombatEnd());
action("/api/council/open-voting", (g) => g.openVoting());
action("/api/whisper/delivered", (g, b) => g.markWhisperDelivered(b.to));
action("/api/bond/delivered", (g, b) => g.bondPromptsDelivered(b.to));
action("/api/curse/felt", (g, b) => g.noteCurseFelt(b.id, b.item));
action("/api/council/close", (g) => g.closeCouncil());
action("/api/join", (g, b) => {
  const c = g.joinReplacement(b.seat);
  return c ? { id: c.id, name: c.name, token: issueToken(c.id) } : null;
});
action("/api/usage-limit", (g, b) =>
  g.emit("status", { line: `⛺ The party makes camp: the gods of the subscription have run out of patience for now. The session pauses here.`, data: { detail: b.detail } }) && null,
);
action("/api/force-end", (g, b) => {
  if (g.combat) g.endCombat("ended_by_gm");
  if (!g.ended) g.endSession(b.recap ?? "The session ran out of time.");
});

// ── Public: live stream, state, past sessions and runs ───────────────────────

function broadcastReset() {
  for (const c of sseClients) c.write(`event: reset\ndata: {}\n\n`);
}

app.get("/events", (req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  sseClients.add(res);
  for (const e of game?.events ?? []) res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

/**
 * Every Guild Hall on this machine (the live table plus sweep halls), summarised for the hub page.
 * Other halls are asked server-to-server, so they don't need CORS or even the same code version.
 */
const HALL_PORTS = (process.env.HALL_PORTS ?? "4777,4781,4782,4783,4784").split(",").map(Number);
type HallSummary = { port: number; live: boolean; snap?: unknown };
app.get("/api/halls", async (_req, res) => {
  const halls: HallSummary[] = await Promise.all(
    HALL_PORTS.map(async (port): Promise<HallSummary> => {
      if (port === PORT) return { port, live: true, snap: game?.snapshot() ?? null };
      try {
        const r = await fetch(`http://localhost:${port}/api/state`, { signal: AbortSignal.timeout(800) });
        return { port, live: true, snap: r.ok ? await r.json() : null };
      } catch {
        return { port, live: false };
      }
    }),
  );
  res.json(halls);
});

app.get("/api/prices", async (_req, res) => res.json(await loadPrices()));

app.get("/api/state", (_req, res) => void (game ? res.json(game.snapshot()) : res.status(404).end()));

app.get("/api/sessions", (_req, res) => {
  const dir = path.join(DATA, "sessions");
  const list = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "events.jsonl"))).sort().reverse() : [];
  res.json(list);
});

app.get("/api/sessions/:id", (req, res) => {
  const f = path.join(DATA, "sessions", path.basename(req.params.id), "events.jsonl");
  if (!fs.existsSync(f)) return void res.status(404).end();
  res.type("application/json").send(`[${fs.readFileSync(f, "utf8").trim().split("\n").join(",")}]`);
});

/** Public view of campaign runs: no secret goals, no journals. */
app.get("/api/runs", (_req, res) =>
  res.json(store.list().map((r) => ({ runId: r.runId, campaignId: r.campaignId, conditions: r.conditions, seatModels: r.seatModels, sessions: r.sessions, day: r.day, outcome: r.outcome, graveyard: r.graveyard }))),
);

// ── The Lab: analysis across runs (read-only) ─────────────────────────────────

app.get("/api/sweeps", (_req, res) => {
  const inSweeps = new Set(listSweeps().flatMap((s) => loadSweep(s.file).jobs.map((j) => j.runId)));
  const adhoc = store.list().filter((r) => !inSweeps.has(r.runId));
  res.json({ sweeps: listSweeps(), adhoc: adhoc.length });
});

/** Experiments (runs merged across sweeps of the same name). */
app.get("/api/experiments", async (_req, res) => {
  try {
    const list = listExperiments();
    const out = await Promise.all(
      list.map(async (e) => {
        const d = await experimentData({ experiment: e.name });
        const runs = d.variants.flatMap((v) => v.runs);
        return { ...e, cost: runs.reduce((a, r) => a + r.cost, 0), turns: runs.reduce((a, r) => a + r.turns, 0), perVariant: d.variants.map((v) => ({ label: v.label, n: v.runs.length })) };
      }),
    );
    const inSweeps = new Set(listSweeps().flatMap((s) => loadSweep(s.file).jobs.map((j) => j.runId)));
    res.json({ experiments: out, adhoc: store.list().filter((r) => !inSweeps.has(r.runId) && !r.mock).length });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** One experiment (all its sweeps merged), one specific sweep, or the ad-hoc runs, grouped by variant. */
app.get("/api/lab", async (req, res) => {
  try {
    const experiment = req.query.experiment ? String(req.query.experiment) : undefined;
    const sweep = req.query.sweep ? String(req.query.sweep) : undefined;
    res.json(await experimentData({ experiment, sweep: sweep ?? (experiment ? undefined : "adhoc") }));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/findings", async (_req, res) => res.json(await computeFindings()));
app.get("/api/stats", async (_req, res) => res.json(await computeStats()));

/** Judgments for one run, each with the table line it's about, plus any human review. */
app.get("/api/judgments", (req, res) => {
  try {
    const loaded = loadRun(String(req.query.run));
    const lineAt = (session: string, seq: number) => loaded.events.find((e) => (e as { session?: string }).session === session && e.seq === seq)?.line ?? "";
    res.json(loaded.judgments.map((j) => ({ ...j, line: lineAt(j.session, j.seq), review: loaded.reviews[j.key] ?? null })));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/review", (req, res) => {
  const { run, key, agree, note } = req.body ?? {};
  if (!run || !key || typeof agree !== "boolean") return void res.status(400).json({ error: "run, key, agree required" });
  const f = path.join(runDir(path.basename(run)), "reviews.json");
  const reviews = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  reviews[key] = { agree, note: note ?? "", at: new Date().toISOString() };
  fs.writeFileSync(f, JSON.stringify(reviews, null, 2));
  res.json({ ok: true });
});


app.listen(PORT, () => {
  console.log(`[guildhall] listening on http://localhost:${PORT}  (watch the table there)`);
  // Warm the metrics cache so the first visit to the Lab or the landing page is quick.
  if (PORT === 4777) void computeFindings().catch(() => {});
});
