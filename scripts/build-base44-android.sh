#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:?Set JAVA_HOME to JDK 21}"
: "${ANDROID_HOME:?Set ANDROID_HOME to Android SDK with API 36 and build-tools 36.0.0}"
: "${SUN_ANDROID_KEYSTORE:?Set the absolute path to your existing Play upload keystore}"
: "${SUN_ANDROID_STORE_PASSWORD:?Set the upload keystore password}"
: "${SUN_ANDROID_KEY_PASSWORD:?Set the key password}"
npm ci --prefix mobile-runtime --ignore-scripts --no-audit --no-fund
if [ ! -e node_modules ]; then ln -s mobile-runtime/node_modules node_modules; fi
./mobile-runtime/node_modules/.bin/cap sync android
cd android
bash gradlew bundleRelease assembleRelease --no-daemon --console=plain
