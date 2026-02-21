@echo off
setlocal EnableDelayedExpansion

echo 🚀 Starting build process for Chronos...

:: Optional: Increment version
if not "%~1"=="" (
    if "%~1"=="patch" (
        goto :increment
    )
    if "%~1"=="minor" (
        goto :increment
    )
    if "%~1"=="major" (
        goto :increment
    )
    echo ℹ️  Argument '%~1' is not a standard version type (patch/minor/major). Skipping auto-increment.
    goto :check_npm

    :increment
    echo 🆙 Incrementing version (%~1)...
    call npm version %~1 --no-git-tag-version
    if %errorlevel% neq 0 (
        echo ❌ Error: Failed to increment version.
        exit /b 1
    )
)

:check_npm
:: Check for npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Error: npm is not installed or not in PATH.
    exit /b 1
)

:: Clean up
echo 🧹 Cleaning up...
if exist out rmdir /s /q out
if exist *.vsix del /q *.vsix

echo 📦 Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ❌ Error: npm install failed.
    exit /b 1
)

echo 🔨 Compiling extension...
call npm run compile
if %errorlevel% neq 0 (
    echo ❌ Error: Compilation failed.
    exit /b 1
)

echo 🎁 Packaging extension...
:: Use npx to ensure we use the latest compatible vsce
call npx @vscode/vsce package
if %errorlevel% neq 0 (
    echo ❌ Error: Packaging failed.
    exit /b 1
)

:: Find the generated VSIX file
set "VSIX_FILE="
for %%f in (*.vsix) do (
    set "VSIX_FILE=%%f"
    set "FILESIZE=%%~zf"
)

if not defined VSIX_FILE (
    echo ❌ Error: .vsix file was not generated.
    exit /b 1
)

:: Check size (10000 bytes approx 10kb)
if %FILESIZE% LSS 10000 (
    echo ⚠️  WARNING: The generated VSIX is suspiciously small (%FILESIZE% bytes).
    echo     This might indicate missing dependencies or files.
) else (
    echo ✅ Success! Created package: !VSIX_FILE! (%FILESIZE% bytes^)
    echo     You can now upload this file to the Marketplace.
)

endlocal
