@echo off
setlocal
title LOCAL HUB - Windows Firewall Setup
cd /d "%~dp0\.."

net session >nul 2>&1
if errorlevel 1 (
  echo [INFO] This script must be run as Administrator to configure Windows Firewall.
  echo Right-click scripts\configure-firewall.bat and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)

set HTTP_PORT=3000
set HTTPS_PORT=3443
for /f "tokens=*" %%p in ('node -e "try{const c=require('./config/localhub.config.json');console.log(c.port||3000)}catch{console.log(3000)}"') do set HTTP_PORT=%%p
for /f "tokens=*" %%p in ('node -e "try{const c=require('./config/localhub.config.json');console.log(c.httpsPort||3443)}catch{console.log(3443)}"') do set HTTPS_PORT=%%p

echo Allowing LOCAL HUB ports %HTTP_PORT% (HTTP) and %HTTPS_PORT% (HTTPS) on Private networks...
netsh advfirewall firewall delete rule name="LOCAL HUB HTTP" >nul 2>&1
netsh advfirewall firewall delete rule name="LOCAL HUB HTTPS" >nul 2>&1

netsh advfirewall firewall add rule name="LOCAL HUB HTTP" dir=in action=allow protocol=TCP localport=%HTTP_PORT% profile=private
netsh advfirewall firewall add rule name="LOCAL HUB HTTPS" dir=in action=allow protocol=TCP localport=%HTTPS_PORT% profile=private

echo.
echo [OK] Firewall rules added for Private Wi-Fi/LAN networks (ports %HTTP_PORT% and %HTTPS_PORT%).
echo NOTE: Make sure your Windows Wi-Fi network profile is set to "Private" in Windows Settings.
echo.
pause

