@echo off
cd /d "%~dp0"
echo [1/4] Verifying private Vault...
python scripts\verify_vault.py || goto :fail
echo [2/4] Verifying 141-system registry...
python scripts\feature_parity_audit.py || goto :fail
echo [3/4] Running Memory Engine self-test...
python scripts\self_test.py || goto :fail
echo [4/4] Running refinement retrieval/UI smoke tests...
python scripts\refinement_viii_smoke_test.py || goto :fail
echo.
echo LifeOS verification PASS
pause
exit /b 0
:fail
echo.
echo LifeOS verification FAILED
pause
exit /b 1
