#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting installation for Chronos..."

# Check for node version (vsce needs >= 16)
NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Error: Node.js version 16 or higher is required. Current: $(node -v)"
    echo "    Please update Node.js (e.g., 'nvm install 20 && nvm use 20')."
    exit 1
fi

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed."
    exit 1
fi

# Clean up
echo "🧹 Cleaning up..."
rm -rf out chronos.vsix

echo "📦 Installing dependencies..."
npm install

echo "🔨 Compiling extension..."
npm run compile

echo "🎁 Packaging extension..."
# Use npx to ensure we use vsce, auto-confirming prompts
npx @vscode/vsce package --out chronos.vsix

# Check size
FILESIZE=$(stat -f%z chronos.vsix 2>/dev/null || stat -c%s chronos.vsix 2>/dev/null || echo 0)
if [ "$FILESIZE" -lt 50000 ]; then
    echo "⚠️  WARNING: The generated VSIX is very small ($FILESIZE bytes)."
    echo "    This suggests dependencies are missing. Please ensure 'npm install' ran correctly."
else
    echo "✅ VSIX generated successfully ($FILESIZE bytes)."
fi

echo "💿 Installing to VS Code..."
# Use the correct extension ID from package.json: IldioMartins.chronos-history
code --uninstall-extension IldioMartins.chronos-history || true
code --install-extension chronos.vsix --force

echo "✅ Success! The extension has been installed."
echo "👉 IMPORTANT: Reload VS Code now (Cmd+Shift+P -> 'Developer: Reload Window')."