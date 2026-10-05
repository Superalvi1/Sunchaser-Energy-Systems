# Android 1.0.15 release

Package: `com.sunchaser.crm`  
Version: `1.0.15`  
Version code: `18`  
Target SDK: `36`

The Android production build now connects to `https://crm.sunchaserenergy.co` instead of the retired Render endpoint. It includes the current CRM interface, saved Smart Quote proposals, document upload fixes, editable client names, and WhatsApp sales agent settings. AI replies still require a configured provider API key/model and explicit enablement.

## Play Console release name

`1.0.15 (18) – CRM and quotation updates`

## English release notes

```text
Improved saved quotations and proposal access.
Fixed document uploads and added client name editing.
Updated CRM screens and WhatsApp AI settings.
Connected the Android app to our current production server.
Improved mobile navigation and reliability.
```

Upload the signed Android App Bundle to the existing Sunchaser CRM listing. Use internal testing to verify login, proposal viewing/PDF downloads, uploads and staff navigation on an actual device before production rollout. Do not create a new app listing. Google Play must accept and publish the release before users can download the update from the store. If version code 18 has already been used outside this repository, increment it and rebuild.

Build: `bash scripts/build-android-release.sh`. The existing upload key is retained; do not replace it to resolve a signing mismatch.
