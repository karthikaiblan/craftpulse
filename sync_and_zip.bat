@echo off
title CraftPulse GitHub Sync & ZIP Generator
echo ========================================================
echo Updating CraftPulse ZIP and Pushing to GitHub...
echo ========================================================
cd /d "C:\Users\KARTHI\.gemini\antigravity\scratch\craftpulse"

echo [1/3] Committing independent per-device session updates...
git add index.html
git commit -m "Enable independent per-device session and device role selector"
git push origin main

echo [2/3] Generating fresh ZIP archive...
powershell -NoProfile -Command "$desktop = [Environment]::GetFolderPath('Desktop'); Compress-Archive -Path index.html, README.md, start_public_live_tunnel.bat, images -DestinationPath craftpulse_source_code.zip -Force; Copy-Item craftpulse_source_code.zip \"$desktop\craftpulse_source_code.zip\" -Force; Copy-Item craftpulse_source_code.zip \"C:\Users\KARTHI\.gemini\antigravity\brain\49868423-28ea-4fa4-b024-6575bf647362\craftpulse_source_code.zip\" -Force; Write-Host 'ZIP successfully updated on Desktop!' -ForegroundColor Green"

echo [3/3] Done! GitHub Pages will update automatically.
echo ========================================================
echo SUCCESS! Press any key to exit.
echo ========================================================
pause
