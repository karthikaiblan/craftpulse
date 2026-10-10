@echo off
title CraftPulse ZIP Generator & GitHub Sync
echo ========================================================
echo [1/2] Generating fresh ZIP archive with ZEPHYR backend...
echo ========================================================
cd /d "C:\Users\KARTHI\.gemini\antigravity\scratch\craftpulse"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$desktop = [Environment]::GetFolderPath('Desktop'); $artifact = 'C:\Users\KARTHI\.gemini\antigravity\brain\49868423-28ea-4fa4-b024-6575bf647362'; Write-Host 'Compressing files into craftpulse_source_code.zip...' -ForegroundColor Cyan; Compress-Archive -Path index.html, README.md, BACKEND_INTEGRATION.md, firebase.json, firestore.rules, firestore.indexes.json, start_public_live_tunnel.bat, create_zip.bat, update_craftpulse_github_and_zip.bat, images, backend, functions -DestinationPath craftpulse_source_code.zip -Force; Copy-Item craftpulse_source_code.zip \"$desktop\craftpulse_source_code.zip\" -Force; Copy-Item craftpulse_source_code.zip \"$artifact\craftpulse_source_code.zip\" -Force; Write-Host '>>> SUCCESS: ZIP is saved to Desktop!' -ForegroundColor Green"

echo.
echo ========================================================
echo [2/2] Committing and Pushing to GitHub...
echo ========================================================
git add -A
git commit -m "Integrate ZEPHYR LocalLoop backend architecture with unchanged royal UI"
git push origin main

echo.
echo ========================================================
echo ALL DONE! Press any key to close this window.
echo ========================================================
pause
