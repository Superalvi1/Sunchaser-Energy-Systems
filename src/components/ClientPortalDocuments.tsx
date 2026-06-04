import React, { useEffect, useState } from "react";
import { Download, Eye, FileText, Loader2 } from "lucide-react";
import { User } from "../types";
import { fetchCustomerPortalDocuments } from "../services/api";
import { portal } from "../lib/clientPortalUi";

const VAULT_SLOTS: { type: string; label: string }[] = [
  { type: "quotation_pdf", label: "Quotation" },
  { type: "agreement", label: "Agreement" },
  { type: "invoice", label: "Invoice" },
  { type: "warranty_certificate", label: "Warranty" },
  { type: "net_metering_documents", label: "Net Metering" },
  { type: "completion_certificate", label: "Completion Report" },
];

interface ClientPortalDocumentsProps {
  user: User;
}

export default function ClientPortalDocuments({ user }: ClientPortalDocumentsProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [byType, setByType] = useState<Record<string, any>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCustomerPortalDocuments(user.id, user.username);
        const map: Record<string, any> = {};
        for (const slot of data.wallet || []) {
          if (slot.document) map[slot.type] = { ...slot, document: slot.document };
        }
        if (!cancelled) setByType(map);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Unable to load documents.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id, user.username]);

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="h-8 w-8 text-amber-400 animate-spin mx-auto" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-400 text-center">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <p className={portal.subtitle}>Secure vault for your project files</p>
      {VAULT_SLOTS.map((slot) => {
        const doc = byType[slot.type]?.document;
        const url = doc?.fileUrl;
        return (
          <div key={slot.type} className={`${portal.card} ${portal.cardPad}`}>
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10">
                <FileText className="h-5 w-5 text-amber-400" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white">{slot.label}</p>
                {doc ? (
                  <p className="text-sm text-slate-500 mt-1 truncate">{doc.title || doc.fileName}</p>
                ) : (
                  <p className="text-sm text-slate-600 mt-1">Not uploaded yet</p>
                )}
                {url && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className={portal.btnSecondary + " !py-2 !px-3 !text-xs"}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Preview
                    </a>
                    <a
                      href={url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className={portal.btnPrimary + " !py-2 !px-3 !text-xs"}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
