@echo off
setlocal EnableExtensions
cd /d "%~dp0desktop" || (echo Cannot find the desktop folder.& pause & exit /b 1)
title LifeOS V0.1 Iteration 2 - Desktop
if not exist node_modules\electron (echo Desktop dependencies are missing. Run setup_desktop.bat once.& pause & exit /b 1)
if not exist ..\data\lifeos.db (
  echo Creating a clean local index for your empty Vault...
  python ..\engine\rebuild_memory_engine.py || (echo Could not create the local index.& pause & exit /b 1)
)
set "LIFEOS_PORT=8791"
set "LIFEOS_BACKEND_URL=http://127.0.0.1:%LIFEOS_PORT%"
echo.
echo   Opening LifeOS V0.1 Iteration 2 desktop...
echo.
call npm start
if errorlevel 1 (
  echo.
  echo The desktop app could not start. Check the message above.
  pause
)
