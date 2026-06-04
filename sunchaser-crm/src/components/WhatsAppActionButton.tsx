import React, { useState } from "react";
import { MessageCircle } from "lucide-react";
import { User } from "../types";
import { logWhatsAppOpened } from "../services/api";
import {
  buildWhatsAppDeepLink,
  buildWhatsAppMessageBody,
  WHATSAPP_TEMPLATE_LABELS,
  type WhatsAppMessageType,
  type WhatsAppTemplateVars,
} from "../lib/whatsapp";

interface WhatsAppActionButtonProps {
  staffUser: User;
  phone: string;
  messageType: WhatsAppMessageType;
  vars?: WhatsAppTemplateVars;
  label?: string;
  customerId?: string;
  leadId?: string;
  projectDeliveryId?: string;
  className?: string;
}

export default function WhatsAppActionButton({
  staffUser,
  phone,
  messageType,
  vars = {},
  label,
  customerId,
  leadId,
  projectDeliveryId,
  className = "",
}: WhatsAppActionButtonProps) {
  const [busy, setBusy] = useState(false);
  const displayLabel = label || WHATSAPP_TEMPLATE_LABELS[messageType] || "WhatsApp";

  const handleClick = async () => {
    if (!phone?.trim()) {
      alert("No phone number on file.");
      return;
    }
    setBusy(true);
    const messageBody = buildWhatsAppMessageBody(messageType, vars);
    try {
      await logWhatsAppOpened(staffUser.id, staffUser.username, {
        phone,
        messageType,
        messageBody,
        vars,
        customerId,
        leadId,
        projectDeliveryId,
      });
    } catch {
      /* still open WhatsApp even if log fails */
    }
    const url = buildWhatsAppDeepLink(phone, messageBody);
    window.open(url, "_blank", "noopener,noreferrer");
    setBusy(false);
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600/20 text-emerald-400 border border-emerald-600/40 hover:bg-emerald-600/30 disabled:opacity-50 ${className}`}
    >
      <MessageCircle className="w-3.5 h-3.5" />
      {busy ? "Opening…" : displayLabel}
    </button>
  );
}
