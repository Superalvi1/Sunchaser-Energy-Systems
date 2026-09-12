import React, { useRef, useState } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import type { User } from "../types";
import {
  createAdminInvoice,
  fetchAdminInvoices,
  recordAdminInvoicePayment,
} from "../services/api";
import {
  findMissingPayments,
  parseVyaparImportPayload,
  type VyaparImportPayload,
  type VyaparImportSummary,
} from "../lib/vyaparMatchedImport";

type ImportResult = {
  invoicesCreated: number;
  invoicesSkipped: number;
  paymentsCreated: number;
  paymentsSkipped: number;
  failures: Array<{ invoiceNumber: string; error: string }>;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(value);

export default function VyaparMatchedImporter({
  staffUser,
  onImported,
}: {
  staffUser: User;
  onImported: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<VyaparImportPayload | null>(null);
  const [summary, setSummary] = useState<VyaparImportSummary | null>(null);
  const [fileName, setFileName] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setPayload(null);
    setSummary(null);
    setFileName("");
    setConfirmation("");
    setProgress("");
    setError("");
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const readFile = async (file?: File) => {
    reset();
    if (!file) return;
    try {
      const parsed = parseVyaparImportPayload(await file.text());
      setPayload(parsed.payload);
      setSummary(parsed.summary);
      setFileName(file.name);
    } catch (cause: any) {
      setError(cause?.message || "Unable to read the import file.");
    }
  };

  const runImport = async () => {
    if (!payload || !summary || confirmation.trim() !== `IMPORT ${summary.invoiceCount}`) return;
    setRunning(true);
    setError("");
    setResult(null);
    const next: ImportResult = {
      invoicesCreated: 0,
      invoicesSkipped: 0,
      paymentsCreated: 0,
      paymentsSkipped: 0,
      failures: [],
    };

    try {
      const response = await fetchAdminInvoices(staffUser, { includeArchived: true });
      const byNumber = new Map(
        (response.invoices || []).map((invoice: any) => [String(invoice.invoiceNumber), invoice])
      );

      for (let index = 0; index < payload.invoices.length; index += 1) {
        const source = payload.invoices[index];
        setProgress(`Processing invoice ${index + 1} of ${payload.invoices.length}: ${source.invoiceNumber}`);
        try {
          let target: any = byNumber.get(source.invoiceNumber);
          if (!target) {
            const { payments: _payments, ...invoiceBody } = source;
            const created: any = await createAdminInvoice(staffUser, {
              ...invoiceBody,
              paidAmount: 0,
            });
            target = created.invoice;
            if (!target?.id) throw new Error("CRM did not return the new invoice ID.");
            byNumber.set(source.invoiceNumber, target);
            next.invoicesCreated += 1;
          } else {
            next.invoicesSkipped += 1;
          }

          const missing = findMissingPayments(source.payments, target.payments || []);
          next.paymentsSkipped += source.payments.length - missing.length;
          for (const payment of missing) {
            await recordAdminInvoicePayment(staffUser, target.id, payment);
            next.paymentsCreated += 1;
          }
        } catch (cause: any) {
          next.failures.push({
            invoiceNumber: source.invoiceNumber,
            error: String(cause?.message || "Import failed").slice(0, 180),
          });
        }
      }

      setResult(next);
      setProgress("");
      await onImported();
    } catch (cause: any) {
      setError(cause?.message || "The import could not start.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-bold px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 flex items-center gap-1.5"
      >
        <FileUp className="h-3.5 w-3.5" /> Vyapar matched import
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] bg-slate-950/60 p-4 flex items-center justify-center">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200">
            <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Vyapar matched migration</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Super Admin only. Existing invoice numbers and matching receipts are skipped safely.
                </p>
              </div>
              <button
                type="button"
                disabled={running}
                onClick={() => { setOpen(false); reset(); }}
                className="p-1 rounded hover:bg-slate-100 text-slate-500"
                aria-label="Close importer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <label className="block border-2 border-dashed border-slate-300 rounded-xl p-5 text-center cursor-pointer hover:border-violet-400">
                <FileUp className="h-7 w-7 mx-auto text-violet-600 mb-2" />
                <span className="text-sm font-semibold text-slate-800">
                  {fileName || "Select the prepared Vyapar migration JSON"}
                </span>
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/json,.json"
                  disabled={running}
                  onChange={(event) => readFile(event.target.files?.[0])}
                  className="sr-only"
                />
              </label>

              {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

              {summary && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      ["Parties", summary.partyCount],
                      ["Invoices", summary.invoiceCount],
                      ["Items", summary.itemCount],
                      ["Payments", summary.paymentCount],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <p className="text-[10px] uppercase font-semibold text-slate-500">{label}</p>
                        <p className="text-lg font-bold text-slate-900">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-xs space-y-1 text-slate-700">
                    <p><strong>Sales:</strong> PKR {money(summary.salesTotal)}</p>
                    <p><strong>Matched receipts:</strong> PKR {money(summary.paymentTotal)}</p>
                    <p><strong>Resulting balance:</strong> PKR {money(summary.balanceTotal)}</p>
                    <p className="text-amber-800"><strong>Held for review:</strong> {summary.unresolvedReceiptCount} unmatched receipt entries are not imported.</p>
                  </div>

                  <label className="block text-xs text-slate-600">
                    Type <strong>IMPORT {summary.invoiceCount}</strong> to enable the production import.
                    <input
                      type="text"
                      value={confirmation}
                      disabled={running}
                      onChange={(event) => setConfirmation(event.target.value)}
                      className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      placeholder={`IMPORT ${summary.invoiceCount}`}
                    />
                  </label>

                  <button
                    type="button"
                    disabled={running || confirmation.trim() !== `IMPORT ${summary.invoiceCount}`}
                    onClick={runImport}
                    className="w-full bg-violet-600 disabled:bg-slate-300 text-white font-bold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2"
                  >
                    {running && <Loader2 className="h-4 w-4 animate-spin" />}
                    {running ? "Importing…" : "Import matched invoices and payments"}
                  </button>
                </div>
              )}

              {progress && <p className="text-xs font-mono text-violet-700">{progress}</p>}

              {result && (
                <div className={`rounded-xl border p-4 text-xs ${result.failures.length ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
                  <p className="font-bold text-sm mb-2">Import finished</p>
                  <p>{result.invoicesCreated} invoices created · {result.invoicesSkipped} invoices already existed</p>
                  <p>{result.paymentsCreated} payments created · {result.paymentsSkipped} payments already existed</p>
                  {result.failures.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-y-auto">
                      <p className="font-semibold">{result.failures.length} invoice(s) need retry:</p>
                      {result.failures.map((failure) => (
                        <p key={failure.invoiceNumber} className="font-mono mt-1">
                          {failure.invoiceNumber}: {failure.error}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
