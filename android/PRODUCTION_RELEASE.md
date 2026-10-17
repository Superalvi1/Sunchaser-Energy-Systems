# Sunchaser CRM — Android Play release 1.0.18 (21)

This is a release-preparation branch, not a verified Google Play upload. Never publish until a signed bundle and a real-device smoke test pass.

| Setting | Value |
|---|---|
| Android application ID | `com.sunchaser.crm` (do not change) |
| Version name / code | `1.0.18` / `21` |
| Android target SDK | 36 (Google Play Android 16 requirement since Aug 31, 2026) |
| Native Capacitor API default | `https://crm.sunchaserenergy.co` |
| Signing alias | `sunchaser-key` unless overridden securely |
| Play upload key | Must match the existing upload certificate in Play Console |

## Critical: confirm Play Console version

Open Google Play Console → Sunchaser CRM → Release → App bundle explorer, and confirm that the greatest previously uploaded version code is below 21. If it is 21 or above, increase `versionCode` further before building; Google Play rejects reused or lower codes.

## Security: move signing material to GitHub Actions Secrets

Older versions of `android/app/build.gradle` committed signing passwords in the public repository. The new Gradle file reads credentials only from environment variables; **rotate the local keystore/key passwords** and treat the historical values as exposed. Do not commit the keystore, passwords, or certificates containing private keys. Rotating passwords should retain the same private signing key/certificate, which is needed to update the existing app. If the upload private key itself may be compromised, follow Google's upload-key reset process before publishing.

Configure these GitHub Actions repository secrets (Settings → Secrets and variables → Actions):

- `SUN_ANDROID_KEYSTORE_BASE64`: base64 encoding of the **original registered upload keystore** (`android/app/sunchaser-release-key.jks`). On macOS: `base64 -i /path/to/original.jks | tr -d '\\n'` (save in the secret, not in source code).
- `SUN_ANDROID_STORE_PASSWORD`: current store password.
- `SUN_ANDROID_KEY_PASSWORD`: current private-key password.
- Optional `SUN_ANDROID_KEY_ALIAS`: set only if the correct keystore's alias is not `sunchaser-key`.

Never send signing keys/passwords through chat.

To validate the key, export the **public certificate** locally via `keytool -exportcert -rfc -keystore /path/to/original.jks -alias sunchaser-key -file upload-certificate.pem` and compare its SHA-256 certificate fingerprint to the registered **upload certificate** in Play Console's App integrity screen.

## Building and retrieving the signed AAB

The GitHub Actions workflow `Build Android CRM (debug and signed Play bundle)` builds the latest web UI and Capacitor assets. On each push to main it uploads a debug APK; it uploads a **signed AAB only when all signing secrets are present**. A manual `workflow_dispatch` fails clearly if any required signing material is missing.

Before merging, open GitHub → Actions → Build Android CRM → Run workflow, select branch `release/android-1.0.18-build21`, wait for success, and download `Sunchaser-CRM-1.0.18-build21-play-store-aab`. Unzip that artifact and test it on a device. After approving and merging the PR, build again on `main` and upload that fresh `app-release.aab` file to Google Play Console, preferably the Internal testing track first. Do not upload `app-debug.apk` to the release track.

For a local build (with the original keystore stored at `android/app/sunchaser-release-key.jks`):

```bash
export SUN_ANDROID_STORE_PASSWORD='YOUR_CURRENT_STORE_PASSWORD'
export SUN_ANDROID_KEY_PASSWORD='YOUR_CURRENT_KEY_PASSWORD'
export SUN_ANDROID_KEY_ALIAS='sunchaser-key'
npm ci --ignore-scripts
./scripts/build-android-release.sh
```

The unsigned frontend build alone is **not** a Play release. The workflow embeds only client-side UI/assets; server-only CRM/Moos integrations must be deployed separately.

## Release QA

1. Confirm Android backend requests go to `https://crm.sunchaserenergy.co/api` — not WebView localhost or the old Render host.
2. Test login, token renewal, user roles, customer and lead lists, quotation creation and PDF download, invoice print, and WhatsApp inbox on a physical Android device.
3. Confirm the app opens with existing users' data intact; changing app ID or upload certificate would break updates.
4. Verify the upload bundle's `versionCode`, `targetSdkVersion`, and signing certificate before Google Play submission.
5. Internal-test the AAB on one device; only then promote to production.

Do not claim that the Moos agent is available in the Android release until its separate backend PR has been merged, deployed, and tested with auto-replies kept off.
