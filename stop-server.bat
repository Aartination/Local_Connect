@echo off
setlocal
title LOCAL HUB - Stop Server
cd /d "%~dp0"

node scripts\stop.mjs
echo.
pause

