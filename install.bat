@echo off
SETLOCAL
echo 🚀 Starting installation for Chronos...

:: Check for npm
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ❌ Error: npm is not installed.
    exit /b 1
)

:: Run the PowerShell script with Bypass policy
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"

if %ERRORLEVEL% neq 0 (
    echo ❌ Installation failed.
    exit /b %ERRORLEVEL%
)

ENDLOCAL
pause
