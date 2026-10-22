#!/usr/bin/env bash
set -u
cd mobile
mkdir -p logs
python ../scripts/android_documents_acceptance.py > logs/documents-driver.log 2>&1 &
DRIVER=$!
timeout 1320 briefcase run android --test --no-input -d emulator-5554 > logs/native-acceptance.txt 2>&1
RESULT=$?
cat logs/native-acceptance.txt
adb logcat -d > logs/android-logcat.txt
adb shell screencap -p /sdcard/acceptance.png
adb pull /sdcard/acceptance.png logs/android-screen.png
adb exec-out run-as life.lifeos.lifeosmobile cat files/data/NATIVE_ACCEPTANCE.json > logs/NATIVE_ACCEPTANCE.json
if [ "$RESULT" -eq 0 ]; then
    wait "$DRIVER"
    RESULT=$?
else
    kill "$DRIVER" 2>/dev/null || true
fi
exit "$RESULT"
