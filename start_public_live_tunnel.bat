@echo off
title CraftPulse Public Internet Link
echo ========================================================
echo Starting Cloudflare Public Internet Link...
echo ========================================================
python -m http.server 8080 --directory "%~dp0" >nul 2>&1 &
"%~dp0cloudflared.exe" tunnel --url http://localhost:8080
pause
