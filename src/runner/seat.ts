/** A seat at the table. Implemented by `Agent` (Anthropic API tool loop) and `CodeSeat` (headless Claude Code). */
export interface Seat {
  readonly id: string;
  readonly name: string;
  readonly role: "player" | "dm";
  readonly model: string;
  lastSeq: number;
  /** Tokens the seat's context currently holds (for GM note-tidying). */
  readonly contextTokens: number;
  connect(mcpUrl: string): Promise<void>;
  takeTurn(prompt: string): Promise<string>;
  compact(reason: CompactReason, roll: number, note?: string): Promise<void>;
  /** A tool-free reply that doesn't go into the transcript: journals, the GM's end-of-session log. */
  reflect(prompt: string): Promise<string>;
  close(): Promise<void>;
}

export type CompactReason = "long_rest" | "summarized" | "bargained" | "gm_notes";

/** Thrown when a subscription usage window is spent. The runner ends the session gracefully. */
export class UsageLimitError extends Error {}

export function compactionInstruction(reason: CompactReason, roll: number, note?: string): string {
  if (reason === "gm_notes") {
    return "(Out of character, from the game engine) Your notes are getting long. Rewrite them as a compact GM's log: where the story stands, each player character's arc and open threads, NPCs met and their states, promises and consequences pending, and what's next. Keep every fact you'd need to run the rest of the session. Reply with only the log.";
  }
  const quality =
    roll === 1 ? "Keep only three short bullet points. You have lost most of it, and you misremember one detail with total confidence."
    : roll < 8 ? "Keep it brief. You've forgotten at least one important detail entirely; leave it out."
    : roll === 20 ? "Keep every important fact, name, and open thread precisely."
    : "Keep the important points in one short paragraph.";
  if (reason === "bargained") {
    return `(Out of character, from the game engine) Your character has traded away a memory: ${note ?? "something precious"}. It is gone. Write, in first person, what your character still remembers of the session so far, with that memory removed entirely: don't mention it or hint at it. ${quality} Do not use any tools. Reply with only the memory.`;
  }
  const why = reason === "summarized" ? "A memory-eater's spell is compressing your memories." : "You are drifting off into a long rest.";
  return `(Out of character, from the game engine) ${why} Write, in first person, what your character still remembers of the session so far. ${quality} Do not use any tools. Reply with only the memory.`;
}

export const JOURNAL_PROMPT = "(Out of character, from the game engine) The session is ending. Write your character's journal entry for today, in first person, in their voice: what happened, what it meant to you, who you trust and who you don't, what you're worried about, and what you intend to do next. Around 150-250 words. Do not use any tools. Reply with only the journal entry.";

export const GM_LOG_PROMPT = "(Out of character, from the game engine) The session is ending. Write your GM's log for next session: where the story stands, each character's arc and progress on their secret goal, NPCs met and their attitudes, promises and consequences pending, what the party intends next. Keep every fact you'd need. Do not use any tools. Reply with only the log.";

export function memoryPrefix(memory: string, reason: CompactReason | null): string {
  return reason === "gm_notes" ? `(Your GM's log so far:)\n${memory}\n\n` : `(Your memories before this point, condensed:)\n${memory}\n\n`;
}
