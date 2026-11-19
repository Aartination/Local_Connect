@echo off
setlocal
title LOCAL HUB - Restore Backup
cd /d "%~dp0"

node scripts\restore.mjs %*
echo.
pause

