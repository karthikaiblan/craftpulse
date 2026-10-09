@echo off
title CraftPulse Web Server
echo ========================================================
echo Starting CraftPulse Server on http://localhost:8080
echo Press Ctrl+C in this window to stop the server when done.
echo ========================================================
start http://localhost:8080
python -m http.server 8080 --directory "%~dp0"
pause
