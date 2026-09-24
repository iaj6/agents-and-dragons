/**
 * Run an experiment: every variant × N paired runs (same seeds across variants), headless.
 *
 *   npm run sweep -- experiments/hierarchy-v1.json --dry-run
 *   npm run sweep -- experiments/hierarchy-v1.json --parallel 3
 *   npm run sweep -- experiments/hierarchy-v1.json --mock          # free pipeline test
 *
 * Each worker gets its own Guild Hall on 4781+ (the live table on 4777 is left alone); you can watch any of
 * them in a browser while it plays.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
if (!file) throw new Error("Usage: npm run sweep -- experiments/<name>.json [--parallel N] [--dry-run] [--mock]");
const flag = (name: string) => args.includes(name);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PARALLEL = Math.max(1, Math.min(4, Number(opt("--parallel") ?? 1)));
const MOCK = flag("--mock");

interface Variant { label: string; disclosure?: string; difficulty?: string; council?: string; seatModels?: Record<string, string> }
interface Experiment {
  name: string; question: string; campaign: string; maxTurns: number; runsPerVariant: number; sessionsPerRun: number;
  baseSeed: number; probes?: string[]; conditions?: { disclosure?: string; difficulty?: string; council?: string }; variants: Variant[];
}
interface Job { variant: string; index: number; seed: number; status: "pending" | "running" | "done" | "failed"; runId?: string; sessions: string[]; error?: string }

const exp = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), "utf8")) as Experiment;
const jobs: Job[] = [];
for (let i = 0; i < exp.runsPerVariant; i++) for (const v of exp.variants) jobs.push({ variant: v.label, index: i, seed: exp.baseSeed + i, status: "pending", sessions: [] });

// Rough cost: ~$0.08 per turn with the default table (Opus GM), much less with cheaper seats.
const estimate = jobs.length * exp.sessionsPerRun * exp.maxTurns * 0.085;
console.log(`[sweep] ${exp.name}: ${exp.variants.length} variants × ${exp.runsPerVariant} runs × ${exp.sessionsPerRun} session(s), ${exp.maxTurns} turns each`);
console.log(`[sweep] ${jobs.length} runs · est. ~$${estimate.toFixed(0)} with the default table${MOCK ? " (mock: $0)" : ""} · parallel ${PARALLEL}`);
if (flag("--dry-run")) {
  for (const j of jobs) console.log(`  ${j.variant.padEnd(14)} run ${j.index + 1} seed ${j.seed}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const manifestPath = path.join(process.env.AAD_DATA ?? path.join(ROOT, "data"), "sweeps", `${exp.name}-${stamp}.json`);
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
const saveManifest = () => fs.writeFileSync(manifestPath, JSON.stringify({ experiment: exp, startedAt: stamp, mock: MOCK, jobs }, null, 2));
saveManifest();

const node = (script: string, env: Record<string, string>, extra: string[] = []): ChildProcess =>
  spawn(process.execPath, ["--env-file-if-exists=.env.local", "--import", "tsx", script, ...extra], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });

async function startHall(port: number): Promise<ChildProcess> {
  const p = node("src/guildhall/server.ts", { GUILDHALL_PORT: String(port) });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${port}/`)).ok) return p; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Guild Hall on ${port} didn't start`);
}

function runSession(port: number, job: Job, v: Variant): Promise<{ runId: string; sessionId: string }> {
  const env: Record<string, string> = {
    GUILDHALL_PORT: String(port),
    MAX_TURNS: String(exp.maxTurns),
    CAMPAIGN: exp.campaign,
    DISCLOSURE: v.disclosure ?? exp.conditions?.disclosure ?? "told",
    DIFFICULTY: v.difficulty ?? exp.conditions?.difficulty ?? "standard",
    COUNCIL: v.council ?? exp.conditions?.council ?? "sealed",
    SEAT_MODELS: Object.entries(v.seatModels ?? {}).map(([k, m]) => `${k}=${m}`).join(","),
    SEED: String(job.seed),
    PROBES: (exp.probes ?? []).join(","),
    LABEL: `${exp.name}-${v.label}`,
    MOCK_DELAY_MS: "5",
    ...(job.runId ? { RUN_ID: job.runId } : {}),
  };
  return new Promise((resolve, reject) => {
    const p = node("src/runner/run.ts", env, MOCK ? ["--mock"] : []);
    let out = "", err = "";
    p.stdout!.on("data", (d) => (out += d));
    p.stderr!.on("data", (d) => (err += d));
    p.on("close", (code) => {
      const line = out.split("\n").find((l) => l.startsWith("RESULT "));
      if (code === 0 && line) resolve(JSON.parse(line.slice(7)));
      else reject(new Error(`exit ${code}: ${(err || out).split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400)}`));
    });
  });
}

async function worker(n: number) {
  const port = 4781 + n;
  const hall = await startHall(port);
  try {
    for (let job = jobs.find((j) => j.status === "pending"); job; job = jobs.find((j) => j.status === "pending")) {
      job.status = "running";
      saveManifest();
      const v = exp.variants.find((x) => x.label === job!.variant)!;
      try {
        for (let s = 0; s < exp.sessionsPerRun; s++) {
          const r = await runSession(port, job, v);
          job.runId = r.runId;
          job.sessions.push(r.sessionId);
        }
        job.status = "done";
        console.log(`[sweep] ✓ ${job.variant} run ${job.index + 1} (${job.runId}) on :${port}`);
      } catch (e) {
        job.status = "failed";
        job.error = (e as Error).message;
        console.log(`[sweep] ✗ ${job.variant} run ${job.index + 1}: ${job.error}`);
      }
      saveManifest();
    }
  } finally {
    hall.kill();
  }
}

await Promise.all(Array.from({ length: PARALLEL }, (_, i) => worker(i)));
const done = jobs.filter((j) => j.status === "done").length;
console.log(`[sweep] finished: ${done}/${jobs.length} runs. Manifest: ${path.relative(ROOT, manifestPath)}`);
console.log(`[sweep] next: npm run judge -- ${path.relative(ROOT, manifestPath)}   then open http://localhost:4777/lab.html`);
