import React from "react";
import { DEFAULT_BRANDING } from "../lib/branding";

type AppLogoProps = {
  className?: string;
  logoUrl?: string;
  alt?: string;
};

export default function AppLogo({
  className = "h-10 w-auto",
  logoUrl = DEFAULT_BRANDING.logoUrl,
  alt = DEFAULT_BRANDING.companyName,
}: AppLogoProps) {
  return (
    <img
      src={logoUrl || DEFAULT_BRANDING.logoUrl}
      alt={alt}
      className={className}
      onError={(e) => {
        (e.target as HTMLImageElement).src = DEFAULT_BRANDING.logoUrl;
      }}
    />
  );
}
