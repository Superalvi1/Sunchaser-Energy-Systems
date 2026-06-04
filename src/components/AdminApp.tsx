import React, { useState } from "react";
import { 
  TrendingUp, BarChart4, ClipboardList, ShieldAlert, Package, 
  RefreshCcw, DollarSign, Award, Users, Settings2, Trash2, FolderOpen, Headphones, Wrench, Zap, Heart, History, Activity, Truck
} from "lucide-react";
import { Lead, Ticket, InventoryItem, DashboardStats, Product, User } from "../types";
import ClientPortalStaffTools from "./ClientPortalStaffTools";
import SupportDeskStaff from "./SupportDeskStaff";
import ServiceDeskStaff from "./ServiceDeskStaff";
import CustomerSavingsStaff from "./CustomerSavingsStaff";
import SubscriptionDeskStaff from "./SubscriptionDeskStaff";
import AfterSalesStaffTools from "./AfterSalesStaffTools";
import AssetMaintenanceLogStaff from "./AssetMaintenanceLogStaff";
import EnergyMonitoringStaff from "./EnergyMonitoringStaff";
import ProjectDeliveryStaff from "./ProjectDeliveryStaff";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, PieChart, Pie, Cell 
} from "recharts";
import ManualAdminControl from "./ManualAdminControl";
import { currencySymbol, API_BASE_URL } from "../services/api";

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
  quoteTemplates?: any[];
  quoteTemplatePages?: any[];
  bankAccounts?: any[];
  companyTerms?: any[];
  ceoMessages?: any[];
  socialLinks?: any[];
  structureDescriptions?: any[];
  quotePdfSettings?: any[];
  onResolveTicket: (id: string) => void;
  onProcureInventory: (vendor: string, itemId: string, quantity: number) => Promise<void>;
  onRefreshState: () => void;
  staffUser: User;
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
  quoteTemplates = [],
  quoteTemplatePages = [],
  bankAccounts = [],
  companyTerms = [],
  ceoMessages = [],
  socialLinks = [],
  structureDescriptions = [],
  quotePdfSettings = [],
  onResolveTicket,
  onProcureInventory,
  onRefreshState,
  staffUser
}: AdminAppProps) {
  const [activeSegment, setActiveSegment] = useState<
    'overview' | 'sales' | 'inventory' | 'tickets' | 'control-panel' | 'pdf-templates' | 'client-portal' | 'support-desk' | 'service-desk' | 'savings-desk' | 'subscription-desk' | 'asset-maintenance' | 'energy-monitoring' | 'project-delivery'
  >('overview');

  // Procurement local form states
  const [vendor, setVendor] = useState("Canadian Solar Ltd");
  const [itemId, setItemId] = useState(inventory.length > 0 ? inventory[0].id : "p-400");
  const [quantity, setQuantity] = useState<number>(100);
  const [procurementLoading, setProcurementLoading] = useState(false);
  const [procurementNotice, setProcurementNotice] = useState<string | null>(null);

  // Template Manager Tab states
  const [selectedSubTab, setSelectedSubTab] = useState<'pages' | 'banks' | 'terms' | 'ceo' | 'structures' | 'settings'>('pages');
  
  // Database CRUD status states
  const [syncing, setSyncing] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Edit draft tracking states
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pageDraft, setPageDraft] = useState<any>(null);

  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [bankDraft, setBankDraft] = useState<any>(null);
  const [newBank, setNewBank] = useState({
    bankName: "",
    accountTitle: "",
    accountNumber: "",
    iban: "",
    branchCode: "",
    isActive: true,
    sortOrder: 0
  });

  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [termDraft, setTermDraft] = useState<any>(null);
  const [newTerm, setNewTerm] = useState({
    termText: "",
    sortOrder: 0
  });

  const [editingCeoId, setEditingCeoId] = useState<string | null>(null);
  const [ceoDraft, setCeoDraft] = useState<any>(null);

  const [editingStructId, setEditingStructId] = useState<string | null>(null);
  const [structDraft, setStructDraft] = useState<any>(null);

  const [editingPdfSettingsId, setEditingPdfSettingsId] = useState<string | null>(null);
  const [pdfSettingsDraft, setPdfSettingsDraft] = useState<any>(null);

  const saveDbChange = async (action: "add" | "edit" | "delete", table: string, data: any, id?: string) => {
    setSyncing(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/db/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, table, data, id })
      });
      if (!res.ok) throw new Error("Could not execute manual update on server memory.");
      const result = await res.json();
      if (result.success) {
        setSuccessMsg(`Action [${action.toUpperCase()}] for '${table}' successfully stored and persisted.`);
        setTimeout(() => setSuccessMsg(null), 4000);
        onRefreshState();
      } else {
        throw new Error("Server rejected state modifier request.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Network state syncing faulted.");
      setTimeout(() => setErrorMsg(null), 4000);
    } finally {
      setSyncing(false);
    }
  };

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
          onClick={() => setActiveSegment('pdf-templates')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'pdf-templates'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <ClipboardList className="w-4 h-4 inline mr-1" /> Quotation Templates
        </button>
        <button
          onClick={() => setActiveSegment('support-desk')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'support-desk'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <Headphones className="w-4 h-4 inline mr-1" /> Support Desk
        </button>
        <button
          onClick={() => setActiveSegment('service-desk')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'service-desk'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <Wrench className="w-4 h-4 inline mr-1" /> Service Desk
        </button>
        <button
          onClick={() => setActiveSegment('savings-desk')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'savings-desk'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <Zap className="w-4 h-4 inline mr-1" /> Savings Desk
        </button>
        <button
          onClick={() => setActiveSegment('subscription-desk')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'subscription-desk'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <Heart className="w-4 h-4 inline mr-1" /> Subscription Desk
        </button>
        <button
          onClick={() => setActiveSegment('asset-maintenance')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'asset-maintenance'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <History className="w-4 h-4 inline mr-1" /> Asset &amp; Maintenance
        </button>
        <button
          onClick={() => setActiveSegment('energy-monitoring')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'energy-monitoring'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <Activity className="w-4 h-4 inline mr-1" /> Energy Monitoring
        </button>
        <button
          onClick={() => setActiveSegment('project-delivery')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'project-delivery'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <Truck className="w-4 h-4 inline mr-1" /> Project Delivery
        </button>
        <button
          onClick={() => setActiveSegment('client-portal')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSegment === 'client-portal'
              ? "bg-neutral-950 border border-amber-500/40 text-neutral-100"
              : "bg-neutral-955 text-neutral-405 border border-neutral-850 hover:bg-neutral-800"
          }`}
        >
          <FolderOpen className="w-4 h-4 inline mr-1" /> Client Portal Tools
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

        {activeSegment === 'pdf-templates' && (
          <div className="space-y-6 fade-in-entry text-left font-sans text-xs">
            
            {/* Top Branding Section & Live Preview Button */}
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-800 pb-4">
              <div>
                <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider font-mono">Quotation PDF Template Manager</h3>
                <p className="text-[11px] text-neutral-400 mt-0.5">Manage branding, cover pages, payment channels, and client-facing assurances.</p>
              </div>
              <button
                onClick={() => window.open(`${API_BASE_URL}/api/export/pdf/template-preview/tmpl-1`, "_blank")}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 transition cursor-pointer"
              >
                Live PDF Template Preview
              </button>
            </div>

            {/* Notification system */}
            {successMsg && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-2xl text-[11px] font-mono">
                ✓ {successMsg}
              </div>
            )}
            {errorMsg && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-2xl text-[11px] font-mono">
                ❌ {errorMsg}
              </div>
            )}

            {/* Inner Sub-Tab Selector Navigation */}
            <div className="flex gap-1.5 bg-neutral-950 p-1.5 rounded-2xl border border-neutral-850 flex-wrap">
              {(['pages', 'banks', 'terms', 'ceo', 'structures', 'settings'] as const).map((sub) => (
                <button
                  key={sub}
                  onClick={() => {
                    setSelectedSubTab(sub);
                    // Clear edits when switching tabs
                    setPageDraft(null);
                    setBankDraft(null);
                    setTermDraft(null);
                    setCeoDraft(null);
                    setStructDraft(null);
                    setPdfSettingsDraft(null);
                  }}
                  className={`py-2 px-4 rounded-xl text-[10px] font-bold uppercase tracking-wider transition cursor-pointer ${
                    selectedSubTab === sub
                      ? "bg-amber-500 text-neutral-950"
                      : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900"
                  }`}
                >
                  {sub === 'pages' && 'Pages & Layout'}
                  {sub === 'banks' && 'Bank Accounts'}
                  {sub === 'terms' && 'Terms & Conditions'}
                  {sub === 'ceo' && 'Executive CEO Messages'}
                  {sub === 'structures' && 'Structure Drawings'}
                  {sub === 'settings' && 'Global PDF settings'}
                </button>
              ))}
            </div>

            {/* Sub-Tab Contents */}

            {/* SUBTAB 1: PAGES & LAYOUT */}
            {selectedSubTab === 'pages' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 bg-neutral-900 border border-neutral-808 rounded-3xl p-5 shadow-sm space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-450 font-mono mb-2">Template Layout Checklist</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-800 text-neutral-400 text-[10px] uppercase font-mono tracking-wider">
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Page Title</th>
                          <th className="py-2.5 px-3 text-center">Order</th>
                          <th className="py-2.5 px-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-850 text-neutral-350">
                        {quoteTemplatePages
                          .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0))
                          .map((p: any) => (
                            <tr
                              key={p.id}
                              onClick={() => {
                                setEditingPageId(p.id);
                                setPageDraft({ ...p });
                              }}
                              className={`cursor-pointer hover:bg-neutral-950 transition ${
                                editingPageId === p.id ? 'bg-neutral-950 border-l-2 border-amber-500' : ''
                              }`}
                            >
                              <td className="py-2.5 px-3 font-mono font-bold uppercase text-neutral-400">{p.pageType}</td>
                              <td className="py-2.5 px-3 font-semibold text-neutral-100">{p.title || "(No Title)"}</td>
                              <td className="py-2.5 px-3 text-center font-mono font-semibold">{p.sortOrder}</td>
                              <td className="py-2.5 px-3 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-mono font-bold ${
                                  p.isEnabled ? 'bg-emerald-500/20 text-emerald-450 text-emerald-400' : 'bg-neutral-800 text-neutral-500'
                                }`}>
                                  {p.isEnabled ? 'Active' : 'Disabled'}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="lg:col-span-5">
                  {pageDraft ? (
                    <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-5 space-y-4 shadow-sm">
                      <div className="flex justify-between items-center pb-2 border-b border-neutral-800">
                        <span className="text-xs font-bold uppercase text-amber-500 font-mono">Edit: {pageDraft.pageType}</span>
                        <button
                          onClick={() => {
                            setEditingPageId(null);
                            setPageDraft(null);
                          }}
                          className="text-neutral-450 hover:text-neutral-200 text-[10px]"
                        >
                          Clear
                        </button>
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-neutral-300 block font-semibold">Page Title Header</label>
                        <input
                          type="text"
                          value={pageDraft.title || ""}
                          onChange={(e) => setPageDraft({ ...pageDraft, title: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-neutral-300 block font-semibold">Text Content / Descriptions</label>
                        <textarea
                          rows={6}
                          value={pageDraft.bodyText || ""}
                          onChange={(e) => setPageDraft({ ...pageDraft, bodyText: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-200 focus:outline-none focus:border-amber-500 font-sans leading-relaxed text-xs"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Display Rank / Sort Order</label>
                          <input
                            type="number"
                            value={pageDraft.sortOrder}
                            onChange={(e) => setPageDraft({ ...pageDraft, sortOrder: Number(e.target.value) })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>
                        
                        <div className="flex items-center gap-2 pt-5">
                          <input
                            type="checkbox"
                            id="page-enabled-checkbox"
                            checked={pageDraft.isEnabled}
                            onChange={(e) => setPageDraft({ ...pageDraft, isEnabled: e.target.checked })}
                            className="rounded border-neutral-800 text-amber-500 focus:ring-0 w-4 h-4 cursor-pointer"
                          />
                          <label htmlFor="page-enabled-checkbox" className="text-neutral-300 font-semibold cursor-pointer">Enabled</label>
                        </div>
                      </div>

                      <button
                        onClick={async () => {
                          await saveDbChange("edit", "quoteTemplatePages", pageDraft, pageDraft.id);
                          setEditingPageId(null);
                          setPageDraft(null);
                        }}
                        className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2 rounded-xl transition cursor-pointer"
                      >
                        Save Page Details
                      </button>
                    </div>
                  ) : (
                    <div className="bg-neutral-900/50 border border-neutral-808 border-dashed rounded-3xl p-8 text-center text-neutral-500 text-xs flex flex-col justify-center items-center h-48">
                      <span>Select a page from the checklist layout to customize its titles & body texts.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SUBTAB 2: BANK ACCOUNTS */}
            {selectedSubTab === 'banks' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 bg-neutral-900 border border-neutral-808 rounded-3xl p-5 shadow-sm space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-450 font-mono mb-2">Registered Accounts</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-800 text-neutral-400 text-[10px] uppercase font-mono tracking-wider">
                          <th className="py-2.5 px-3">Bank Name</th>
                          <th className="py-2.5 px-3">Account Title</th>
                          <th className="py-2.5 px-3 text-center">Active</th>
                          <th className="py-2.5 px-3 text-right">Delete</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-850 text-neutral-300">
                        {bankAccounts
                          .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0))
                          .map((b: any) => (
                            <tr
                              key={b.id}
                              onClick={() => {
                                setEditingBankId(b.id);
                                setBankDraft({ ...b });
                              }}
                              className={`cursor-pointer hover:bg-neutral-950 transition ${
                                editingBankId === b.id ? 'bg-neutral-950 border-l-2 border-amber-500' : ''
                              }`}
                            >
                              <td className="py-2.5 px-3 font-semibold text-neutral-100">{b.bankName}</td>
                              <td className="py-2.5 px-3 font-mono">{b.accountTitle}</td>
                              <td className="py-2.5 px-3 text-center">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                  b.isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-neutral-800 text-neutral-500'
                                }`}>
                                  {b.isActive ? 'Y' : 'N'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (confirm("Delete this bank account from quotations?")) {
                                      await saveDbChange("delete", "bankAccounts", null, b.id);
                                      if (editingBankId === b.id) {
                                        setEditingBankId(null);
                                        setBankDraft(null);
                                      }
                                    }
                                  }}
                                  className="text-rose-400 hover:text-rose-300 p-1 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5 inline" />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="lg:col-span-5 space-y-6">
                  {/* Account Editor Draft */}
                  {bankDraft ? (
                    <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-5 space-y-4 shadow-sm">
                      <div className="flex justify-between items-center pb-2 border-b border-neutral-800">
                        <span className="text-xs font-bold uppercase text-amber-500 font-mono">Edit Account details</span>
                        <button
                          onClick={() => {
                            setEditingBankId(null);
                            setBankDraft(null);
                          }}
                          className="text-neutral-450 hover:text-neutral-200 text-[10px]"
                        >
                          Clear
                        </button>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Bank Institution Name</label>
                          <input
                            type="text"
                            value={bankDraft.bankName || ""}
                            onChange={(e) => setBankDraft({ ...bankDraft, bankName: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Account Title (Beneficiary)</label>
                          <input
                            type="text"
                            value={bankDraft.accountTitle || ""}
                            onChange={(e) => setBankDraft({ ...bankDraft, accountTitle: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono text-xs font-bold"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Account Number</label>
                          <input
                            type="text"
                            value={bankDraft.accountNumber || ""}
                            onChange={(e) => setBankDraft({ ...bankDraft, accountNumber: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">IBAN Code</label>
                          <input
                            type="text"
                            value={bankDraft.iban || ""}
                            onChange={(e) => setBankDraft({ ...bankDraft, iban: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-neutral-300 block font-semibold">Branch Code</label>
                            <input
                              type="text"
                              value={bankDraft.branchCode || ""}
                              onChange={(e) => setBankDraft({ ...bankDraft, branchCode: e.target.value })}
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-neutral-300 block font-semibold">Sort order</label>
                            <input
                              type="number"
                              value={bankDraft.sortOrder || 0}
                              onChange={(e) => setBankDraft({ ...bankDraft, sortOrder: Number(e.target.value) })}
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="bank-active-checkbox"
                            checked={bankDraft.isActive}
                            onChange={(e) => setBankDraft({ ...bankDraft, isActive: e.target.checked })}
                            className="rounded border-neutral-800 text-amber-500 focus:ring-0 w-4 h-4 cursor-pointer"
                          />
                          <label htmlFor="bank-active-checkbox" className="text-neutral-300 font-semibold cursor-pointer">Account Active for Invoicing</label>
                        </div>

                        <button
                          onClick={async () => {
                            await saveDbChange("edit", "bankAccounts", bankDraft, bankDraft.id);
                            setEditingBankId(null);
                            setBankDraft(null);
                          }}
                          className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2 rounded-xl transition cursor-pointer"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Add New Account Form */
                    <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-5 space-y-4 shadow-sm text-left">
                      <h4 className="text-xs font-bold uppercase text-indigo-400 font-mono pb-2 border-b border-neutral-800">Add Bank Channel</h4>
                      
                      <div className="space-y-3 text-xs">
                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Bank Institution Name</label>
                          <input
                            type="text"
                            placeholder="e.g. Allied Bank Limited"
                            value={newBank.bankName}
                            onChange={(e) => setNewBank({ ...newBank, bankName: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Account Title</label>
                          <input
                            type="text"
                            placeholder="e.g. SUNCHASER ENERGY SYSTEMS"
                            value={newBank.accountTitle}
                            onChange={(e) => setNewBank({ ...newBank, accountTitle: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono text-xs font-bold"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Account Number</label>
                          <input
                            type="text"
                            placeholder="e.g. 04190010112276..."
                            value={newBank.accountNumber}
                            onChange={(e) => setNewBank({ ...newBank, accountNumber: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">IBAN Code</label>
                          <input
                            type="text"
                            placeholder="e.g. PK81ABPA..."
                            value={newBank.iban}
                            onChange={(e) => setNewBank({ ...newBank, iban: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-neutral-300 block font-semibold">Branch Code</label>
                            <input
                              type="text"
                              placeholder="e.g. 0419"
                              value={newBank.branchCode}
                              onChange={(e) => setNewBank({ ...newBank, branchCode: e.target.value })}
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-neutral-300 block font-semibold">Sort Order</label>
                            <input
                              type="number"
                              value={newBank.sortOrder}
                              onChange={(e) => setNewBank({ ...newBank, sortOrder: Number(e.target.value) })}
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={!newBank.bankName || !newBank.accountNumber}
                          onClick={async () => {
                            const newId = `bank-${Date.now()}`;
                            await saveDbChange("add", "bankAccounts", { id: newId, ...newBank });
                            setNewBank({
                              bankName: "",
                              accountTitle: "",
                              accountNumber: "",
                              iban: "",
                              branchCode: "",
                              isActive: true,
                              sortOrder: bankAccounts.length + 1
                            });
                          }}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
                        >
                          Register New Account
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SUBTAB 3: TERMS & CONDITIONS */}
            {selectedSubTab === 'terms' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 bg-neutral-900 border border-neutral-808 rounded-3xl p-5 shadow-sm space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-450 font-mono mb-2">Legal Clauses ({companyTerms.length})</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-800 text-neutral-400 text-[10px] uppercase font-mono tracking-wider">
                          <th className="py-2.5 px-3">Sort</th>
                          <th className="py-2.5 px-3">Term Clause Text</th>
                          <th className="py-2.5 px-3 text-right">Delete</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-850 text-neutral-350">
                        {companyTerms
                          .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0))
                          .map((t: any) => (
                            <tr
                              key={t.id}
                              onClick={() => {
                                setEditingTermId(t.id);
                                setTermDraft({ ...t });
                              }}
                              className={`cursor-pointer hover:bg-neutral-950 transition ${
                                editingTermId === t.id ? 'bg-neutral-950 border-l-2 border-amber-500' : ''
                              }`}
                            >
                              <td className="py-2.5 px-3 font-mono font-bold">{t.sortOrder}</td>
                              <td className="py-2.5 px-3 truncate max-w-sm font-sans">{t.termText}</td>
                              <td className="py-2.5 px-3 text-right">
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (confirm("Delete this legal clause?")) {
                                      await saveDbChange("delete", "companyTerms", null, t.id);
                                      if (editingTermId === t.id) {
                                        setEditingTermId(null);
                                        setTermDraft(null);
                                      }
                                    }
                                  }}
                                  className="text-rose-400 hover:text-rose-300 p-1 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5 inline" />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="lg:col-span-5 space-y-6">
                  {termDraft ? (
                    <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-5 space-y-4 shadow-sm">
                      <div className="flex justify-between items-center pb-2 border-b border-neutral-800">
                        <span className="text-xs font-bold uppercase text-amber-500 font-mono">Edit Legal Clause</span>
                        <button
                          onClick={() => {
                            setEditingTermId(null);
                            setTermDraft(null);
                          }}
                          className="text-neutral-450 hover:text-neutral-200 text-[10px]"
                        >
                          Clear
                        </button>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Clause Text</label>
                          <textarea
                            rows={5}
                            value={termDraft.termText || ""}
                            onChange={(e) => setTermDraft({ ...termDraft, termText: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans leading-relaxed text-xs"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Sort Rank</label>
                          <input
                            type="number"
                            value={termDraft.sortOrder || 0}
                            onChange={(e) => setTermDraft({ ...termDraft, sortOrder: Number(e.target.value) })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>

                        <button
                          onClick={async () => {
                            await saveDbChange("edit", "companyTerms", termDraft, termDraft.id);
                            setEditingTermId(null);
                            setTermDraft(null);
                          }}
                          className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2 rounded-xl transition cursor-pointer"
                        >
                          Save Clause Changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Add Term */
                    <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-5 space-y-4 shadow-sm text-left">
                      <h4 className="text-xs font-bold uppercase text-indigo-400 font-mono pb-2 border-b border-neutral-800">Add Legal Clause</h4>
                      
                      <div className="space-y-3 text-xs">
                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Clause Text Description</label>
                          <textarea
                            rows={4}
                            placeholder="Enter the quotation terms details here..."
                            value={newTerm.termText}
                            onChange={(e) => setNewTerm({ ...newTerm, termText: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans leading-relaxed text-xs"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Sort Rank Order</label>
                          <input
                            type="number"
                            value={newTerm.sortOrder}
                            onChange={(e) => setNewTerm({ ...newTerm, sortOrder: Number(e.target.value) })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>

                        <button
                          type="button"
                          disabled={!newTerm.termText}
                          onClick={async () => {
                            const newId = `term-${Date.now()}`;
                            await saveDbChange("add", "companyTerms", { id: newId, ...newTerm });
                            setNewTerm({
                              termText: "",
                              sortOrder: companyTerms.length + 1
                            });
                          }}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
                        >
                          Append Legal Clause
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SUBTAB 4: CEO MESSAGES */}
            {selectedSubTab === 'ceo' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-6 bg-neutral-900 border border-neutral-808 rounded-3xl p-5 shadow-sm space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-450 font-mono pb-2 border-b border-neutral-800">Executive Board Signatures</h4>
                  <div className="space-y-3">
                    {ceoMessages.map((m: any) => (
                      <div
                        key={m.id}
                        onClick={() => {
                          setEditingCeoId(m.id);
                          setCeoDraft({ ...m });
                        }}
                        className={`p-4 bg-neutral-950 rounded-2xl border cursor-pointer hover:border-amber-500/40 transition flex items-center justify-between ${
                          editingCeoId === m.id ? 'border-amber-500' : 'border-neutral-850'
                        }`}
                      >
                        <div>
                          <strong className="text-neutral-100 text-xs block font-sans">{m.name}</strong>
                          <span className="text-[10px] text-neutral-400 font-mono">{m.designation}</span>
                        </div>
                        <span className="text-[9px] bg-neutral-800 text-neutral-450 px-2 py-0.5 rounded font-mono uppercase">
                          {m.id}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-6">
                  {ceoDraft ? (
                    <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-5 space-y-4 shadow-sm">
                      <div className="flex justify-between items-center pb-2 border-b border-neutral-800">
                        <span className="text-xs font-bold uppercase text-amber-500 font-mono">Edit Board Assurance Letter</span>
                        <button
                          onClick={() => {
                            setEditingCeoId(null);
                            setCeoDraft(null);
                          }}
                          className="text-neutral-450 hover:text-neutral-200 text-[10px]"
                        >
                          Clear
                        </button>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Executive Full Name</label>
                          <input
                            type="text"
                            value={ceoDraft.name || ""}
                            onChange={(e) => setCeoDraft({ ...ceoDraft, name: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Corporate Designation</label>
                          <input
                            type="text"
                            value={ceoDraft.designation || ""}
                            onChange={(e) => setCeoDraft({ ...ceoDraft, designation: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono text-[11px]"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Signature Assurances Message</label>
                          <textarea
                            rows={5}
                            value={ceoDraft.message || ""}
                            onChange={(e) => setCeoDraft({ ...ceoDraft, message: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-105 focus:outline-none focus:border-amber-500 font-sans leading-relaxed text-xs"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-neutral-300 block font-semibold">Signature Image URL</label>
                            <input
                              type="text"
                              value={ceoDraft.signatureUrl || ""}
                              onChange={(e) => setCeoDraft({ ...ceoDraft, signatureUrl: e.target.value })}
                              placeholder="e.g. /assets/sig.png"
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-neutral-300 block font-semibold">Photo Image URL</label>
                            <input
                              type="text"
                              value={ceoDraft.photoUrl || ""}
                              onChange={(e) => setCeoDraft({ ...ceoDraft, photoUrl: e.target.value })}
                              placeholder="e.g. /assets/ceo.jpg"
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                            />
                          </div>
                        </div>

                        <button
                          onClick={async () => {
                            await saveDbChange("edit", "ceoMessages", ceoDraft, ceoDraft.id);
                            setEditingCeoId(null);
                            setCeoDraft(null);
                          }}
                          className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2 rounded-xl transition cursor-pointer"
                        >
                          Update Executive Message
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-neutral-900/50 border border-neutral-808 border-dashed rounded-3xl p-8 text-center text-neutral-500 text-xs flex flex-col justify-center items-center h-48">
                      <span>Select a board member signature profile from the left list to edit their message.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SUBTAB 5: STRUCTURE DRAWINGS */}
            {selectedSubTab === 'structures' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-6 bg-neutral-900 border border-neutral-808 rounded-3xl p-5 shadow-sm space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-450 font-mono pb-2 border-b border-neutral-800">Mechanical Drawings Library</h4>
                  <div className="space-y-3">
                    {structureDescriptions.map((s: any) => (
                      <div
                        key={s.id}
                        onClick={() => {
                          setEditingStructId(s.id);
                          setStructDraft({ ...s });
                        }}
                        className={`p-4 bg-neutral-950 rounded-2xl border cursor-pointer hover:border-amber-500/40 transition flex items-center justify-between ${
                          editingStructId === s.id ? 'border-amber-500' : 'border-neutral-850'
                        }`}
                      >
                        <div>
                          <strong className="text-neutral-100 text-xs block font-sans">{s.title}</strong>
                          <span className="text-[10px] text-neutral-400 font-mono uppercase">{s.structureType} Type</span>
                        </div>
                        <span className="text-[9px] bg-neutral-800 text-neutral-450 px-2 py-0.5 rounded font-mono uppercase">
                          {s.windRating || s.wind_rating || "130 km/h"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-6">
                  {structDraft ? (
                    <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-5 space-y-4 shadow-sm text-left">
                      <div className="flex justify-between items-center pb-2 border-b border-neutral-800">
                        <span className="text-xs font-bold uppercase text-amber-500 font-mono">Edit Structural Specifications</span>
                        <button
                          onClick={() => {
                            setEditingStructId(null);
                            setStructDraft(null);
                          }}
                          className="text-neutral-450 hover:text-neutral-200 text-[10px]"
                        >
                          Clear
                        </button>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Mount Type Title</label>
                          <input
                            type="text"
                            value={structDraft.title || ""}
                            onChange={(e) => setStructDraft({ ...structDraft, title: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Technical Description (English)</label>
                          <textarea
                            rows={3}
                            value={structDraft.descriptionEn || ""}
                            onChange={(e) => setStructDraft({ ...structDraft, descriptionEn: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans leading-relaxed text-xs"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold text-right font-sans">تکنیکی تفصیل (Urdu)</label>
                          <textarea
                            rows={3}
                            dir="rtl"
                            value={structDraft.descriptionUr || ""}
                            onChange={(e) => setStructDraft({ ...structDraft, descriptionUr: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans leading-relaxed text-sm text-right"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-neutral-300 block font-semibold">Material Grade</label>
                            <input
                              type="text"
                              value={structDraft.materialType || ""}
                              onChange={(e) => setStructDraft({ ...structDraft, materialType: e.target.value })}
                              placeholder="e.g. Hot-Dip Galvanized Iron"
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-neutral-300 block font-semibold">Estimated Weight</label>
                            <input
                              type="text"
                              value={structDraft.weight || ""}
                              onChange={(e) => setStructDraft({ ...structDraft, weight: e.target.value })}
                              placeholder="e.g. 25kg/frame"
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-neutral-300 block font-semibold">Wind Shear Rating</label>
                            <input
                              type="text"
                              value={structDraft.windRating || ""}
                              onChange={(e) => setStructDraft({ ...structDraft, windRating: e.target.value })}
                              placeholder="e.g. 130 km/h wind shear"
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-neutral-300 block font-semibold">Structural Warranty</label>
                            <input
                              type="text"
                              value={structDraft.warranty || ""}
                              onChange={(e) => setStructDraft({ ...structDraft, warranty: e.target.value })}
                              placeholder="e.g. 10 Years structural guarantee"
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Reference Image URL</label>
                          <input
                            type="text"
                            value={structDraft.imageUrl || ""}
                            onChange={(e) => setStructDraft({ ...structDraft, imageUrl: e.target.value })}
                            placeholder="Image URL for PDF reference frame"
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>

                        <button
                          onClick={async () => {
                            await saveDbChange("edit", "structureDescriptions", structDraft, structDraft.id);
                            setEditingStructId(null);
                            setStructDraft(null);
                          }}
                          className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2 rounded-xl transition cursor-pointer"
                        >
                          Save Specifications
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-neutral-900/50 border border-neutral-808 border-dashed rounded-3xl p-8 text-center text-neutral-500 text-xs flex flex-col justify-center items-center h-48">
                      <span>Select a mounting structure drawing type on the left to edit its specs.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SUBTAB 6: GLOBAL PDF SETTINGS */}
            {selectedSubTab === 'settings' && (
              <div className="bg-neutral-900 border border-neutral-808 rounded-3xl p-6 shadow-sm max-w-2xl text-left">
                <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-400 font-mono pb-2 border-b border-neutral-800 mb-4">Corporate PDF Invoice Branding</h4>
                
                {(() => {
                  const currentSettings = quotePdfSettings[0] || {
                    id: "settings-1",
                    companyName: "SUNCHASER ENERGY SYSTEMS",
                    officeAddress: "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore",
                    hotlinePhones: "0309-0236666, 0330-7776444",
                    billingEmail: "billing@sunchaser-energy.com",
                    websiteUrl: "www.sunchaser-energy.com",
                    logoUrl: ""
                  };
                  
                  // Initialize settings draft if not initialized
                  if (!pdfSettingsDraft || pdfSettingsDraft.id !== currentSettings.id) {
                    setPdfSettingsDraft({ ...currentSettings });
                    return null;
                  }

                  return (
                    <div className="space-y-4 text-xs font-sans">
                      <div className="space-y-1">
                        <label className="text-neutral-300 block font-semibold">Registered Company Name</label>
                        <input
                          type="text"
                          value={pdfSettingsDraft.companyName || ""}
                          onChange={(e) => setPdfSettingsDraft({ ...pdfSettingsDraft, companyName: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-bold"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-neutral-300 block font-semibold">Head Office Address</label>
                        <input
                          type="text"
                          value={pdfSettingsDraft.officeAddress || ""}
                          onChange={(e) => setPdfSettingsDraft({ ...pdfSettingsDraft, officeAddress: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Hotline Phones (Comma Separated)</label>
                          <input
                            type="text"
                            value={pdfSettingsDraft.hotlinePhones || ""}
                            onChange={(e) => setPdfSettingsDraft({ ...pdfSettingsDraft, hotlinePhones: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Billing Support Email</label>
                          <input
                            type="email"
                            value={pdfSettingsDraft.billingEmail || ""}
                            onChange={(e) => setPdfSettingsDraft({ ...pdfSettingsDraft, billingEmail: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Official Website URL</label>
                          <input
                            type="text"
                            value={pdfSettingsDraft.websiteUrl || ""}
                            onChange={(e) => setPdfSettingsDraft({ ...pdfSettingsDraft, websiteUrl: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-neutral-300 block font-semibold">Corporate Logo URL</label>
                          <input
                            type="text"
                            value={pdfSettingsDraft.logoUrl || ""}
                            onChange={(e) => setPdfSettingsDraft({ ...pdfSettingsDraft, logoUrl: e.target.value })}
                            placeholder="Direct URL of transparent PNG logo image"
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>
                      </div>

                      <div className="pt-2">
                        <button
                          onClick={async () => {
                            await saveDbChange("edit", "quotePdfSettings", pdfSettingsDraft, pdfSettingsDraft.id);
                          }}
                          className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2.5 px-6 rounded-xl transition cursor-pointer"
                        >
                          Save Corporate Settings
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

          </div>
        )}
        {activeSegment === 'support-desk' && <SupportDeskStaff staffUser={staffUser} />}
        {activeSegment === 'service-desk' && <ServiceDeskStaff staffUser={staffUser} />}
        {activeSegment === 'savings-desk' && <CustomerSavingsStaff staffUser={staffUser} />}
        {activeSegment === 'subscription-desk' && <SubscriptionDeskStaff staffUser={staffUser} />}
        {activeSegment === 'asset-maintenance' && <AssetMaintenanceLogStaff staffUser={staffUser} />}
        {activeSegment === 'energy-monitoring' && <EnergyMonitoringStaff staffUser={staffUser} />}
        {activeSegment === 'project-delivery' && <ProjectDeliveryStaff staffUser={staffUser} />}
        {activeSegment === 'client-portal' && (
          <>
            <ClientPortalStaffTools staffUser={staffUser} />
            <AfterSalesStaffTools staffUser={staffUser} />
          </>
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
