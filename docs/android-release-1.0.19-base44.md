# Sunchaser CRM 1.0.19 — Base44 migration

Package: `com.sunchaser.crm`. Version code: **22**. Target SDK: **36**. Minimum SDK: **23**.

The Android shell now opens `https://crm.sunchaserenergy.co/client`. It uses the live Base44 frontend and backend, so future web fixes appear without bundling the former Railway API frontend. Internet access is required. An offline retry screen is bundled. Existing app identity, icon and upload certificate are retained.

## Customer access

1. Customer opens the app and creates an account using email/password and email verification. Existing legacy CRM usernames/passwords are not migrated.
2. The administrator opens `https://crm.sunchaserenergy.co/customer-access` (also linked from the staff CRM), finds the registered email, verifies the customer's identity, selects the corresponding customer record and saves the link.
3. Customer refreshes the app. Only the linked customer's system information, invoice totals, explicitly shared files, warranty records and support requests are available.
4. Staff/administrators use **Open staff CRM** from the customer portal. CRM APIs and direct CrmRecord reads remain administrator-only.

Google sign-in remains available on the website; Android uses email/password because embedded Google OAuth is unsupported. Account deletion is requested through a support ticket for staff processing. The app does not claim to automate deletion.

## Included behavior

- Dark navy/gold customer interface with Home, Documents, Support and Account sections.
- Customer record and equipment summary, saved installation status and invoice balances.
- Invoice PDF rendering; private file downloads require explicit customer visibility and ownership.
- Native PDF/file sharing through the Android share sheet.
- Service, technical, warranty and general requests, saved with retry protection and displayed in the existing administrator support workflow.
- Customer-visible support updates and resolution summaries.
- Session expiration returns to sign-in. Back navigation returns to Home and then minimizes the app.
- Cleartext traffic, release WebView debugging and application backup disabled.

This is the migrated customer essentials release. Live inverter telemetry, native push notifications, subscription payments and the full legacy portal feature set are not implemented in this new customer screen. Older archived files without migrated private bytes are shown as unavailable rather than returning broken legacy URLs.

## Verification

- Signed `bundleRelease` and `assembleRelease`: passed locally with JDK 21, Gradle 9.4.1 and Android SDK 36.
- Base44 customer API authorization/isolation/idempotency tests plus existing CRM authentication, login, admin workflow and migration regression checks: **25/25 passed**.
- Vite frontend build: passed.
- New customer API: deployed and responds to authenticated owner identity and admin access list in browser preview.
- Base44 publication: confirmed **Your app is live**, custom CRM hostname.
- Published customer and login pages: rendered in the connected browser.
- App package/version, AAB structure, signing certificate and packaged remote server configuration checked separately with bundletool, jarsigner and ZIP inspection.
- Play Console upload certificate SHA-256 matched the existing release keystore. The Play app-signing certificate is different, as expected with Play App Signing.
- No physical Android device test or complete real customer login/link/download/support journey has been performed. Start with Internal testing and verify one customer account before production rollout.

## Build

Use a clean checkout, JDK 21 and Android SDK 36. Supply `SUN_ANDROID_KEYSTORE`, `SUN_ANDROID_STORE_PASSWORD`, `SUN_ANDROID_KEY_PASSWORD` and optionally `SUN_ANDROID_KEY_ALIAS` through the environment, then run:

```sh
bash scripts/build-base44-android.sh
```

Outputs: `android/app/build/outputs/bundle/release/app-release.aab` and `android/app/build/outputs/apk/release/app-release.apk`.

Keystore files must stay outside Git. The previous repository history already exposed the old upload key; removing it from this branch does not revoke that exposure. Arrange a Play upload-key reset separately. This release reuses the currently registered upload certificate for compatibility.

## Suggested Play release notes

Updated for the migrated Sunchaser service. View your solar system details, invoices, shared documents, warranties and support requests in an improved customer interface. Improved connection recovery and document sharing. Sign in with your registered email; contact Sunchaser if your customer record needs linking.
