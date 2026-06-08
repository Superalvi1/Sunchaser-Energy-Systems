import React, { useState } from "react";
import { Copy, MessageCircle, Link2 } from "lucide-react";
import { useToast } from "../lib/toast";
import {
  buildPortalInvitationMessage,
  buildWhatsAppInvitationUrl,
  getCustomerPortalUrl,
} from "../lib/customerInvitation";

interface CustomerInvitationPanelProps {
  customerName: string;
  customerCode: string | null | undefined;
  phone?: string | null;
  compact?: boolean;
}

export default function CustomerInvitationPanel({
  customerName,
  customerCode,
  phone,
  compact = false,
}: CustomerInvitationPanelProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const code = customerCode || null;

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied.`);
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };

  if (!code) {
    return (
      <p className={`text-slate-500 font-mono ${compact ? "text-[10px]" : "text-xs"}`}>
        Customer Code: not assigned yet (run migration or create customer in Supabase).
      </p>
    );
  }

  const invitation = buildPortalInvitationMessage(customerName, code);
  const portalUrl = getCustomerPortalUrl();

  const openWhatsApp = () => {
    setBusy(true);
    const url = buildWhatsAppInvitationUrl(phone || "", invitation);
    window.open(url, "_blank", "noopener,noreferrer");
    setBusy(false);
  };

  return (
    <div
      className={`rounded-2xl border border-amber-500/20 bg-amber-500/5 ${
        compact ? "p-3 space-y-2" : "p-4 space-y-3"
      }`}
    >
      <h4 className={`font-bold text-amber-400 uppercase tracking-wide ${compact ? "text-[10px]" : "text-xs"}`}>
        Customer Invitation
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`font-mono font-bold text-amber-300 ${compact ? "text-xs" : "text-sm"}`}>
          Customer Code: {code}
        </span>
      </div>
      <div className={`flex flex-wrap gap-2 ${compact ? "text-[10px]" : "text-xs"}`}>
        <button
          type="button"
          disabled={busy}
          onClick={() => copyText(code, "Customer code")}
          className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-xl font-bold"
        >
          <Copy className="h-3.5 w-3.5" /> Copy Code
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => copyText(invitation, "Portal invitation")}
          className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-xl font-bold"
        >
          <Link2 className="h-3.5 w-3.5" /> Copy Portal Invitation
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={openWhatsApp}
          className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-xl font-bold"
        >
          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp Invitation
        </button>
      </div>
      {!compact && (
        <p className="text-[10px] text-slate-500 font-mono truncate">Portal: {portalUrl}</p>
      )}
    </div>
  );
}
