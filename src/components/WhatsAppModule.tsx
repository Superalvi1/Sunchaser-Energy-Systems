import React, { useEffect, useState } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { User } from "../types";
import WhatsAppActionButton from "./WhatsAppActionButton";
import {
  type WhatsAppMessageType,
  type WhatsAppTemplateVars,
} from "../lib/whatsapp";

export type WhatsAppModulePreset =
  | "lead"
  | "customer"
  | "quotation"
  | "project"
  | "support_ticket";

const PRESET_ACTIONS: Record<WhatsAppModulePreset, WhatsAppMessageType[]> = {
  lead: ["open_chat", "quotation_sent", "advance_payment_reminder"],
  customer: ["open_chat", "quotation_sent", "payment_balance_reminder"],
  quotation: ["open_chat", "quotation_sent", "advance_payment_reminder"],
  project: [
    "open_chat",
    "installation_scheduled",
    "payment_balance_reminder",
    "technician_assigned",
  ],
  support_ticket: ["open_chat", "support_ticket_update", "service_ticket_received"],
};

export interface WhatsAppModuleProps {
  staffUser: User;
  preset: WhatsAppModulePreset;
  phone: string;
  onPhoneChange?: (phone: string) => void;
  onPhonePersist?: (phone: string) => void | Promise<void>;
  customerName?: string;
  customerId?: string;
  leadId?: string;
  projectDeliveryId?: string;
  templateVars?: WhatsAppTemplateVars;
  actions?: WhatsAppMessageType[];
  compact?: boolean;
  className?: string;
}

export default function WhatsAppModule({
  staffUser,
  preset,
  phone: phoneProp,
  onPhoneChange,
  onPhonePersist,
  customerName,
  customerId,
  leadId,
  projectDeliveryId,
  templateVars = {},
  actions,
  compact = false,
  className = "",
}: WhatsAppModuleProps) {
  const [phone, setPhone] = useState(phoneProp || "");

  useEffect(() => {
    setPhone(phoneProp || "");
  }, [phoneProp]);

  const vars: WhatsAppTemplateVars = {
    customerName: customerName || templateVars.customerName,
    companyName: templateVars.companyName,
    ...templateVars,
  };

  const actionList = actions || PRESET_ACTIONS[preset];

  const handlePhoneInput = (value: string) => {
    setPhone(value);
    onPhoneChange?.(value);
  };

  const persistPhone = () => {
    if (onPhonePersist) void onPhonePersist(phone);
  };

  if (compact) {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        <WhatsAppActionButton
          staffUser={staffUser}
          phone={phone}
          messageType="open_chat"
          vars={vars}
          label="WhatsApp"
          customerId={customerId}
          leadId={leadId}
          projectDeliveryId={projectDeliveryId}
          className="!px-2 !py-1"
        />
        {actionList
          .filter((t) => t !== "open_chat")
          .slice(0, 2)
          .map((messageType) => (
            <WhatsAppActionButton
              key={messageType}
              staffUser={staffUser}
              phone={phone}
              messageType={messageType}
              vars={vars}
              customerId={customerId}
              leadId={leadId}
              projectDeliveryId={projectDeliveryId}
              className="!px-2 !py-1 text-[10px]"
            />
          ))}
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-emerald-900/40 bg-emerald-950/15 p-3 space-y-2.5 ${className}`}
    >
      <div className="flex items-center gap-2 text-emerald-400">
        <MessageCircle className="w-4 h-4 shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wide">WhatsApp</span>
        <span className="text-[9px] text-slate-500 font-mono">Phase 1 · Click-to-Chat</span>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
          <Phone className="w-3 h-3" /> Customer phone
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => handlePhoneInput(e.target.value)}
          onBlur={persistPhone}
          placeholder="03xx-xxxxxxx or +92…"
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-100"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {actionList.map((messageType) => (
          <WhatsAppActionButton
            key={messageType}
            staffUser={staffUser}
            phone={phone}
            messageType={messageType}
            vars={vars}
            customerId={customerId}
            leadId={leadId}
            projectDeliveryId={projectDeliveryId}
          />
        ))}
      </div>
    </div>
  );
}
