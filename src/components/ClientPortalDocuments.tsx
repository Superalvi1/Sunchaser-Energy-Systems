import React, { useEffect, useState } from "react";
import { Download, Eye, FileText, Loader2 } from "lucide-react";
import { User } from "../types";
import { fetchCustomerPortalDocuments, customerInvoicePdfUrl, customerWarrantyCertificateUrl } from "../services/api";
import { portal } from "../lib/clientPortalUi";
import { DOCUMENT_WALLET_TYPES } from "../lib/clientPortalPhase2";

const VAULT_SLOTS: { type: string; label: string }[] = [
  { type: "quotation_pdf", label: "Quotation" },
  { type: "agreement", label: "Agreement" },
  { type: "invoice", label: "Invoice" },
  { type: "warranty_certificate", label: "Warranty Certificate" },
  { type: "net_metering_documents", label: "Net Metering" },
  { type: "completion_certificate", label: "Completion Report" },
];

const TYPE_LABELS = Object.fromEntries(DOCUMENT_WALLET_TYPES.map((d) => [d.type, d.label]));

interface ClientPortalDocumentsProps {
  user: User;
}

function resolveVaultDocumentUrl(url: string | undefined, user: User): string | undefined {
  if (!url) return url;
  const invoiceMatch = url.match(/\/api\/export\/pdf\/invoice\/([^/?]+)/);
  if (invoiceMatch) {
    return customerInvoicePdfUrl(decodeURIComponent(invoiceMatch[1]), user.id, user.username);
  }
  if (
    url.includes("/api/customer-portal/warranty-certificate/me") ||
    url.match(/\/api\/admin\/customers\/[^/]+\/warranty-certificate/)
  ) {
    return customerWarrantyCertificateUrl(user.id, user.username);
  }
  return url;
}

export default function ClientPortalDocuments({ user }: ClientPortalDocumentsProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [byType, setByType] = useState<Record<string, any>>({});
  const [documents, setDocuments] = useState<any[]>([]);

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
        if (!cancelled) {
          setByType(map);
          setDocuments(data.documents || []);
        }
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
    <div className="space-y-6">
      <p className={portal.subtitle}>Secure vault for your project files</p>

      <div className="space-y-4">
        {VAULT_SLOTS.map((slot) => {
          const doc = byType[slot.type]?.document;
          const url = resolveVaultDocumentUrl(doc?.fileUrl, user);
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

      {documents.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wide">All uploaded documents</h3>
          <ul className="space-y-2">
            {documents.map((doc) => (
              <li key={doc.id} className={`${portal.card} ${portal.cardPad} flex items-center gap-3`}>
                <FileText className="h-5 w-5 text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{doc.title || doc.fileName}</p>
                  <p className="text-xs text-slate-500">
                    {TYPE_LABELS[doc.documentType] || doc.documentType}
                    {doc.uploadedAt ? ` · ${new Date(doc.uploadedAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                {doc.fileUrl && (
                  <a
                    href={resolveVaultDocumentUrl(doc.fileUrl, user)}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className={portal.btnPrimary + " !py-2 !px-3 !text-xs shrink-0"}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
