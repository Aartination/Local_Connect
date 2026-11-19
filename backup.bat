@echo off
setlocal
title LOCAL HUB - Create Backup
cd /d "%~dp0"

echo Creating full backup of LOCAL HUB database and uploaded files...
echo.
node scripts\backup.mjs %*
echo.
pause

