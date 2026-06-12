import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, MapPin, Package, Phone, Search, Truck } from "lucide-react";
import { User } from "../types";
import { fetchDeliveryDashboardCustomers } from "../services/api";
import type { DeliveryDashboardCustomerRow } from "../lib/deliveryManagement";
import DeliveryChallanPanel from "./DeliveryChallanPanel";
import ProjectCompletionGapsStaff from "./ProjectCompletionGapsStaff";

interface ProjectDeliveryStaffProps {
  staffUser: User;
}

function customerLabel(row: DeliveryDashboardCustomerRow) {
  return `${row.customerName} · ${row.systemSize} · ${row.invoiceNumber}`;
}

export default function ProjectDeliveryStaff({ staffUser }: ProjectDeliveryStaffProps) {
  const [customers, setCustomers] = useState<DeliveryDashboardCustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<DeliveryDashboardCustomerRow | null>(null);

  const load = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const data = await fetchDeliveryDashboardCustomers(staffUser);
      const rows = data.customers || [];
      setCustomers(rows);
      setSelected((prev) => {
        if (!prev) return null;
        return rows.find((r) => r.invoiceId === prev.invoiceId) || null;
      });
    } catch (e: any) {
      setMsg(e.message || "Failed to load contracted customers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [staffUser.id, staffUser.username]);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const hay = [
        c.customerName,
        c.systemSize,
        c.invoiceNumber,
        c.phone,
        c.siteAddress,
        c.quotationId,
        c.projectId,
        c.customerId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [customers, searchQuery]);

  const selectCustomer = (row: DeliveryDashboardCustomerRow) => {
    setSelected(row);
    setSearchQuery("");
    setPickerOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Truck className="h-6 w-6 text-amber-500" />
          <div>
            <h2 className="text-xl font-extrabold">Delivery Dashboard</h2>
            <p className="text-xs text-slate-400">
              Contracted customers from the Contract-to-Invoice workflow — no manual project setup required.
            </p>
          </div>
        </div>
        {!loading && (
          <span className="text-xs font-mono text-slate-400 bg-slate-900 border border-slate-800 rounded-full px-3 py-1">
            {customers.length} ready for delivery
          </span>
        )}
      </div>

      <ProjectCompletionGapsStaff staffUser={staffUser} />

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <p className="text-xs text-slate-400 font-mono uppercase">Select contracted customer</p>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-10 py-2.5 text-sm"
            placeholder="Search by name, system size, invoice number, phone…"
            value={pickerOpen ? searchQuery : selected ? customerLabel(selected) : searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPickerOpen(true);
            }}
            onFocus={() => setPickerOpen(true)}
            aria-label="Search contracted customers"
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            onClick={() => setPickerOpen((o) => !o)}
            aria-label="Toggle customer list"
          >
            <ChevronDown className={`h-4 w-4 transition ${pickerOpen ? "rotate-180" : ""}`} />
          </button>
          {pickerOpen && (
            <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-slate-950 border border-slate-700 rounded-xl shadow-xl">
              {loading ? (
                <div className="flex items-center gap-2 text-slate-400 text-xs p-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : filteredCustomers.length === 0 ? (
                <p className="text-xs text-slate-500 p-4">
                  {customers.length === 0
                    ? "No contracted customers with invoices yet. Mark a lead Contracted to auto-provision customer, project, and invoice."
                    : "No matches for your search."}
                </p>
              ) : (
                filteredCustomers.map((row) => (
                  <button
                    key={row.invoiceId}
                    type="button"
                    onClick={() => selectCustomer(row)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-800 last:border-0 hover:bg-slate-900 transition ${
                      selected?.invoiceId === row.invoiceId ? "bg-amber-500/10" : ""
                    }`}
                  >
                    <div className="font-bold text-sm text-slate-100">{row.customerName}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {row.systemSize} · Invoice {row.invoiceNumber}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 flex flex-wrap gap-2">
                      <span>{row.deliveredPercent}% delivered</span>
                      <span>·</span>
                      <span>{row.challanCount} challan(s)</span>
                      {row.remainingQty > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-amber-400">{row.remainingQty} units remaining</span>
                        </>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {msg && <p className="text-xs text-red-400">{msg}</p>}
      </div>

      {loading && !selected ? (
        <Loader2 className="h-8 w-8 animate-spin text-amber-500 mx-auto" />
      ) : !selected ? (
        <div className="bg-slate-950 border border-dashed border-slate-800 rounded-2xl p-8 text-center space-y-2">
          <Package className="h-10 w-10 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-400">
            Select a contracted customer above to view project details, delivery history, remaining items, and create
            partial delivery challans.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
              <p className="text-[10px] font-mono uppercase text-slate-500">Customer</p>
              <p className="font-bold text-lg">{selected.customerName}</p>
              {selected.phone && (
                <p className="text-slate-400 flex items-center gap-1.5 text-xs">
                  <Phone className="h-3.5 w-3.5" /> {selected.phone}
                </p>
              )}
              {selected.siteAddress && (
                <p className="text-slate-400 flex items-start gap-1.5 text-xs">
                  <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {selected.siteAddress}
                </p>
              )}
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-1.5 text-xs">
              <p className="text-[10px] font-mono uppercase text-slate-500 mb-2">Linked records</p>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Invoice</span>
                <span className="font-mono text-amber-400">{selected.invoiceNumber}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Project</span>
                <span className="font-mono text-slate-300">{selected.projectId || "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Quotation</span>
                <span className="font-mono text-slate-300 truncate max-w-[60%]">{selected.quotationId}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Customer ID</span>
                <span className="font-mono text-slate-300">{selected.customerId}</span>
              </div>
              <div className="flex justify-between gap-2 pt-1 border-t border-slate-800">
                <span className="text-slate-500">Delivery progress</span>
                <span className="font-bold text-emerald-400">{selected.deliveredPercent}%</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
            <DeliveryChallanPanel
              key={selected.invoiceId}
              staffUser={staffUser}
              invoiceId={selected.invoiceId}
              invoiceNumber={selected.invoiceNumber}
              customerName={selected.customerName}
            />
          </div>
        </div>
      )}
    </div>
  );
}
