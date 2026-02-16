# Chronos History

**Comprehensive history management for VS Code.**

Chronos History provides a robust safety net by automatically tracking local snapshots of your work, independent of Git. Effortlessly restore previous versions, use specialized Git views, and leverage AI to understand your project's evolution.

---

## 📖 Features & Usage

Access all features via the context menu (right-click) in your editor or explorer:

```text
Chronos History
 ├─ Show History              (File-specific timeline)
 ├─ Show History for Selection (History for selected lines)
 ├───────────────────────────
 ├─ Show Git History          (Git commits for current file)
 ├─ Git History for Selection  (Git commits for selected lines)
 ├───────────────────────────
 ├─ Show Project History      (Global timeline of all changes)
 ├─ Show History Graph        (Interactive visualization)
 ├─ Show Recent Changes       (Quick view of latest modifications)
 ├─ Toggle Code Heatmap       (Line-level activity visualization)
 ├─ Put Label                 (Create a named checkpoint)
 ├─ Generate Commit Message   (AI draft based on local history)
 ├───────────────────────────
 ├─ Export History            (Backup to ZIP)
 ├─ Import History            (Restore from ZIP)
```

## 🚀 Advanced Comparison & Git Deep Dive

Chronos now features an intuitive, two-step comparison model and advanced Git integration similar to professional IDE tools. 

### 1. The "Select for Compare" Workflow:
1.  **Step 1 (Select Source):** Hover over any snapshot or commit and click the **`↔`** button. The item will be highlighted as the **Source**, and a blue banner will appear at the top.
2.  **Step 2 (Select Target):** Click the **`↔`** button on any *other* item. 
3.  **Result:** Chronos immediately generates a **Range Diff** showing the cumulative changes between those two points in time.
*   *To exit comparison mode, simply click **Cancel** in the top banner.*

### 2. New Comparison Capabilities:
*   **Compare Branch:** Instantly see differences between your current work and the HEAD of any branch.
*   **Compare Version:** Select any branch and then pick a specific commit from its history to compare against.

---

## 🎨 User Interface & Experience

### 1. Revamped HTML Preview ("Context Bar")
Our HTML previews and diff views now feature a professional **Context Bar**. This bar automatically extracts and displays version details (like `COMMIT 7a2b3c` or `BRANCH main`) and the full file path, keeping the code area clean and focused on your work.

### 2. UI/UX Enhancements
*   **Safe Editing:** Side-by-side diffs against the **"Current"** version now use the actual workspace file. This allows you to **edit and save directly** from the diff editor while viewing changes.
*   **Reliable Branch Selection:** The branch selection menu now works seamlessly, even when the extension panel or focused views are active.

### 3. UI Styles (Configurable)
Chronos offers two distinct UI experiences, configurable via `chronos.ui.useJetBrainsStyle`:

### 1. JetBrains Style (Default)
A high-density, **table-based UI** mimicking the professional experience of IntelliJ or WebStorm.
*   **Table View:** Multi-column layout with Time, Event, and Message.
*   **Details Pane:** A side panel opens on selection to show full metadata and actions.
*   **Best for:** Power users and those accustomed to JetBrains IDEs.

### 2. Standard VS Code Style
A modern, **card-based list** that feels native to VS Code's aesthetic.
*   **List View:** Vertical cards with time badges and line change magnitudes (+/-).
*   **Top Header:** Actions appear at the top of the view when an item is selected.

---

## 📂 Sidebar Views

Chronos adds a dedicated icon to your Activity Bar (the "Black Hole" icon) with two essential views:

*   **Deleted Files:** A list of files you've recently deleted. You can **Preview** their content or **Restore** them with a single click.
*   **Recent Activity:** A quick-access feed of the files you've worked on in the last 24 hours.

---

## 🛠 Detailed Menu Reference

#### 1. Show History (with Session Replay)
**The File-specific "Time Machine".**
This opens a timeline of every automatic snapshot taken for the **currently active file**. Use this when you want to see how a specific file has evolved over the last few hours or days, compare versions side-by-side, or restore the file to a previous state.
*   **🎬 Session Replay ("Code Cinema"):** Use the built-in player controls (`◀`, `▶`, `⏸`) to watch your code evolve over time.

#### 2. Show History for Selection (Chronos History)
**A local "Time Machine" for your uncommitted work.**
This is unique to the Chronos extension. It tracks changes locally on your machine, completely independent of Git.
*   **How it works:** It filters your local Chronos snapshots to find only those where the selected lines were modified.
*   **Side-by-Side View:** By default, clicking a snapshot opens VS Code's native side-by-side diff editor, scoped specifically to the selected lines.

#### 3. Git History for Selection
**The direct equivalent to JetBrains' "Show History for Selection".**
This feature integrates deeply with Git to track the evolution of specific lines of code.
*   **How it works:** It runs a `git log -L` command on the selected lines.
*   **Diff View:** Select any commit to see exactly how those lines changed in that specific version (vs. its parent).
*   **📝 Compare with Current:** A dedicated button to compare a specific commit's version of the lines with your current work-in-progress.

#### 4. Show Project History (with Deep Search)
**The Global Activity Feed.**
This provides a bird's-eye view of changes across your **entire workspace**. It lists snapshots from all files, sorted chronologically.
*   **🔍 Deep Content Search:** Search through the **actual content** of historical snapshots. Toggle "Deep Search" to find functions or code blocks you deleted days ago, even if you don't remember the filename.

