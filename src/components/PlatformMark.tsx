import React, { useSyncExternalStore } from "react";
import { getPlatformInfo, subscribeWorkspace, type PlatformInfo } from "../lib/workspaceModules";

const SYNC_BUILD_INFO: PlatformInfo = { multiCompany: true, platformName: "Sunchaser Sync" };

/** The platform's name as the sign-in screens show it. null in single-company mode (those screens keep their existing Sunchaser wording). */
export function usePlatformInfo(): PlatformInfo | null {
  const info = useSyncExternalStore(subscribeWorkspace, getPlatformInfo, getPlatformInfo);
  // Branding only: this build flag never enables server permissions or company access.
  return info && info.multiCompany ? info : import.meta.env.VITE_APP_VARIANT === "sync" ? SYNC_BUILD_INFO : null;
}

/** A plain wordmark: the platform has no logo image of its own, and a company's logo must not stand in for it before anyone has signed in. */
export function PlatformWordmark({ name, className = "" }: { name: string; className?: string }) {
  return (
    <div className={`mx-auto mb-2 inline-flex items-center gap-2 ${className}`} data-testid="platform-wordmark" aria-label={name}>
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500 text-lg font-black text-slate-950" aria-hidden="true">S</span>
      <span className="text-2xl font-extrabold tracking-tight text-white">{name}</span>
    </div>
  );
}
