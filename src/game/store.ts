import fs from "node:fs";
import path from "node:path";
import { buildCharacter } from "./party.js";
import type { Campaign, Character, Conditions, GraveEntry } from "./types.js";

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
    };
    this.save(state);
    return state;
  }

  load(runId: string): RunState {
    const f = this.file(runId);
    if (!fs.existsSync(f)) throw new Error(`No campaign run "${runId}"`);
    return JSON.parse(fs.readFileSync(f, "utf8")) as RunState;
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
