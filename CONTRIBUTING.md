# Contributing to Chronos

Thank you for your interest in improving Chronos!

## 🚀 Development Setup

1. **Prerequisites:**
   - [Node.js](https://nodejs.org/)
   - `npm`

2. **Installation:**
   ```bash
   git clone https://github.com/ilidio/Chronos.git
   cd Chronos
   npm install
   ```

3. **Running in Debug Mode:**
   - Open the project in VS Code.
   - Press **F5** (or go to `Run and Debug` -> `Run Extension`).
   - This launches a new **Extension Development Host** window with the extension active.

## 📦 Packaging & Publishing

We use a helper script `package.sh` to manage builds and versioning.

### Prerequisites
- Install `vsce` globally: `npm install -g @vscode/vsce`
- Login: `vsce login <publisher_id>`

### Using the Build Script (Recommended)

We provide scripts for macOS/Linux (`.sh`) and Windows (`.bat`, `.ps1`).

#### macOS / Linux
```bash
# Standard Build
./package.sh

# Increment Version (patch/minor/major) & Build
./package.sh patch
```

#### Windows (Command Prompt)
```cmd
:: Standard Build
package.bat

:: Increment Version & Build
package.bat patch
```

#### Windows (PowerShell)
```powershell
# Standard Build
.\package.ps1

# Increment Version & Build
.\package.ps1 -VersionType patch
```

### Manual Commands
If you prefer manual commands:

```bash
# Package
vsce package

# Publish
vsce publish
```
