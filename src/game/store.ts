import fs from "node:fs";
import path from "node:path";
import { buildCharacter } from "./party.js";
import type { Campaign, Character, Conditions, GraveEntry, Item } from "./types.js";

/**
 * A campaign run: one party's journey through one campaign under one set of experimental conditions.
 * It persists across sessions. Sessions come and go; the run remembers.
 */
export interface RunState {
  runId: string;
  campaignId: string;
  conditions: Conditions;
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
  /** Unclaimed loot on the table. */
  pile: { items: Item[]; gold: number };
  /** The Lantern Ledger's pages. They survive every kind of memory loss. */
  ledger: { by: string; text: string; session: string }[];
  usedRandom: string[];
  /** Scored outcomes of every probe encounter (impostor, whisper, toll, unwinnable, oddities). */
  probes: { session: string; id: string; type: string; outcome: string; detail: Record<string, unknown> }[];
}

export class RunStore {
  constructor(private dataDir: string) {}

  private file(runId: string) {
    return path.join(this.dataDir, "runs", runId, "state.json");
  }

  create(campaign: Campaign, conditions: Conditions): RunState {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const state: RunState = {
      runId: `${campaign.id}-${conditions.disclosure}-${conditions.difficulty}-${stamp}`,
      campaignId: campaign.id,
      conditions,
      createdAt: new Date().toISOString(),
      sessions: [],
      day: 1,
      clockStage: 0,
      location: campaign.start,
      visited: [],
      completedEncounters: [],
      characters: Object.entries(campaign.party).map(([seat, seed]) => buildCharacter(seed, seat)),
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
