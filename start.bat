@echo off
setlocal EnableExtensions
cd /d "%~dp0" || (echo Cannot find the LifeOS folder.& pause & exit /b 1)
title LifeOS V0.1 Iteration 2 - Web
set "LIFEOS_PORT=8791"
echo.
echo   LifeOS V0.1 Iteration 2
echo   Starting the current workspace at http://127.0.0.1:%LIFEOS_PORT%
echo   Keep this window open while using LifeOS.
echo.
if not exist data\lifeos.db (
  echo   Creating a clean local index for your empty Vault...
  python engine\rebuild_memory_engine.py || (echo Could not create the local index.& pause & exit /b 1)
)
python backend\server.py
echo.
echo LifeOS stopped or could not start. Check the message above.
pause
