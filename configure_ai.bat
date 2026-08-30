@echo off
cd /d "%~dp0"
python scripts\configure_ai.py
if errorlevel 1 pause & exit /b 1
python scripts\test_ai_connection.py
pause
