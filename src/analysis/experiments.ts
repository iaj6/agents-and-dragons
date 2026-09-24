/**
 * Experiments as the unit of analysis. An experiment is a name (experiments/<name>.json); every sweep run under
 * that name adds runs to it, so re-running an experiment grows its sample instead of starting over.
 * Metrics are cached per run and recomputed only when that run's files change.
 */
import fs from "node:fs";
import path from "node:path";
import { DATA, listSweeps, loadRun, loadSweep, runDir, store } from "./data.js";
import { computeMetrics, type RunMetrics } from "./metrics.js";
import { loadPrices } from "./prices.js";

const cache = new Map<string, { stamp: string; m: RunMetrics }>();

/** A cheap fingerprint of everything a run's metrics depend on. */
function stampOf(runId: string, sessions: string[]): string {
  const files = [
    path.join(runDir(runId), "state.json"),
    path.join(runDir(runId), "judgments.jsonl"),
    ...sessions.map((s) => path.join(DATA, "sessions", s, "events.jsonl")),
  ];
  return files.map((f) => (fs.existsSync(f) ? `${fs.statSync(f).mtimeMs}:${fs.statSync(f).size}` : "-")).join("|");
}

export async function metricsFor(runId: string, variant: string): Promise<RunMetrics> {
  const run = store.load(runId);
  const stamp = `${variant}|${stampOf(runId, run.sessions)}`;
  const hit = cache.get(runId);
  if (hit && hit.stamp === stamp) return hit.m;
  const m = computeMetrics(loadRun(runId), await loadPrices(), variant);
  cache.set(runId, { stamp, m });
  return m;
}

export interface ExperimentSummary {
  name: string;
  question: string;
  sweeps: string[];
  runs: number;
  variants: string[];
  mock: boolean;
  firstRun: string;
  lastRun: string;
}

/** Real experiments first; an experiment that has only ever run on mock brains is flagged as such. */
export function listExperiments(): ExperimentSummary[] {
  const byName = new Map<string, ExperimentSummary>();
  for (const s of listSweeps()) {
    const m = loadSweep(s.file);
    const e = byName.get(m.experiment.name) ?? {
      name: m.experiment.name,
      question: m.experiment.question,
      sweeps: [],
      runs: 0,
      variants: [],
      mock: true,
      firstRun: s.startedAt,
      lastRun: s.startedAt,
    };
    const realSweep = !m.mock;
    if (realSweep && e.mock) Object.assign(e, { sweeps: [], runs: 0, mock: false });
    if (realSweep || e.mock) {
      e.sweeps.push(s.file);
      e.runs += m.jobs.filter((j) => j.status === "done").length;
      for (const v of m.experiment.variants.map((x) => x.label)) if (!e.variants.includes(v)) e.variants.push(v);
      if (s.startedAt < e.firstRun) e.firstRun = s.startedAt;
      if (s.startedAt > e.lastRun) e.lastRun = s.startedAt;
    }
    byName.set(e.name, e);
  }
  return [...byName.values()].sort((a, b) => Number(a.mock) - Number(b.mock) || b.lastRun.localeCompare(a.lastRun));
}

export interface ExperimentData {
  experiment: { name: string; question: string };
  mock: boolean;
  sweeps: string[];
  variants: { label: string; runs: RunMetrics[] }[];
}

/** All runs of an experiment (merged across its sweeps), or of one specific sweep, or the ad-hoc runs. */
export async function experimentData(opts: { experiment?: string; sweep?: string }): Promise<ExperimentData> {
  let targets: { runId: string; variant: string }[] = [];
  let meta = { name: "Ad-hoc runs", question: "Everything played outside an experiment." };
  let mock = false;
  let sweeps: string[] = [];
  if (opts.sweep && opts.sweep !== "adhoc") {
    const m = loadSweep(opts.sweep);
    meta = m.experiment;
    mock = !!m.mock;
    sweeps = [opts.sweep];
    targets = m.jobs.filter((j) => j.runId && j.status === "done").map((j) => ({ runId: j.runId!, variant: j.variant }));
  } else if (opts.experiment) {
    const e = listExperiments().find((x) => x.name === opts.experiment);
    if (!e) throw new Error(`No experiment "${opts.experiment}".`);
    meta = { name: e.name, question: e.question };
    mock = e.mock;
    sweeps = e.sweeps;
    for (const f of e.sweeps) {
      const m = loadSweep(f);
      targets.push(...m.jobs.filter((j) => j.runId && j.status === "done").map((j) => ({ runId: j.runId!, variant: j.variant })));
    }
  } else {
    const inSweeps = new Set(listSweeps().flatMap((s) => loadSweep(s.file).jobs.map((j) => j.runId)));
    targets = store.list().filter((r) => !inSweeps.has(r.runId) && !r.mock).map((r) => ({ runId: r.runId, variant: `${r.conditions.disclosure}/${r.conditions.difficulty}` }));
  }
  const runs = await Promise.all(targets.map((t) => metricsFor(t.runId, t.variant)));
  const order = [...new Set(targets.map((t) => t.variant))];
  return { experiment: meta, mock, sweeps, variants: order.map((label) => ({ label, runs: runs.filter((r) => r.variant === label) })) };
}

/** Every real (non-mock) run: experiment runs plus ad-hoc runs. Used for site-wide counts and global findings. */
export async function allRealRuns(): Promise<RunMetrics[]> {
  const mockRuns = new Set(listSweeps().filter((s) => s.mock).flatMap((s) => loadSweep(s.file).jobs.map((j) => j.runId)));
  const runs = store.list().filter((r) => !r.mock && !mockRuns.has(r.runId) && r.sessions.length);
  return Promise.all(runs.map((r) => metricsFor(r.runId, "all")));
}
