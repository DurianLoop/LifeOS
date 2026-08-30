@echo off
cd /d "%~dp0mobile"
call npm install
if errorlevel 1 exit /b %errorlevel%
echo.
echo Capacitor dependencies installed.
echo Use: npm run add:android  or on macOS: npm run add:ios
