@echo off
setlocal EnableExtensions
cd /d "%~dp0desktop" || (echo Cannot find the desktop folder.& pause & exit /b 1)
title LifeOS V0.1 Iteration 2 - Desktop setup
echo.
echo   LifeOS V0.1 Iteration 2 desktop setup
echo.
where npm >nul 2>nul || (echo Node.js LTS is required. Install it from https://nodejs.org/ and run this file again.& pause & exit /b 1)
call npm install
if errorlevel 1 (
  echo.
  echo Setup did not finish. Keep this window open and check the npm message above.
  pause
  exit /b 1
)
echo.
echo Setup complete. LifeOS will open now.
pause
call "%~dp0start_desktop.bat"
