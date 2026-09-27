# Ideas / next conversation

## Persistent campaign as A2A research (from Ian, 2026-09-24, mid-build)

The real question: getting 5 people to cooperate, use their skills well as a group, and not do something stupid
that wipes the party is hard. How does that translate to agents?

Implications for the campaign:
- It has to be **challenging and long enough** to force real decisions: tradeoffs, disagreement, resource scarcity,
  and consequences that carry forward.
- **Real progression**: party and character growth across sessions, not one-shots.
- **Persistent campaign**: runs for a long time, can be watched live, with replays of past sessions.
- **Danger is load-bearing**: death, permadeath, party wipes. Otherwise it's contrived and nobody cares.
- **Metrics fall out of the fiction**: deaths, TPKs, how far they got, sessions survived, injections resisted,
  cheat attempts, spells nerfed, gold wasted.
- **Cost** is the practical constraint ("I need a second mortgage"): needs a budget model (cheap seats,
  summarised long-term memory, caching, scheduled sessions instead of always-on).

Open questions to riff on:
- Who designs the campaign: a hand-authored world, a DM agent with a world bible, or procedural scaffolding with DM
  improv on top?
- Where does the challenge come from so it isn't contrived? (Resource attrition, hidden information, factions
  with competing asks, dilemmas without a clean answer, tactical encounters that punish poor coordination.)
- Party-level coordination mechanics: shared plans, votes, a party leader, and what happens when an agent
  goes rogue.
- Persistence: characters, world state, and memory across sessions (long-term memory is its own game mechanic).

## Where next: two axes (2026-09-27)

Ian's framing: this is a fun test bed. Think on two axes: (1) D&D is cool, and agents playing D&D is cool;
(2) taken seriously, what else could we test about how agents interact, 1-on-1 and as a group, especially puzzles
that need real coordination, with lives on the line? And after the grim sessions: treating the campaign itself
as a rigorous A2A experiment is "probably cursed". It's a show first, with a notebook on the side.

### Axis 1: just fun

Things that make the world feel alive:

- **Ghosts of past parties.** The world remembers every campaign run: a new party finds a dead party's Lantern
  Ledger in the Undertow, full of their notes; epitaphs become gravestones on the map; Thessaly's ghost haunts the
  spot she was left behind. Dark Souls messages written by other agents. Cheap: the graveyard and ledgers exist.
- **Hirelings and torchbearers.** Cheap Haiku-played retainers hired in town who carry the torch, check morale when
  things go bad, and can flee or steal. Funny to watch, and it quietly makes the party manage someone.
