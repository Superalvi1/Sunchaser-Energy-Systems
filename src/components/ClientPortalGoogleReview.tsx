import React, { useEffect, useState } from "react";
import { CheckCircle2, Star } from "lucide-react";
import type { CompanyBranding } from "../lib/branding";
import { portal, resolveGoogleReviewUrl } from "../lib/clientPortalUi";
import {
  googleReviewQrImageUrl,
  isGoogleReviewMarkedComplete,
  markGoogleReviewComplete,
} from "../lib/clientPortalReviewTracking";

interface ClientPortalGoogleReviewProps {
  customerId: string;
  branding?: CompanyBranding | null;
}

export default function ClientPortalGoogleReview({ customerId, branding }: ClientPortalGoogleReviewProps) {
  const reviewUrl = resolveGoogleReviewUrl(branding);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    setCompleted(isGoogleReviewMarkedComplete(customerId));
  }, [customerId]);

  const handleMarkDone = () => {
    markGoogleReviewComplete(customerId);
    setCompleted(true);
  };

  return (
    <section className={`${portal.card} ${portal.cardPad} space-y-4`}>
      <div className="flex items-center gap-2">
        <Star className="h-5 w-5 text-amber-400 fill-amber-400" />
        <h2 className={portal.titleSm}>Leave a Google Review</h2>
      </div>
      <p className={portal.subtitle}>
        Your project is complete. Help other homeowners discover Sunchaser Energy.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-5">
        <div className={`${portal.cardMuted} p-3 rounded-2xl shrink-0`}>
          <img
            src={googleReviewQrImageUrl(reviewUrl, 160)}
            alt="Google review QR code"
            width={160}
            height={160}
            className="rounded-xl"
          />
          <p className="text-[10px] text-slate-500 text-center mt-2">Scan to review</p>
        </div>
        <div className="flex-1 w-full space-y-3">
          <a
            href={reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={portal.btnPrimary + " w-full"}
            onClick={() => {
              window.setTimeout(() => handleMarkDone(), 800);
            }}
          >
            <Star className="h-4 w-4 fill-current" />
            Leave Google Review
          </a>
          {!completed ? (
            <button type="button" onClick={handleMarkDone} className={portal.btnSecondary + " w-full !text-xs"}>
              I&apos;ve submitted my review
            </button>
          ) : (
            <p className="flex items-center justify-center gap-2 text-sm text-emerald-400 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Review marked complete — thank you!
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
