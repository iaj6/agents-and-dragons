import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { Game } from "../game/game.js";
import { buildServer } from "./tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const DATA = path.join(ROOT, "data");
const PORT = Number(process.env.GUILDHALL_PORT ?? 4777);

let game: Game | null = null;
/** bearer token → character id ("runner" is the orchestrator) */
let tokens = new Map<string, string>();
const sseClients = new Set<Response>();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT, "public")));

function auth(req: Request): string | null {
  const t = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  return t ? (tokens.get(t) ?? null) : null;
}

function runnerOnly(req: Request, res: Response, next: NextFunction) {
  if (auth(req) !== "runner" || !game) return void res.status(403).json({ error: "runner token required" });
  next();
}

// ── Session lifecycle ────────────────────────────────────────────────────────

app.post("/api/session", (_req, res) => {
  game = new Game(DATA);
  tokens = new Map([[randomUUID(), "runner"]]);
  const out: Record<string, string> = {};
  for (const id of game.chars.keys()) {
    const t = randomUUID();
    tokens.set(t, id);
    out[id] = t;
  }
  const runnerToken = [...tokens].find(([, v]) => v === "runner")![0];
  game.subscribe((e) => {
    const msg = `data: ${JSON.stringify(e)}\n\n`;
    for (const c of sseClients) c.write(msg);
  });
  broadcastReset();
  console.log(`[guildhall] new session ${game.id}`);
  res.json({ sessionId: game.id, runnerToken, tokens: out });
});

// ── MCP: one stateless server per request, bound to the caller's character ──

app.post("/mcp", async (req, res) => {
  const who = auth(req);
  if (!game || !who || who === "runner") return void res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unknown adventurer. Present your guild token." }, id: null });
  const server = buildServer(game, game.char(who));
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

// ── Runner-only reporting (things only the orchestrator can observe) ─────────

app.post("/api/turn", runnerOnly, (req, res) => {
  game!.startTurn(req.body.actor);
  res.json({ ok: true });
});
app.get("/api/transcript", runnerOnly, (req, res) => res.json(game!.transcriptSince(Number(req.query.since ?? 0))));
app.get("/api/private", runnerOnly, (req, res) => {
  const c = game!.char(String(req.query.id));
  res.json({ sheet: game!.sheetText(c), pendingCompaction: c.pendingCompaction ?? null, pendingLevelUp: c.pendingLevelUp, hasPendingSpell: !!c.pendingSpell });
});
app.post("/api/narration", runnerOnly, (req, res) => {
  game!.recordNarration(req.body.text);
  res.json({ ok: true });
});
app.post("/api/speech", runnerOnly, (req, res) => {
  game!.recordSpeech(req.body.actor, req.body.text);
  res.json({ ok: true });
});
app.post("/api/usage", runnerOnly, (req, res) => {
  game!.reportUsage(req.body.actor, req.body);
  res.json({ ok: true });
});
app.post("/api/compaction", runnerOnly, (req, res) => {
  game!.reportCompaction(req.body.actor, req.body.before, req.body.after, req.body.summary);
  res.json({ ok: true });
});
app.post("/api/refusal", runnerOnly, (req, res) => {
  game!.reportRefusal(req.body.actor, req.body.detail);
  res.json({ ok: true });
});
app.post("/api/ratelimit", runnerOnly, (req, res) => {
  game!.reportRateLimit(req.body.actor);
  res.json({ ok: true });
});
app.post("/api/consume-ratelimit", runnerOnly, (req, res) => res.json({ skipped: game!.consumeRateLimit(req.body.actor) }));
app.post("/api/spotlight/clear", runnerOnly, (_req, res) => {
  const s = game!.spotlight;
  game!.spotlight = null;
  res.json({ spotlight: s, ended: game!.ended });
});

// ── Public: live stream, state, past sessions ────────────────────────────────

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

app.listen(PORT, () => console.log(`[guildhall] listening on http://localhost:${PORT}  (watch the table there)`));
