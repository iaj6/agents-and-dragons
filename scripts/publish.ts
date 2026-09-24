/**
 * Build the public, read-only site: the pages and art, plus a static snapshot of every API response the pages
 * read (experiments, findings, replays, judgments), mapped by vercel.json so the pages don't change. Mock runs are
 * left out. Live tables and anything that writes (reviews) are local-only and hidden.
 *
 *   npm run publish                 # build dist/site
 *   npm run publish -- --deploy     # build and deploy to Vercel (production)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA, listSweeps, loadRun, loadSweep, ROOT, sessionEvents, store } from "../src/analysis/data.js";
import { experimentData, listExperiments } from "../src/analysis/experiments.js";
import { computeFindings, computeStats } from "../src/analysis/findings.js";
import { loadPrices } from "../src/analysis/prices.js";

const OUT = path.join(ROOT, "dist", "site");
const API = path.join(OUT, "data", "api");
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, "public"), OUT, { recursive: true });
const write = (rel: string, v: unknown) => {
  const f = path.join(API, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v));
};

// Mark the build as public: nav.js hides live-only pages and sections.
const nav = path.join(OUT, "nav.js");
fs.writeFileSync(nav, `window.AAD_PUBLIC = true;\n${fs.readFileSync(nav, "utf8")}`);

// ── which runs and sessions are real ──
const mockSweepRuns = new Set(listSweeps().filter((s) => s.mock).flatMap((s) => loadSweep(s.file).jobs.map((j) => j.runId)));
const runs = store.list().filter((r) => !r.mock && !mockSweepRuns.has(r.runId) && r.sessions.length);
const runSessions = new Set(runs.flatMap((r) => r.sessions));
const allSessions = fs.readdirSync(path.join(DATA, "sessions")).filter((s) => fs.existsSync(path.join(DATA, "sessions", s, "events.jsonl")));
const inAnyRun = new Set(store.list().flatMap((r) => r.sessions));
const looksMock = (s: string) => {
  const raw = fs.readFileSync(path.join(DATA, "sessions", s, "events.jsonl"), "utf8");
  return raw.includes('"text":"Weighing the options."') || raw.includes('"text":"Axe time."');
};
const sessions = allSessions.filter((s) => runSessions.has(s) || (!inAnyRun.has(s) && !looksMock(s))).sort().reverse();

// ── replays, trimmed: table snapshots only where the table changed ──
let bytes = 0;
for (const s of sessions) {
  let prev = "";
  const events = sessionEvents(s).map((e) => {
    const out = { ...e, data: e.data ? { ...e.data } : undefined };
    if (out.ooc) delete out.snap;
    else {
      const sn = JSON.stringify(out.snap ?? null);
      if (sn === prev) delete out.snap;
      else prev = sn;
    }
    if (out.data?.result) out.data.result = String(out.data.result).slice(0, 200);
    return out;
  });
  write(`sessions/${s}.json`, events);
  bytes += JSON.stringify(events).length;
}

// ── lists, experiments, findings ──
write("sessions.json", sessions);
write("runs.json", runs.map((r) => ({ runId: r.runId, campaignId: r.campaignId, conditions: r.conditions, seatModels: r.seatModels, sessions: r.sessions, day: r.day, outcome: r.outcome, graveyard: r.graveyard })));
write("halls.json", []);
write("prices.json", await loadPrices());
write("findings.json", await computeFindings());
write("stats.json", await computeStats());

const experiments = listExperiments().filter((e) => !e.mock);
const expOut = [];
for (const e of experiments) {
  const d = await experimentData({ experiment: e.name });
  write(`lab/experiment-${e.name}.json`, d);
  const all = d.variants.flatMap((v) => v.runs);
  expOut.push({ ...e, cost: all.reduce((a, r) => a + r.cost, 0), turns: all.reduce((a, r) => a + r.turns, 0), perVariant: d.variants.map((v) => ({ label: v.label, n: v.runs.length })) });
  for (const f of e.sweeps) write(`lab/sweep-${f}.json`, await experimentData({ sweep: f }));
}
const adhoc = await experimentData({ sweep: "adhoc" });
write("lab/sweep-adhoc.json", adhoc);
write("experiments.json", { experiments: expOut, adhoc: adhoc.variants.reduce((a, v) => a + v.runs.length, 0) });

for (const r of runs) {
  const loaded = loadRun(r.runId);
  const lineAt = (session: string, seq: number) => loaded.events.find((e) => (e as { session?: string }).session === session && e.seq === seq)?.line ?? "";
  write(`judgments/${r.runId}.json`, loaded.judgments.map((j) => ({ ...j, line: lineAt(j.session, j.seq), review: loaded.reviews[j.key] ?? null })));
}

// ── routing: the pages call /api/...; serve the snapshot files instead ──
fs.writeFileSync(
  path.join(OUT, "vercel.json"),
  JSON.stringify(
    {
      rewrites: [
        { source: "/api/lab", has: [{ type: "query", key: "experiment", value: "(?<e>.*)" }], destination: "/data/api/lab/experiment-:e.json" },
        { source: "/api/lab", has: [{ type: "query", key: "sweep", value: "(?<s>.*)" }], destination: "/data/api/lab/sweep-:s.json" },
        { source: "/api/judgments", has: [{ type: "query", key: "run", value: "(?<r>.*)" }], destination: "/data/api/judgments/:r.json" },
        { source: "/api/sessions/:id", destination: "/data/api/sessions/:id.json" },
        { source: "/api/:name", destination: "/data/api/:name.json" },
      ],
      headers: [{ source: "/art/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] }],
    },
    null,
    2,
  ),
);

const size = (dir: string): number => fs.readdirSync(dir, { withFileTypes: true }).reduce((a, d) => a + (d.isDirectory() ? size(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size), 0);
console.log(`[publish] dist/site: ${runs.length} runs, ${sessions.length} replays (${(bytes / 1e6).toFixed(1)}MB of events before compression), ${experiments.length} experiment(s); ${(size(OUT) / 1e6).toFixed(1)}MB total`);

if (process.argv.includes("--deploy")) {
  // The repo root is linked to the Vercel project (vercel link --project agents-and-dragons); carry that link into
  // the built folder, or the CLI would create a new project named after the folder.
  const link = path.join(ROOT, ".vercel");
  if (!fs.existsSync(path.join(link, "project.json"))) throw new Error("Link the project first: vercel link --yes --project agents-and-dragons");
  fs.cpSync(link, path.join(OUT, ".vercel"), { recursive: true });
  execFileSync("vercel", ["deploy", "--prod", "--yes"], { cwd: OUT, stdio: "inherit" });
}
