# Project Instructions: Chronos History

This project is a VS Code extension that provides a comprehensive local and Git history tracking system, enhanced with Google Gemini AI.

## Core Mandates

- **Language:** TypeScript exclusively.
- **Build System:** Use `esbuild` for bundling (see `npm run bundle`).
- **Dependencies:** Always check `package.json` before adding new libraries. Prefer existing dependencies like `simple-git`, `date-fns`, and `adm-zip`.
- **VS Code API:** Strictly follow the VS Code Extension API guidelines. Avoid using internal or private APIs.
- **AI Integration:** Use the `@google/genai` package. All AI-related logic must respect the user's `chronos.ai` settings (API key, model, language).
- **Environment:** Development is primarily on macOS ARM (Apple Silicon). Node 14 operations (if any) should use `arch -x86_64` (Rosetta 2).

## Architectural Patterns

- **Separation of Concerns:**
    - `src/extension.ts`: Main entry point and command registration.
    - `src/historyManager.ts`: Central logic for orchestrating history snapshots.
    - `src/storage.ts`: Logic for reading/writing snapshots to disk.
    - `src/ai/`: All AI-related services. Centralize Gemini interactions here.
    - `src/git/`: Specialized services for Git command execution and parsing.
    - `src/views/`: Webview providers and Tree Data Providers for the sidebar and panel.
- **UI:** The extension uses a JetBrains-inspired table UI for the history list. Webview logic should remain clean and decoupled from the main extension logic as much as possible.
- **Data Integrity:** Ensure snapshots are atomic and handle potential disk errors gracefully in `storage.ts`.

## Testing Strategy

- **Custom Mock System:** This project uses a custom mock-based testing suite instead of standard frameworks like Jest.
- **Running Tests:**
    - Core Logic: `./test.sh`
    - Git Parser: `node test/git_parser_tests.js`
    - AI Integration: `node test/comprehensive_ai_tests.js` (Requires `.gemini.test.json`)
- **Validation:** Every logic change MUST be accompanied by a test update or a new test case in the `test/` directory using the provided mocks (`test/mock_vscode.js`).

## Sub-agent Strategy

- **`codebase_investigator`**: Invoke for tasks requiring a deep understanding of how components interact, such as refactoring `historyManager.ts` or diagnosing Git integration bugs.
- **`generalist`**: Use for batch updates (e.g., adding license headers), generating documentation, or performing repetitive refactors across multiple files.

## Documentation Note

- `agents.md` describes the *internal* AI features available to the end-user.
- This `GEMINI.md` file contains instructions for *me* (the Gemini CLI agent).
- Do not confuse the two.
