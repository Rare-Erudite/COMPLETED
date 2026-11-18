#!/bin/bash
# Emulator smoke test for the RARE APK.
#
# The android-emulator-runner action executes each line of its `script` input in
# a SEPARATE shell, so shell variables do not survive from one line to the next.
# Everything therefore lives in this file and is invoked as a single command.
set -euo pipefail

APK="$(find . -name '*.apk' -type f -print -quit)"
echo "APK: $APK"
test -n "$APK"
test -s "$APK"

echo "=== adb install ==="
adb install "$APK"

echo "=== installed package ==="
adb shell pm list packages | grep com.rare.ai.intelligence

echo "=== launch ==="
adb logcat -c
adb shell am start -W -n com.rare.ai.intelligence/.MainActivity
sleep 25

echo "=== process id (empty means it is not running) ==="
adb shell pidof com.rare.ai.intelligence || echo "NOT RUNNING"

echo "=== app logcat ==="
adb logcat -d -s RARE_APP:* | tail -80 || true

echo "=== network: did the WebView reach the production host? ==="
adb logcat -d | grep -i "rareproject.vercel.app" | tail -20 || echo "no direct host string in logcat"

echo "=== screenshot ==="
adb exec-out screencap -p > "${RUNNER_TEMP:-/tmp}/launch.png" || true
ls -l "${RUNNER_TEMP:-/tmp}/launch.png" || true

echo "=== crash check ==="
if adb logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime.*com.rare.ai.intelligence"; then
  echo "::error::App crashed on launch"
  exit 1
fi
echo "No fatal exception in logcat."
