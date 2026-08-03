# Chronos History — Feature Summary

**Version 4.3.9** · VS Code extension (`chronos-history`) · TypeScript · VS Code engine `^1.95.0`

A local + Git history tracking system that auto-captures snapshots of file changes and browses them through a JetBrains-inspired UI, enhanced with Google Gemini AI.

---

## Core history tracking

- **Automatic local snapshots** — captures file changes continuously, independent of Git.
- **File history** (`Show History`) — per-file timeline of every snapshot, with **Session Replay** ("Code Cinema") playback controls.
- **History for Selection** (`Show History for Selection`) — filters local snapshots to those touching the selected lines.
- **Project History** (`Show Project History`) — global, chronological feed across the whole workspace, with **Deep Content Search** over snapshot contents.
- **Recent Changes** (`Show Recent Changes`) — quick view of the latest modifications.
- **Put Label** — manual named checkpoints, with **Snapshot Pinning** (pinned snapshots survive auto-pruning).
- **Retention/pruning** — controlled by `maxDays` (default 30) and `maxSizeMB` (default 500).

## Visualization

- **History Graph** (`Show History Graph`) — interactive vis-network graph; zoom/pan, hover for details, double-click to diff.
- **Code Heatmap** (`Toggle Code Heatmap`) — line-level churn coloring (hot 24h / warm 7d / lukewarm 30d).

## Comparison & diff

- **Select-for-Compare workflow** — two-step source/target range diff between any two snapshots or commits.
- **Compare with Current / Compare with Active Editor.**
- **Compare Branch / Compare Version** — diff work against any branch HEAD or a specific commit.
- **HTML preview "Context Bar"** — shows version metadata (commit/branch) and file path; side-by-side or unified layout, configurable position.
- **Native side-by-side diff** — editable against the live "Current" workspace file.

## Git integration

- **Show Git History** — Git commits for the current file.
- **Git History for Selection** — `git log -L` on selected lines, with Compare-with-Current.
- **.gitignore-aware filtering** (`respectGitIgnore`).
- Built on `simple-git`.

## Restore / time travel

- **Restore Snapshot** — restore a single file version.
- **Restore Project to...** — global "soft undo" reverting the entire workspace to a point in time.
- **Deleted Files view** — preview and one-click restore of recently deleted files.

## Local Experiments (safe mode)

- **Start / Manage Experiment** — temporary checkpoint session; **Keep** or **Discard** all changes without Git branches.
- Optional AI post-mortem on stop.

## AI features (Google Gemini)

All AI logic centralized in `src/ai/aiService.ts`. Seven agents:

1. **Summarizer** — ≤5-word snapshot summaries (`smartSummaries`).
2. **Explainer** — explains intent/logic of a change (`explainChanges`).
3. **Experiment Assistant** — post-mortem on kept/discarded experiments (`experimentPostMortem`).
4. **Semantic Search** — natural-language snapshot search.
5. **Commit Architect** (`Generate Commit Message`) — Conventional Commits drafts.
6. **Daily Briefer** (`dailyBriefing`) — summary of last session at startup; also `Show Briefing for Date...`.
7. **Changelog Writer** (`Generate Changelog`) — categorized `CHANGELOG.md` draft.

## Sharing & portability

- **Export / Import History** — back up or merge history as ZIP.
- **Share Snapshot / Import Shared Snapshot** — exchange `.chronos` files with teammates.
- **External shared storage** (`Use External Shared Storage`, `customStoragePath`) — share local history with the Chronos History Diff Desktop App.
- **Save in project folder** (`saveInProjectFolder`) — store history in `.history/` at project root.

## UI / views

- **Two UI styles** — JetBrains table style (default) vs. standard VS Code card list (`ui.useJetBrainsStyle`).
- **View placement** — bottom panel (default) or editor tab (`viewMode`).
- **Activity Bar container** ("Black Hole" icon) with **Deleted Files** and **Recent Activity (24h)** views; **History List** webview in the panel.

## Diagnostics

- **Show Chronos Logs** and **Run Diagnostics** commands for troubleshooting.

## Privacy

All history stored locally. Only relevant diffs are sent to Gemini when AI is enabled; API keys are never sent to the model.
