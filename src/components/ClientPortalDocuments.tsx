import React, { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { User } from "../types";
import { fetchCustomerPortalDocuments } from "../services/api";

interface ClientPortalDocumentsProps {
  user: User;
}

export default function ClientPortalDocuments({ user }: ClientPortalDocumentsProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCustomerPortalDocuments(user.id, user.username);
      setWallet(data.wallet || []);
    } catch (err: any) {
      setError(err.message || "Unable to load documents.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user.id, user.username]);

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="h-8 w-8 text-amber-500 animate-spin mx-auto" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-rose-400 text-center">{error}</p>;
  }

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 px-1">
        Document Wallet
      </h3>
      {wallet.map((slot) => (
        <div
          key={slot.type}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-start gap-3"
        >
          <FileText className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-100">{slot.label}</p>
            {slot.document ? (
              <>
                <p className="text-xs text-slate-400 mt-1 truncate">{slot.document.title}</p>
                <a
                  href={slot.document.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2 text-xs font-bold text-amber-400 hover:text-amber-300"
                >
                  <Download className="w-3.5 h-3.5" />
                  View / Download
                </a>
              </>
            ) : (
              <p className="text-xs text-slate-500 mt-1 font-mono">No document uploaded yet.</p>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
