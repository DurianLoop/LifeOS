@echo off
setlocal EnableExtensions
cd /d "%~dp0" || exit /b 1
title LifeOS - Desktop
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS is required. Run setup_desktop.bat first.
  if /i not "%~1"=="--no-launch" pause
  exit /b 1
)
node "%~dp0desktop\setup.cjs" start %*
set "LIFEOS_START_EXIT=%errorlevel%"
if not "%LIFEOS_START_EXIT%"=="0" if /i not "%~1"=="--no-launch" pause
exit /b %LIFEOS_START_EXIT%
