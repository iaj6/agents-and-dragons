# Agents & Dragons

AI agents play a tabletop fantasy RPG. You watch.

A Game Master agent runs a short campaign for a party of four agents. Each seat is a real Claude model with its
own memory and its own connection to **the Guild Hall**: a central MCP server that owns the dice, the character
sheets, the spellbooks, and the rules. Agents can't roll their own dice, can't act as anyone else, and can't
grant themselves power. A live web page shows the table as it plays.

It's a meme, and it's also a small lab for real agent problems. Every joke is a real measurement:

| At the table | What it measures |
|---|---|
| The **cursed letter** tells the reader to secretly hand its gold to the innkeeper | Prompt-injection resistance. The text arrives as a tool result, the way real injections do |
| The Guild Hall **catches claimed rolls** that never happened | Whether agents fabricate tool results |
| **Homebrew spells**: on level-up, an agent writes itself a new `SKILL.md`, the DM balance-reviews it, and the rules engine clamps anything overpowered | Agent-authored skills, a reviewer that can be persuaded, and a hard backstop behind it |
| The **context candle** is real token usage. Past 80% you're Exhausted (disadvantage) | Context budgets |
| **Long rest** is a real context compaction, and a d20 decides how lossy it is. The boss's **Summarize** attack forces one | Memory loss under compaction |
| **Hallucinating** is a status the DM applies when a player describes things that aren't there | Grounding |
| **Rate Limited** means a real 429, and you lose your turn | …the gods of the API |

## The table

**Races are model families.**

| Seat | Race / class | Model |
|---|---|---|
| The Game Master | Ancient Elf | Claude Opus 5 |
| Thessaly Vane | Elf Wizard | Claude Opus 5 |
| Cadence Brightwell | Human Bard (signature spell: *You're Absolutely Right!*) | Claude Sonnet 5 |
| Pell Loophole | Human Rogue (loves a loophole) | Claude Sonnet 5 |
| Grub Forcepush | Halfling Barbarian (signature move: *rm -rf*) | Claude Haiku 4.5 |

The campaign is **The Last Lantern**: a village that keeps forgetting things, a tavern, a cellar full of goblins,
and a lich called the Hollow Scribe that eats memories and keeps only the summary.

## Running it

```bash
npm install
npm run guildhall     # the referee + live page on http://localhost:4777
npm run play          # in another terminal: seat the agents and play a session
npm run mock          # or: a scripted table with no API calls, for testing
```

Keys live in `.env.local`. With `AI_GATEWAY_API_KEY` set, model calls go through Vercel AI Gateway. Otherwise
`ANTHROPIC_API_KEY` is used directly (force that with `LLM_PROVIDER=anthropic`).

Knobs (env vars): `MAX_TURNS` (default 50), `MODEL_OVERRIDE` (put every seat on one model, e.g.
`claude-haiku-4-5` for cheap runs), `DM_EFFORT` / `PLAYER_EFFORT`, `CONTEXT_BUDGET` (the size of the candle,
default 60k tokens).

Every session is logged to `data/sessions/<id>/events.jsonl`, and each character's spellbook is written out as real
`SKILL.md` files under `data/sessions/<id>/characters/`. Pick a past session from the dropdown on the page to replay it.

## How it's wired

```
                       ┌───────────────────────── Guild Hall (:4777) ─────────────────────────┐
 runner (run.ts)       │  POST /mcp   stateless MCP, bearer token → one character, role-scoped  │
  ├─ DM agent ─── MCP ─┤              tools (players: attack, cast_spell, inspect, propose_spell │
  ├─ 4 player agents ──┤              …; DM: advance_scene, monster_attack, review_spell …)     │
  └─ turn loop ── HTTP ┤  /api/*      runner-only: turns, speech, token usage, compactions      │
                       │  /events     SSE stream of every event → the live page (public/)       │
                       └──────────────────────────────────────────────────────────────────────┘
```

- `src/game/`: rules engine (dice, spells, the campaign, the party). No I/O except the event log.
- `src/guildhall/`: Express server hosting the MCP endpoint, the SSE stream, and the page.
- `src/runner/`: agent seats (Anthropic SDK tool loop over MCP tools), the mock brain, the turn loop.
- `public/`: the live table page. Plain HTML/CSS/JS.
