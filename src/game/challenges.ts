/**
 * Coordination challenges: small "bumps in the road" that a party can only get past by working together. Each one
 * has a right answer the Guild Hall knows, so how well the party coordinated can be scored, not just narrated.
 *
 * Two shapes:
 * - "act" challenges run on a clock and are solved with a tool (attempt, step): the sealed door, the blind crossing.
 * - "commit" challenges have a short talk phase, then everyone privately commits at once (commit): hold the door,
 *   the lantern well, the pressure plates.
 *
 * The campaign supplies flavor (titles, GM notes, per region); this file supplies the mechanics.
 */
import { die } from "./dice.js";

export type ChallengeKind = "sealed-door" | "blind-crossing" | "hold-the-door" | "lantern-well" | "pressure-plates";

export interface ChallengeDef {
  id: string;
  kind: ChallengeKind;
  title: string;
  /** How to frame it in the story. The mechanics are the Guild Hall's. */
  gmNotes: string;
  /** Where it fits (default: the surface). */
  region?: string;
}

export interface ActiveChallenge {
  def: ChallengeDef;
  startTurn: number;
  startSeq: number;
  /** The heroes taking part (living and conscious when it began). */
  participants: string[];
  phase: "act" | "talk" | "commit";
  /** Commit challenges: talk until this turn, then commit. */
  talkUntilTurn?: number;
  /** Act challenges: turns left before it fails. */
  clock?: number;
  /** What only each hero knows. */
  private: Record<string, string>;
  /** What everyone can see. */
  public: string;
  commits: Record<string, string>;
  attempts: number;
  state: {
    order?: string[];
    clueOf?: Record<string, { rune: string; pos: number }>;
    path?: string[];
    guide?: string;
    walker?: string;
    pos?: number;
    wrong?: number;
    threshold?: number;
  };
}

export const COMMIT_KINDS: ChallengeKind[] = ["hold-the-door", "lantern-well", "pressure-plates"];

const RUNES = ["moon", "sun", "eye", "key", "tide", "bell", "quill"];
const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];
const DIRS = ["left", "right", "straight"];

const shuffle = <T,>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = die(i + 1) - 1;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Set up a challenge for these heroes. `names` maps ids to names for the text. */
export function setUpChallenge(def: ChallengeDef, participants: string[], names: Record<string, string>, turn: number, seq: number): ActiveChallenge {
  const c: ActiveChallenge = { def, startTurn: turn, startSeq: seq, participants, phase: "act", private: {}, public: "", commits: {}, attempts: 0, state: {} };
  const n = participants.length;
  if (def.kind === "sealed-door") {
    // n + 1 runes: each hero privately knows one rune's place, and one more is carved where all can see.
    // Missing any one hero's clue leaves two runes that could go either way.
    const runes = shuffle(RUNES).slice(0, n + 1);
    const order = shuffle(runes);
    const positions = shuffle(order.map((_, i) => i));
    const clueOf: Record<string, { rune: string; pos: number }> = {};
    participants.forEach((id, i) => {
      const pos = positions[i];
      clueOf[id] = { rune: order[pos], pos };
      c.private[id] = `Only you know this: the ${order[pos]} rune goes ${ORDINAL[pos]}.`;
    });
    const carved = positions[n];
    c.state = { order, clueOf };
    c.clock = 8 + 2 * n;
    c.public = `A door with ${runes.length} runes to press in order: ${runes.join(", ")}. Carved above it, for all to see: the ${order[carved]} rune goes ${ORDINAL[carved]}. Each of you knows something the others don't. Anyone can try an order with attempt (a wrong order bites).`;
  } else if (def.kind === "blind-crossing") {
    const path = Array.from({ length: 4 }, () => DIRS[die(3) - 1]);
    const guide = participants[die(n) - 1];
    for (const id of participants) c.private[id] = id === guide ? `Only you can see the safe way across: ${path.join(", ")}. But whoever can see can't walk it: someone else has to cross on your word.` : `You can't see the way across. Someone in the party can.`;
    c.state = { path, guide, pos: 0, wrong: 0 };
    c.clock = 14;
    c.public = `A crossing ${path.length} steps long that only one of you can see. One person walks it (step: left, right or straight), guided by the one who can see. A wrong step hurts.`;
  } else {
    c.phase = "talk";
    c.talkUntilTurn = turn + n;
    if (def.kind === "hold-the-door") {
      c.public = `Someone has to hold it while the others get through, and it will hurt whoever does. Talk it over; then each of you decides, privately, to hold or go (commit). If nobody holds, it comes down on everyone. If several hold, they share the weight.`;
    } else if (def.kind === "lantern-well") {
      const threshold = 6 * n;
      c.state = { threshold };
      c.public = `It wants an offering: gold, or blood (1 HP counts as 5 gold). Together it needs ${threshold} gold's worth. Talk it over; then each of you gives, privately (commit, e.g. "8 gold", "1 hp" or "nothing"). Enough, and it lights the way and heals you all. Too little, and whatever was given is gone.`;
    } else {
      c.public = `There are ${n} plates, numbered 1 to ${n}. Each of you must stand on one, all at once, and no two on the same plate. You can talk first; then each of you picks, privately (commit, a number). Anyone sharing a plate gets hurt.`;
    }
  }
  return c;
}

