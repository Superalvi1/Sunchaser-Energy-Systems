import React from "react";
import { UserCircle } from "lucide-react";

/** Staff-facing note: live customer UI is only via Customer role login (portalclient). */
export default function ClientPortalStaffNotice() {
  return (
    <div className="max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center space-y-4">
      <UserCircle className="w-12 h-12 text-amber-500 mx-auto" />
      <h2 className="text-lg font-bold text-white">Client Portal (production)</h2>
      <p className="text-sm text-slate-400 leading-relaxed">
        Customers sign in with their portal account to access Home, Documents, Warranty, and Support.
        Demo shop data has been removed from the customer experience.
      </p>
      <p className="text-xs font-mono text-slate-500">
        Manage documents, warranties, and tickets under <strong className="text-amber-400">Support Desk</strong> and{" "}
        <strong className="text-amber-400">Client Portal Tools</strong> in Admin Dashboard.
      </p>
    </div>
  );
}
