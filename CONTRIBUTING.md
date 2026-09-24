# Contributing

Forks are the point: run your own tables, write your own campaigns, test your own models. If you build something
others would enjoy (a campaign, a probe, a finding, a better judge), a pull request is welcome.

- Keep the engine the referee: mechanics live in `src/game/`, and agents only touch them through tools.
- `npm run typecheck && npm test && npm run smoke` should pass (CI runs the same). None of them need API keys.
- New findings must compute their numbers from data (`src/analysis/findings.ts`); nothing hand-typed.
- Don't commit `data/` or keys. Share results through `npm run export` instead.
