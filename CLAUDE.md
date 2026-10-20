# CLAUDE.md

Instructions for Claude when working in this repository.

## Project

**Chronos History** — a VS Code extension (`chronos-history`, v4.3.9) that provides a comprehensive local + Git history tracking system, enhanced with Google Gemini AI. Snapshots of file changes are captured automatically and browsed through a JetBrains-inspired table UI, graph, heatmap, and timeline views.

- **Language:** TypeScript only.
- **Entry point (runtime):** `./dist/extension.js` (bundled). Source entry: `src/extension.ts`.
- **VS Code engine:** `^1.95.0`.
- **Platform:** Developed on macOS ARM (Apple Silicon).

## Build & Run

| Task | Command |
|------|---------|
| Type-check / compile to `out/` | `npm run compile` |
| Watch compile | `npm run watch` |
| Bundle to `dist/` (esbuild, minified) | `npm run bundle` |
| Watch bundle | `npm run bundle-watch` |
| Package `.vsix` | `npm run bundle` then `vsce package` (or `./package.sh`) |

`vscode:prepublish` runs `npm run bundle`. Always bundle with esbuild for releases — `external:vscode`, CJS, node platform.

## Testing

Two layers, with different reach.

**1. Mock-based suites — the default.** Plain Node scripts against
`test/mock_vscode.js`, no Jest. This is where logic changes are covered.

- **Full suite:** `./test.sh` (compiles first, then runs every suite).
- **Individual suites:** `node test/run_tests.js`, `node test/git_parser_tests.js`,
  `node test/content_anchor_tests.js`, etc.
- **Real git:** `test/git_integration_tests.js` builds a throwaway repository in
  `os.tmpdir()` and mocks only `vscode`, so `git diff`/`git log -L` run for real.
  It is in `./test.sh`.
- **AI tests:** `node test/comprehensive_ai_tests.js` (requires `.gemini.test.json`
  with a real key — do not commit keys).

**2. Real VS Code — `npm run test:integration`.** Launches an actual VS Code via
`@vscode/test-electron` (mocha, inside the extension host) against the workspace in
`test/integration/fixture/`. This is the only place the real API is exercised: what
a language extension's symbol provider really returns, and whether `vscode.diff`
positions the editor when handed a selection. **Not in `./test.sh`** — it needs a
display, so on Linux/CI it must run under `xvfb-run`. VS Code is downloaded on first
run into `.vscode-test/`.

**Rule:** every logic change must come with a test update or a new case in `test/`,
using the existing mocks. Run `./test.sh` before considering a change done. When a
change rests on how the VS Code API behaves rather than on our own logic, add a case
to the integration suite too — a mock written by hand cannot disagree with the
assumption it encodes.

## Architecture

```
src/
  extension.ts          Main entry: activation, command registration, wiring
  historyManager.ts     Central orchestration of snapshot capture
  storage.ts            Read/write snapshots to disk (must stay atomic + error-safe)
  backup.ts             Backup / archive logic (adm-zip)
  timeTravel.ts         Restore / time-travel across snapshots
  types.ts              Shared types
  ai/aiService.ts       All Gemini interactions — centralize AI logic here
  git/gitService.ts     Git command execution (simple-git)
  git/gitIgnoreService.ts  .gitignore-aware filtering
  historyFilter.ts      Snapshot filtering for a line range (content-anchored)
  utils/rangeMapper.ts  Pure diff/line-range maths shared by the above
  utils/contextResolver.ts  Resolves the enclosing function/class around the cursor
  views/                Webview + tree-data providers (history panel, graph,
                        heatmap, activity, divergence, deleted files)
```

Keep separation of concerns: webview/view logic stays decoupled from core extension logic. Snapshot writes in `storage.ts` must be atomic and degrade gracefully on disk errors.

### Storage integrity

The index and the snapshot blobs are separate on disk and can come apart. Three
rules hold:

- **Nothing destructive without a confirmation.** `removeOrphanedEntries()` only
  drops entries whose blob is missing, re-checks each one against disk first, and
  acts only on the reports its caller passes in. The count and the file list go
  to the user before the modal confirmation (`cleanOrphanedHistory` in
  `extension.ts`); diagnostics report the same numbers read-only.
- **Missing content is a read-time judgement, never a record.** `getHistoryForFile`
  annotates entries with a transient `contentMissing`; it is never written to
  `index.json`, because the content may be a remount away.
- **Write the index before deleting content, and never swallow a failed index
  write.** `saveIndex()` reports the failure to the user and rethrows; `prune()`
  writes the pruned index first and deletes blobs only once it has landed, so a
  failed write leaves unreferenced blobs (cheap) rather than entries pointing at
  content that is gone (lost history). The write queue must not be left rejected,
  or every later save fails on an error already handled.
- **Changing the storage root copies, it never moves.** `migrateStorage()` verifies
  every file it writes, skips files already at the destination, and leaves the
  source untouched. Both entry points must warn: the `chronos.useSharedStorage`
  command and the `onDidChangeConfiguration` handler for a path edited by hand.

Regressions for all of this live in `test/data_loss_tests.js`.

## Dependencies

Check `package.json` before adding libraries. Prefer the existing ones:

- `simple-git` — Git operations
- `date-fns` — date handling
- `adm-zip` — archives/backups
- `@google/genai` — Gemini
- `glob`, `minimatch` — path matching
- `uuid`, `vis-network` — IDs and graph rendering

Use only the public VS Code Extension API — no internal/private APIs.

## AI Integration

All AI logic lives in `src/ai/aiService.ts`. Respect the user's `chronos.ai.*` settings (`apiKey`, `model` default `gemini-2.0-flash`, `language`, and per-feature toggles). Never send API keys or secrets to the model. Truncate diffs to the configured context window (~4000–6000 chars). See `agents.md` for the user-facing AI features (summarizer, explainer, commit architect, changelog writer, etc.).

## Conventions

- Follow Conventional Commits for commit messages.
- Don't commit secrets (`.gemini.test.json`, `test_secrets.json`, keys).
- `out/` and `dist/` are build artifacts — don't hand-edit them.

## File Map for Agents

- `README.md` — end-user feature documentation.
- `agents.md` — the *internal* AI features exposed to the end user.
- `GEMINI.md` — instructions for the Gemini CLI agent.
- `CLAUDE.md` — this file, instructions for Claude.
- `CONTRIBUTING.md` / `devel_readme.md` — contributor + dev setup notes.
