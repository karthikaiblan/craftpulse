@echo off
title Create CraftPulse ZIP
echo ========================================================
echo Creating CraftPulse + ZEPHYR Backend ZIP Archive...
echo ========================================================
cd /d "C:\Users\KARTHI\.gemini\antigravity\scratch\craftpulse"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$desktop = [Environment]::GetFolderPath('Desktop'); $artifact = 'C:\Users\KARTHI\.gemini\antigravity\brain\49868423-28ea-4fa4-b024-6575bf647362'; Write-Host 'Packaging CraftPulse + ZEPHYR files...' -ForegroundColor Cyan; Compress-Archive -Path index.html, README.md, BACKEND_INTEGRATION.md, firebase.json, firestore.rules, firestore.indexes.json, start_public_live_tunnel.bat, create_zip.bat, update_craftpulse_github_and_zip.bat, images, backend, functions -DestinationPath craftpulse_source_code.zip -Force; Copy-Item craftpulse_source_code.zip \"$desktop\craftpulse_source_code.zip\" -Force; Copy-Item craftpulse_source_code.zip \"$artifact\craftpulse_source_code.zip\" -Force; Write-Host 'SUCCESS: craftpulse_source_code.zip has been created directly on your Desktop!' -ForegroundColor Green"

echo.
echo ========================================================
echo SUCCESS! Your ZIP file is ready on your Desktop.
echo Press any key to close.
echo ========================================================
pause
