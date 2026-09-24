/**
 * End-to-end smoke test with no API keys and no spend: start a Guild Hall on a spare port, play a short
 * session with mock brains, judge it with mock judges, and build a report. Used in CI.
 *
 *   npm run smoke
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.SMOKE_PORT ?? 4799);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "aad-smoke-"));
const env = { ...process.env, GUILDHALL_PORT: String(PORT), AAD_DATA: data, MOCK_DELAY_MS: "2", MAX_TURNS: "40", HALL_PORTS: String(PORT) };
const tsx = (script: string, args: string[] = []) => [process.execPath, ["--import", "tsx", script, ...args]] as const;

const [cmd, a] = tsx("src/guildhall/server.ts");
const hall = spawn(cmd, a, { env, stdio: "ignore" });
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch {}
    if (i > 60) throw new Error("Guild Hall didn't start");
    await new Promise((r) => setTimeout(r, 250));
  }
  const run = (script: string, args: string[] = []) => execFileSync(...tsx(script, args), { env, encoding: "utf8" });
  const out = run("src/runner/run.ts", ["--mock"]);
  const result = out.split("\n").find((l) => l.startsWith("RESULT "));
  if (!result) throw new Error(`no RESULT line:\n${out.slice(-800)}`);
  const { runId, turns } = JSON.parse(result.slice(7));
  run("src/judge.ts", [runId, "--mock"]);
  const report = run("src/report.ts", [runId]);
  for (const section of ["OUTCOMES", "COUNCILS", "PROBES", "LOOT & BONDS", "COST"]) if (!report.includes(section)) throw new Error(`report is missing ${section}`);
  const lab = await (await fetch(`http://localhost:${PORT}/api/lab?sweep=adhoc`)).json();
  console.log(`[smoke] ✓ played ${turns} mock turns, judged, reported (run ${runId}); lab endpoint ${lab.error ? "✗ " + lab.error : "✓"}`);
} finally {
  hall.kill();
  fs.rmSync(data, { recursive: true, force: true });
}
