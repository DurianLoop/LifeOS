#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo '[1/4] Verifying private Vault...'
python3 scripts/verify_vault.py
echo '[2/4] Verifying 141-system registry...'
python3 scripts/feature_parity_audit.py
echo '[3/4] Running Memory Engine self-test...'
python3 scripts/self_test.py
echo '[4/4] Running refinement retrieval/UI smoke tests...'
python3 scripts/refinement_viii_smoke_test.py
echo 'LifeOS verification PASS'
