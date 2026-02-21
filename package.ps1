# package.ps1
param (
    [ValidateSet("patch", "minor", "major")]
    [string]$VersionType
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting build process for Chronos..." -ForegroundColor Cyan

# Optional: Increment version
if ($VersionType) {
    Write-Host "🆙 Incrementing version ($VersionType)..." -ForegroundColor Yellow
    npm version $VersionType --no-git-tag-version
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to increment version."
        exit 1
    }
}

# Check for npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "Error: npm is not installed or not in PATH."
    exit 1
}

# Clean up
Write-Host "🧹 Cleaning up..." -ForegroundColor Yellow
if (Test-Path "out") { Remove-Item "out" -Recurse -Force }
Get-ChildItem -Filter "*.vsix" | Remove-Item -Force

Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "🔨 Compiling extension..." -ForegroundColor Yellow
npm run compile
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "🎁 Packaging extension..." -ForegroundColor Yellow
# Use npx to ensure we use the latest compatible vsce
cmd /c "npx @vscode/vsce package"
if ($LASTEXITCODE -ne 0) { 
    Write-Error "Packaging failed."
    exit 1 
}

# Find the generated VSIX file
$vsixFile = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1

if (-not $vsixFile) {
    Write-Error "Error: .vsix file was not generated."
    exit 1
}

# Check size
if ($vsixFile.Length -lt 10000) {
    Write-Warning "The generated VSIX is suspiciously small ($($vsixFile.Length) bytes)."
    Write-Warning "This might indicate missing dependencies or files."
} else {
    Write-Host "✅ Success! Created package: $($vsixFile.Name) ($($vsixFile.Length) bytes)" -ForegroundColor Green
    Write-Host "    You can now upload this file to the Marketplace." -ForegroundColor Green
}
