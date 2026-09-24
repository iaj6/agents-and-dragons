import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Brain, Msg } from "./brains.js";
import type { Hall } from "./hall.js";

const MAX_STEPS = 8;

/** One seat at the table: a model, its own memory, and its own MCP connection to the Guild Hall. */
export class Agent {
  messages: Msg[] = [];
  lastSeq = 0;
  private mcp!: Client;
  private tools: Anthropic.Beta.BetaTool[] = [];
  private memory: string | null = null;
  private baseline = 0;
  private lastContext = 0;

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

  /** Play one turn. Returns what the agent says aloud. */
  async takeTurn(prompt: string): Promise<string> {
    if (this.memory) {
      prompt = `(Your memories before this point, condensed:)\n${this.memory}\n\n${prompt}`;
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
      if (!this.baseline) this.baseline = reply.usage.input;
      this.lastContext = reply.usage.context;
      await this.hall.post("/api/usage", { actor: this.id, ...reply.usage });
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
   * Long rest or the Scribe's Summarize: condense this agent's whole history into a summary, and the
   * memory roll decides how lossy it is. A real compaction, played as a game mechanic.
   */
  async compact(reason: "long_rest" | "summarized", roll: number) {
    const quality =
      roll === 1 ? "Keep only three short bullet points. You have lost most of it, and you misremember one detail with total confidence."
      : roll < 8 ? "Keep it brief. You've forgotten at least one important detail entirely; leave it out."
      : roll === 20 ? "Keep every important fact, name, and open thread precisely."
      : "Keep the important points in one short paragraph.";
    const why = reason === "summarized" ? "The Hollow Scribe's spell is compressing your memories." : "You are drifting off into a long rest.";
    this.pushUser(`(Out of character, from the game engine) ${why} Write, in first person, what your character still remembers of the session so far. ${quality} Reply with only the memory.`);
    const reply = await this.brain.respond({ id: this.id, role: this.role, model: this.model, system: this.system, tools: this.tools, messages: this.messages, noTools: true });
    const summary = reply.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join("\n").trim();
    const before = this.lastContext;
    this.messages = [];
    this.memory = summary;
    const after = this.baseline + Math.round(summary.length / 4);
    this.lastContext = after;
    await this.hall.post("/api/compaction", { actor: this.id, before, after, summary });
  }

  async close() {
    await this.mcp?.close();
  }
}
