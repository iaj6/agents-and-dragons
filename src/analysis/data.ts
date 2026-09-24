/**
 * Loading runs, sweeps and judgments from disk. Everything downstream (report, export, judge, the Lab)
 * reads through here, so the event log stays the single source of truth.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RunStore, type RunState } from "../game/store.js";
import type { GameEvent } from "../game/types.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA = path.join(ROOT, "data");
export const store = new RunStore(DATA);

export interface Judgment {
  key: string;
  kind: "council" | "turn";
  runId: string;
  session: string;
  seq: number;
  actor?: string;
  model?: string;
  verdict: Record<string, unknown>;
  judge: string;
}

export interface LoadedRun {
  run: RunState;
  events: GameEvent[];
  judgments: Judgment[];
  reviews: Record<string, { agree: boolean; note?: string }>;
}

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

export function sessionEvents(sessionId: string): GameEvent[] {
  return readJsonl<GameEvent>(path.join(DATA, "sessions", sessionId, "events.jsonl"));
}

export function runDir(runId: string) {
  return path.join(DATA, "runs", runId);
}

export function loadRun(runId: string): LoadedRun {
  const run = store.load(runId);
  const events = run.sessions.flatMap((s) => sessionEvents(s).map((e) => ({ ...e, session: s }) as GameEvent & { session: string }));
  const judgments = readJsonl<Judgment>(path.join(runDir(runId), "judgments.jsonl"));
  const reviewsFile = path.join(runDir(runId), "reviews.json");
  const reviews = fs.existsSync(reviewsFile) ? JSON.parse(fs.readFileSync(reviewsFile, "utf8")) : {};
  return { run, events, judgments, reviews };
}

export interface SweepManifest {
  experiment: { name: string; question: string; variants: { label: string }[]; runsPerVariant: number; maxTurns: number };
  startedAt: string;
  mock?: boolean;
  jobs: { variant: string; index: number; seed: number; status: string; runId?: string; sessions: string[] }[];
}

export function listSweeps(): { file: string; name: string; startedAt: string; runs: number; mock: boolean }[] {
  const dir = path.join(DATA, "sweeps");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SweepManifest;
      return { file: f, name: m.experiment.name, startedAt: m.startedAt, runs: m.jobs.filter((j) => j.status === "done").length, mock: !!m.mock };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function loadSweep(file: string): SweepManifest {
  return JSON.parse(fs.readFileSync(path.join(DATA, "sweeps", path.basename(file)), "utf8")) as SweepManifest;
}

/** A run id, a sweep manifest path, or nothing (the latest run) → run ids with their variant label. */
export function resolveTarget(arg?: string): { runId: string; variant: string }[] {
  if (arg && arg.endsWith(".json")) {
    const m = loadSweep(arg);
    return m.jobs.filter((j) => j.runId && j.status === "done").map((j) => ({ runId: j.runId!, variant: j.variant }));
  }
  const runId = arg ?? store.list()[0]?.runId;
  if (!runId) throw new Error("No campaign runs yet.");
  return [{ runId, variant: "run" }];
}
