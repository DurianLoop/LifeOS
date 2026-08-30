@echo off
cd /d "%~dp0"
echo Rebuilding local Memory Engine from Private Vault...
python engine\rebuild_memory_engine.py
pause
