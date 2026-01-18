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
```

### 🛠 Detailed Menu Reference

#### 1. Show History
**The File-specific "Time Machine".**
This opens a timeline of every automatic snapshot taken for the **currently active file**. Use this when you want to see how a specific file has evolved over the last few hours or days, compare versions side-by-side, or restore the file to a previous state.

#### 2. Show History for Selection (Chronos History)
**A local "Time Machine" for your uncommitted work.**
This is unique to the Chronos extension. It tracks changes locally on your machine, completely independent of Git.
*   **How it works:** It filters your local Chronos snapshots to find only those where the selected lines were modified.
*   **What it shows:** A timeline of your local edits (auto-saves) that affected that specific block of code.
*   **Side-by-Side View:** By default, clicking a snapshot opens VS Code's native side-by-side diff editor, scoped specifically to the selected lines.

#### 3. Git History for Selection
**The direct equivalent to JetBrains' "Show History for Selection".**
This feature integrates deeply with Git to track the evolution of specific lines of code, even if you haven't been running this extension.
*   **How it works:** It runs a `git log -L` command on the selected lines.
*   **What it shows:** It displays a list of every Git commit that touched those lines.
*   **Diff View:** Select any commit to see exactly how those lines changed in that specific version, using the native side-by-side diff viewer.

#### 4. Show Project History
**The Global Activity Feed.**
This provides a bird's-eye view of changes across your **entire workspace**. It lists snapshots from all files, sorted chronologically. This is useful for answering the question: *"What was I working on yesterday across the whole project?"*

#### 5. Show Recent Changes
**The "What just happened?" view.**
A streamlined, high-priority view of the most recent modifications. While Project History shows a long timeline, Recent Changes is optimized for quick context switching.

#### 6. Put Label
**Manual Checkpoints.**
Chronos takes snapshots automatically, but sometimes you want to mark a specific moment (e.g., *"Right before the big API refactor"*). Putting a label creates a **named bookmark** in your timeline.

---

## 🌟 New Features

### ↔️ Side-by-Side Diffs
Enjoy a unified experience. Whether viewing local history or Git commits, Chronos now uses VS Code's native side-by-side diff editor by default. This provides syntax highlighting, intellisense, and a familiar interface for reviewing changes.
*   **Toggle:** Prefer the old inline view? Disable `chronos.showDiffSideBySide` in settings.

### 🧪 Local Experiments (Safe Mode)
Safely try out risky refactors without Git branches.
*   **Start:** Run command `Chronos: Start Experiment` (or use context menu if enabled).
*   **Manage:** Use the Status Bar item to "Keep" or "Discard" the experiment.
*   **Discard:** Instantly reverts your file to the state before the experiment started.
*   **Configuration:** Enable/Disable via `chronos.experiments`.

### 🔍 Full-Text History Search
Forgot where you wrote that one clever function? Search through your entire history of snapshots.
*   **How:** Open any History View and use the search bar at the top.

### ♻️ Deleted File Resurrection
Accidentally deleted a file? Chronos remembers.
*   **Access:** Open the "Chronos" sidebar view.
*   **Action:** Find your deleted file in the "Deleted Files" list and click the restore icon.

### 📈 Activity View
See where you've been most active in the last 24 hours via the "Recent Activity" list in the Chronos sidebar.

---

## ⚙️ Configuration

Tune the extension in **Settings** (`Cmd+,` -> search `chronos`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `chronos.enabled` | `true` | Turn the entire system on/off. |
| `chronos.maxDays` | `30` | Days to keep history before pruning. |
| `chronos.exclude` | `node_modules`, ... | Folders to ignore. |
| `chronos.showDiffSideBySide` | `true` | Use native side-by-side diff editor. Disable for inline view. |
| `chronos.diff.syncScroll` | `true` | Synchronize scrolling in diff view. |
| `chronos.experiments` | `true` | Enable the "Start Experiment" feature menu item. |
| `chronos.saveInProjectFolder` | `false` | If true, saves history in `.history/` inside your project. |

---

## 🛡️ Data & Privacy
**Your code stays yours.** All history is stored locally on your machine. No data is ever sent to any server.

---

**[Contributing / Developer Guide](https://github.com/ilidio/Chronos/blob/main/CONTRIBUTING.md)**