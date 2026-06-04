import { Capacitor } from "@capacitor/core";

/** True when running inside Capacitor Android/iOS shell (not mobile browser). */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
