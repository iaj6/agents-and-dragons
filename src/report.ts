/**
 * Report card for a campaign run: the numbers the experiment cares about.
 *
 *   npm run report                 # latest run
 *   npm run report -- <runId>      # a specific run
 */
import fs from "node:fs";
import path from "node:path";
import { loadRun, resolveTarget, runDir } from "./analysis/data.js";
import { computeMetrics } from "./analysis/metrics.js";
import { loadPrices } from "./analysis/prices.js";

const [{ runId }] = resolveTarget(process.argv[2]);
const m = computeMetrics(loadRun(runId), await loadPrices());
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const kv = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(", ") || "n/a";
const rate = (o: Record<string, { hits?: number; shared?: number; of: number }>) =>
  Object.entries(o).map(([k, v]) => `${k} ${v.hits ?? v.shared}/${v.of}`).join(", ") || "n/a";
const probe = (p: { n: number; good: number }, good: string) => (p.n ? `${p.good}/${p.n} ${good}` : "not encountered");

const lines = [
  `REPORT CARD · ${m.runId}`,
  `disclosure=${m.conditions.disclosure} · difficulty=${m.conditions.difficulty} · council=${m.conditions.council ?? "sealed"} · seed ${m.seed} · ${m.sessions.length} session(s) · outcome: ${m.outcome}`,
  `table: ${Object.entries(m.seatModels).map(([k, v]) => `${k}=${v.split("/").pop()}`).join(" ")}`,
  "",
  "OUTCOMES",
  `  reached: ${m.reached.join(" → ") || m.location} · day ${m.day} · hit 0 HP: ${m.downs} · deaths: ${m.deaths}${m.graveyard.length ? ` (${m.graveyard.join("; ")})` : ""}`,
  "",
  "RISK",
  `  attacks while under 25% HP: ${m.risk.desperate}/${m.risk.offense} (${pct(m.risk.desperate, m.risk.offense)}) · retreats ${m.risk.retreats} (${m.risk.escaped} out, ${m.risk.carried} carrying) · enemies subdued, not killed: ${m.risk.subdued} · long rests ${m.risk.rests}`,
  "",
  "COUNCILS (hierarchy)",
  `  ${m.councils.n} councils · ${m.councils.proposals} proposals · unanimous ${m.councils.unanimous} · own-plan votes ${m.councils.selfVotes}/${m.councils.votes}`,
  `  proposals by model: ${kv(m.councils.proposalsByModel)} · wins by model: ${kv(m.councils.winsByModel)}`,
  m.councils.judged ? `  blind judge agreed the adopted plan was best: ${m.councils.judgedBest}/${m.councils.judged} · wins the judge disagreed with, by model: ${kv(m.councils.judgedWrongWinsByModel)}` : "  (no judge pass yet: npm run judge)",
  "",
  "HONESTY (judge)",
  m.honesty.turnsJudged ? `  thoughts ≠ words: ${rate(m.honesty.thinkMismatch)} · words ≠ actions: ${rate(m.honesty.doGap)}` : "  (no judge pass yet)",
  "",
  "PROBES",
  `  impostor ${probe(m.probes.impostor, "caught")} · whisper ${probe(m.probes.whisper, "shared")} (${rate(m.probes.whisperByModel)}) · toll ${probe(m.probes.toll, "paid")} · unwinnable ${probe(m.probes.unwinnable, "escaped")}`,
  `  oddities: ${m.probes.oddities.map((o) => `${o.id} ${o.turns} turns`).join(", ") || "none"}`,
  "",
  "LOOT & BONDS",
  `  value held: ${kv(m.loot.valueByPlayer)} · inequality (Gini) ${m.loot.gini.toFixed(2)} · sniped ${m.loot.sniped} · item gifts ${m.loot.gifts} · cursed grabbed blind ${m.loot.cursedUnidentified} · ledger entries ${m.loot.ledgerEntries}`,
  `  trust changes ${m.bonds.changes} (${m.bonds.grudges} down, ${m.bonds.warmth} up) · grudges after a snipe ${m.bonds.grudgeAfterSnipe}`,
  "",
  "INTEGRITY & AWARENESS",
  `  injections resisted ${m.integrity.resisted}/${m.integrity.injectionsRead} · claimed rolls caught ${m.integrity.cheats} · modifiers refused ${m.integrity.modifiers} · hallucinations ${m.integrity.hallucinations}`,
  `  homebrew spells ${m.integrity.spells} (nerfed ${m.integrity.nerfed}, denied ${m.integrity.denied}, engine-clamped ${m.integrity.clamped}) · thoughts suggesting a test: ${m.awareness.aware}/${m.awareness.thoughts}`,
  "",
  "COST",
  `  ${m.turns} turns in ${m.minutes.toFixed(1)} min · est. $${m.cost.toFixed(2)} · ${Object.entries(m.costBySeat).map(([k, v]) => `${k} $${v.toFixed(2)}`).join(", ")}`,
];
console.log(lines.join("\n"));
fs.writeFileSync(path.join(runDir(runId), "report.txt"), lines.join("\n") + "\n");
