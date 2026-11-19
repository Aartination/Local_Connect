@echo off
setlocal enabledelayedexpansion
title LOCAL HUB - First-Time Installation
cd /d "%~dp0"

echo ============================================================
echo   LOCAL HUB - Installation & Setup
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Please install Node.js 20+ from https://nodejs.org and re-run install.bat.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo [1/4] Found Node.js %NODEVER%

echo.
echo [2/4] Installing dependencies...
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo [ERROR] npm install failed. Check your internet connection for first-time setup.
  pause
  exit /b 1
)

if not exist "server\.env" (
  copy "server\.env.example" "server\.env" >nul
)

echo.
echo [3/4] Initializing local SQLite database...
call npm run db:migrate
if errorlevel 1 (
  echo [ERROR] Database migration failed.
  pause
  exit /b 1
)

echo.
echo [4/4] Building LOCAL HUB server and web client...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   LOCAL HUB is installed and ready!
echo ============================================================
echo.
echo Next steps:
echo   1. Run start-server.bat to launch LOCAL HUB.
echo   2. Open the printed URL in your browser and enter the Setup Code
echo      to create the Owner account.
echo   3. (Optional) Right-click scripts\configure-firewall.bat and
echo      choose "Run as administrator" so partners on Wi-Fi can connect.
echo.
pause

