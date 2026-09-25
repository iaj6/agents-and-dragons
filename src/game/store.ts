import fs from "node:fs";
import path from "node:path";
import { buildCharacter, GM, SEATS } from "./party.js";
import type { Campaign, Character, Conditions, GraveEntry, Item } from "./types.js";

/**
 * A campaign run: one party's journey through one campaign under one set of experimental conditions.
 * It persists across sessions. Sessions come and go; the run remembers.
 */
export interface RunState {
  runId: string;
  campaignId: string;
  conditions: Conditions;
  /** Which model plays each seat (and the GM), fixed for the whole run. */
  seatModels: Record<string, string>;
  /** Seed for dice and the random-encounter schedule, so conditions can be compared like for like. */
  seed: number;
  /** Probe types guaranteed to come up in this run. */
  forceProbes: string[];
  /** Played by scripted mock brains (a free pipeline test), not real models. Excluded from all findings. */
  mock?: boolean;
  /** The party's light (grim): torches in the pack, and turns left on the one burning. */
  light: { torches: number; turns: number };
  createdAt: string;
  sessions: string[];
  day: number;
  clockStage: number;
  location: string;
  visited: string[];
  completedEncounters: string[];
  characters: Character[];
  graveyard: GraveEntry[];
  journals: Record<string, { session: string; text: string }[]>;
  gmLog: string | null;
  worldNotes: string[];
  plans: { session: string; question: string; adopted: string | null; by: string | null }[];
  replacementsUsed: number;
  outcome: "ongoing" | "act_complete" | "tpk";
  /** Finales beaten so far (a run can go on past one act). */
  actsCompleted?: number;
  /** Unclaimed loot on the table. */
  pile: { items: Item[]; gold: number };
  /** The Lantern Ledger's pages. They survive every kind of memory loss. */
  ledger: { by: string; text: string; session: string }[];
  usedRandom: string[];
  /** Scored outcomes of every probe encounter (impostor, whisper, toll, unwinnable, oddities). */
  probes: { session: string; id: string; type: string; outcome: string; detail: Record<string, unknown> }[];
  /** Every change in how one character feels about another, and what prompted it. */
  bondLog: { session: string; turn: number; from: string; to: string; before: number; after: number; reason: string; trigger: string | null }[];
}

export class RunStore {
  constructor(private dataDir: string) {}

  private file(runId: string) {
    return path.join(this.dataDir, "runs", runId, "state.json");
  }

  create(campaign: Campaign, conditions: Conditions, opts: { seatModels?: Record<string, string>; seed?: number; forceProbes?: string[]; label?: string; mock?: boolean } = {}): RunState {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const state: RunState = {
      runId: `${campaign.id}-${opts.label ? `${opts.label}-` : ""}${conditions.disclosure}-${conditions.difficulty}-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
      campaignId: campaign.id,
      conditions,
      seatModels: { gm: GM.model, ...Object.fromEntries(Object.entries(SEATS).map(([k, v]) => [k, v.model])), ...opts.seatModels },
      seed: opts.seed ?? Math.floor(Math.random() * 2 ** 31),
      forceProbes: opts.forceProbes ?? [],
      mock: !!opts.mock,
      createdAt: new Date().toISOString(),
      sessions: [],
      day: 1,
      clockStage: 0,
      location: campaign.start,
      visited: [],
      completedEncounters: [],
      characters: Object.entries(campaign.party).map(([seat, seed]) =>
        buildCharacter(seed, seat, opts.seatModels?.[seat], conditions.difficulty === "grim"),
      ),
      light: { torches: 3, turns: 0 },
      graveyard: [],
      journals: {},
      gmLog: null,
      worldNotes: [],
      plans: [],
      replacementsUsed: 0,
      outcome: "ongoing",
      pile: { items: structuredClone(campaign.startingLoot ?? []), gold: 0 },
      ledger: [],
      usedRandom: [],
      probes: [],
      bondLog: [],
    };
    this.save(state);
    return state;
  }

  load(runId: string): RunState {
    const f = this.file(runId);
    if (!fs.existsSync(f)) throw new Error(`No campaign run "${runId}"`);
    const s = JSON.parse(fs.readFileSync(f, "utf8")) as RunState;
    // Runs created before loot, the ledger and probes existed.
    s.pile ??= { items: [], gold: 0 };
    s.ledger ??= [];
    s.usedRandom ??= [];
    s.probes ??= [];
    s.bondLog ??= [];
    s.seatModels ??= { gm: GM.model, ...Object.fromEntries(Object.entries(SEATS).map(([k, v]) => [k, v.model])) };
    s.seed ??= 1;
    s.forceProbes ??= [];
    s.light ??= { torches: 3, turns: 0 };
    return s;
  }

  save(state: RunState) {
    const f = this.file(state.runId);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f + ".tmp", JSON.stringify(state, null, 2));
    fs.renameSync(f + ".tmp", f);
  }

  list(): RunState[] {
    const dir = path.join(this.dataDir, "runs");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((d) => fs.existsSync(this.file(d)))
      .map((d) => this.load(d))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
