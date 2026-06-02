# Android production release

## Verified configuration

| Item | Value |
|------|--------|
| Package name | `com.sunchaser.crm` |
| Production API | `https://sunchaser-energy-systems.onrender.com` |
| Production Supabase | **Sunchaser Production** — project ref `xxtdfvgkurxabpbmjban` (`https://xxtdfvgkurxabpbmjban.supabase.co`) |
| Version name | `1.0.0` |
| Version code | `2` |

Auth and data flow through Render; the mobile app does not call Supabase directly.

## Build signed AAB

```bash
chmod +x scripts/build-android-release.sh
./scripts/build-android-release.sh
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

## Signing

Release signing uses `android/app/sunchaser-release-key.jks` (not committed). Configure passwords locally in `android/app/build.gradle` or via environment-specific signing config.
