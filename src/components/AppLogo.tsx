import React from "react";
import { DEFAULT_BRANDING } from "../lib/branding";
import { OFFICIAL_SUNCHASER_LOGO, resolveOfficialLogoUrl } from "../lib/brandingAssets";

type AppLogoProps = {
  className?: string;
  logoUrl?: string;
  alt?: string;
};

export default function AppLogo({
  className = "h-10 w-auto",
  logoUrl,
  alt = DEFAULT_BRANDING.companyName,
}: AppLogoProps) {
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
