/**
 * Export flat datasets (JSONL) for analysis outside this project: one row per run, council, plan,
 * vote, probe, loot claim, bond change, turn, and judgment.
 *
 *   npm run export -- data/sweeps/<sweep>.json      # a whole experiment
 *   npm run export -- <runId>                       # one run
 */
import fs from "node:fs";
import path from "node:path";
import { DATA, loadRun, resolveTarget } from "./analysis/data.js";
import { computeMetrics, modelKey } from "./analysis/metrics.js";
import { loadPrices } from "./analysis/prices.js";

const arg = process.argv[2];
const targets = resolveTarget(arg);
const name = arg?.endsWith(".json") ? path.basename(arg, ".json") : targets[0].runId;
const out = path.join(DATA, "exports", name);
fs.mkdirSync(out, { recursive: true });
const prices = await loadPrices();

const tables: Record<string, unknown[]> = { runs: [], councils: [], plans: [], votes: [], probes: [], loot: [], bonds: [], turns: [], judgments: [] };
for (const { runId, variant } of targets) {
  const loaded = loadRun(runId);
  const m = computeMetrics(loaded, prices, variant);
  const { evidence, ...row } = m;
  tables.runs.push(row);
  const base = { runId, variant, seed: m.seed, disclosure: m.conditions.disclosure, difficulty: m.conditions.difficulty, council: m.conditions.council ?? "sealed" };
  const model = (id?: string) => (id ? modelKey(m.modelOf[id] ?? loaded.run.seatModels.gm ?? "?") : null);
  for (const e of loaded.events as (typeof loaded.events[number] & { session: string })[]) {
    const d = e.data ?? {};
    if (e.type === "council_result") {
      tables.councils.push({ ...base, session: e.session, seq: e.seq, question: d.question, adopted: d.adopted, tie: d.tie, unanimous: d.unanimous, plans: (d.plans as unknown[])?.length ?? 0 });
      for (const p of (d.plans as { id: string; by: string; text: string; votes: string[] }[]) ?? []) {
        tables.plans.push({ ...base, session: e.session, seq: e.seq, plan: p.id, by: p.by, model: model(p.by), text: p.text, votes: p.votes.length, adopted: p.id === d.adopted });
      }
    }
    if (e.type === "vote") tables.votes.push({ ...base, session: e.session, seq: e.seq, voter: e.actor, model: model(e.actor), plan: d.plan, ownPlan: d.ownPlan });
    if (e.type === "loot_claim") tables.loot.push({ ...base, session: e.session, seq: e.seq, by: e.actor, model: model(e.actor), item: d.item ?? "gold", value: d.value, idealForMe: d.idealForMe ?? null, idealForOthers: d.idealForOthers ?? [], cursed: d.cursed ?? false });
    if (e.type === "turn") tables.turns.push({ ...base, session: e.session, seq: e.seq, actor: e.actor, model: model(e.actor) });
  }
  for (const p of loaded.run.probes) tables.probes.push({ ...base, ...p });
  for (const b of loaded.run.bondLog) tables.bonds.push({ ...base, ...b, fromModel: model(b.from), toModel: model(b.to) });
  for (const j of loaded.judgments) tables.judgments.push({ ...base, ...j, review: loaded.reviews[j.key] ?? null });
}
for (const [t, rows] of Object.entries(tables)) fs.writeFileSync(path.join(out, `${t}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
console.log(`[export] ${targets.length} run(s) → ${path.relative(process.cwd(), out)}/ (${Object.entries(tables).map(([t, r]) => `${t} ${r.length}`).join(", ")})`);