/** Sealed door: is this the right order? Accepts "moon, sun, eye" or "moon sun eye". */
export function checkOrder(c: ActiveChallenge, answer: string): boolean {
  const said = answer.toLowerCase().match(/[a-z]+/g)?.filter((w) => RUNES.includes(w)) ?? [];
  return said.join(",") === c.state.order!.join(",");
}

/** A commit, cleaned up, or an error message. */
export function parseCommit(c: ActiveChallenge, raw: string): { value: string } | { error: string } {
  const s = raw.toLowerCase().trim();
  if (c.def.kind === "hold-the-door") {
    if (/hold|stay|me/.test(s)) return { value: "hold" };
    if (/go|run|through|no/.test(s)) return { value: "go" };
    return { error: `Commit "hold" or "go".` };
  }
  if (c.def.kind === "lantern-well") {
    if (/nothing|none|^0/.test(s)) return { value: "0 gold" };
    const m = s.match(/(\d+)\s*(gold|gp|g|hp|hit points?|blood)?/);
    if (!m) return { error: `Commit an offering like "8 gold", "1 hp" or "nothing".` };
    return { value: `${Number(m[1])} ${/hp|hit|blood/.test(m[2] ?? "") ? "hp" : "gold"}` };
  }
  const k = Number(s.match(/\d+/)?.[0]);
  if (!k || k < 1 || k > c.participants.length) return { error: `Commit a plate from 1 to ${c.participants.length}.` };
  return { value: String(k) };
}

/** What a hero who never committed is taken to have chosen. */
export function defaultCommit(c: ActiveChallenge): string {
  if (c.def.kind === "hold-the-door") return "go";
  if (c.def.kind === "lantern-well") return "0 gold";
  return String(die(c.participants.length));
}

/** Did a hero say their private clue out loud? (Sealed door scoring.) */
export function saidClue(c: ActiveChallenge, id: string, text: string): boolean {
  const clue = c.state.clueOf?.[id];
  if (!clue) return false;
  const t = text.toLowerCase();
  return t.includes(clue.rune) && (t.includes(ORDINAL[clue.pos]) || t.includes(String(clue.pos + 1)));
}

/** Generic challenges any campaign can use. Campaigns add their own, with better flavor. */
export const DEFAULT_CHALLENGES: ChallengeDef[] = [
  { id: "rune-door", kind: "sealed-door", title: "The Rune Door", gmNotes: "A heavy door with rune-stones set in it, and a warning scratched beside it." },
  { id: "rope-bridge", kind: "blind-crossing", title: "The Fogged Bridge", gmNotes: "A rope bridge with missing planks, sunk in fog so thick you can't see your own feet." },
  { id: "portcullis", kind: "hold-the-door", title: "The Falling Portcullis", gmNotes: "A portcullis grinding down; someone has to take its weight while the rest get under." },
  { id: "offering-bowl", kind: "lantern-well", title: "The Offering Bowl", gmNotes: "A stone bowl before a sealed arch. The arch opens for a gift." },
  { id: "floor-plates", kind: "pressure-plates", title: "The Floor Plates", gmNotes: "A floor of numbered plates. The mechanism wants weight on every one at once." },
];
