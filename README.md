# Chronos History

**Comprehensive history management for VS Code.**

Chronos History provides a robust safety net by automatically tracking local snapshots of your work, independent of Git. Effortlessly restore previous versions or use specialized Git views to trace history for specific code selections.

## 📖 Features & Usage

Access all features via the context menu (right-click) in your editor or explorer:

```text
Chronos History
 ├─ Show History              (File-specific timeline)
 ├─ Show History for Selection (History for selected lines)
 ├───────────────────────────
 ├─ Git History for Selection  (Git commits for selected lines)
 ├───────────────────────────
 ├─ Show Project History      (Global timeline of all changes)
 ├─ Show Recent Changes       (Quick view of latest modifications)
 ├─ Put Label                 (Create a named checkpoint)
 ├─ Generate Commit Message   (AI draft based on local history)
```

### 🛠 Detailed Menu Reference

#### 1. Show History
**The File-specific "Time Machine".**
This opens a timeline of every automatic snapshot taken for the **currently active file**. Use this when you want to see how a specific file has evolved over the last few hours or days, compare versions side-by-side, or restore the file to a previous state.

#### 2. Show History for Selection (Chronos History)
**A local "Time Machine" for your uncommitted work.**
This is unique to the Chronos extension. It tracks changes locally on your machine, completely independent of Git.
*   **How it works:** It filters your local Chronos snapshots to find only those where the selected lines were modified.
*   **Side-by-Side View:** By default, clicking a snapshot opens VS Code's native side-by-side diff editor, scoped specifically to the selected lines.

#### 3. Git History for Selection
**The direct equivalent to JetBrains' "Show History for Selection".**
This feature integrates deeply with Git to track the evolution of specific lines of code.
*   **How it works:** It runs a `git log -L` command on the selected lines.
*   **Diff View:** Select any commit to see exactly how those lines changed in that specific version, using the native side-by-side diff viewer.

#### 4. Show Project History
**The Global Activity Feed.**
This provides a bird's-eye view of changes across your **entire workspace**. It lists snapshots from all files, sorted chronologically.

#### 5. Show Recent Changes
**The "What just happened?" view.**
A streamlined, high-priority view of the most recent modifications—helping you remember the last few files you touched before a break.

#### 6. Put Label
**Manual Checkpoints.**
Chronos takes snapshots automatically, but sometimes you want to mark a specific moment (e.g., *"Right before the big API refactor"*).

---

## 🌟 New Features

### ✨ AI-Powered Insights (Gemini)
Chronos now integrates with Google Gemini to provide intelligent analysis of your code history.
*   **Smart Summaries:** Automatically generates concise (5-word) labels for your snapshots based on code diffs.
*   **"Explain This Change":** A dedicated button in the History View that provides an AI explanation of the *intent* and *logic* behind any snapshot.
*   **Experiment Post-Mortem:** When stopping an "Experiment", Gemini generates a summary of your work or suggests a commit message.

### ↔️ Side-by-Side Diffs
Whether viewing local history or Git commits, Chronos uses VS Code's native side-by-side diff editor by default. This provides syntax highlighting, intellisense, and a familiar interface.
*   **Toggle:** Prefer the old inline view? Disable `chronos.showDiffSideBySide` in settings.

### 🧪 Local Experiments (Safe Mode)
Safely try out risky refactors without Git branches.
*   **Start:** Use the Command Palette (`Cmd+Shift+P`) -> `Chronos: Start Experiment`.
*   **Manage:** Use the Status Bar item to "Keep" or "Discard" the experiment.
*   **Discard:** Instantly reverts your file to the state before the experiment started.

### 🔍 Full-Text History Search
Search through your entire history of snapshots using the search bar at the top of any History View.

### ♻️ Deleted File Resurrection
Accidentally deleted a file? Find your deleted file in the "Deleted Files" list in the Chronos sidebar and click the restore icon.

---

## ⚙️ Configuration

Tune the extension in **Settings** (`Cmd+,` -> search `chronos`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `chronos.ai.apiKey` | `""` | Your Google Gemini API Key. |
| `chronos.ai.model` | `gemini-2.0-flash` | Gemini Model ID (e.g., `gemini-3-flash-preview`). |
| `chronos.ai.smartSummaries` | `true` | Auto-generate AI summaries for new snapshots. |
| `chronos.ai.explainChanges` | `true` | Enable the "Explain" button in history view. |
| `chronos.ai.experimentPostMortem` | `true` | Generate AI insights when stopping experiments. |
| `chronos.showDiffSideBySide` | `true` | Use native side-by-side diff editor. |
| `chronos.diff.syncScroll` | `true` | Synchronize scrolling in diff view. |
| `chronos.experiments` | `true` | Enable the "Experiments" functionality. |
| `chronos.maxDays` | `30` | Days to keep history before pruning. |
| `chronos.saveInProjectFolder` | `false` | Save history in `.history/` inside your project. |

---

## 🛡️ Data & Privacy
**Your code stays yours.** All history is stored locally. If AI features are enabled, only the relevant code diffs are sent to Google Gemini for analysis. No data is ever persisted by the extension on any remote server.

---

**[Contributing / Developer Guide](https://github.com/ilidio/Chronos/blob/main/CONTRIBUTING.md)**
