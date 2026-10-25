@echo off
rem ---------------------------------------------------------------------------
rem  EVOLT - one-click local start for Windows.
rem  Double-click this file. The first run installs dependencies, sets up a
rem  private PostgreSQL database, loads demo data and builds the app (a few
rem  minutes). Later runs start in seconds. Close the window to stop EVOLT.
rem
rem  Options (from a terminal):  run-evolt.bat --rebuild | --no-seed | --no-open | --port 3001
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
title EVOLT

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [EVOLT] Node.js is not installed. Install the LTS version from https://nodejs.org
  echo         then double-click run-evolt.bat again.
  start "" "https://nodejs.org/en/download"
  goto :fail
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)"
if errorlevel 1 (
  echo.
  echo [EVOLT] Node.js 20.9 or newer is required. Please update Node.js from https://nodejs.org
  goto :fail
)

if not exist "node_modules\next\package.json" goto :install
if not exist "node_modules\embedded-postgres\package.json" goto :install
goto :start

:install
echo [EVOLT] Installing dependencies (first run only, needs internet)...
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo [EVOLT] npm ci failed, trying npm install...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
)

:start
node scripts\run-local.mjs %*
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo [EVOLT] EVOLT could not start. Read the messages above for the reason.
pause
exit /b 1
