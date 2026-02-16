# Chronos AI Agents 🤖

This document outlines the AI-driven features in Chronos History, powered by Google Gemini. These "agents" assist with summarizing changes, explaining complex logic, and automating routine Git tasks.

## Overview

Chronos History integrates Google Gemini to provide semantic understanding of your code evolution. By analyzing diffs and historical context, it helps you stay oriented in your project's timeline.

## Specialized Agents

### 1. The Summarizer (`summarizeDiff`)
- **Purpose:** Generates ultra-concise (max 5 words) summaries for every snapshot.
- **Context:** Analyzes the file diff.
- **Outcome:** Used in the History List and Graph views to give a quick overview of what changed at a glance.

### 2. The Explainer (`explainDiff`)
- **Purpose:** Provides a high-level explanation of the "Why" and "What" behind a specific change.
- **Context:** Analyzes the diff with an "Expert Software Engineer" persona.
- **Outcome:** Helps developers understand past decisions or complex refactors without reading raw diffs.

### 3. The Experiment Assistant (`experimentPostMortem`)
- **Purpose:** Analyzes the results of an "Experimental Session".
- **Context:** When an experiment is kept or discarded, it reviews the diff.
- **Outcome:** Suggests commit messages if kept, or summarizes the attempt if discarded.

### 4. The Semantic Search Engine (`semanticSearch`)
- **Purpose:** Allows users to find snapshots using natural language.
- **Context:** Matches user queries against snapshot labels, file paths, and metadata.
- **Outcome:** Returns a list of relevant snapshot IDs for easier navigation.

### 5. The Commit Architect (`generateCommitMessage`)
- **Purpose:** Drafts professional Git commit messages.
- **Context:** Analyzes the accumulated changes since the last commit.
- **Outcome:** Provides a structured message following the Conventional Commits format.

### 6. The Daily Briefer (`generateDailyBriefing`)
- **Purpose:** Welcomes the developer with a summary of their last session.
- **Context:** Aggregates activity data (filenames and change summaries) from the previous day.
- **Outcome:** 2-3 bullet points highlighting key achievements.

### 7. The Changelog Writer (`generateChangelog`)
- **Purpose:** Drafts a full `CHANGELOG.md`.
- **Context:** Reviews historical activity and categorizes changes (Features, Fixes, Refactors).
- **Outcome:** A professional Markdown draft ready for release notes.

## Configuration

AI features can be tuned in VS Code Settings (`Ctrl+,`):

- **API Key:** `chronos.ai.apiKey` (Required)
- **Model:** `chronos.ai.model` (Default: `gemini-2.0-flash`)
- **Language:** `chronos.ai.language` (e.g., English, Spanish, Portuguese)
- **Toggle Features:** individual toggles for `smartSummaries`, `explainChanges`, `experimentPostMortem`, and `dailyBriefing`.

## Security & Privacy

- **No Secret Leaking:** Chronos does not send your API keys or credentials to the AI.
- **Context Limits:** Diffs are truncated to fit within model context windows (typically 4000-6000 characters) to ensure performance and cost-efficiency. Large refactors are summarized based on the most significant chunks.
- **Local Control:** All AI calls are triggered by user actions or explicit settings.

## Developer Tips 💡

- **Better Commit Messages:** If you're using `generateCommitMessage`, make sure your changes are logically grouped. The AI performs better when the diff represents a cohesive set of changes.
- **Custom Language:** Use the `chronos.ai.language` setting to receive explanations in your preferred language, which is especially helpful for team-wide changelogs.
- **Smart Labels:** Labels you manually put using `chronos.putLabel` are also indexed for semantic search, allowing you to find them even if you don't remember the exact wording.