#### 5. Show History Graph
**Interactive Visualization.**
A graphical view of your history that helps visualize parallel changes and experiments.
*   **🚀 How to Use Show History Graph:**
    1. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
    2. Run **"Chronos: Show History Graph"**.
    3. A new editor tab will open displaying the graph.
        * **Zoom/Pan:** Use mouse wheel and drag to navigate.
        * **Inspect:** Hover over nodes for details (Timestamp, Event Type, Label).
        * **Compare:** Double-click a node to see what changed in that snapshot.

#### 6. Show Recent Changes
**The "What just happened?" view.**
A streamlined, high-priority view of the most recent modifications—helping you remember the last few files you touched before a break.

#### 7. Toggle Code Heatmap
**🌡️ Visualize Churn.**
Instantly see which parts of your file are the most active. Chronos color-codes your lines based on their age:
*   🔴 **Hot:** Changed in the last 24 hours.
*   🟠 **Warm:** Changed in the last 7 days.
*   🟡 **Lukewarm:** Changed in the last 30 days.

#### 8. Put Label (with Smart Pinning)
**Manual Checkpoints.**
Chronos takes snapshots automatically, but sometimes you want to mark a specific moment (e.g., *"Right before the big API refactor"*).
*   **📌 Snapshot Pinning:** Important snapshots can be **Pinned**. Pinned snapshots are **never** removed by the automatic pruning logic (`maxDays`).

#### 9. Restore Project to...
**Global Time Travel.**
Restore your entire workspace to a specific point in time. This acts as a "Soft Undo" for the whole project.
*   **How to Use:** Run "Chronos: Restore Project to..." from the Command Palette, and select a timestamp from the list. All files will be reverted to their state at that moment.

#### 10. Generate Commit Message
**AI-Powered Drafts.**
Let Gemini analyze your local changes and draft a commit message for you.
*   **Context Aware:** Uses the diff of your current changes to generate a relevant summary.

#### 11. Export & Import History
**Backup and Share.**
Move your history between machines or keep safety backups.
*   **Export:** Saves your entire history to a `.zip` file.
*   **Import:** Merges a backup file into your current history.

---

## 🌟 New Features

### 📝 Automatic Changelog Generator
Save hours of manual documentation. Chronos can analyze your project history between any two points in time and generate a clean, formatted `CHANGELOG.md` draft categorized by Features, Bug Fixes, and Refactorings.
*   **How to Use:** Run "Chronos: Generate Changelog (AI)..." from the Command Palette and select your desired range (Presets or Custom).

### 🤝 Collaborative Sharing
Share specific moments of your work with teammates.
*   **Share:** In the History View, select a snapshot and click **Share**. This creates a `.chronos` file you can send via Slack, Email, or Teams.
*   **Receive:** Your teammate can run **"Chronos: Import Shared Snapshot..."** to add your snapshot to their local history for comparison or restoration.

### ✨ AI-Powered Insights (Gemini)
Chronos now integrates with Google Gemini to provide intelligent analysis of your code history.
*   **🌅 Daily Progress Briefing:** Wake up to a summary of your work. When you start VS Code, Chronos analyzes your last session and provides a concise briefing of your achievements—perfect for stand-ups!
*   **🧠 Semantic Search:** Don't just search for text—search for *intent*. "Show me where I fixed the auth bug" will find relevant snapshots even if the word "auth" isn't in the message.
*   **✨ Explain Changes:** A dedicated button in any history view that provides an AI explanation of the *intent* and *logic* behind any snapshot.
*   **📈 Smart Summaries:** Automatically generates concise labels for your snapshots as you work.

### 🧪 Local Experiments (Safe Mode)
Safely try out risky refactors without Git branches.
*   **Start:** Use the Command Palette (`Cmd+Shift+P`) -> `Chronos: Start Experiment`.
*   **Manage:** Use the Status Bar item or Command Palette to "Keep" or "Discard" the experiment.
*   **Discard:** Instantly reverts all files to the state before the experiment started.

---

## ⚙️ Configuration

| Setting | Default | Description |
| :--- | :--- | :--- |
| `chronos.ui.useJetBrainsStyle` | `true` | Toggle between Table and Card UI styles. |
| `chronos.viewMode` | `editor` | Display history in a main `editor` tab or a bottom `panel`. |
| `chronos.ai.apiKey` | `""` | Your Google Gemini API Key. |
| `chronos.ai.language` | `English` | Language for AI summaries and briefings. |
| `chronos.showDiffSideBySide` | `true` | Use native side-by-side diff editor. |
| `chronos.maxDays` | `30` | Days to keep history before pruning (skips pinned snapshots). |
| `chronos.saveInProjectFolder` | `false` | Save history in `.history/` inside your project. |

---

## 🛡️ Data & Privacy
**Your code stays yours.** All history is stored locally. If AI features are enabled, only the relevant code diffs are sent to Google Gemini for analysis. No data is ever persisted by the extension on any remote server.

---

**[Developer Guide & Testing](devel_readme.md)** | **[Contributing Guide](CONTRIBUTING.md)** | **[License](LICENSE)**
