@echo off
setlocal EnableExtensions
cd /d "%~dp0desktop" || (echo Cannot find the desktop folder.& pause & exit /b 1)
title LifeOS v0.3 - Desktop setup
echo.
echo   LifeOS v0.3 desktop setup for running from source
echo.
where npm >nul 2>nul || (echo Node.js LTS is required. Install it from https://nodejs.org/ and run this file again.& pause & exit /b 1)
if not defined LIFEOS_PYTHON set "LIFEOS_PYTHON=python"
"%LIFEOS_PYTHON%" -c "import sys; assert sys.version_info >= (3, 10), 'Python 3.10 or newer is required'" >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 or newer is needed to run the source checkout.
  echo The Windows installer includes Python and does not need this setup script.
  echo Install Python or set LIFEOS_PYTHON to its full executable path, then retry.
  pause
  exit /b 1
)
"%LIFEOS_PYTHON%" -m pip install -r ..\requirements.txt
if errorlevel 1 (echo Python dependency setup failed.& pause & exit /b 1)
call npm ci
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
