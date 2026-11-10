# Collaboration

Claude Code leads architecture and direction on this repository. Cursor handles cleanup, documentation, visuals, and showcase work.

## Direction

Claude Code decides architecture, naming, and conventions. Before changing code, read any of these that exist:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/PLAN.md`
- TODO files
- comments on the open pull request

If a Cursor plan conflicts with that direction, follow Claude Code and record the difference in the pull request description. Do not edit files Claude Code is actively changing unless it asks.

## Before every push

1. `git fetch origin`.
2. Check `main`, other branches, and open pull requests for new commits or notes.
3. Rebase onto `main` when it has moved.
4. Do not force-push over someone else's commits.

## Branches and pull requests

- Cursor branches use the form `cursor/<topic>-bbab`.
- Open the pull request as a draft while the work is still moving.
- Keep a **Progress log** at the top of the pull request description, with UTC timestamps.
- Record the same story, by date, in `docs/PROGRESS.md`.
- Push at each meaningful step so the branch stays visible.
- Mark the pull request ready for review only after `npm test` and `npm run typecheck` pass.

## What stays true here

Benchmark is the construction project-manager demo. Mock mode is the default. Drafts are never sent. The page in `docs/` can be published on its own.
