Android PDF share hotfix verification:
- Reduces native PDF handoff to one cache file.
- Uses FileReader Data URL conversion instead of Uint8Array/btoa accumulation.
- Uses Capacitor Share single-file `url` path.
- Guards Share availability and native share errors.
- Android version: 1.0.9 (12).
- Vite build, Capacitor sync, and signed release APK build passed in workflow run 34814613264.
