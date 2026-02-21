# Chronos Developer Guide

This document contains internal development information, packaging instructions, and testing procedures.

---

## 📦 Packaging & Versioning

You can use the included `package.sh` script to build the `.vsix` package. This script also supports automatic version bumping.

**Usage:**

```bash
# Just build the package
./package.sh

# Build and increment patch version (0.0.X -> 0.0.X+1)
./package.sh patch

# Build and increment minor version (0.X.0 -> 0.X+1.0)
./package.sh minor

# Build and increment major version (X.0.0 -> X+1.0.0)
./package.sh major
```

---

## 🧪 Testing Procedures

### 1. Core Feature Tests
We use a custom mock-based testing suite to verify logic without needing a full VS Code instance.

Run the full suite:
```bash
./test.sh
```

### 2. AI Feature Testing
To run the AI integration tests, create a `.gemini.test.json` file in the project root. This file is ignored by Git and stores your test credentials.

**Format (`.gemini.test.json`):**
```json
{
    "apiKey": "YOUR_GEMINI_API_KEY",
    "modelId": "gemini-2.0-flash"
}
```

- **apiKey**: Your Google Gemini API key.
- **modelId**: The model identifier to use for testing (e.g., `gemini-2.0-flash`).

Run the comprehensive AI test suite:
```bash
node test/comprehensive_ai_tests.js
```

### 3. Git & Parser Tests
To verify Git output parsing logic:
```bash
node test/git_parser_tests.js
```

---

**[Back to Main README](README.md)** | **[Contributing Guide](CONTRIBUTING.md)**
