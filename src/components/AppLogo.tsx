import React, { useState, useSyncExternalStore } from "react";
import { DEFAULT_BRANDING } from "../lib/branding";
import { OFFICIAL_SUNCHASER_LOGO, resolveOfficialLogoUrl } from "../lib/brandingAssets";
import { subscribeWorkspace, workspaceIsNeutral } from "../lib/workspaceModules";

type AppLogoProps = {
  className?: string;
  logoUrl?: string;
  alt?: string;
  /** A company with no logo of its own shows its name in place of the image (default). The shell header already prints the name. */
  nameFallback?: boolean;
  /** Decides by itself whether this is another company's screen (e.g. from its own branding); by default the open workspace decides. */
  neutral?: boolean;
};

export default function AppLogo({
  className = "h-10 w-auto",
  logoUrl,
  alt = DEFAULT_BRANDING.companyName,
  nameFallback = true,
  neutral: neutralProp,
}: AppLogoProps) {
  // A company other than Sunchaser never shows Sunchaser's logo: with no logo of its own it shows its name (or nothing), and a logo
  // that fails to load is hidden instead of being replaced by the Sunchaser one.
  const workspaceNeutral = useSyncExternalStore(subscribeWorkspace, workspaceIsNeutral, workspaceIsNeutral);
  const neutral = neutralProp ?? workspaceNeutral;
  const [broken, setBroken] = useState(false);
  if (neutral) {
    const own = (logoUrl || "").trim();
    if (!own || broken) return nameFallback && alt && alt !== DEFAULT_BRANDING.companyName ? <span className="font-extrabold text-white" data-testid="company-wordmark">{alt}</span> : null;
    return <img src={own} alt={alt} className={className} onError={() => setBroken(true)} />;
  }
  const src = resolveOfficialLogoUrl(logoUrl || DEFAULT_BRANDING.logoUrl);
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={(e) => {
        (e.target as HTMLImageElement).src = OFFICIAL_SUNCHASER_LOGO;
      }}
    />
  );
}
