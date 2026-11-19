@echo off
setlocal
title LOCAL HUB Server
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please run install.bat first.
  pause
  exit /b 1
)

if not exist "server\dist\index.js" (
  echo Building LOCAL HUB first...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
  )
)

if not exist "client\dist\index.html" (
  echo Building web client first...
  call npm run build --workspace client
  if errorlevel 1 (
    echo [ERROR] Client build failed.
    pause
    exit /b 1
  )
)

if not exist "database\localhub.db" (
  call npm run db:migrate
)

echo Starting LOCAL HUB... (Press Ctrl+C or run stop-server.bat to stop)
echo.
node server\dist\index.js
if errorlevel 1 (
  echo.
  echo LOCAL HUB exited with an error. Check logs\ for details.
  pause
)

