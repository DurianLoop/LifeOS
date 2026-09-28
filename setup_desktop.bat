@echo off
setlocal EnableExtensions
cd /d "%~dp0" || exit /b 1
title LifeOS - Desktop setup
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS is required. Install it from https://nodejs.org/ and retry.
  if /i not "%~1"=="--no-launch" pause
  exit /b 1
)
node "%~dp0desktop\setup.cjs" setup %*
set "LIFEOS_SETUP_EXIT=%errorlevel%"
if not "%LIFEOS_SETUP_EXIT%"=="0" if /i not "%~1"=="--no-launch" pause
exit /b %LIFEOS_SETUP_EXIT%