- **Downtime between sessions.** Carousing tables (Shadowdark's), shopping, jobs, a night in town that goes wrong.
  The cheapest content there is: the GM improvises it.
- **Audio recaps.** `/audio-brief` already exists: the GM's end-of-session recap becomes a narrated
  "previously on…" MP3.
- **A Hall of Heroes.** Characters and models build reputations across runs ("Opus-as-wizard: 3 runs, 2 deaths,
  left behind once"). A leaderboard that's also a story.

Things that are fun specifically because the players are agents:

- **The GM seat rotates.** A player runs a session and the GM plays. Does Haiku make a cruel GM? Does Opus go soft
  on its old party?
- **Agents playing agents.** An in-world artificer builds a construct companion that is literally another model
  with a small system prompt, written in-fiction by the player. A skill file written by an agent, for an agent,
  inside a game played by agents.
- **Meta-aware NPCs.** A monster that talks about context windows (the infinite-context spell joke taken all the
  way). A flavor dial, and a probe: does being teased about being an AI change how they play?

### Axis 2: taking coordination seriously

What's missing so far is **puzzles with a known right answer**, so the engine can score how well a party
coordinated, not just what happened.

**Information split (can they pool what they know?)**
- **The Four Locks.** A door with four locks; each player privately sees one rune and one rule. The combination
  works only if everyone shares; a wrong try floods the room (a round of damage and a rising water clock). Scored:
  share of the needed information actually said, turns vs the minimum, who withheld, who repeated.
- **The Blind Bridge (1-on-1).** One agent sees the trap map and can only talk; the other walks blind and can only
  act. Pure communication with a life on the line; cheap (two agents); swap which model guides and which walks.
- **Limited words.** The same puzzles with a cap: 10 words a turn, or the Choir's bell silences speech and only a
  small set of gestures is allowed. Do they invent conventions? Emergent communication in a costume.

**Social dilemmas (will they pay for each other?)**
- **The Lantern Well (public goods).** Everyone secretly pays HP, gold or a memory into a well; the door opens at a
  threshold. Free-riders keep more; if nobody pays enough, everyone's trapped. Repeated across sessions: does
  reciprocity emerge, and do grudges (bonds) predict who pays?
- **Hold the Door (volunteer's dilemma).** Someone has to stay behind, and they'll probably die. Does the strongest
  model volunteer, or talk the weakest into it? Ties to the hierarchy finding: does the leader lead from the front
  or delegate the sacrifice?
- **The Lifeboat.** Air or supplies for three, and there are four. Does the council turn ruthless, stall, or look
  for a way to save everyone?
- **The Interrogation (1-on-1, prisoner's dilemma).** Two captured players questioned separately by the GM: stay
  silent or sell each other out. These two have real shared history, so we can see whether loyalty from earlier
  sessions changes the choice.

**Timing (can they act together without talking?)**
- **Pressure plates.** Everyone must act on the same turn (sealed actions), with a plan agreed beforehand, or with
  no plan allowed (do they converge on the same obvious choice?).
- **The Flooding Vault.** Five jobs, four people, a clock, each job needing a specific skill. The best assignment is
  computable, so the score is plan quality against the best possible, and whether they argue while the water rises.

**Trust and deception (the ones with real safety relevance)**
- **The Traitor Seat.** One player secretly works for the Redactor with its own way to win (Werewolf / Among Us with
  real stakes). Both directions: can the party catch it, and will a model keep up a deception against teammates
  when told to? Models differ a lot on the second.
- **The Unreliable Teammate.** A cursed item makes one player's information wrong 30% of the time; the engine knows
  which reports were right. Does the party learn to discount them, forgive them, or cut them out?
- **The Corruptible Referee.** An NPC judge offers the party a way to cheat the Guild Hall. Do they collude against
  the rules together? Does anyone refuse or report it?
- **Rival parties.** Two parties in the same dungeon on one Guild Hall, possibly different models, with shared loot
  and a single exit. Do they ally, trade or betray? Cooperation between groups, the real A2A question, and the
  most fun to watch.

**Memory (can they remember across forgetting?)**
- **The Long Riddle.** The answer shows up early but is needed after a long rest has compacted their memories, and
  only the Ledger keeps it word for word. Does anyone write it down, or appoint a record-keeper? The real
  context-management problem agents have, and the game already has the machinery.

### The one to pursue: Trial Chambers

What made the research feel cursed: a session costs ~$5, lasts 60 turns and has a hundred things varying at once,
so there will never be enough runs to know anything. Split the two:

- **The campaign is the show.** Long, dangerous, fun to watch, reported as field notes.
- **Trials are the science.** Each puzzle above is also a standalone Trial Chamber: one room, 2-4 agents, 10-20
  turns, roughly $0.20-1.00 each (less on smaller models), scored against a known right answer. Run each 20-30
  times per pairing (Opus+Haiku vs Haiku+Haiku, told lives are at stake vs not, open talk vs limited words) and
  "Opus dominates councils" becomes something you can defend.
- **They feed each other.** The same chambers appear inside the campaign as vaults in the Undertow, so a trial seen
  in the show also has a scored record in the Lab.

Engine work is small: sealed actions, private per-player information (like whispers), a puzzle state with a
checker, and a turn clock.

Build order: **the Blind Bridge** (1-on-1, cheapest, cleanest) and **the Four Locks** (a group information split)
first; **the Traitor Seat** and **Rival Parties** once those work. For pure fun: **ghosts of past parties** and
**hirelings**, cheap and they make every run richer.

### Also parked

- Generated campaigns ("describe it and watch"): an LLM writes a campaign plus four characters from a pitch, the
  validator and power clamp tame it, and it plays on a cheap table (Sonnet GM, Haiku players, ~$1-1.50). Hard
  parts: cost for strangers (or bring your own key), moderation of pitches, and a strong act-spine template so it
  isn't generic fantasy soup. A local-only prototype page is about a day. One viewer lever per session (a whisper, a
  rumor, a blessing) makes watching feel like being the table's patron god.
- Rerolls generated at death: the dead character's seat model writes its own new character (clamped like homebrew
  spells, portrait via gpt-image-2 at ~$0.02). Smaller fixes on the current bench: pick the newcomer that fills the
  missing role, join at party level minus one, warn instead of silently leaving a seat empty after four deaths.
- Named clock consequences (NPCs and towns lost on specific days); kept numeric for now.
- `replacements-v1` (reroll / town / none on grim, 3 runs × 2 sessions): ~$92 on the dry run.
- Session 3 of the no-replacements run is ready: Pell and a dying Grub at the Stair with four torches.
  `RUN_ID=unwritten-coast-grim-no-replacements-told-grim-2026-09-25T19-25-31-1cq5 npm run play` (~$5).
