@echo off
setlocal EnableExtensions
cd /d "%~dp0" || (echo Cannot find the LifeOS folder.& pause & exit /b 1)
title LifeOS v0.2 - Web
set "LIFEOS_PORT=8791"
echo.
echo   LifeOS v0.2
echo   Starting the current workspace at http://127.0.0.1:%LIFEOS_PORT%
echo   Keep this window open while using LifeOS.
echo.
python backend\server.py
echo.
echo LifeOS stopped or could not start. Check the message above.
pause
