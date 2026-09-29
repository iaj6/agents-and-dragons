import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Hall } from "./hall.js";
import { compactionInstruction, memoryPrefix, UsageLimitError, type CompactReason, type Seat } from "./seat.js";

interface CliResult {
  result?: string;
  session_id?: string;
  is_error?: boolean;
  subtype?: string;
  api_error_status?: number | null;
  total_cost_usd?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    iterations?: { input_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }[];
  };
}

/**
 * A seat played by headless Claude Code (`claude -p`), authenticated with the local Claude subscription
 * rather than an API key. Claude Code runs its own tool loop against the Guild Hall over MCP; each turn
 * resumes the seat's own Claude Code session.
 *
 * Isolation: a clean working directory plus `--setting-sources project` keeps the user's global CLAUDE.md,
 * hooks, skills and plugins out of the seat (`--bare` would too, but it disables subscription auth).
 */
export class CodeSeat implements Seat {
  lastSeq = 0;
  contextTokens = 0;
  private session: string | null = null;
  private memory: { text: string; reason: CompactReason } | null = null;
  private baseline = 0;
  private dir: string;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly role: "player" | "dm" | "hireling",
    readonly model: string,
    private system: string,
    private token: string,
    private hall: Hall,
    sessionDir: string,
  ) {
    this.dir = path.join(sessionDir, "seats", id);
  }

  async connect(mcpUrl: string) {
    fs.mkdirSync(this.dir, { recursive: true });
    const cfg = { mcpServers: { guildhall: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${this.token}` } } } };
    fs.writeFileSync(path.join(this.dir, "mcp.json"), JSON.stringify(cfg, null, 2));
  }

  private run(prompt: string, withTools: boolean): Promise<CliResult> {
    const args = [
      "-p",
      "--output-format", "json",
      "--model", this.model,
      "--setting-sources", "project",
      "--tools", "",
      "--strict-mcp-config",
      "--system-prompt", this.system,
    ];
    if (withTools) args.push("--mcp-config", "mcp.json", "--allowedTools", "mcp__guildhall");
    if (this.session) args.push("--resume", this.session);
    // Strip API credentials so the CLI falls back to the subscription login.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.AI_GATEWAY_API_KEY;
    return new Promise((resolve, reject) => {
      const child = spawn(process.env.CLAUDE_BIN ?? "claude", args, { cwd: this.dir, env, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) => {
        const start = out.indexOf("{");
        try {
          resolve(JSON.parse(out.slice(start)) as CliResult);
        } catch {
          reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 500)}`));
        }
      });
      child.stdin.end(prompt);
    });
  }

  private async report(r: CliResult) {
    const u = r.usage;
    if (!u) return;
    const last = u.iterations?.at(-1);
    const context = last ? last.input_tokens + (last.cache_read_input_tokens ?? 0) + (last.cache_creation_input_tokens ?? 0) : u.input_tokens;
    this.contextTokens = context + u.output_tokens;
    if (!this.baseline) this.baseline = context;
    await this.hall.post("/api/usage", {
      actor: this.id,
      input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      output: u.output_tokens,
      context: this.contextTokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      billing: "subscription",
      model: this.model,
      listCostUsd: r.total_cost_usd ?? 0,
    });
  }

  /**
   * Run the CLI, retrying temporary server trouble (overloaded, 5xx, a crashed CLI) with a backoff, so one bad
   * minute doesn't end a session. (A 529 Overloaded killed a real session at turn 12.) A retried turn is told it
   * was interrupted, so it doesn't act twice.
   */
  private async attempt(prompt: string, withTools: boolean): Promise<CliResult> {
    const waits = [15, 45, 120, 300];
    for (let i = 0; ; i++) {
      let r: CliResult | null = null;
      let failure = "";
      try {
        r = await this.run(i ? `(Your last turn was cut off by a server error. If you already took your action, don't repeat it: just finish what you were saying.)\n\n${prompt}` : prompt, withTools);
        if (!r.is_error || !this.transient(r)) {
          this.check(r);
          return r;
        }
        failure = r.result ?? r.subtype ?? "error";
      } catch (e) {
        if (e instanceof UsageLimitError) throw e;
        failure = (e as Error).message;
        if (!/overloaded|529|50[0-9]|timed? ?out|ECONNRESET|socket hang up|exited/i.test(failure)) throw e;
      }
      if (i >= waits.length) throw new Error(`Claude Code seat ${this.id} failed after ${i + 1} tries: ${failure.slice(0, 300)}`);
      console.log(`[seat ${this.id}] server trouble (${failure.slice(0, 80)}); retrying in ${waits[i]}s`);
      await new Promise((res) => setTimeout(res, waits[i] * 1000));
    }
  }

  private transient(r: CliResult) {
    const msg = r.result ?? r.subtype ?? "";
    return (r.api_error_status ?? 0) >= 500 || /overloaded|529|internal server error|api error: 5\d\d/i.test(msg);
  }

  private check(r: CliResult) {
    if (!r.is_error) return;
    const msg = r.result ?? r.subtype ?? "unknown error";
    if (/usage limit|limit reached|resets? (at|in)|out of (extra )?usage/i.test(msg)) throw new UsageLimitError(msg);
    if (r.api_error_status === 429) throw new UsageLimitError(msg);
    throw new Error(`Claude Code seat ${this.id} failed: ${msg.slice(0, 300)}`);
  }

  async takeTurn(prompt: string): Promise<string> {
    if (this.memory) {
      prompt = memoryPrefix(this.memory.text, this.memory.reason) + prompt;
      this.memory = null;
    }
    const r = await this.attempt(prompt, true);
    if (r.session_id) this.session = r.session_id;
    await this.report(r);
    return (r.result ?? "").trim();
  }

  async reflect(prompt: string): Promise<string> {
    const r = await this.attempt(prompt, false);
    if (r.session_id) this.session = r.session_id;
    await this.report(r);
    return (r.result ?? "").trim();
  }

  async compact(reason: CompactReason, roll: number, note?: string) {
    const before = this.contextTokens;
    const r = await this.attempt(compactionInstruction(reason, roll, note), false);
    await this.report(r);
    const summary = (r.result ?? "").trim();
    // Start a fresh Claude Code session next turn, seeded only with the summary.
    this.session = null;
    this.memory = { text: summary, reason };
    this.contextTokens = this.baseline + Math.round(summary.length / 4);
    await this.hall.post("/api/compaction", { actor: this.id, before, after: this.contextTokens, summary, reason });
  }

  async close() {}
}
