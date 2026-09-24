import type { Campaign } from "../types.js";
import { LAST_LANTERN } from "./last-lantern.js";
import { UNWRITTEN_COAST } from "./unwritten-coast.js";

export const CAMPAIGNS: Record<string, Campaign> = {
  [LAST_LANTERN.id]: LAST_LANTERN,
  [UNWRITTEN_COAST.id]: UNWRITTEN_COAST,
};

export function getCampaign(id: string): Campaign {
  const c = CAMPAIGNS[id];
  if (!c) throw new Error(`Unknown campaign "${id}". Known: ${Object.keys(CAMPAIGNS).join(", ")}`);
  return c;
}
