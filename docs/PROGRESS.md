# Progress

A dated log of how this repository became Benchmark. Older private names are not used here.

## 2026-11-10

- Slack live-send stays off by default and sends only after a PM approves. `scripts/publish-demo.sh` copies `docs/` to a separate public demo repository when that repository already exists. It does not create one.
- Rebased the showcase onto `main` after the cleanup merge (`b4d5879`). Dropped the separate A1–A9 minute table. The chart now uses the Thursday counts and `dashboard/assumptions.json`: 68 minutes net per request, about 4.5 hours per project manager per week. The drafting step is labeled Drafting so a later compliance-and-billing specialist can keep that name.
- Added the visual showcase on `cursor/benchmark-showcase-bbab`: agent hero and detail cards, daily and weekly cadences, the Thursday request swimlane, before-and-after automations, an illustrative time chart, and an integration map that separates mocked connectors from planned ones. `docs/SHOWCASE.md` walks through them. `scripts/showcase.mjs` regenerates the files.
- Started that branch for the showcase. Assumptions for any time figures live in `docs/TIME_SAVED.md` and are labeled illustrative, not measured.
- Removed leftover identifiers from the earlier project: the Tuesday fixture filename, the old theme key, the old provider alias, and the old screenshot.
- The playable story is Thursday, 12 March 2026, for Maria Alvarez at Summit Ridge Builders. The workflow command is `thursday`.
- Rewrote the README as a portfolio page and added screenshots of the static demo, including light mode, dark mode, the day plan, a paused play-through, and the terminal.
- Added architecture, Thursday workflow, and agent-card diagrams in `docs/images/`. `scripts/diagrams.mjs` regenerates the SVG and PNG files.
- Added this log and `docs/COLLABORATION.md`. Claude Code leads direction. Cursor handles cleanup, docs, visuals, and the showcase.
- Checked `origin` before the push. `main` had not moved, and there were no new direction notes or pull request comments.
- Stopped the Pages workflow from running on every push to `main`. It is manual only, until Benchmark has a public home and Pages is enabled. Action versions were moved to the Node 24 majors. Claude Code's CI workflow on the dashboard branch was left alone.

## 2026-11-06

- Merged the Benchmark demo for a construction project manager: one lead, four specialists, light and dark mode, and the day view (`#3`).

## 2026-11-05

- The repository started, then held a day-planning showcase under an earlier name.
- A browser demo that runs in mock mode was added and merged.
