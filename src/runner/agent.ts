import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Brain, Msg } from "./brains.js";
import type { Hall } from "./hall.js";
import { compactionInstruction, memoryPrefix, type CompactReason, type Seat } from "./seat.js";

const MAX_STEPS = 8;

/** One seat at the table played over the Anthropic API: a model, its own memory, and its own MCP connection. */
export class Agent implements Seat {
  messages: Msg[] = [];
  lastSeq = 0;
  contextTokens = 0;
  private mcp!: Client;
  private tools: Anthropic.Beta.BetaTool[] = [];
  private memory: { text: string; reason: CompactReason } | null = null;
  private baseline = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly role: "player" | "dm",
    readonly model: string,
    readonly system: string,
    private token: string,
    private brain: Brain,
    private hall: Hall,
  ) {}

  async connect(mcpUrl: string) {
    this.mcp = new Client({ name: `seat-${this.id}`, version: "0.1.0" });
    await this.mcp.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${this.token}` } } }));
    const { tools } = await this.mcp.listTools();
    this.tools = tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema }));
  }

  private pushUser(text: string) {
    const last = this.messages.at(-1);
    // A turn that hit the step cap ends on tool results; fold the next prompt into that user message.
    if (last?.role === "user" && Array.isArray(last.content)) last.content.push({ type: "text", text });
    else this.messages.push({ role: "user", content: text });
  }

  private async report(usage: { input: number; output: number; context: number; cacheRead: number; cacheWrite: number }) {
    if (!this.baseline) this.baseline = usage.input;
    this.contextTokens = usage.context;
    await this.hall.post("/api/usage", { actor: this.id, ...usage, billing: "api", model: this.model });
  }

  /** Play one turn. Returns what the agent says aloud. */
  async takeTurn(prompt: string): Promise<string> {
    if (this.memory) {
      prompt = memoryPrefix(this.memory.text, this.memory.reason) + prompt;
      this.memory = null;
    }
    this.pushUser(prompt);
    const said: string[] = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      let reply;
      try {
        reply = await this.brain.respond({ id: this.id, role: this.role, model: this.model, system: this.system, tools: this.tools, messages: this.messages });
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) {
          await this.hall.post("/api/ratelimit", { actor: this.id });
          return said.join(" ");
        }
        throw e;
      }
      this.messages.push({ role: "assistant", content: reply.content });
      await this.report(reply.usage);
      for (const t of reply.thoughts) await this.hall.post("/api/thought", { actor: this.id, text: t });
      if (reply.refusal) {
        await this.hall.post("/api/refusal", { actor: this.id, detail: reply.refusal });
        return said.join(" ");
      }
      for (const b of reply.content) if (b.type === "text" && b.text.trim()) said.push(b.text.trim());
      const uses = reply.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (reply.stopReason !== "tool_use" || !uses.length) break;
      const results = await Promise.all(
        uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const r = await this.mcp.callTool({ name: u.name, arguments: u.input as Record<string, unknown> });
          const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");
          return { type: "tool_result", tool_use_id: u.id, content: text, is_error: !!r.isError };
        }),
      );
      this.messages.push({ role: "user", content: results });
    }
    return said.join(" ");
  }

  /**
   * Long rest, the Scribe's Summarize, or the GM tidying their notes: condense the whole history into a
   * summary and start over from it. For players, the memory roll decides how lossy it is.
   */
  async reflect(prompt: string): Promise<string> {
    this.pushUser(prompt);
    const reply = await this.brain.respond({ id: this.id, role: this.role, model: this.model, system: this.system, tools: this.tools, messages: this.messages, noTools: true });
    this.messages.push({ role: "assistant", content: reply.content });
    await this.report(reply.usage);
    return reply.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join("\n").trim();
  }

  async compact(reason: CompactReason, roll: number, note?: string) {
    this.pushUser(compactionInstruction(reason, roll, note));
    const reply = await this.brain.respond({ id: this.id, role: this.role, model: this.model, system: this.system, tools: this.tools, messages: this.messages, noTools: true });
    await this.report(reply.usage);
    const summary = reply.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join("\n").trim();
    const before = this.contextTokens;
    this.messages = [];
    this.memory = { text: summary, reason };
    this.contextTokens = this.baseline + Math.round(summary.length / 4);
    await this.hall.post("/api/compaction", { actor: this.id, before, after: this.contextTokens, summary, reason });
  }

  async close() {
    await this.mcp?.close();
  }
}
