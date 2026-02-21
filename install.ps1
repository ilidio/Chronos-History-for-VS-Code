Write-Host "🚀 Starting installation for Chronos..." -ForegroundColor Cyan

# Check for npm
if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
    Write-Error "npm is not installed."
    exit 1
}

# Clean up
Write-Host "🧹 Cleaning up..." -ForegroundColor Yellow
if (Test-Path "out") { Remove-Item -Recurse -Force "out" }
if (Test-Path "chronos.vsix") { Remove-Item -Force "chronos.vsix" }

Write-Host "📦 Installing dependencies..." -ForegroundColor Green
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "🔨 Compiling extension..." -ForegroundColor Green
npm run compile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "🎁 Packaging extension..." -ForegroundColor Green
"y" | npx @vscode/vsce package --out chronos.vsix
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Check size
$file = Get-Item "chronos.vsix"
if ($file.Length -lt 50000) {
    Write-Warning "The generated VSIX is very small ($($file.Length) bytes)."
    Write-Warning "This suggests dependencies are missing."
} else {
    Write-Host "✅ VSIX generated successfully ($($file.Length) bytes)." -ForegroundColor Green
}

Write-Host "💿 Installing to VS Code..." -ForegroundColor Green
code --uninstall-extension ilidio.chronos
code --install-extension chronos.vsix --force

Write-Host "✅ Success! The extension has been installed." -ForegroundColor Cyan
Write-Host "👉 IMPORTANT: Reload VS Code now (Ctrl+Shift+P -> 'Developer: Reload Window')."