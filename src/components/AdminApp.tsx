import React, { useState } from "react";
import { 
  TrendingUp, BarChart4, ClipboardList, ShieldAlert, Package, 
  RefreshCcw, DollarSign, Award, Users, Settings2, Trash2 
} from "lucide-react";
import { Lead, Ticket, InventoryItem, DashboardStats, Product } from "../types";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, PieChart, Pie, Cell 
} from "recharts";
import ManualAdminControl from "./ManualAdminControl";
import { currencySymbol } from "../services/api";

interface AdminAppProps {
  leads: Lead[];
  tickets: Ticket[];
  inventory: InventoryItem[];
  stats: DashboardStats;
  purchaseOrders: any[];
  categories: any[];
  products: Product[];
  orders: any[];
  warranties: any[];
  solarPackages?: any[];
  settings?: any;
  websiteContent?: any;
  quotations?: any[];
  onResolveTicket: (id: string) => void;
  onProcureInventory: (vendor: string, itemId: string, quantity: number) => Promise<void>;
  onRefreshState: () => void;
}

export default function AdminApp({
  leads,
  tickets,
  inventory,
  stats,
  purchaseOrders,
  categories,
  products,
  orders,
  warranties,
  solarPackages = [],
  settings = {},
  websiteContent = {},
  quotations = [],
  onResolveTicket,
  onProcureInventory,
  onRefreshState
}: AdminAppProps) {
  const [activeSegment, setActiveSegment] = useState<'overview' | 'sales' | 'inventory' | 'tickets' | 'control-panel'>('overview');

  // Procurement local form states
  const [vendor, setVendor] = useState("Canadian Solar Ltd");
  const [itemId, setItemId] = useState(inventory.length > 0 ? inventory[0].id : "p-400");
  const [quantity, setQuantity] = useState<number>(100);
  const [procurementLoading, setProcurementLoading] = useState(false);
  const [procurementNotice, setProcurementNotice] = useState<string | null>(null);

  // Format monetary sums
  const formattedRevenue = stats.totalRevenue.toLocaleString();
  const formattedPending = stats.pendingRevenue.toLocaleString();

  // Data mapping for charts
  const statusChartData = Object.entries(stats.leadsByStatus).map(([name, value]) => ({
    name,
    Leads: value
  }));

  // Map revenue by sales representative
  const salesPerformanceData = [
    { name: "Sarah Connor", Revenue: leads.filter(l => l.assignedSalesperson === "Sarah Connor" && (l.status === 'Contracted' || l.status === 'Installed')).reduce((sum, l) => sum + (l.quotes?.[0]?.totalCost || 0), 0) },
    { name: "Michael Scott", Revenue: leads.filter(l => l.assignedSalesperson === "Michael Scott" && (l.status === 'Contracted' || l.status === 'Installed')).reduce((sum, l) => sum + (l.quotes?.[0]?.totalCost || 0), 0) }
  ];

  const COLORS = ["#F59E0B", "#10B981", "#3B82F6", "#6366F1", "#EC4899", "#EF4444"];

  return (
    <div id="admin-view" className="space-y-8 animate-fade-in">
      {/* Upper overview stat cards grids */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 font-mono">
        {/* Card 1 */}
        <div className="bg-neutral-900 rounded-3xl border border-neutral-808 p-5 shadow-sm flex items-center gap-4">
          <div className="bg-emerald-500/10 p-3 rounded-2xl text-emerald-400">
            <DollarSign className="h-6 w-6" />
          </div>
          <div>
            <span className="text-neutral-400 text-[10px] block uppercase tracking-wider font-sans font-semibold">Total Revenue Secured</span>
            <span className="text-xl font-bold font-mono text-neutral-100">{currencySymbol}{formattedRevenue}</span>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-neutral-900 rounded-3xl border border-neutral-808 p-5 shadow-sm flex items-center gap-4">
          <div className="bg-amber-500/10 p-3 rounded-2xl text-amber-500">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <span className="text-neutral-400 text-[10px] block uppercase tracking-wider font-sans font-semibold">Pipeline value</span>
            <span className="text-xl font-bold font-mono text-neutral-100">{currencySymbol}{formattedPending}</span>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-neutral-900 rounded-3xl border border-neutral-808 p-5 shadow-sm flex items-center gap-4">
          <div className="bg-indigo-500/10 p-3 rounded-2xl text-indigo-400">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <span className="text-neutral-400 text-[10px] block uppercase tracking-wider font-sans font-semibold">Deployments Active</span>
            <span className="text-xl font-bold font-mono text-neutral-100">{stats.contractedCount + stats.installedCount}</span>
          </div>
        </div>

        {/* Card 4 */}
        <div className="bg-neutral-900 rounded-3xl border border-neutral-808 p-5 shadow-sm flex items-center gap-4">
          <div className="bg-rose-500/10 p-3 rounded-2xl text-rose-400 animate-pulse">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <span className="text-neutral-400 text-[10px] block uppercase tracking-wider font-sans font-semibold">Inquiries Open</span>
            <span className="text-xl font-bold font-mono text-neutral-100">{tickets.filter(t => t.status !== 'Resolved').length}</span>
          </div>
        </div>
      </div>

      {/* Internal segment selector */}
      <div className="flex gap-2 border-b border-neutral-800 pb-3 flex-wrap">
        <button
          onClick={() => setActiveSegment('overview')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'overview'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <BarChart4 className="w-4 h-4 inline mr-1" /> Business Analytics
        </button>
        <button
          onClick={() => setActiveSegment('sales')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'sales'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <Award className="w-4 h-4 inline mr-1" /> Sales Performance
        </button>
        <button
          onClick={() => setActiveSegment('inventory')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'inventory'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <Package className="w-4 h-4 inline mr-1" /> Hardware Inventory
        </button>
        <button
          onClick={() => setActiveSegment('tickets')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'tickets'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <ShieldAlert className="w-4 h-4 inline mr-1" /> Support Tickets
        </button>
        <button
          onClick={() => setActiveSegment('control-panel')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'control-panel'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <Settings2 className="w-4 h-4 inline mr-1" /> Manual Control Panel
        </button>
      </div>

      {/* Segment Workspace rendering */}
      <div className="grid grid-cols-1 gap-8">
        {activeSegment === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Leads status tracker Recharts */}
            <div className="lg:col-span-8 bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-sm space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono mb-2">Lead Progression Analytics</h3>
              <div className="h-80 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#262626" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} />
                    <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '12px', border: '1px solid #262626', backgroundColor: '#0a0a0a', color: '#f5f5f5' }} />
                    <Bar dataKey="Leads" fill="#f59e0b" radius={[6, 6, 0, 0]} barSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Static distribution stats */}
            <div className="lg:col-span-4 bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-sm flex flex-col justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono mb-4 font-sans">Pipeline Status Details</h3>
              
              <div className="space-y-3 font-mono text-xs">
                {Object.entries(stats.leadsByStatus).map(([status, count], i) => (
                  <div key={status} className="flex justify-between items-center py-2 border-b border-neutral-800">
                    <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }}></span> {status}</span>
                    <strong className="text-neutral-100">{count} Lead{count !== 1 ? 's' : ''}</strong>
                  </div>
                ))}
              </div>

              <div className="pt-4 mt-4 border-t border-neutral-800 bg-neutral-950 rounded-2xl p-4 text-[11px] leading-relaxed text-neutral-400 font-sans text-left">
                Progress rates are optimized for **91% SLA** site surveys to quotations conversion. Total lead intake has increased by **14.2%** over prior week metrics.
              </div>
            </div>
          </div>
        )}

        {activeSegment === 'sales' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Sales performance list bar charts */}
            <div className="lg:col-span-7 bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-sm space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono mb-2">Committed Volume by Representative ({currencySymbol.trim()})</h3>
              <div className="h-64 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesPerformanceData} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#262626" />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} />
                    <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '12px', border: '1px solid #262626', backgroundColor: '#0a0a0a', color: '#f5f5f5' }} />
                    <Bar dataKey="Revenue" fill="#10b981" radius={[0, 6, 6, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Commissions overview */}
            <div className="lg:col-span-5 bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-sm space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono mb-4 font-sans">Commission Logs & Performance</h3>
              <div className="space-y-3 font-mono text-xs">
                {salesPerformanceData.map((agent) => (
                  <div key={agent.name} className="p-3 bg-neutral-950 border border-neutral-800 rounded-2xl space-y-2">
                    <div className="flex justify-between items-center font-sans font-bold">
                      <span className="text-neutral-105 text-sm">{agent.name}</span>
                      <span className="bg-emerald-500/20 text-emerald-305 text-[10px] px-2 py-0.5 rounded">Active</span>
                    </div>
                    <div className="flex justify-between text-neutral-400">
                      <span>Total Sales Volume:</span>
                      <strong className="text-neutral-100">{currencySymbol}{agent.Revenue.toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between text-indigo-400">
                      <span>Accrued 3% Commission:</span>
                      <strong>{currencySymbol}{(agent.Revenue * 0.03).toLocaleString()}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeSegment === 'inventory' && (
          <div className="space-y-8 fade-in-entry text-left">
            
            {/* 1. LOW STOCK ALERTS PANEL */}
            {(() => {
              const lowStockItems = inventory.filter(item => {
                if (item.category === 'Panels') return item.stock < 300;
                if (item.category === 'Inverters') return item.stock < 600;
                if (item.category === 'Storage') return item.stock < 90;
                return item.stock < 100;
              });

              if (lowStockItems.length === 0) return null;

              return (
                <div className="bg-rose-950/20 border border-rose-900/60 p-5 rounded-3xl text-rose-300 font-sans space-y-3 shadow-md">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-rose-450 text-rose-400 flex items-center gap-2">
                    <ShieldAlert className="h-4.5 w-4.5 text-rose-500 animate-bounce" /> Sunchaser Procurement Warning: Low Hardware Stock
                  </h4>
                  <p className="text-xs text-slate-400">
                    The following hardware SKUs are below critical staging requirements. Action is required to prevent project site deployment blocks:
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1 text-[11px] font-mono">
                    {lowStockItems.map(item => (
                      <span key={item.id} className="bg-rose-950 border border-rose-900 px-3 py-1.5 rounded-xl text-rose-300 font-semibold flex items-center gap-1.5">
                        {item.name} ({item.stock} left) • Threshold: {item.category === 'Panels' ? '300' : item.category === 'Inverters' ? '600' : '90'}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* 2. MAIN HARDWARE INVENTORY STATUS TABLE */}
            <div className="bg-neutral-900 border border-neutral-808 rounded-3xl p-6 shadow-sm space-y-4 font-sans">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-neutral-100">Warehouse Components Stock Log</h3>
                  <p className="text-[11px] text-neutral-450 text-neutral-400 mt-0.5">Physical equipment accounts synced with current customer proposals.</p>
                </div>
                <div className="bg-neutral-950 px-3 py-1 rounded-xl text-[10px] font-mono border border-neutral-850 text-neutral-400">
                  Total SKUs Tracked: {inventory.length}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-neutral-800 text-neutral-400 text-[10px] uppercase font-mono tracking-wider">
                      <th className="py-3 px-4 font-semibold">SKU ID</th>
                      <th className="py-3 px-4 font-semibold">Component Name</th>
                      <th className="py-3 px-4 font-semibold">Category</th>
                      <th className="py-3 px-4 font-semibold text-right">In-Stock Count</th>
                      <th className="py-3 px-4 font-semibold text-right">Wholesale Cost</th>
                      <th className="py-3 px-4 font-semibold">Warehouse Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-850 text-neutral-300">
                    {inventory.map((item) => {
                      const isLow = (item.category === 'Panels' && item.stock < 300) ||
                                    (item.category === 'Inverters' && item.stock < 600) ||
                                    (item.category === 'Storage' && item.stock < 90);
                      return (
                        <tr key={item.id} className="hover:bg-neutral-950 transition">
                          <td className="py-2.5 px-4 font-mono font-bold text-neutral-400">{item.id}</td>
                          <td className="py-2.5 px-4 font-semibold text-neutral-100">{item.name}</td>
                          <td className="py-2.5 px-4 text-neutral-450 text-neutral-450">{item.category}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-neutral-100">{item.stock} units</td>
                          <td className="py-2.5 px-4 text-right font-mono text-neutral-100">{currencySymbol}{item.cost.toLocaleString()}</td>
                          <td className="py-2.5 px-4">
                            <span className={`inline-block w-2.5 h-2.5 rounded-full mr-2 ${isLow ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
                            <span className="font-mono text-[10px]">{isLow ? "Restock Critical" : "Stock Stable"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 3. PROCUREMENT DESK & PURCHASE ORDERS */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Draft PO Form */}
              <div className="lg:col-span-5 bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-sm space-y-4 font-sans">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono">Procurement Desk</h3>
                  <p className="text-[11px] text-neutral-400 mt-1">Issue automated, instant restock Purchase Orders to component partners.</p>
                </div>

                {procurementNotice && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl text-[10px] font-mono leading-relaxed">
                    ✓ {procurementNotice}
                  </div>
                )}

                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setProcurementLoading(true);
                    setProcurementNotice(null);
                    try {
                      await onProcureInventory(vendor, itemId, quantity);
                      setProcurementNotice("Purchase Order finalized and warehouse stock incremented!");
                      setQuantity(100);
                      setTimeout(() => setProcurementNotice(null), 5000);
                    } catch (err: any) {
                      setProcurementNotice(`Error: ${err.message}`);
                    } finally {
                      setProcurementLoading(false);
                    }
                  }}
                  className="space-y-4 text-xs"
                >
                  <div className="space-y-1">
                    <label className="text-neutral-300 block font-semibold">Vendor Partner</label>
                    <select
                      value={vendor}
                      onChange={(e) => setVendor(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans cursor-pointer"
                    >
                      <option value="Canadian Solar Ltd">Canadian Solar Ltd (Panels)</option>
                      <option value="Enphase Energy">Enphase Energy (Microinverters)</option>
                      <option value="Tesla Energy Services">Tesla Energy Services (Storage)</option>
                      <option value="Sunchaser Staging Co">Sunchaser Staging Co (OEM)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-neutral-300 block font-semibold">Target Hardware Component SKU</label>
                    <select
                      value={itemId}
                      onChange={(e) => setItemId(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans cursor-pointer"
                    >
                      {inventory.map(item => (
                        <option key={item.id} value={item.id}>
                          [{item.id}] {item.name} ({currencySymbol}{item.cost}/unit)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-neutral-300 block font-semibold">Procurement Quantity</label>
                      <input
                        type="number"
                        min="10"
                        max="2000"
                        required
                        value={quantity}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <span className="text-neutral-300 block font-semibold">Wholesale Cost Est</span>
                      <div className="bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-100 font-mono font-bold">
                        {currencySymbol}{((inventory.find(i => i.id === itemId)?.cost || 0) * quantity).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={procurementLoading || quantity < 1}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {procurementLoading ? "Transmitting..." : "Authorize Bulk PO & Restock"}
                  </button>
                </form>
              </div>

              {/* Purchase Orders Log List */}
              <div className="lg:col-span-7 bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-sm space-y-4 font-sans">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono">Purchase Orders History Pipeline</h3>
                
                <div className="space-y-3 font-mono text-[11px] max-h-[340px] overflow-y-auto pr-1">
                  {purchaseOrders && purchaseOrders.length > 0 ? (
                    purchaseOrders.map((po) => (
                      <div key={po.id} className="bg-neutral-950 border border-neutral-850 p-4 rounded-2xl flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="bg-neutral-800 text-neutral-300 px-2 py-0.5 rounded text-[9px] font-bold">{po.id}</span>
                            <span className="text-slate-400 font-bold">{po.vendor}</span>
                          </div>
                          <p className="text-slate-400 font-sans text-xs pt-1">
                            SKU: <strong className="text-indigo-400">{po.itemName || po.itemId}</strong> • Qty: <strong className="text-neutral-200">{po.quantity}</strong>
                          </p>
                          <span className="text-[10px] text-slate-500">Date: {po.date}</span>
                        </div>
                        <div className="flex flex-col items-start sm:items-end gap-1.5 shrink-0">
                          <span className="text-neutral-100 font-bold">{currencySymbol}{po.cost.toLocaleString()}</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                            po.status === 'Delivered' ? 'bg-emerald-500/20 text-emerald-305 text-emerald-300 font-semibold' : 'bg-neutral-800 text-neutral-400'
                          }`}>
                            {po.status}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-10 text-neutral-500">
                      No purchase orders recorded. Use the form to authorize procurement.
                    </div>
                  )}
                </div>
              </div>

            </div>

          </div>
        )}

        {activeSegment === 'tickets' && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono mb-2">Diagnostic Support Cases Coordinator</h3>
            <div className="space-y-4">
              {tickets.filter(t => t.status !== 'Resolved').length > 0 ? (
                tickets.filter(t => t.status !== 'Resolved').map((t) => (
                  <div key={t.id} className="border border-neutral-800 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:shadow-sm transition bg-neutral-950">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-neutral-100 font-sans">{t.subject}</h4>
                        <span className="text-[10px] bg-rose-500/20 text-rose-300 font-mono px-2 py-0.5 rounded font-bold">{t.priority}</span>
                      </div>
                      <p className="text-neutral-400 text-xs">{t.customerName} ({t.email})</p>
                      <p className="text-neutral-500 text-xs italic">Description: "{t.description}"</p>
                    </div>
                    <button
                      onClick={() => onResolveTicket(t.id)}
                      className="bg-emerald-600 hover:bg-emerald-505 text-neutral-952 px-4 py-1.5 rounded-xl font-bold font-sans text-xs transition cursor-pointer text-white"
                    >
                      Resolve Diagnostic Ticket
                    </button>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-neutral-500 text-xs">
                  <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-50 text-amber-500 animate-bounce" />
                  <span>No open maintenance tickets. Workflows are fully clear!</span>
                </div>
              )}
            </div>
          </div>
        )}

        {activeSegment === 'control-panel' && (
          <ManualAdminControl
            leads={leads}
            tickets={tickets}
            inventory={inventory}
            categories={categories}
            products={products}
            orders={orders}
            warranties={warranties}
            solarPackages={solarPackages}
            settings={settings}
            websiteContent={websiteContent}
            quotations={quotations}
            onRefreshState={onRefreshState}
          />
        )}
      </div>
    </div>
  );
}
