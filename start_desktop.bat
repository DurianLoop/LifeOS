@echo off
setlocal EnableExtensions
cd /d "%~dp0desktop" || (echo Cannot find the desktop folder.& pause & exit /b 1)
title LifeOS v0.3 - Desktop
if not exist node_modules\electron (echo Desktop dependencies are missing. Run setup_desktop.bat once.& pause & exit /b 1)
where npm >nul 2>nul || (echo Node.js is missing. Run setup_desktop.bat first.& pause & exit /b 1)
echo.
echo   Opening LifeOS v0.3 desktop...
echo.
call npm start
if errorlevel 1 (
  echo.
  echo The desktop app could not start. Check the message above.
  pause
)
