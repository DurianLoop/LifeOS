@echo off
setlocal EnableExtensions
cd /d "%~dp0desktop" || (echo Cannot find the desktop folder.& pause & exit /b 1)
title LifeOS v0.2 - Desktop
if not exist node_modules\electron (echo Desktop dependencies are missing. Run setup_desktop.bat once.& pause & exit /b 1)
set "LIFEOS_PORT=8791"
set "LIFEOS_BACKEND_URL=http://127.0.0.1:%LIFEOS_PORT%"
echo.
echo   Opening LifeOS v0.2 desktop...
echo.
call npm start
if errorlevel 1 (
  echo.
  echo The desktop app could not start. Check the message above.
  pause
)
