#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${JAVA_HOME:-}" ]] && [[ -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

echo "==> Production web build (mode production)"
./node_modules/.bin/vite build --mode production

echo "==> Capacitor sync android"
./node_modules/.bin/cap sync android

# Runtime uploads belong on the CRM server, not in distributable app assets.
node --input-type=module <<'JS'
import { rmSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
const uploads = resolve('android/app/src/main/assets/public/uploads');
try {
  if (lstatSync(uploads).isSymbolicLink()) throw new Error('Refusing linked upload assets');
  rmSync(uploads, { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
JS

echo "==> Signed release AAB"
cd android
./gradlew bundleRelease

AAB_PATH="$ROOT/android/app/build/outputs/bundle/release/app-release.aab"
if [[ -f "$AAB_PATH" ]]; then
  echo ""
  echo "Release AAB: $AAB_PATH"
  ls -lh "$AAB_PATH"
else
  echo "AAB not found at expected path" >&2
  exit 1
fi
