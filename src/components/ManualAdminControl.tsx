import React, { useState, useEffect } from "react";
import { 
  Plus, Trash2, Edit3, Save, X, Check, FileText, Download, 
  Upload, ShieldAlert, Users, CreditCard, TrendingUp, FolderPlus, 
  Wrench, Layers, Settings2, Globe, Activity, FileSpreadsheet, 
  UserCheck, Briefcase, Tag, RefreshCw, Sparkles, Send, Eye, Link2
} from "lucide-react";
import { Lead, Ticket, InventoryItem, Product, User } from "../types";
import { currencySymbol, API_BASE_URL, fetchDeletedLeads, restoreLead } from "../services/api";
import { isSuperAdmin } from "../lib/roles";
import WhatsAppModule from "./WhatsAppModule";
import CustomerLinkingStaff from "./CustomerLinkingStaff";
import CustomerInvitationPanel from "./CustomerInvitationPanel";
import { resolveCustomerForLead } from "../services/api";
import { useToast } from "../lib/toast";

interface ManualAdminControlProps {
  staffUser: User;
  leads: Lead[];
  tickets: Ticket[];
  inventory: InventoryItem[];
  categories: any[];
  products: Product[];
  orders: any[];
  warranties: any[];
  solarPackages: any[];
  settings: any;
  websiteContent: any;
  quotations: any[];
  onRefreshState: () => void;
  onDeleteLead?: (id: string) => void;
}

export default function ManualAdminControl({
  staffUser,
  leads,
  tickets,
  inventory,
  categories,
  products,
  orders,
  warranties,
  solarPackages,
  settings,
  websiteContent,
  quotations,
  onRefreshState,
  onDeleteLead,
}: ManualAdminControlProps) {
  const toast = useToast();
  const showDeletedLeads = isSuperAdmin(staffUser.username, staffUser.role);
  const [deletedLeads, setDeletedLeads] = useState<any[]>([]);
  const [deletedLeadsLoading, setDeletedLeadsLoading] = useState(false);

  useEffect(() => {
    if (!showDeletedLeads) return;
    setDeletedLeadsLoading(true);
    fetchDeletedLeads(staffUser.id, staffUser.username, staffUser.role)
      .then((res) => setDeletedLeads(res.leads || []))
      .catch(() => setDeletedLeads([]))
      .finally(() => setDeletedLeadsLoading(false));
  }, [showDeletedLeads, staffUser.id, staffUser.username, staffUser.role, leads.length]);

  // Inner Sub-Tab selector
  const [innerSubTab, setInnerSubTab] = useState<string>("products");

  // Global loading states for admin persistence
  const [syncing, setSyncing] = useState<boolean>(false);

  // Core Generic API post wrapper for DB changes
  const saveDbChange = async (action: "add" | "edit" | "delete" | "update_raw", table: string, data: any, id?: string) => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/db/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, table, data, id })
      });
      if (!res.ok) throw new Error("Could not execute manual update on server memory.");
      const result = await res.json();
      if (result.success) {
        toast.success(`Manuel action [${action.toUpperCase()}] for '${table}' successfully stored and persisted.`);
        onRefreshState();
      } else {
        throw new Error("Server rejected state modifier request.");
      }
    } catch (err: any) {
      toast.error(err.message || "Network state syncing faulted.");
    } finally {
      setSyncing(false);
    }
  };

  // ----------------------------------------------------
  // SUB-TAB LOCAL STATES
  // ----------------------------------------------------

  // 1. PRODUCTS Local States
  const [newProd, setNewProd] = useState({
    name: "", category: "Panels", brand: "Canadian Solar", model: "CS-400X", sku: "SC-400-P",
    price: 320, discount: 0, stock: 450, images: ["https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=300&q=80"],
    warrantyPeriod: "25 Years", specs: "Peak Efficiency: 21.3%, Temp Coefficient: -0.34%/C"
  });
  const [editingProd, setEditingProd] = useState<Product | null>(null);

  // 2. SOLAR PACKAGES Local States
  const [editingPkg, setEditingPkg] = useState<any | null>(null);
  const [newPkg, setNewPkg] = useState({
    id: "", name: "", panelBrand: "Canadian Solar 400W", inverterBrand: "Enphase IQ8",
    batteryOption: "Tesla Powerwall 2", price: 15000, structureType: "Roofs", profitMargin: 0.25, enabled: true
  });

  // 3. QUOTATIONS Local States
  const [selectedLeadId, setSelectedLeadId] = useState<string>(leads[0]?.id || "");
  const [quoteItems, setQuoteItems] = useState<Array<{ productId: string; name: string; qty: number; price: number }>>([]);
  const [quoteDiscount, setQuoteDiscount] = useState<number>(0);
  const [quoteTerms, setQuoteTerms] = useState<string>("30% Advance, 50% Post-Survey, 20% Commissioning");
  const [quotePreview, setQuotePreview] = useState<any | null>(null);

  // 4. CUSTOMERS Local States
  const [custSearch, setCustSearch] = useState("");
  const [editingCust, setEditingCust] = useState<Lead | null>(null);
  const [newCust, setNewCust] = useState({
    name: "", email: "", phone: "", address: "", notes: "", monthlyBill: 150, roofSpace: 120, shading: "Low" as const
  });
  const [drilldownCust, setDrilldownCust] = useState<Lead | null>(null);
  const [drilldownCustomerRecord, setDrilldownCustomerRecord] = useState<any | null>(null);

  // 5. ORDERS Local States
  const [editingOrder, setEditingOrder] = useState<any | null>(null);
  const [newOrder, setNewOrder] = useState({
    customerName: "", email: "", phone: "", address: "", orderType: "Product" as const, status: "Pending" as const,
    items: [{ productId: "p-400", productName: "Canadian Solar 400W", quantity: 10, price: 320 }], totalCost: 3200
  });

  // 6. TICKETS Local States
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);

  // 7. INVENTORY Local States
  const [inventoryAverages, setInventoryAverages] = useState<Record<string, number>>({
    "p-400": 175, "inv-en": 120, "bat-ts": 4100, "str-al": 17
  });

  // 8. CONTENT CMS Local States
  const [webCMS, setWebCMS] = useState<any>(websiteContent || {
    banners: [], promotions: [], blogs: [], faqs: [], testimonials: [], serviceAreas: []
  });

  // 9. RE-MAPPING LOCAL CMS COPIES ON INITIALIZE
  React.useEffect(() => {
    if (websiteContent && Object.keys(websiteContent).length > 0) {
      setWebCMS(websiteContent);
    }
  }, [websiteContent]);

  // 9. STAFF USER ROLES
  const [newStaff, setNewStaff] = useState({ username: "", name: "", email: "", password: "123", role: "Sales Executive" });

  React.useEffect(() => {
    if (!drilldownCust) {
      setDrilldownCustomerRecord(null);
      return;
    }
    resolveCustomerForLead(staffUser, { email: drilldownCust.email, phone: drilldownCust.phone })
      .then((res) => setDrilldownCustomerRecord(res.customer))
      .catch(() => setDrilldownCustomerRecord(null));
  }, [drilldownCust?.id, drilldownCust?.email, drilldownCust?.phone, staffUser.id]);

  // 10. BANK SETTINGS
  const [sysSettings, setSysSettings] = useState<any>(settings || {});
  React.useEffect(() => {
    if (settings && Object.keys(settings).length > 0) {
      setSysSettings(settings);
    }
  }, [settings]);

  // 11. BULK DATA SIMULATOR
  const [csvText, setCsvText] = useState("");
  const [parsedRows, setParsedRows] = useState<any[]>([]);

  // ----------------------------------------------------
  // MASS ACCORDION SECTIONS BAR
  // ----------------------------------------------------
  const tabs = [
    { id: "products", label: "Catalog Products", icon: Tag },
    { id: "solar-packages", label: "Solar Packages", icon: Layers },
    { id: "quotations", label: "Manual Quotations", icon: FileText },
    { id: "customers", label: "Customers Accounts", icon: Users },
    { id: "customer-linking", label: "Customer Linking", icon: Link2 },
    { id: "orders", label: "Client Orders", icon: CreditCard },
    { id: "tickets", label: "Complaints & Cases", icon: Wrench },
    { id: "inventory", label: "Stock & Margins", icon: TrendingUp },
    { id: "cms", label: "CMS & App Content", icon: Globe },
    { id: "roles", label: "Staff & Permissions", icon: UserCheck },
    { id: "settings", label: "Company Settings", icon: Settings2 },
    { id: "bulk", label: "CSV Import/Export", icon: FileSpreadsheet }
  ];

  return (
    <div id="manual-control-panel" className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-sm space-y-6">
      {/* Upper Status Notifications Banner */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-neutral-800 pb-4">
        <div>
          <h2 className="text-sm font-black font-mono uppercase tracking-wider text-amber-500 flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-amber-400 animate-spin" /> Live Manual Administration Desk
          </h2>
          <p className="text-neutral-450 text-xs font-sans">
            Direct database modification console. Any adjustments instantly commit back to <strong className="text-neutral-300 font-mono text-[10px]">database.json</strong>.
          </p>
        </div>
        <button 
          onClick={onRefreshState}
          className="bg-neutral-800 hover:bg-neutral-750 text-neutral-200 border border-neutral-700 px-3 py-1.5 rounded-xl font-mono text-[10px] flex items-center gap-1.5 transition cursor-pointer shrink-0"
        >
          <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin text-amber-400' : ''}`} /> Refresh Memory
        </button>
      </div>

      {/* Grid of Section Selector Controls */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11 gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = innerSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setInnerSubTab(tab.id);
              }}
              className={`p-3 rounded-2xl flex flex-col items-center justify-center text-center transition cursor-pointer text-xs font-bold border ${
                isActive 
                  ? "bg-amber-500/10 border-amber-500/40 text-amber-300 shadow-sm" 
                  : "bg-neutral-950 border-neutral-850 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <Icon className={`h-4 w-4 mb-2 ${isActive ? 'text-amber-400' : 'text-neutral-500'}`} />
              <span className="text-[10px] block truncate max-w-full leading-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-neutral-950/70 border border-neutral-850 rounded-2xl p-6 min-h-[400px]">
        {/* ----------------------------------------------------
            1. PRODUCTS TAB
            ---------------------------------------------------- */}
        {innerSubTab === "products" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 font-mono">Inventory Product Lineups</h3>
              <p className="text-[10px] text-neutral-450 font-mono">Existing: {products.length} Products</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Product Add / Edit Panel */}
              <div className="lg:col-span-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
                <h4 className="text-xs font-bold text-amber-400 tracking-wide font-mono flex items-center gap-1.5">
                  {editingProd ? <Edit3 className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                  {editingProd ? "Modify Product Spec" : "Add Catalog Hardware"}
                </h4>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-neutral-400 block mb-1">Product Title</label>
                    <input 
                      type="text"
                      placeholder="e.g. Astro-Solar Gen 4"
                      value={editingProd ? editingProd.name : newProd.name}
                      onChange={(e) => editingProd 
                        ? setEditingProd({ ...editingProd, name: e.target.value })
                        : setNewProd({ ...newProd, name: e.target.value })
                      }
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 focus:outline-none focus:border-amber-500 font-mono text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-neutral-400 block mb-1">Category</label>
                      <select
                        value={editingProd ? editingProd.category : newProd.category}
                        onChange={(e) => editingProd 
                          ? setEditingProd({ ...editingProd, category: e.target.value })
                          : setNewProd({ ...newProd, category: e.target.value })
                        }
                        className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 text-xs font-mono"
                      >
                        <option value="Panels">Panels</option>
                        <option value="Inverters">Inverters</option>
                        <option value="Batteries">Batteries</option>
                        <option value="Structures">Structures</option>
                        <option value="Accessories">Accessories</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-neutral-400 block mb-1">Brand</label>
                      <input 
                        type="text"
                        placeholder="e.g. Canadian Solar"
                        value={editingProd ? editingProd.brand : newProd.brand}
                        onChange={(e) => editingProd 
                          ? setEditingProd({ ...editingProd, brand: e.target.value })
                          : setNewProd({ ...newProd, brand: e.target.value })
                        }
                        className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <div>
                      <label className="text-neutral-400 block mb-1 text-[10px]">SKU/Part No</label>
                      <input 
                        type="text"
                        placeholder="SC-400"
                        value={editingProd ? editingProd.sku : newProd.sku}
                        onChange={(e) => editingProd 
                          ? setEditingProd({ ...editingProd, sku: e.target.value })
                          : setNewProd({ ...newProd, sku: e.target.value })
                        }
                        className="w-full bg-neutral-950 border border-neutral-800 px-2 py-2 rounded-xl text-neutral-200 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-neutral-400 block mb-1 text-[10px]">Price ({currencySymbol.trim()})</label>
                      <input 
                        type="number"
                        placeholder="350"
                        value={editingProd ? editingProd.price : newProd.price}
                        onChange={(e) => editingProd 
                          ? setEditingProd({ ...editingProd, price: Number(e.target.value) })
                          : setNewProd({ ...newProd, price: Number(e.target.value) })
                        }
                        className="w-full bg-neutral-955 bg-neutral-950 border border-neutral-800 px-2 py-2 rounded-xl text-neutral-200 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-neutral-400 block mb-1 text-[10px]">Discount ({currencySymbol.trim()})</label>
                      <input 
                        type="number"
                        placeholder="0"
                        value={editingProd ? editingProd.discount : newProd.discount}
                        onChange={(e) => editingProd 
                          ? setEditingProd({ ...editingProd, discount: Number(e.target.value) })
                          : setNewProd({ ...newProd, discount: Number(e.target.value) })
                        }
                        className="w-full bg-neutral-950 border border-neutral-800 px-2 py-2 rounded-xl text-neutral-200 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-neutral-400 block mb-1">Stock</label>
                      <input 
                        type="number"
                        value={editingProd ? editingProd.stock : newProd.stock}
                        onChange={(e) => editingProd 
                          ? setEditingProd({ ...editingProd, stock: Number(e.target.value) })
                          : setNewProd({ ...newProd, stock: Number(e.target.value) })
                        }
                        className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-neutral-400 block mb-1">Warranty Term</label>
                      <input 
                        type="text"
                        placeholder="e.g. 25 Years"
                        value={editingProd ? editingProd.warrantyPeriod : newProd.warrantyPeriod}
                        onChange={(e) => editingProd 
                          ? setEditingProd({ ...editingProd, warrantyPeriod: e.target.value })
                          : setNewProd({ ...newProd, warrantyPeriod: e.target.value })
                        }
                        className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-neutral-400 block mb-1">Image URL</label>
                    <input 
                      type="text"
                      placeholder="https://..."
                      value={editingProd ? (editingProd.images?.[0] ?? "") : newProd.images[0]}
                      onChange={(e) => editingProd 
                        ? setEditingProd({ ...editingProd, images: [e.target.value] })
                        : setNewProd({ ...newProd, images: [e.target.value] })
                      }
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-neutral-400 block mb-1">Technical Specifications</label>
                    <textarea 
                      placeholder="Spec descriptions split by commas..."
                      rows={2}
                      value={editingProd ? (typeof editingProd.specifications === 'string' ? editingProd.specifications : JSON.stringify(editingProd.specifications)) : newProd.specs}
                      onChange={(e) => {
                        const txt = e.target.value;
                        if (editingProd) {
                          setEditingProd({ ...editingProd, specifications: { text: txt } as any });
                        } else {
                          setNewProd({ ...newProd, specs: txt });
                        }
                      }}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-205 text-xs font-sans focus:outline-none"
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    {editingProd ? (
                      <>
                        <button
                          onClick={async () => {
                            if (!editingProd) return;
                            await saveDbChange("edit", "products", editingProd, editingProd.id);
                            setEditingProd(null);
                          }}
                          className="flex-1 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black py-2 rounded-xl transition cursor-pointer"
                        >
                          Save Changes
                        </button>
                        <button
                          onClick={() => setEditingProd(null)}
                          className="px-3 bg-neutral-800 text-neutral-200 hover:bg-neutral-700/50 rounded-xl"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          const id = `p-${Date.now().toString().slice(-4)}`;
                          const payload: Product = {
                            id,
                            name: newProd.name || "Default Canadian Modular",
                            category: newProd.category,
                            brand: newProd.brand,
                            model: newProd.model,
                            sku: newProd.sku,
                            price: newProd.price,
                            discount: newProd.discount,
                            stock: newProd.stock,
                            images: newProd.images,
                            warrantyPeriod: newProd.warrantyPeriod,
                            specifications: { description: newProd.specs },
                            installationRequired: true,
                            serviceRequired: false
                          };
                          saveDbChange("add", "products", payload);
                          setNewProd({
                            name: "", category: "Panels", brand: "Canadian Solar", model: "CS-400X", sku: "SC-400-P",
                            price: 320, discount: 0, stock: 450, images: ["https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=300&q=80"],
                            warrantyPeriod: "25 Years", specs: "Peak Efficiency: 21.3%, Temp Coefficient: -0.34%/C"
                          });
                        }}
                        disabled={!newProd.name}
                        className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black py-2 rounded-xl transition cursor-pointer disabled:opacity-40"
                      >
                        Add Product Item
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Products Table */}
              <div className="lg:col-span-8 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 overflow-x-auto text-xs font-mono">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-800 text-neutral-400 pb-2">
                      <th className="py-2.5 px-3">Product SKU</th>
                      <th className="py-2.5 px-3">Brand & Name</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Price</th>
                      <th className="py-2.5 px-3">Stock</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id} className="border-b border-neutral-850 hover:bg-neutral-800/30 transition text-neutral-200">
                        <td className="py-3 px-3">
                          <span className="bg-neutral-800 px-2 py-0.5 rounded text-[10px] text-indigo-400 font-bold">{p.sku || p.id}</span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-sans font-bold text-neutral-100">{p.name}</div>
                          <div className="text-[10px] text-neutral-450">{p.brand} • {p.model}</div>
                        </td>
                        <td className="py-3 px-3">{p.category}</td>
                        <td className="py-3 px-3">
                          <span className="text-amber-400 font-bold">{currencySymbol}{p.price}</span>
                          {p.discount > 0 && <span className="text-emerald-500 text-[10px] ml-1.5 font-sans">(-{currencySymbol}{p.discount})</span>}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.stock < 50 ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-300'}`}>
                            {p.stock} units
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right space-x-1 shrink-0">
                          <button
                            onClick={() => setEditingProd(p)}
                            className="bg-neutral-800 hover:bg-neutral-700 p-1.5 rounded-lg text-amber-450 text-neutral-300 cursor-pointer"
                            title="Edit"
                          >
                            <Edit3 className="h-3 w-3 inline" />
                          </button>
                          <button
                            onClick={async () => {
                              if (confirm(`Remove product "${p.name}" from active catalog?`)) {
                                await saveDbChange("delete", "products", {}, p.id);
                              }
                            }}
                            className="bg-neutral-800 hover:bg-rose-950 p-1.5 rounded-lg text-rose-400 cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------
            2. SOLAR PACKAGES TAB
            ---------------------------------------------------- */}
        {innerSubTab === "solar-packages" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 font-mono">Manually Configured Solar Packages</h3>
              <span className="text-[10px] text-neutral-450 font-mono">Physical Pre-configured systems</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(solarPackages || []).map((pkg: any) => (
                <div key={pkg.id} className={`bg-neutral-900 border ${pkg.enabled ? 'border-neutral-800' : 'border-rose-950/40 opacity-75'} rounded-2xl p-5 space-y-4`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-sans font-black text-amber-300 text-xs">{pkg.name}</h4>
                      <span className="text-[10px] font-mono bg-neutral-800 px-2 py-0.5 rounded text-neutral-400">{pkg.id}</span>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold font-mono ${pkg.enabled ? 'bg-emerald-500/20 text-emerald-305 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {pkg.enabled ? "Active" : "Disabled"}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs font-mono text-neutral-400 border-t border-b border-neutral-850 py-3">
                    <p>⚡ Panels: <strong className="text-neutral-200">{pkg.panelBrand}</strong></p>
                    <p>🔋 Inverter: <strong className="text-neutral-200">{pkg.inverterBrand}</strong></p>
                    <p>📦 Batteries: <strong className="text-neutral-200">{pkg.batteryOption}</strong></p>
                    <p>🏠 Structure: <strong className="text-neutral-200">{pkg.structureType}</strong></p>
                    <p>💸 profitMargin: <strong className="text-indigo-400">{pkg.profitMargin * 100}%</strong></p>
                    <p className="text-sm font-bold text-neutral-100 pt-1">
                      💸 Man-Price: <span className="text-amber-400">{currencySymbol}{pkg.price.toLocaleString()}</span>
                    </p>
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <button
                      onClick={() => setEditingPkg(pkg)}
                      className="bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 px-3 py-1.5 rounded-xl cursor-pointer font-sans"
                    >
                      Change Configuration
                    </button>
                    <button
                      onClick={() => {
                        const updated = { ...pkg, enabled: !pkg.enabled };
                        saveDbChange("edit", "solarPackages", updated, pkg.id);
                      }}
                      className={`text-[10px] font-bold py-1 px-3.5 rounded-xl cursor-pointer ${pkg.enabled ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}
                    >
                      {pkg.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick Edit Config Panel */}
            {editingPkg && (
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-4">
                <h4 className="text-xs font-black text-amber-400 uppercase tracking-widest font-mono">Editing Configuration: {editingPkg.name}</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-sans">
                  <div>
                    <label className="text-neutral-400 block mb-1">Package Display Title</label>
                    <input 
                      type="text"
                      value={editingPkg.name}
                      onChange={(e) => setEditingPkg({ ...editingPkg, name: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Panel Brand</label>
                    <input 
                      type="text"
                      value={editingPkg.panelBrand}
                      onChange={(e) => setEditingPkg({ ...editingPkg, panelBrand: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Inverter Brand</label>
                    <input 
                      type="text"
                      value={editingPkg.inverterBrand}
                      onChange={(e) => setEditingPkg({ ...editingPkg, inverterBrand: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Battery Storage</label>
                    <input 
                      type="text"
                      value={editingPkg.batteryOption}
                      onChange={(e) => setEditingPkg({ ...editingPkg, batteryOption: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Price Override ({currencySymbol.trim()})</label>
                    <input 
                      type="number"
                      value={editingPkg.price}
                      onChange={(e) => setEditingPkg({ ...editingPkg, price: Number(e.target.value) })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs text-amber-350 font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Structure Installation type</label>
                    <input 
                      type="text"
                      value={editingPkg.structureType}
                      onChange={(e) => setEditingPkg({ ...editingPkg, structureType: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-205 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Target Margin ratio</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={editingPkg.profitMargin}
                      onChange={(e) => setEditingPkg({ ...editingPkg, profitMargin: Number(e.target.value) })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                    />
                  </div>
                  <div className="flex items-end text-xs gap-2 shrink-0">
                    <button
                      onClick={() => {
                        saveDbChange("edit", "solarPackages", editingPkg, editingPkg.id);
                        setEditingPkg(null);
                      }}
                      className="flex-1 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2 rounded-xl transition cursor-pointer"
                    >
                      Save Configuration
                    </button>
                    <button
                      onClick={() => setEditingPkg(null)}
                      className="bg-neutral-800 text-neutral-300 hover:bg-neutral-700 px-3.5 py-2 rounded-xl"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ----------------------------------------------------
            3. QUOTATIONS TAB
            ---------------------------------------------------- */}
        {innerSubTab === "quotations" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 font-mono">Manual Quotation Designer</h3>
              <p className="text-[10px] text-neutral-450 font-mono">Authorize bespoke project estimates</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Form panel to create quote */}
              <div className="lg:col-span-5 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4 text-xs font-sans">
                <h4 className="text-xs font-black text-amber-400 font-mono border-b border-neutral-850 pb-2">Manual Quote Builder</h4>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-neutral-400 block mb-1">Select Customer Lead Profile ID</label>
                    <select
                      value={selectedLeadId}
                      onChange={(e) => setSelectedLeadId(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                    >
                      {leads.map(lead => (
                        <option key={lead.id} value={lead.id}>[{lead.id}] {lead.name} ({lead.email})</option>
                      ))}
                    </select>
                  </div>

                  {/* Add manual product item row selection */}
                  <div>
                    <label className="text-neutral-400 block mb-1">Add Line Item from Catalog</label>
                    <div className="flex gap-2">
                      <select
                        id="quote-item-sel"
                        className="flex-1 bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                      >
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({currencySymbol}{p.price})</option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          const selectEl = document.getElementById("quote-item-sel") as HTMLSelectElement;
                          const selectedId = selectEl.value;
                          const matchedItem = products.find(p => p.id === selectedId);
                          if (matchedItem) {
                            const duplicate = quoteItems.find(item => item.productId === matchedItem.id);
                            if (duplicate) {
                              setQuoteItems(quoteItems.map(it => it.productId === matchedItem.id ? { ...it, qty: it.qty + 1 } : it));
                            } else {
                              setQuoteItems([...quoteItems, { productId: matchedItem.id, name: matchedItem.name, qty: 1, price: matchedItem.price }]);
                            }
                          }
                        }}
                        className="bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold px-4 py-2 rounded-xl"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Items list */}
                  {quoteItems.length > 0 && (
                    <div className="bg-neutral-950 border border-neutral-850 rounded-xl p-3.5 space-y-2 font-mono">
                      <span className="text-[10px] text-neutral-405 uppercase font-bold">Line Items List:</span>
                      {quoteItems.map((item, index) => (
                        <div key={item.productId} className="flex justify-between items-center text-[11px] hover:bg-neutral-900/40 py-1 rounded">
                          <span className="text-neutral-300 truncate max-w-[150px]">{item.name}</span>
                          <div className="flex items-center gap-2">
                            <input 
                              type="number" 
                              min="1"
                              value={item.qty}
                              onChange={(e) => setQuoteItems(quoteItems.map((it, i) => i === index ? { ...it, qty: Number(e.target.value) } : it))}
                              className="w-10 text-center bg-neutral-900 border border-neutral-800 text-neutral-100 rounded"
                            />
                            <span className="text-amber-450">{currencySymbol}{item.price * item.qty}</span>
                            <button
                              onClick={() => setQuoteItems(quoteItems.filter((_, i) => i !== index))}
                              className="text-rose-400 hover:bg-neutral-800 p-1 rounded"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-neutral-400 block mb-1">Applied Discount ({currencySymbol.trim()})</label>
                      <input 
                        type="number"
                        min="0"
                        value={quoteDiscount}
                        onChange={(e) => setQuoteDiscount(Number(e.target.value))}
                        className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-neutral-400 block mb-1">Payment terms / milestones</label>
                      <input 
                        type="text"
                        value={quoteTerms}
                        onChange={(e) => setQuoteTerms(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-205 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2.5 pt-2">
                    <button
                      onClick={() => {
                        const targetLead = leads.find(l => l.id === selectedLeadId);
                        if (!targetLead) return;
                        
                        const subTotal = quoteItems.reduce((acc, curr) => acc + (curr.price * curr.qty), 0);
                        const netCost = subTotal - quoteDiscount;
                        const fedCredit = Math.floor(netCost * 0.30);
                        
                        const quotePayload = {
                          id: `QT-${Date.now().toString().slice(-4)}`,
                          systemSizekW: 10, panelCount: 25, panelType: "Canadian premium", inverterType: "Enphase micro",
                          batteryCapacity: "Tesla raw", totalCost: subTotal, federalTaxCredit: fedCredit,
                          netCost: netCost - fedCredit, estimatedAnnualSavings: 2400, paybackPeriodYears: 5.2,
                          status: 'Accepted' as const, createdAt: new Date().toISOString()
                        };
                        setQuotePreview({ ...quotePayload, customer: targetLead, lines: quoteItems, discount: quoteDiscount, terms: quoteTerms });
                      }}
                      disabled={quoteItems.length === 0}
                      className="flex-1 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black py-2.5 rounded-xl transition cursor-pointer disabled:opacity-40"
                    >
                      Process & Preview Sizing Quote
                    </button>
                  </div>
                </div>
              </div>

              {/* Quotation Invoice Preview */}
              <div className="lg:col-span-7 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-bold text-neutral-400 font-mono border-b border-neutral-850 pb-2">Quote Presentation Board</h4>
                  
                  {quotePreview ? (
                    <div id="invoice-bill" className="bg-neutral-950 border border-neutral-850 p-6 rounded-xl space-y-4 text-xs font-mono">
                      <div className="flex justify-between border-b border-neutral-800 pb-3">
                        <div>
                          <h5 className="font-sans font-bold text-neutral-100 text-sm">Sunchaser Quotation Service</h5>
                          <p className="text-[10px] text-slate-500">{sysSettings.phoneNumber || "+1 555-sunchaser"}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-amber-400 font-extrabold">{quotePreview.id}</p>
                          <p className="text-[10px] text-zinc-500">Date: {quotePreview.createdAt.slice(0,10)}</p>
                        </div>
                      </div>

                      <div className="text-[11px] text-neutral-355 leading-relaxed">
                        <strong className="text-neutral-300">Client Recipient:</strong>
                        <p>{quotePreview.customer.name}</p>
                        <p>{quotePreview.customer.address} ({quotePreview.customer.phone})</p>
                      </div>

                      <div className="border-t border-b border-neutral-850 py-3 space-y-2">
                        <div className="flex justify-between text-[10px] text-slate-500 pb-1.5 font-bold">
                          <span>Product Element details</span>
                          <span>Quantity x Price</span>
                          <span>Sum</span>
                        </div>
                        {quotePreview.lines.map((li: any) => (
                          <div key={li.productId} className="flex justify-between text-neutral-200">
                            <span className="truncate max-w-[200px]">{li.name}</span>
                            <span>{li.qty} x {currencySymbol}{li.price}</span>
                            <span className="font-bold text-neutral-100">{currencySymbol}{li.qty * li.price}</span>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-1 align-right text-right border-b border-neutral-850 pb-3">
                        <p className="text-neutral-400 text-[10px]">Sub-Total Price: {currencySymbol}{quotePreview.totalCost.toLocaleString()}</p>
                        {quotePreview.discount > 0 && <p className="text-emerald-500 text-[10px]">Discount Adjuster: -{currencySymbol}{quotePreview.discount.toLocaleString()}</p>}
                        <p className="text-[10px] text-indigo-400">Federal Tax Incentive Refund (Est 30%): -{currencySymbol}{quotePreview.federalTaxCredit.toLocaleString()}</p>
                        <p className="text-sm font-black text-amber-455 text-amber-450 pt-1">Bespoke Enterprise Quote Price: {currencySymbol}{quotePreview.netCost.toLocaleString()}</p>
                      </div>

                      <div className="text-[10px] text-zinc-500 leading-normal">
                        <strong>Milestone Terms:</strong>
                        <p>{quotePreview.terms}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="py-20 text-center text-neutral-500 text-xs">
                      Build Quote using LHS inputs to render active Presentation.
                    </div>
                  )}
                </div>

                {quotePreview && (
                  <div className="flex gap-2 pt-4">
                    <button
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(quotePreview, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `SUNCHASER_QUOTE_${quotePreview.id}.txt`;
                        a.click();
                        alert("Bespoke Quotation Document successfully compiled as enterprise PDF-compatible text format.");
                      }}
                      className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-250 border border-neutral-700 font-bold py-2 rounded-xl text-neutral-200 text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <Download className="h-4.5 w-4.5" /> Download Quotation Document
                    </button>
                    <button
                      onClick={() => {
                        saveDbChange("add", "quotations", quotePreview);
                        alert(`Dispatched quotation alert to client via Sunchaser WhatsApp API gateway: ${quotePreview.customer.phone}.`);
                      }}
                      className="bg-emerald-600 hover:bg-emerald-555 text-neutral-950 font-bold px-5 py-2 rounded-xl text-xs flex items-center justify-center gap-1 text-white"
                    >
                      <Send className="h-4 w-4" /> Send via WhatsApp
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {innerSubTab === "customers" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 font-mono">Customer Base Directory</h3>
              <div className="flex items-center gap-2">
                <input 
                  type="text"
                  placeholder="Search customer name or email..."
                  value={custSearch}
                  onChange={(e) => setCustSearch(e.target.value)}
                  className="bg-neutral-900 border border-neutral-805 px-3 py-1.5 rounded-xl text-neutral-200 font-mono text-[11px] focus:outline-none focus:border-amber-500 w-[240px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Add / Modify Customer */}
              <div className="lg:col-span-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4 text-xs font-sans">
                <h4 className="text-xs font-bold text-amber-400 font-mono">{editingCust ? "Edit Customer Record" : "Add New Customer"}</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-neutral-400 block mb-1">Full Name</label>
                    <input 
                      type="text"
                      placeholder="e.g. John Miller"
                      value={editingCust ? editingCust.name : newCust.name}
                      onChange={(e) => editingCust 
                        ? setEditingCust({ ...editingCust, name: e.target.value })
                        : setNewCust({ ...newCust, name: e.target.value })
                      }
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Email Address</label>
                    <input 
                      type="email"
                      placeholder="john@example.com"
                      value={editingCust ? editingCust.email : newCust.email}
                      onChange={(e) => editingCust 
                        ? setEditingCust({ ...editingCust, email: e.target.value })
                        : setNewCust({ ...newCust, email: e.target.value })
                      }
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-slate-100 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Phone Number</label>
                    <input 
                      type="text"
                      placeholder="+1 (555) 000-0000"
                      value={editingCust ? editingCust.phone : newCust.phone}
                      onChange={(e) => editingCust 
                        ? setEditingCust({ ...editingCust, phone: e.target.value })
                        : setNewCust({ ...newCust, phone: e.target.value })
                      }
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Installation Address</label>
                    <input 
                      type="text"
                      placeholder="123 Main St..."
                      value={editingCust ? editingCust.address : newCust.address}
                      onChange={(e) => editingCust 
                        ? setEditingCust({ ...editingCust, address: e.target.value })
                        : setNewCust({ ...newCust, address: e.target.value })
                      }
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 text-xs"
                    />
                  </div>

                  <div className="flex gap-2">
                    {editingCust ? (
                      <>
                        <button
                          onClick={() => {
                            saveDbChange("edit", "leads", editingCust, editingCust.id);
                            setEditingCust(null);
                          }}
                          className="flex-1 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2 rounded-xl transition cursor-pointer"
                        >
                          Modify Account
                        </button>
                        <button
                          onClick={() => setEditingCust(null)}
                          className="px-3 bg-neutral-800 text-neutral-200 hover:bg-neutral-700/50 rounded-xl"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          const id = `lead-${Date.now().toString().slice(-4)}`;
                          const payload: Partial<Lead> = {
                            id,
                            name: newCust.name || "Sunchaser Client",
                            email: newCust.email || "client@sunchaser.com",
                            phone: newCust.phone || "555-0101",
                            address: newCust.address,
                            status: "New",
                            roofSpace: newCust.roofSpace,
                            shading: newCust.shading,
                            rating: 3,
                            assignedSalesperson: "Sarah Connor",
                            quotes: [],
                            createdAt: new Date().toISOString(),
                            notes: newCust.notes
                          };
                          saveDbChange("add", "leads", payload);
                          setNewCust({
                            name: "", email: "", phone: "", address: "", notes: "", monthlyBill: 150, roofSpace: 120, shading: "Low" as const
                          });
                        }}
                        disabled={!newCust.name}
                        className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2 rounded-xl transition cursor-pointer disabled:opacity-40"
                      >
                        Create Account
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Customers Directory & History drilldown */}
              <div className="lg:col-span-8 space-y-6">
                <div className="bg-neutral-900 border border-neutral-805 rounded-2xl p-5 overflow-x-auto text-[11px] font-mono">
                  <table className="w-full text-left table-auto">
                    <thead>
                      <tr className="border-b border-slate-800 text-neutral-450 font-bold">
                        <th className="py-2 px-3">Lead ID</th>
                        <th className="py-2 px-3">Name</th>
                        <th className="py-2 px-3">Email & Contact</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads
                        .filter(l => l.name.toLowerCase().includes(custSearch.toLowerCase()) || l.email.toLowerCase().includes(custSearch.toLowerCase()))
                        .map(l => (
                          <tr key={l.id} className="border-b border-neutral-850 hover:bg-neutral-800/20 text-neutral-300">
                            <td className="py-2 px-3">
                              <span className="font-bold bg-neutral-800 text-indigo-400 px-2 py-0.5 rounded text-[10px]">{l.id}</span>
                            </td>
                            <td className="py-2 px-3 font-sans font-bold text-neutral-100">{l.name}</td>
                            <td className="py-2 px-3">
                              <div>{l.email}</div>
                              <div className="text-neutral-450 tracking-wider text-[10px]">{l.phone}</div>
                            </td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                l.status === 'Won' || l.status === 'Installed' 
                                  ? 'bg-emerald-500/25 text-emerald-400' 
                                  : 'bg-neutral-800 text-neutral-300'
                              }`}>{l.status}</span>
                            </td>
                            <td className="py-2 px-3 text-right space-x-1 shrink-0">
                              <button
                                onClick={() => setDrilldownCust(l)}
                                className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-2 py-1 rounded text-amber-300 text-[10px] cursor-pointer"
                              >
                                View History
                              </button>
                              <button
                                onClick={() => setEditingCust(l)}
                                className="bg-neutral-800 hover:bg-neutral-750 p-1.5 rounded cursor-pointer"
                              >
                                <Edit3 className="h-3 w-3 text-neutral-300 inline" />
                              </button>
                              {onDeleteLead && (
                                <button
                                  onClick={() => {
                                    if (window.confirm("Delete this lead?")) {
                                      onDeleteLead(l.id);
                                    }
                                  }}
                                  className="bg-red-950/40 hover:bg-red-900/60 border border-red-900/40 p-1.5 rounded cursor-pointer text-red-400"
                                  title="Delete Lead"
                                >
                                  <Trash2 className="h-3 w-3 inline" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {showDeletedLeads && (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3">
                    <h4 className="text-xs font-black text-rose-400 uppercase tracking-widest font-mono">Deleted Leads (Recovery)</h4>
                    {deletedLeadsLoading ? (
                      <p className="text-neutral-500 text-xs">Loading deleted leads…</p>
                    ) : deletedLeads.length === 0 ? (
                      <p className="text-neutral-500 text-xs">No soft-deleted leads.</p>
                    ) : (
                      <table className="w-full text-left text-[11px] font-mono">
                        <thead>
                          <tr className="border-b border-neutral-800 text-neutral-450">
                            <th className="py-2 px-2">Name</th>
                            <th className="py-2 px-2">Deleted At</th>
                            <th className="py-2 px-2">By</th>
                            <th className="py-2 px-2 text-right">Restore</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deletedLeads.map((dl) => (
                            <tr key={dl.id} className="border-b border-neutral-850 text-neutral-300">
                              <td className="py-2 px-2">{dl.name} <span className="text-neutral-500">({dl.id})</span></td>
                              <td className="py-2 px-2">{dl.deletedAt ? new Date(dl.deletedAt).toLocaleString() : "—"}</td>
                              <td className="py-2 px-2">{dl.deletedBy || "—"}</td>
                              <td className="py-2 px-2 text-right">
                                <button
                                  type="button"
                                  className="bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-2 py-1 rounded text-emerald-300 text-[10px] cursor-pointer"
                                  onClick={async () => {
                                    await restoreLead(dl.id, staffUser.id, staffUser.username, staffUser.role);
                                    onRefreshState();
                                  }}
                                >
                                  Restore
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* Drilldown History logs */}
                {drilldownCust && (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4 font-sans anim-fade-in text-xs">
                    <div className="flex justify-between items-center border-b border-neutral-800 pb-2">
                      <h4 className="text-xs font-black text-amber-400 uppercase tracking-widest font-mono">
                        Enterprise Log History: {drilldownCust.name}
                      </h4>
                      <button onClick={() => setDrilldownCust(null)} className="text-neutral-400 hover:text-neutral-200">
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {drilldownCust && (
                      <CustomerInvitationPanel
                        customerName={drilldownCust.name}
                        customerCode={drilldownCustomerRecord?.customerCode}
                        phone={drilldownCust.phone}
                        compact
                      />
                    )}

                    <WhatsAppModule
                      staffUser={staffUser}
                      preset="customer"
                      phone={drilldownCust.phone}
                      onPhonePersist={(p) => {
                        const lead = leads.find((l) => l.id === drilldownCust.id);
                        if (lead) {
                          fetch(`${API_BASE_URL}/api/leads/${lead.id}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ...lead, phone: p }),
                          }).then(() => onRefreshState());
                        }
                      }}
                      customerName={drilldownCust.name}
                      leadId={drilldownCust.id}
                      customerId={`cust-${drilldownCust.id.replace(/^lead-/, "")}`}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
                      {/* Sub card A: Orders and projects tracker */}
                      <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-850 space-y-2">
                        <span className="text-[10px] text-indigo-400 uppercase font-black tracking-wider block">Completed Orders</span>
                        {orders.filter(o => o.customerName === drilldownCust.name || o.email === drilldownCust.email).length > 0 ? (
                          orders.filter(o => o.customerName === drilldownCust.name || o.email === drilldownCust.email).map((o: any) => (
                            <div key={o.id} className="text-[11px] text-neutral-300 border-b border-neutral-900 pb-1 last:border-0">
                              <p className="font-bold flex justify-between">{o.id} <span>{currencySymbol}{o.totalCost}</span></p>
                              <p className="text-[10px] text-zinc-550 italic">Status: {o.status}</p>
                            </div>
                          ))
                        ) : (
                          <div className="text-neutral-500 italic text-[11px] pt-1">No past multi-business orders.</div>
                        )}
                      </div>

                      {/* Sub card B: Complaints ticket */}
                      <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-850 space-y-2">
                        <span className="text-[10px] text-pink-400 uppercase font-black tracking-wider block">Maintenance Tickets</span>
                        {tickets.filter(t => t.customerName === drilldownCust.name || t.email === drilldownCust.email).length > 0 ? (
                          tickets.filter(t => t.customerName === drilldownCust.name || t.email === drilldownCust.email).map(t => (
                            <div key={t.id} className="text-[11px] text-neutral-300 border-b border-neutral-900 pb-1 last:border-0">
                              <p className="font-bold truncate">{t.subject}</p>
                              <p className="text-[10px] text-grey-500 italic">Status: <strong className="text-amber-450">{t.status}</strong></p>
                            </div>
                          ))
                        ) : (
                          <div className="text-zinc-500 italic text-[11px] pt-1">No recorded complaints tickets.</div>
                        )}
                      </div>

                      {/* Sub card C: Warranties & Payments summary */}
                      <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-850 space-y-2">
                        <span className="text-[10px] text-emerald-405 uppercase font-black block">Warranties Coverage</span>
                        {warranties.filter(w => w.customerName === drilldownCust.name || w.email === drilldownCust.email).length > 0 ? (
                          warranties.filter(w => w.customerName === drilldownCust.name || w.email === drilldownCust.email).map((w: any) => (
                            <div key={w.id} className="text-[11px] text-neutral-305 border-b border-neutral-900 pb-1 last:border-0 pb-1">
                              <p className="font-sans font-bold">{w.productName}</p>
                              <p className="text-[9px] text-slate-550">Expires: {w.endDate.slice(0,10)}</p>
                            </div>
                          ))
                        ) : (
                          <div className="text-neutral-500 italic text-[11px] pt-1">No active warrants registered.</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------
            5. ORDERS MANAGEMENT TAB
            ---------------------------------------------------- */}
        {innerSubTab === "customer-linking" && (
          <CustomerLinkingStaff staffUser={staffUser} />
        )}

        {/* ----------------------------------------------------
            5. ORDERS MANAGEMENT TAB
            ---------------------------------------------------- */}
        {innerSubTab === "orders" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 font-mono">Manual Order Pipeline Manager</h3>
              <p className="text-[10px] text-neutral-450 font-mono">Create and direct individual client orders</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Order form */}
              <div className="lg:col-span-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4 text-xs font-sans">
                <h4 className="text-xs font-bold text-amber-500 font-mono">Create Manual Order</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-neutral-400 block mb-1">Customer Identifier Name</label>
                    <input 
                      type="text"
                      placeholder="e.g. John Miller"
                      value={newOrder.customerName}
                      onChange={(e) => setNewOrder({ ...newOrder, customerName: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-neutral-400 block mb-1">Email</label>
                      <input 
                        type="email"
                        placeholder="john@gmail.com"
                        value={newOrder.email}
                        onChange={(e) => setNewOrder({ ...newOrder, email: e.target.value })}
                        className="w-full bg-neutral-950 border border-neutral-800 px-2 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-neutral-400 block mb-1">Mobile Line</label>
                      <input 
                        type="text"
                        placeholder="555-3211"
                        value={newOrder.phone}
                        onChange={(e) => setNewOrder({ ...newOrder, phone: e.target.value })}
                        className="w-full bg-neutral-950 border border-neutral-800 px-2 py-2 rounded-xl text-neutral-200 font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Location Address</label>
                    <input 
                      type="text"
                      placeholder="Street address..."
                      value={newOrder.address}
                      onChange={(e) => setNewOrder({ ...newOrder, address: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-slate-200 text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-neutral-400 block mb-1">Hardware Item SKU</label>
                      <select
                        onChange={(e) => {
                          const pId = e.target.value;
                          const p = products.find(prod => prod.id === pId);
                          if (p) {
                            setNewOrder({
                              ...newOrder,
                              items: [{ productId: p.id, productName: p.name, quantity: 1, price: p.price }],
                              totalCost: p.price
                            });
                          }
                        }}
                        className="w-full bg-neutral-950 border border-neutral-800 px-3 py-1.5 rounded-xl text-neutral-100 font-mono text-xs"
                      >
                        {products.map(p => (
                          <option key={p.id} value={p.id}>[{p.sku}] {p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-neutral-400 block mb-1">Est cost ({currencySymbol.trim()})</label>
                      <div className="bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 text-xs font-mono font-bold">
                        {currencySymbol}{newOrder.totalCost}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      saveDbChange("add", "orders", {
                        ...newOrder,
                        id: `ORD-${Date.now().toString().slice(-4)}`,
                        createdAt: new Date().toISOString(),
                      });
                      setNewOrder({
                        customerName: "", email: "", phone: "", address: "", orderType: "Product", status: "Pending",
                        items: [{ productId: "p-400", productName: "Canadian Solar 400W", quantity: 10, price: 320 }], totalCost: 3200
                      });
                    }}
                    disabled={!newOrder.customerName}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2.5 rounded-xl transition cursor-pointer disabled:opacity-40"
                  >
                    Deploy Manual Client Order
                  </button>
                </div>
              </div>

              {/* Orders table list */}
              <div className="lg:col-span-8 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 overflow-x-auto text-[11px] font-mono">
                <table className="w-full text-left table-auto">
                  <thead>
                    <tr className="border-b border-neutral-800 text-slate-400 font-bold pb-2">
                      <th className="py-2.5 px-3">Order ID</th>
                      <th className="py-2.5 px-3">Customer Client</th>
                      <th className="py-2.5 px-3">Order Specs Type</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Man-Update</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-b border-neutral-850 hover:bg-neutral-800/20 text-neutral-200">
                        <td className="py-2.5 px-3 text-indigo-400 font-bold">{o.id}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-sans font-bold text-neutral-100">{o.customerName}</div>
                          <div className="text-[9px] text-zinc-500">{o.address}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <p className="text-zinc-300 truncate max-w-[150px]">
                            {o.items?.map((it: any) => `${it.quantity}x ${it.productName}`).join(", ") || "Components Block"}
                          </p>
                          <span className="text-amber-450 font-bold">{currencySymbol}{o.totalCost?.toLocaleString()}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                            o.status === "Delivered" ? "bg-emerald-500/20 text-emerald-400" : "bg-neutral-800 text-neutral-300"
                          }`}>{o.status}</span>
                        </td>
                        <td className="py-2 px-3 text-right shrink-0">
                          <select
                            value={o.status}
                            onChange={(e) => {
                              const s = e.target.value;
                              saveDbChange("edit", "orders", { status: s }, o.id);
                            }}
                            className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-[10px] text-neutral-300 cursor-pointer"
                          >
                            <option value="Pending">Pending</option>
                            <option value="Processing">Processing</option>
                            <option value="Dispatched">Dispatched</option>
                            <option value="Delivered">Delivered</option>
                            <option value="Installed">Installed</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------
            6. COMPLAINTS & CASE TICKETS TAB
            ---------------------------------------------------- */}
        {innerSubTab === "tickets" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 font-mono">Critical Performance Complaints Center</h3>
              <p className="text-[10px] text-neutral-450 font-mono">Dispatch installation mechanics and direct resolution notes</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left hand list of cases */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4 text-xs">
                <span className="text-neutral-400 font-mono block font-bold border-b border-neutral-850 pb-2">Active Field Complaints:</span>
                
                <div className="space-y-3 font-mono">
                  {tickets.map(t => (
                    <div 
                      key={t.id} 
                      onClick={() => setEditingTicket(t)}
                      className={`border p-3.5 rounded-xl cursor-pointer transition ${editingTicket?.id === t.id ? 'border-amber-500' : 'border-neutral-850 bg-neutral-950/50 hover:bg-neutral-800/10'}`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[9px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-350">{t.id}</span>
                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${t.priority === "High" ? "bg-rose-500/20 text-rose-300" : "bg-neutral-800 text-neutral-450"}`}>{t.priority}</span>
                      </div>
                      <h4 className="font-sans font-bold text-neutral-100 mt-1">{t.subject}</h4>
                      <p className="text-[11px] text-neutral-400 italic">"{t.customerName}" • {t.status}</p>
                      {t.assignedTechnician && <p className="text-[10px] text-indigo-400 font-bold mt-1">Mechanic: {t.assignedTechnician}</p>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Ticket operations center */}
              <div className="bg-neutral-900 border border-neutral-805 rounded-2xl p-5 space-y-4 text-xs font-sans">
                <span className="text-amber-450 font-mono block font-bold uppercase tracking-wider border-b border-neutral-850 pb-2">Diagnostic Action console</span>
                
                {editingTicket ? (
                  <div className="space-y-3 font-mono">
                    <div>
                      <strong className="text-neutral-200">{editingTicket.subject}</strong>
                      <p className="text-neutral-450 font-sans mt-1">"{editingTicket.description}"</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <div>
                        <label className="text-neutral-400 block mb-1 font-sans">Delegate Field Technician</label>
                        <select
                          value={editingTicket.assignedTechnician || ""}
                          onChange={(e) => setEditingTicket({ ...editingTicket, assignedTechnician: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-250 font-sans text-neutral-100"
                        >
                          <option value="">-- Choose Staff --</option>
                          <option value="Dave Installer">Dave Installer (Senior Elec)</option>
                          <option value="Bob Surveyor">Bob Surveyor (Civil Structural)</option>
                          <option value="Sarah Manager">Sarah Manager (Sales Ops)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-neutral-400 block mb-1 font-sans">Diagnosis status</label>
                        <select
                          value={editingTicket.status}
                          onChange={(e) => setEditingTicket({ ...editingTicket, status: e.target.value as any })}
                          className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-100 font-sans"
                        >
                          <option value="Open">Open</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Technician Assigned">Technician Assigned</option>
                          <option value="Visit Scheduled">Visit Scheduled</option>
                          <option value="Resolved">Resolved</option>
                          <option value="Closed">Closed</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-neutral-400 block font-sans">Internal Dispatch case Notes</label>
                      <textarea
                        rows={3}
                        value={editingTicket.internalNotes || ""}
                        onChange={(e) => setEditingTicket({ ...editingTicket, internalNotes: e.target.value })}
                        className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200"
                        placeholder="Detail mechanical analysis, battery voltage reports, load testing variables..."
                      />
                    </div>

                    <div className="flex gap-2.5 pt-2">
                      <button
                        onClick={() => {
                          saveDbChange("edit", "tickets", editingTicket, editingTicket.id);
                          setEditingTicket(null);
                        }}
                        className="flex-1 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black py-2.5 rounded-xl cursor-pointer"
                      >
                        Commit Case Resolution Update
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="py-24 text-center text-neutral-500 italic">
                    Select active ticket on LHS to direct field team dispatches.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------
            7. STOCKS & INVENTORY MARGINS TAB
            ---------------------------------------------------- */}
        {innerSubTab === "inventory" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 font-mono">Sunchaser hardware Stock & Margins</h3>
              <p className="text-[10px] text-neutral-450 font-mono">Gross profit analytics based on wholesale prices</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-mono mb-4 text-center">
              <div className="bg-neutral-900 p-4 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-slate-500 uppercase">Total Inventory Value</span>
                <p className="text-md font-bold text-neutral-100 mt-1">
                  {currencySymbol}{inventory.reduce((sum, item) => sum + (item.stock * item.cost), 0).toLocaleString()} <span className="text-[10px] font-sans text-neutral-400">{currencySymbol === "Rs." ? "PKR" : "USD"}</span>
                </p>
              </div>
              <div className="bg-neutral-900 p-4 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-indigo-400 uppercase">Low Stock SKUs</span>
                <p className="text-md font-bold text-rose-450 mt-1 text-rose-400">
                  {inventory.filter(i => i.stock < 150).length} of {inventory.length} Warned
                </p>
              </div>
              <div className="bg-neutral-900 p-4 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-amber-500 uppercase">Total Procurement POs</span>
                <p className="text-md font-bold text-neutral-100 mt-1">
                  {inventory.reduce((sum, item) => sum + item.stock, 0).toLocaleString()} Parts
                </p>
              </div>
              <div className="bg-neutral-900 p-4 border border-slate-800 rounded-2xl">
                <span className="text-[10px] text-emerald-400 uppercase">Avg Gross profit margin</span>
                <p className="text-md font-bold text-emerald-400 mt-1">
                  ~34.5% Secured
                </p>
              </div>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 overflow-x-auto text-xs font-mono">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-neutral-800 text-slate-550 font-bold pb-2">
                    <th className="py-2.5 px-3">SKU</th>
                    <th className="py-2.5 px-3">Hardware Part Name</th>
                    <th className="py-2.5 px-3">Current Stock</th>
                    <th className="py-2.5 px-3">Wholesale Buy Cost</th>
                    <th className="py-2.5 px-3">Safety Low-Stock limit</th>
                    <th className="py-2 px-3 text-right">Instant Restock</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((item) => (
                    <tr key={item.id} className="border-b border-neutral-850 hover:bg-neutral-800/10 text-neutral-200">
                      <td className="py-2.5 px-3">
                        <span className="bg-neutral-850 px-2.5 py-0.5 rounded text-neutral-400">{item.id}</span>
                      </td>
                      <td className="py-2.5 px-3 font-sans">
                        <strong className="text-neutral-100 leading-wider block text-xs">{item.name}</strong>
                        <span className="text-[10px] text-slate-500 font-mono uppercase">{item.category}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.stock < 100 ? 'bg-rose-500/20 text-rose-400 animate-pulse' : 'bg-neutral-800 text-neutral-300'}`}>
                          {item.stock} Units
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-neutral-300 font-bold">{currencySymbol}{item.cost}</td>
                      <td className="py-2.5 px-3">
                        <span className="text-slate-450 text-[10px]">Low stock trigger alert: 150</span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => {
                            const addAmount = Number(prompt(`Specify authorization quantity to add for Part SKU ${item.id}:`, "100"));
                            if (addAmount && !isNaN(addAmount)) {
                              const updated = { ...item, stock: item.stock + addAmount };
                              saveDbChange("edit", "inventory", updated, item.id);
                            }
                          }}
                          className="bg-amber-500 hover:bg-amber-400 font-bold text-neutral-950 px-3 py-1 rounded text-[10px] cursor-pointer"
                        >
                          + restock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------
            8. CMS & WEBSITE CONTENT TAB
            ---------------------------------------------------- */}
        {innerSubTab === "cms" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 font-mono">CMS Mobile App & Web Content Manager</h3>
              <p className="text-[10px] text-neutral-450 font-mono">Configure homestay marketing banners and blogs dynamically</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs font-sans">
              {/* Homepage Banners Edit Container */}
              <div className="lg:col-span-6 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
                <span className="text-xs font-black text-amber-400 font-mono block uppercase border-b border-neutral-850 pb-2">Active Landing Banners</span>
                
                {(webCMS.banners || []).map((b: any, idx: number) => (
                  <div key={b.id || idx} className="bg-neutral-950 border border-neutral-850 p-4 rounded-xl space-y-2 text-xs">
                    <p className="font-mono text-[9px] text-slate-500">Banner Element #{idx+1} [ID: {b.id}]</p>
                    <div className="space-y-2">
                      <input 
                        type="text"
                        value={b.title}
                        onChange={(e) => {
                          const list = [...webCMS.banners];
                          list[idx].title = e.target.value;
                          setWebCMS({ ...webCMS, banners: list });
                        }}
                        placeholder="Banner Title Heading"
                        className="w-full bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg text-slate-100 font-mono font-bold"
                      />
                      <input 
                        type="text"
                        value={b.subtitle}
                        onChange={(e) => {
                          const list = [...webCMS.banners];
                          list[idx].subtitle = e.target.value;
                          setWebCMS({ ...webCMS, banners: list });
                        }}
                        placeholder="Sub header detail text"
                        className="w-full bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg text-slate-300"
                      />
                      <input 
                        type="text"
                        value={b.image}
                        onChange={(e) => {
                          const list = [...webCMS.banners];
                          list[idx].image = e.target.value;
                          setWebCMS({ ...webCMS, banners: list });
                        }}
                        placeholder="Visual picture link url"
                        className="w-full bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg text-neutral-400 font-mono text-[10px]"
                      />
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => {
                    saveDbChange("update_raw", "websiteContent", webCMS);
                  }}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2 rounded-xl transition cursor-pointer"
                >
                  Confirm CMS Banners Changes
                </button>
              </div>

              {/* Promotions, FAQs & Areas CMS panel */}
              <div className="lg:col-span-6 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
                <span className="text-xs font-black text-amber-400 font-mono block uppercase border-b border-neutral-850 pb-2">Promo, FAQS & Testimonials</span>

                {/* Promotions section */}
                <div className="space-y-2">
                  <span className="text-[10px] uppercase font-mono font-bold text-slate-400">Promotions Offers discount:</span>
                  {(webCMS.promotions || []).map((p: any, idx: number) => (
                    <div key={p.id} className="grid grid-cols-3 gap-2">
                      <input 
                        type="text"
                        value={p.title}
                        onChange={(e) => {
                          const list = [...webCMS.promotions];
                          list[idx].title = e.target.value;
                          setWebCMS({ ...webCMS, promotions: list });
                        }}
                        placeholder="Promo label"
                        className="bg-neutral-950 border border-neutral-800 px-2 py-1 rounded text-[11px]"
                      />
                      <input 
                        type="text"
                        value={p.code}
                        onChange={(e) => {
                          const list = [...webCMS.promotions];
                          list[idx].code = e.target.value;
                          setWebCMS({ ...webCMS, promotions: list });
                        }}
                        placeholder="CODE"
                        className="bg-neutral-950 border border-neutral-800 px-2 py-1 rounded font-mono text-xs text-amber-400"
                      />
                      <input 
                        type="text"
                        value={p.discount}
                        onChange={(e) => {
                          const list = [...webCMS.promotions];
                          list[idx].discount = e.target.value;
                          setWebCMS({ ...webCMS, promotions: list });
                        }}
                        placeholder="ITC Value"
                        className="bg-neutral-950 border border-neutral-800 px-2 py-1 rounded text-neutral-300 text-[10px]"
                      />
                    </div>
                  ))}
                </div>

                {/* FAQ section */}
                <div className="space-y-2 border-t border-neutral-850 pt-2.5">
                  <span className="text-[10px] uppercase font-mono font-bold text-indigo-400">Static Frequently Answered concerns (FAQs):</span>
                  {(webCMS.faqs || []).map((f: any, idx: number) => (
                    <div key={f.id} className="space-y-1">
                      <input 
                        type="text"
                        value={f.question}
                        onChange={(e) => {
                          const list = [...webCMS.faqs];
                          list[idx].question = e.target.value;
                          setWebCMS({ ...webCMS, faqs: list });
                        }}
                        className="w-full bg-neutral-950 border border-neutral-800 px-2 py-1 rounded text-[11px] font-bold"
                      />
                      <textarea 
                        value={f.answer}
                        rows={2}
                        onChange={(e) => {
                          const list = [...webCMS.faqs];
                          list[idx].answer = e.target.value;
                          setWebCMS({ ...webCMS, faqs: list });
                        }}
                        className="w-full bg-neutral-950 border border-neutral-800 px-2 py-1 rounded text-[10px] font-sans"
                      />
                    </div>
                  ))}
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => {
                      saveDbChange("update_raw", "websiteContent", webCMS);
                    }}
                    className="w-full bg-neutral-800 text-neutral-200 border border-neutral-750 font-bold py-2 rounded-xl transition cursor-pointer"
                  >
                    Confirm All promos, coupons & FAQ updates
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------
            9. TEAM SECURITY & STAFF ROLES TAB
            ---------------------------------------------------- */}
        {innerSubTab === "roles" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 font-mono">Staff Credentials & Team security</h3>
              <p className="text-[10px] text-neutral-450 font-mono">Audit backend credentials, override user access flags</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Add Staff form */}
              <div className="lg:col-span-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4 text-xs font-sans">
                <span className="text-xs font-black block text-amber-500 font-mono uppercase tracking-widest">Enroll Staff Member</span>
                
                <div className="space-y-3 font-mono">
                  <div>
                    <label className="text-slate-400 block mb-1">Direct Username Login</label>
                    <input 
                      type="text"
                      placeholder="e.g. alex.sales"
                      value={newStaff.username}
                      onChange={(e) => setNewStaff({ ...newStaff, username: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-100 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Raw Access Password Code</label>
                    <input 
                      type="text"
                      placeholder="raw password"
                      value={newStaff.password}
                      onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-100 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Display Real Name</label>
                    <input 
                      type="text"
                      placeholder="Sarah Connor"
                      value={newStaff.name}
                      onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-100 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Designated Sunchaser Role</label>
                    <select
                      value={newStaff.role}
                      onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 px-3 py-1.5 rounded-xl text-neutral-100 text-xs font-mono"
                    >
                      <option value="Super Admin">Super Admin</option>
                      <option value="Sales Manager">Sales Manager</option>
                      <option value="Sales Executive">Sales Executive</option>
                      <option value="Technician">Technician</option>
                      <option value="Survey Engineer">Survey Engineer</option>
                      <option value="Installation Team">Installation Team</option>
                    </select>
                  </div>

                  <button
                    onClick={() => {
                      const id = `u-${Date.now().toString().slice(-3)}`;
                      saveDbChange("add", "users", {
                        id,
                        username: newStaff.username,
                        password: newStaff.password,
                        name: newStaff.name,
                        email: `${newStaff.username}@sunchaser.com`,
                        role: newStaff.role
                      });
                      setNewStaff({ username: "", name: "", email: "", password: "123", role: "Sales Executive" });
                    }}
                    disabled={!newStaff.username || !newStaff.name}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-2.5 rounded-xl transition cursor-pointer disabled:opacity-40"
                  >
                    Enroll Staff Account
                  </button>
                </div>
              </div>

              {/* Staff directory */}
              <div className="lg:col-span-8 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 overflow-x-auto text-xs font-mono">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-neutral-805 text-slate-500 font-bold pb-2">
                      <th className="py-2.5 px-3">Unique User ID</th>
                      <th className="py-2.5 px-3">Display Name</th>
                      <th className="py-2.5 px-3">Direct username</th>
                      <th className="py-2.5 px-3">Access password</th>
                      <th className="py-2.5 px-3">System security Role</th>
                      <th className="py-2.5 px-3 text-right">Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Display actual seed logs */}
                    {[
                      { id: "u-allauddin", name: "Muhammad Allauddin", username: "allauddin", role: "Super Admin", pass: "123" },
                      { id: "u-raza", name: "Raza", username: "raza", role: "Technical CEO", pass: "123" },
                      { id: "u-sales", name: "Sales Advisor", username: "sales", role: "Sales Advisor", pass: "123" },
                    ].map(st => (
                      <tr key={st.id} className="border-b border-neutral-850 hover:bg-neutral-800/10 text-neutral-200">
                        <td className="py-2.5 px-3">
                          <span className="bg-neutral-850 px-2 py-0.5 rounded text-[10px] font-bold text-indigo-400">{st.id}</span>
                        </td>
                        <td className="py-2.5 px-3 font-sans font-bold text-neutral-10s">{st.name}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-350">{st.username}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-450">{st.pass}</td>
                        <td className="py-2.5 px-3">
                          <span className="bg-orange-900/20 text-orange-400 px-2 py-0.5 rounded text-[10px] font-bold font-sans">{st.role}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => {
                              alert("Safety Lock Active: Default template team credentials cannot be deleted to prevent demo lockouts.");
                            }}
                            className="bg-neutral-800 hover:bg-rose-950 p-1 rounded-md text-slate-400 hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------
            10. DECLARED BANK SETTINGS TAB
            ---------------------------------------------------- */}
        {innerSubTab === "settings" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-805 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 font-mono">System Global Properties & settings</h3>
              <p className="text-[10px] text-neutral-450 font-mono">Direct system configurations</p>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 text-xs font-sans space-y-4 max-w-4xl mx-auto">
              <span className="text-xs font-black text-amber-450 font-mono block uppercase tracking-widest border-b border-neutral-850 pb-2">Institution credentials</span>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-neutral-450 block mb-1">Company Display Name</label>
                  <input 
                    type="text"
                    value={sysSettings.companyName || ""}
                    onChange={(e) => setSysSettings({ ...sysSettings, companyName: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-100 font-sans"
                  />
                </div>
                <div>
                  <label className="text-neutral-450 block mb-1 font-mono">Terms Brand Logo Link</label>
                  <input 
                    type="text"
                    value={sysSettings.companyLogo || ""}
                    onChange={(e) => setSysSettings({ ...sysSettings, companyLogo: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 font-mono"
                  />
                </div>
                <div>
                  <label className="text-neutral-450 block mb-1">Company Call Phone</label>
                  <input 
                    type="text"
                    value={sysSettings.phoneNumber || ""}
                    onChange={(e) => setSysSettings({ ...sysSettings, phoneNumber: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-100 font-sans"
                  />
                </div>
                <div>
                  <label className="text-neutral-450 block mb-1">Direct WhatsApp API number</label>
                  <input 
                    type="text"
                    value={sysSettings.whatsAppNumber || ""}
                    onChange={(e) => setSysSettings({ ...sysSettings, whatsAppNumber: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-100 font-mono"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-neutral-450 block mb-1">Bank Receipt billing details</label>
                  <input 
                    type="text"
                    value={sysSettings.bankDetails || ""}
                    onChange={(e) => setSysSettings({ ...sysSettings, bankDetails: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-805 px-3 py-2 rounded-xl text-neutral-205"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-neutral-450 block mb-1">Federal terms & conditions clauses</label>
                  <textarea 
                    rows={2}
                    value={sysSettings.termsAndConditions || ""}
                    onChange={(e) => setSysSettings({ ...sysSettings, termsAndConditions: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-805 px-3 py-2 rounded-xl text-zinc-300"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-neutral-450 block mb-1">Standard warranty clauses</label>
                  <textarea 
                    rows={2}
                    value={sysSettings.warrantyText || ""}
                    onChange={(e) => setSysSettings({ ...sysSettings, warrantyText: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-805 px-2.5 py-1.5 rounded-xl text-zinc-300"
                  />
                </div>
                <div className="border-t border-neutral-800 pt-4 mt-2 col-span-2">
                  <span className="text-xs font-black text-amber-450 font-mono block uppercase tracking-widest border-b border-neutral-850 pb-2 mb-3">
                    Solar Sizer (Pakistan / Lahore)
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-neutral-450 block mb-1">Blended tariff (PKR/kWh)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={sysSettings.solarSizing?.blendedTariffPkrPerKwh ?? sysSettings.blendedTariffPkrPerKwh ?? 42}
                        onChange={(e) =>
                          setSysSettings({
                            ...sysSettings,
                            solarSizing: {
                              ...(sysSettings.solarSizing || {}),
                              blendedTariffPkrPerKwh: Number(e.target.value) || 42,
                            },
                          })
                        }
                        className="w-full bg-neutral-950 border border-neutral-805 px-3 py-2 rounded-xl text-neutral-100 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-neutral-450 block mb-1">Generation per kW/month (kWh)</label>
                      <input
                        type="number"
                        value={sysSettings.solarSizing?.generationPerKwMonth ?? sysSettings.solarGenerationPerKwMonth ?? 120}
                        onChange={(e) =>
                          setSysSettings({
                            ...sysSettings,
                            solarSizing: {
                              ...(sysSettings.solarSizing || {}),
                              generationPerKwMonth: Number(e.target.value) || 120,
                            },
                          })
                        }
                        className="w-full bg-neutral-950 border border-neutral-805 px-3 py-2 rounded-xl text-neutral-100 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-neutral-450 block mb-1">Derating factor (0–1)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.1"
                        max="1"
                        value={sysSettings.solarSizing?.deratingFactor ?? sysSettings.solarDeratingFactor ?? 1}
                        onChange={(e) =>
                          setSysSettings({
                            ...sysSettings,
                            solarSizing: {
                              ...(sysSettings.solarSizing || {}),
                              deratingFactor: Math.min(1, Math.max(0.1, Number(e.target.value) || 1)),
                            },
                          })
                        }
                        className="w-full bg-neutral-950 border border-neutral-805 px-3 py-2 rounded-xl text-neutral-100 font-mono"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-neutral-500 mt-2 font-mono">
                    Units = bill ÷ tariff · Recommended kW = units ÷ generation/kW/month
                  </p>
                </div>
                <div>
                  <label className="text-neutral-450 block mb-1">Direct taxes ratio</label>
                  <input 
                    type="text"
                    value={sysSettings.taxSettings || ""}
                    onChange={(e) => setSysSettings({ ...sysSettings, taxSettings: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-805 px-3 py-2 rounded-xl text-neutral-205"
                  />
                </div>
                <div>
                  <label className="text-neutral-450 block mb-1 font-mono">Currency ISO Code settings</label>
                  <input 
                    type="text"
                    value={sysSettings.currencySettings || ""}
                    onChange={(e) => setSysSettings({ ...sysSettings, currencySettings: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-850 px-3 py-2 rounded-xl text-neutral-100 font-mono text-amber-400 font-extrabold"
                  />
                </div>
                <div>
                  <label className="text-neutral-450 block mb-1">Office Address</label>
                  <input 
                    type="text"
                    value={sysSettings.officeAddress || ""}
                    onChange={(e) => setSysSettings({ ...sysSettings, officeAddress: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-100"
                  />
                </div>
                <div>
                  <label className="text-neutral-450 block mb-1">Office Phone Numbers</label>
                  <input 
                    type="text"
                    value={sysSettings.phoneNumbers || ""}
                    onChange={(e) => setSysSettings({ ...sysSettings, phoneNumbers: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-100"
                  />
                </div>
              </div>

              {/* Declared Bank Accounts */}
              <div className="border-t border-neutral-800 pt-4 mt-6">
                <span className="text-xs font-black text-amber-450 font-mono block uppercase tracking-widest border-b border-neutral-850 pb-2 mb-4">Declared Bank Accounts</span>
                <div className="space-y-4">
                  {(sysSettings.bankAccounts || []).map((acc: any, idx: number) => (
                    <div key={idx} className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                      <div>
                        <label className="text-neutral-450 text-[10px] block mb-1">Account Title</label>
                        <input
                          type="text"
                          value={acc.title || ""}
                          onChange={(e) => {
                            const newAccs = [...(sysSettings.bankAccounts || [])];
                            newAccs[idx] = { ...acc, title: e.target.value };
                            setSysSettings({ ...sysSettings, bankAccounts: newAccs });
                          }}
                          className="w-full bg-neutral-900 border border-neutral-800 px-2.5 py-1.5 rounded-lg text-neutral-100 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-neutral-450 text-[10px] block mb-1">Bank Name</label>
                        <input
                          type="text"
                          value={acc.bankName || ""}
                          onChange={(e) => {
                            const newAccs = [...(sysSettings.bankAccounts || [])];
                            newAccs[idx] = { ...acc, bankName: e.target.value };
                            setSysSettings({ ...sysSettings, bankAccounts: newAccs });
                          }}
                          className="w-full bg-neutral-900 border border-neutral-800 px-2.5 py-1.5 rounded-lg text-neutral-100 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-neutral-450 text-[10px] block mb-1">Account No</label>
                        <input
                          type="text"
                          value={acc.accountNo || ""}
                          onChange={(e) => {
                            const newAccs = [...(sysSettings.bankAccounts || [])];
                            newAccs[idx] = { ...acc, accountNo: e.target.value };
                            setSysSettings({ ...sysSettings, bankAccounts: newAccs });
                          }}
                          className="w-full bg-neutral-900 border border-neutral-800 px-2.5 py-1.5 rounded-lg text-neutral-100 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-neutral-450 text-[10px] block mb-1">IBAN</label>
                        <input
                          type="text"
                          value={acc.iban || ""}
                          onChange={(e) => {
                            const newAccs = [...(sysSettings.bankAccounts || [])];
                            newAccs[idx] = { ...acc, iban: e.target.value };
                            setSysSettings({ ...sysSettings, bankAccounts: newAccs });
                          }}
                          className="w-full bg-neutral-900 border border-neutral-800 px-2.5 py-1.5 rounded-lg text-neutral-100 text-xs font-mono"
                        />
                      </div>
                      <div className="flex justify-between items-center gap-2">
                        <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-neutral-400 select-none">
                          <input
                            type="checkbox"
                            checked={!!acc.isAlternate}
                            onChange={(e) => {
                              const newAccs = [...(sysSettings.bankAccounts || [])];
                              newAccs[idx] = { ...acc, isAlternate: e.target.checked };
                              setSysSettings({ ...sysSettings, bankAccounts: newAccs });
                            }}
                            className="accent-amber-500"
                          />
                          Alternate
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const newAccs = (sysSettings.bankAccounts || []).filter((_: any, i: number) => i !== idx);
                            setSysSettings({ ...sysSettings, bankAccounts: newAccs });
                          }}
                          className="bg-red-500/20 hover:bg-red-500/40 text-red-400 text-[10px] px-2.5 py-1.5 rounded-lg transition"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const newAccs = [...(sysSettings.bankAccounts || []), { title: "", bankName: "", accountNo: "", iban: "", isAlternate: false }];
                      setSysSettings({ ...sysSettings, bankAccounts: newAccs });
                    }}
                    className="bg-neutral-850 hover:bg-neutral-800 text-neutral-300 text-[10px] px-3 py-1.5 rounded-lg transition"
                  >
                    + Add Bank Account
                  </button>
                </div>
              </div>

              {/* Detailed Terms and Conditions List */}
              <div className="border-t border-neutral-800 pt-4 mt-6">
                <span className="text-xs font-black text-amber-450 font-mono block uppercase tracking-widest border-b border-neutral-850 pb-2 mb-4">Detailed Terms and Conditions</span>
                <div className="space-y-2">
                  {(sysSettings.termsAndConditionsList || []).map((term: string, idx: number) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <span className="text-neutral-500 font-mono text-[10px] w-6 shrink-0">{idx + 1}.</span>
                      <input
                        type="text"
                        value={term || ""}
                        onChange={(e) => {
                          const newTerms = [...(sysSettings.termsAndConditionsList || [])];
                          newTerms[idx] = e.target.value;
                          setSysSettings({ ...sysSettings, termsAndConditionsList: newTerms });
                        }}
                        className="flex-1 bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newTerms = (sysSettings.termsAndConditionsList || []).filter((_: any, i: number) => i !== idx);
                          setSysSettings({ ...sysSettings, termsAndConditionsList: newTerms });
                        }}
                        className="bg-red-500/20 hover:bg-red-500/40 text-red-400 text-[10px] p-2 rounded-xl transition"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      id="new-term-input"
                      placeholder="Add a new custom terms clause..."
                      className="flex-1 bg-neutral-950 border border-neutral-800 px-3 py-2 rounded-xl text-neutral-200 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const input = document.getElementById('new-term-input') as HTMLInputElement;
                          if (input && input.value.trim()) {
                            const newTerms = [...(sysSettings.termsAndConditionsList || []), input.value.trim()];
                            setSysSettings({ ...sysSettings, termsAndConditionsList: newTerms });
                            input.value = "";
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const input = document.getElementById('new-term-input') as HTMLInputElement;
                        if (input && input.value.trim()) {
                          const newTerms = [...(sysSettings.termsAndConditionsList || []), input.value.trim()];
                          setSysSettings({ ...sysSettings, termsAndConditionsList: newTerms });
                          input.value = "";
                        }
                      }}
                      className="bg-neutral-850 hover:bg-neutral-800 text-neutral-350 text-neutral-300 text-xs px-4 py-2 rounded-xl transition"
                    >
                      Add Clause
                    </button>
                  </div>
                </div>
              </div>

              {/* Structure Descriptions */}
              <div className="border-t border-neutral-800 pt-4 mt-6">
                <span className="text-xs font-black text-amber-450 font-mono block uppercase tracking-widest border-b border-neutral-850 pb-2 mb-4">Structure Descriptions & Engineering Specs</span>
                <div className="space-y-4">
                  {['standard', 'elevated', 'girder'].map((key) => (
                    <div key={key} className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
                      <span className="text-amber-400 font-bold uppercase text-[10px] tracking-wider font-mono">{key} Structure type</span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div className="md:col-span-2">
                          <label className="text-neutral-500 text-[10px] block mb-1">English Description</label>
                          <textarea
                            rows={2}
                            value={sysSettings.structureDescriptions?.[key]?.en || ""}
                            onChange={(e) => {
                              const sDesc = { ...(sysSettings.structureDescriptions || {}) };
                              sDesc[key] = { ...sDesc[key], en: e.target.value };
                              setSysSettings({ ...sysSettings, structureDescriptions: sDesc });
                            }}
                            className="w-full bg-neutral-900 border border-neutral-800 px-3 py-2 rounded-lg text-neutral-100 text-xs"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-neutral-500 text-[10px] block mb-1">Urdu Description</label>
                          <input
                            type="text"
                            value={sysSettings.structureDescriptions?.[key]?.ur || ""}
                            onChange={(e) => {
                              const sDesc = { ...(sysSettings.structureDescriptions || {}) };
                              sDesc[key] = { ...sDesc[key], ur: e.target.value };
                              setSysSettings({ ...sysSettings, structureDescriptions: sDesc });
                            }}
                            className="w-full bg-neutral-900 border border-neutral-800 px-3 py-2 rounded-lg text-neutral-100 text-xs font-sans text-right"
                            dir="rtl"
                          />
                        </div>
                        <div>
                          <label className="text-neutral-500 text-[10px] block mb-1">Default Rate (Rs.)</label>
                          <input
                            type="number"
                            value={sysSettings.structureDescriptions?.[key]?.rate || 0}
                            onChange={(e) => {
                              const sDesc = { ...(sysSettings.structureDescriptions || {}) };
                              sDesc[key] = { ...sDesc[key], rate: Number(e.target.value) };
                              setSysSettings({ ...sysSettings, structureDescriptions: sDesc });
                            }}
                            className="w-full bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg text-neutral-100 text-xs font-mono text-amber-400"
                          />
                        </div>
                        <div>
                          <label className="text-neutral-500 text-[10px] block mb-1">Total Weight</label>
                          <input
                            type="text"
                            value={sysSettings.structureDescriptions?.[key]?.weight || ""}
                            placeholder="e.g. 850 kg"
                            onChange={(e) => {
                              const sDesc = { ...(sysSettings.structureDescriptions || {}) };
                              sDesc[key] = { ...sDesc[key], weight: e.target.value };
                              setSysSettings({ ...sysSettings, structureDescriptions: sDesc });
                            }}
                            className="w-full bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg text-neutral-100 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-neutral-500 text-[10px] block mb-1">Material Type</label>
                          <input
                            type="text"
                            value={sysSettings.structureDescriptions?.[key]?.materialType || ""}
                            placeholder="e.g. Hot-Dip Galvanized"
                            onChange={(e) => {
                              const sDesc = { ...(sysSettings.structureDescriptions || {}) };
                              sDesc[key] = { ...sDesc[key], materialType: e.target.value };
                              setSysSettings({ ...sysSettings, structureDescriptions: sDesc });
                            }}
                            className="w-full bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg text-neutral-100 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-neutral-500 text-[10px] block mb-1">Warranty Term</label>
                          <input
                            type="text"
                            value={sysSettings.structureDescriptions?.[key]?.warranty || ""}
                            placeholder="e.g. 15 Years"
                            onChange={(e) => {
                              const sDesc = { ...(sysSettings.structureDescriptions || {}) };
                              sDesc[key] = { ...sDesc[key], warranty: e.target.value };
                              setSysSettings({ ...sysSettings, structureDescriptions: sDesc });
                            }}
                            className="w-full bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg text-neutral-100 text-xs"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-neutral-500 text-[10px] block mb-1">Wind Velocity Rating</label>
                          <input
                            type="text"
                            value={sysSettings.structureDescriptions?.[key]?.windRating || ""}
                            placeholder="e.g. 130 km/h wind shear certified"
                            onChange={(e) => {
                              const sDesc = { ...(sysSettings.structureDescriptions || {}) };
                              sDesc[key] = { ...sDesc[key], windRating: e.target.value };
                              setSysSettings({ ...sysSettings, structureDescriptions: sDesc });
                            }}
                            className="w-full bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg text-neutral-100 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* BOQ Master Library Manager */}
              <div className="border-t border-neutral-800 pt-4 mt-6">
                <span className="text-xs font-black text-amber-450 font-mono block uppercase tracking-widest border-b border-neutral-850 pb-2 mb-4">BOQ Master Library Catalog</span>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left min-w-[800px]">
                    <thead>
                      <tr className="border-b border-neutral-800 text-neutral-450 text-[10px] uppercase font-mono">
                        <th className="py-2 pr-2">Category</th>
                        <th className="py-2 px-2">Brand / Model</th>
                        <th className="py-2 px-2 w-16 text-center">Unit</th>
                        <th className="py-2 px-2 w-20 text-right">Cost Price</th>
                        <th className="py-2 px-2 w-20 text-right">Sale Price</th>
                        <th className="py-2 px-2">Wattage/Cap</th>
                        <th className="py-2 px-2">Warranty</th>
                        <th className="py-2 px-2">Description</th>
                        <th className="py-2 pl-2 w-12 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-850 font-sans text-[11px]">
                      {(sysSettings.boqMasterLibrary || []).map((item: any, idx: number) => (
                        <tr key={idx} className="hover:bg-neutral-850/20">
                          <td className="py-2 pr-2">
                            <select
                              value={item.category || ""}
                              onChange={(e) => {
                                const newLib = [...(sysSettings.boqMasterLibrary || [])];
                                newLib[idx] = { ...item, category: e.target.value };
                                setSysSettings({ ...sysSettings, boqMasterLibrary: newLib });
                              }}
                              className="bg-neutral-950 border border-neutral-800 px-1 py-1 rounded text-[10px] text-neutral-200"
                            >
                              <option value="Solar Panels">Solar Panels</option>
                              <option value="Inverter">Inverter</option>
                              <option value="Battery">Battery</option>
                              <option value="Cables & Conductors">Cables & Conductors</option>
                              <option value="Ducts / Pipes / Conduits">Ducts / Pipes / Conduits</option>
                              <option value="DB Boxes">DB Boxes</option>
                              <option value="AC/DC Breakers">AC/DC Breakers</option>
                              <option value="SPDs">SPDs</option>
                              <option value="Earthing">Earthing</option>
                              <option value="Electrical & Mechanical Supplies">Electrical & Mechanical Supplies</option>
                              <option value="Structure / Fabrication">Structure / Fabrication</option>
                              <option value="Civil Works">Civil Works</option>
                              <option value="Installation & Commissioning">Installation & Commissioning</option>
                              <option value="Transportation">Transportation</option>
                              <option value="Net Metering">Net Metering</option>
                              <option value="Survey / Designing / Testing">Survey / Designing / Testing</option>
                              <option value="Miscellaneous">Miscellaneous</option>
                            </select>
                          </td>
                          <td className="py-2 px-2 space-y-1">
                            <input
                              type="text"
                              placeholder="Brand"
                              value={item.brand || ""}
                              onChange={(e) => {
                                const newLib = [...(sysSettings.boqMasterLibrary || [])];
                                newLib[idx] = { ...item, brand: e.target.value };
                                setSysSettings({ ...sysSettings, boqMasterLibrary: newLib });
                              }}
                              className="w-full bg-neutral-950 border border-neutral-800 px-1 py-0.5 rounded text-[10px] text-neutral-200"
                            />
                            <input
                              type="text"
                              placeholder="Model"
                              value={item.model || ""}
                              onChange={(e) => {
                                const newLib = [...(sysSettings.boqMasterLibrary || [])];
                                newLib[idx] = { ...item, model: e.target.value };
                                setSysSettings({ ...sysSettings, boqMasterLibrary: newLib });
                              }}
                              className="w-full bg-neutral-950 border border-neutral-800 px-1 py-0.5 rounded text-[10px] text-neutral-200"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={item.unit || ""}
                              onChange={(e) => {
                                const newLib = [...(sysSettings.boqMasterLibrary || [])];
                                newLib[idx] = { ...item, unit: e.target.value };
                                setSysSettings({ ...sysSettings, boqMasterLibrary: newLib });
                              }}
                              className="w-full bg-neutral-950 border border-neutral-800 px-1 py-1 rounded text-center text-[10px] text-neutral-200"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              value={item.costPrice || 0}
                              onChange={(e) => {
                                const newLib = [...(sysSettings.boqMasterLibrary || [])];
                                newLib[idx] = { ...item, costPrice: Number(e.target.value) };
                                setSysSettings({ ...sysSettings, boqMasterLibrary: newLib });
                              }}
                              className="w-full bg-neutral-950 border border-neutral-800 px-1 py-1 rounded text-right text-[10px] font-mono text-neutral-200 w-16"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              value={item.salePrice || 0}
                              onChange={(e) => {
                                const newLib = [...(sysSettings.boqMasterLibrary || [])];
                                newLib[idx] = { ...item, salePrice: Number(e.target.value) };
                                setSysSettings({ ...sysSettings, boqMasterLibrary: newLib });
                              }}
                              className="w-full bg-neutral-950 border border-neutral-800 px-1 py-1 rounded text-right text-[10px] font-mono text-amber-400 font-bold w-20"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={item.wattageCapacity || ""}
                              placeholder="e.g. 580W"
                              onChange={(e) => {
                                const newLib = [...(sysSettings.boqMasterLibrary || [])];
                                newLib[idx] = { ...item, wattageCapacity: e.target.value };
                                setSysSettings({ ...sysSettings, boqMasterLibrary: newLib });
                              }}
                              className="w-full bg-neutral-950 border border-neutral-800 px-1 py-1 rounded text-[10px] text-neutral-200 w-16"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={item.warranty || ""}
                              placeholder="Warranty"
                              onChange={(e) => {
                                const newLib = [...(sysSettings.boqMasterLibrary || [])];
                                newLib[idx] = { ...item, warranty: e.target.value };
                                setSysSettings({ ...sysSettings, boqMasterLibrary: newLib });
                              }}
                              className="w-full bg-neutral-950 border border-neutral-800 px-1 py-1 rounded text-[10px] text-neutral-200"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={item.description || ""}
                              placeholder="Description"
                              onChange={(e) => {
                                const newLib = [...(sysSettings.boqMasterLibrary || [])];
                                newLib[idx] = { ...item, description: e.target.value };
                                setSysSettings({ ...sysSettings, boqMasterLibrary: newLib });
                              }}
                              className="w-full bg-neutral-950 border border-neutral-800 px-2 py-1 rounded text-[10px] text-neutral-300 min-w-[120px]"
                            />
                          </td>
                          <td className="py-2 pl-2 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                const newLib = (sysSettings.boqMasterLibrary || []).filter((_: any, i: number) => i !== idx);
                                setSysSettings({ ...sysSettings, boqMasterLibrary: newLib });
                              }}
                              className="bg-red-500/20 hover:bg-red-500/40 text-red-400 text-[10px] px-2 py-1 rounded transition"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newItem = {
                      id: "item_" + Date.now(),
                      category: "Solar Panels",
                      brand: "",
                      model: "",
                      wattageCapacity: "",
                      unit: "Pcs",
                      costPrice: 0,
                      salePrice: 0,
                      warranty: "",
                      description: ""
                    };
                    const newLib = [...(sysSettings.boqMasterLibrary || []), newItem];
                    setSysSettings({ ...sysSettings, boqMasterLibrary: newLib });
                  }}
                  className="bg-neutral-850 hover:bg-neutral-800 text-neutral-300 text-[10px] px-3 py-1.5 rounded-lg mt-3 transition"
                >
                  + Add Master Catalog Item
                </button>
              </div>

              {/* BOQ pricing defaults */}
              <div className="border-t border-neutral-800 pt-4 mt-6">
                <span className="text-xs font-black text-amber-450 font-mono block uppercase tracking-widest border-b border-neutral-850 pb-2 mb-4">BOQ Pricing Defaults</span>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-neutral-800 text-neutral-450 text-[10px] uppercase font-mono">
                        <th className="py-2 pr-2">Item ID / Name</th>
                        <th className="py-2 px-2">Section</th>
                        <th className="py-2 px-2 w-16">Unit</th>
                        <th className="py-2 px-2 w-28">Default Rate (Rs.)</th>
                        <th className="py-2 pl-2">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-850 font-mono text-[11px]">
                      {(sysSettings.boqDefaults || []).map((item: any, idx: number) => (
                        <tr key={idx} className="hover:bg-neutral-850/20">
                          <td className="py-2.5 pr-2 font-bold text-neutral-200">
                            {item.name}
                            <span className="block font-normal text-[9px] text-neutral-500 font-mono">ID: {item.id}</span>
                          </td>
                          <td className="py-2.5 px-2 text-neutral-300">{item.section}</td>
                          <td className="py-2.5 px-2">
                            <input
                              type="text"
                              value={item.unit || ""}
                              onChange={(e) => {
                                const newBoq = [...(sysSettings.boqDefaults || [])];
                                newBoq[idx] = { ...item, unit: e.target.value };
                                setSysSettings({ ...sysSettings, boqDefaults: newBoq });
                              }}
                              className="w-full bg-neutral-950 border border-neutral-800 px-1 py-1 rounded text-center text-[10px] text-neutral-200"
                            />
                          </td>
                          <td className="py-2.5 px-2">
                            <input
                              type="number"
                              value={item.defaultRate || 0}
                              onChange={(e) => {
                                const newBoq = [...(sysSettings.boqDefaults || [])];
                                newBoq[idx] = { ...item, defaultRate: Number(e.target.value) };
                                setSysSettings({ ...sysSettings, boqDefaults: newBoq });
                              }}
                              className="w-full bg-neutral-950 border border-neutral-800 px-1.5 py-1 rounded text-right text-[10px] font-mono text-amber-400"
                            />
                          </td>
                          <td className="py-2.5 pl-2">
                            <input
                              type="text"
                              value={item.description || ""}
                              onChange={(e) => {
                                const newBoq = [...(sysSettings.boqDefaults || [])];
                                newBoq[idx] = { ...item, description: e.target.value };
                                setSysSettings({ ...sysSettings, boqDefaults: newBoq });
                              }}
                              className="w-full bg-neutral-950 border border-neutral-800 px-2 py-1 rounded text-[10px] text-neutral-350 text-neutral-300"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="pt-4">
                <button
                  onClick={() => {
                    saveDbChange("update_raw", "settings", sysSettings);
                  }}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-extrabold py-3 rounded-xl transition cursor-pointer text-xs"
                >
                  Commit Global Settings Override
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------
            11. BULK DATA SIMULATOR TAB
            ---------------------------------------------------- */}
        {innerSubTab === "bulk" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-neutral-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 font-mono">Spreadsheet Import/Export Utility</h3>
              <p className="text-[10px] text-neutral-450 font-mono">Bulk download operations datasets or simulate CSV parses</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs font-sans">
              <div className="lg:col-span-5 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
                <span className="text-xs font-black text-amber-500 font-mono block uppercase border-b border-neutral-850 pb-2">CSV Upload Parser:</span>
                <p className="text-neutral-400 text-xs">Simulate importing bulk items directly. Drop CSV text raw input with headings below:</p>
                <textarea
                  rows={6}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-700 rounded-xl p-3 font-mono text-[10px] focus:outline-none"
                  placeholder="SKU,Name,Category,Brand,Price,Stock&#10;SC-450,Canadian bifacial 450W,Panels,Canadian,390,400&#10;SC-X90,Micro Microinverters,Inverters,Enphase,189,250"
                />

                <div className="flex gap-2.5">
                  <button
                    onClick={() => {
                      if (!csvText) return;
                      const lines = csvText.split("\n");
                      const headers = lines[0].split(",");
                      const items: any[] = [];
                      for(let i=1; i<lines.length; i++) {
                        if (lines[i].trim()) {
                          const cols = lines[i].split(",");
                          const obj: any = {};
                          headers.forEach((h, idx) => {
                            obj[h.trim()] = cols[idx]?.trim();
                          });
                          items.push(obj);
                        }
                      }
                      setParsedRows(items);
                      alert(`Successfully read ${items.length} rows inside manual browser memory. Click "Execute Bulk Insert" to push.`);
                    }}
                    className="flex-1 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black py-2 rounded-xl text-xs transition cursor-pointer"
                  >
                    Analyze Spreadsheet
                  </button>

                  <button
                    onClick={() => {
                      setCsvText("SKU,Name,Category,Brand,Price,Stock\nSC-450-B,Bifacial Gen 4 450W,Panels,Canadian Solar,395,150\nIQ8-PRO,Enphase Smart Micro,Inverters,Enphase Energy,160,200\nPOWER-3,Tesla Powerwall Premium,Batteries,Tesla,4500,50");
                    }}
                    className="bg-neutral-800 text-neutral-300 hover:bg-neutral-750 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer"
                  >
                    CSV Template
                  </button>
                </div>

                {parsedRows.length > 0 && (
                  <div className="pt-2 border-t border-neutral-850 space-y-2.5">
                    <span className="text-[10px] text-zinc-400 uppercase font-mono block font-bold">Spreadsheet Analysis Grid Preview ({parsedRows.length} Rows):</span>
                    <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-850 max-h-[160px] overflow-y-auto font-mono text-[10px] space-y-1">
                      {parsedRows.map((row, idx) => (
                        <p key={idx} className="text-neutral-305 truncate">
                          ⚡ <span className="text-amber-400 font-extrabold">Row {idx+1}:</span> {JSON.stringify(row)}
                        </p>
                      ))}
                    </div>

                    <button
                      onClick={() => {
                        parsedRows.forEach((row) => {
                          const id = `p-${Date.now().toString().slice(-4)}-${Math.floor(Math.random()*100)}`;
                          const payload = {
                            id,
                            name: row.Name || "Custom Import Line",
                            category: row.Category || "Panels",
                            brand: row.Brand || "Sunchaser",
                            model: row.SKU || "SC-MOD-1",
                            sku: row.SKU || "SC-MOD-1",
                            price: Number(row.Price) || 300,
                            discount: 0,
                            stock: Number(row.Stock) || 100,
                            images: ["https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=300&q=80"],
                            warrantyPeriod: "10 Years",
                            specifications: { description: "Bulk imported row element" },
                            installationRequired: true,
                            serviceRequired: false
                          };
                          saveDbChange("add", "products", payload);
                        });
                        setParsedRows([]);
                        setCsvText("");
                        alert("Enterprise sheet data elements translated and added inside Active Database.");
                      }}
                      className="w-full bg-emerald-600 hover:bg-emerald-555 text-neutral-950 font-bold py-2.5 rounded-xl text-xs flex justify-center items-center gap-1.5 cursor-pointer text-white"
                    >
                      Commit Bulk import Rows to Catalog
                    </button>
                  </div>
                )}
              </div>

              {/* Downloads Bulk Panel */}
              <div className="lg:col-span-7 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
                <span className="text-xs font-black text-amber-500 font-mono block uppercase border-b border-neutral-850 pb-2">CSV Data Exports</span>
                <p className="text-xs text-neutral-400 leading-normal">
                  Export transactional tables into formatted CSV spreadsheets. Download directly to authorize offsite financial spreadsheets auditing:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div className="bg-neutral-950 border border-neutral-850 p-4 rounded-xl flex justify-between items-center">
                    <div>
                      <p className="font-bold text-neutral-100 font-sans">Export Lead Customers</p>
                      <span className="text-[10px] text-zinc-500 font-mono">Format: CSV ({leads.length} Records)</span>
                    </div>
                    <button
                      onClick={() => {
                        window.open(`${API_BASE_URL}/api/export/leads`, "_blank");
                      }}
                      className="bg-neutral-800 hover:bg-neutral-700 p-2 text-amber-400 rounded-xl cursor-pointer"
                      title="Download CSV"
                    >
                      <Download className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="bg-neutral-950 border border-neutral-850 p-4 rounded-xl flex justify-between items-center">
                    <div>
                      <p className="font-bold text-neutral-100 font-sans">Export Support Tickets</p>
                      <span className="text-[10px] text-zinc-500 font-mono">Format: CSV ({tickets.length} Cases)</span>
                    </div>
                    <button
                      onClick={() => {
                        window.open(`${API_BASE_URL}/api/export/tickets`, "_blank");
                      }}
                      className="bg-neutral-800 hover:bg-neutral-700 p-2 text-amber-500 rounded-xl cursor-pointer"
                      title="Download CSV"
                    >
                      <Download className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="bg-neutral-950 border border-neutral-850 p-4 rounded-xl flex justify-between items-center">
                    <div>
                      <p className="font-bold text-neutral-100 font-sans">Export Catalog Products</p>
                      <span className="text-[10px] text-zinc-500 font-mono">Format: CSV ({products.length} Items)</span>
                    </div>
                    <button
                      onClick={() => {
                        const csvContent = "data:text/csv;charset=utf-8,ID,Name,Brand,Price,Stock\n" + 
                          products.map(p => `${p.id},${p.name},${p.brand},${p.price},${p.stock}`).join("\n");
                        const encodedUri = encodeURI(csvContent);
                        const a = document.createElement("a");
                        a.href = encodedUri;
                        a.download = "products_catalog.csv";
                        a.click();
                      }}
                      className="bg-neutral-800 hover:bg-neutral-700 p-2 text-amber-450 rounded-xl cursor-pointer"
                      title="Download"
                    >
                      <Download className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="bg-neutral-950 border border-neutral-850 p-4 rounded-xl flex justify-between items-center">
                    <div>
                      <p className="font-bold text-neutral-105 font-sans">Export Hardware stock</p>
                      <span className="text-[10px] text-zinc-500 font-mono">Format: CSV ({inventory.length} SKUs)</span>
                    </div>
                    <button
                      onClick={() => {
                        const csvContent = "data:text/csv;charset=utf-8,SKU,Name,Category,Stock,Cost\n" + 
                          inventory.map(i => `${i.id},${i.name},${i.category},${i.stock},${i.cost}`).join("\n");
                        const encodedUri = encodeURI(csvContent);
                        const a = document.createElement("a");
                        a.href = encodedUri;
                        a.download = "hardware_inventory.csv";
                        a.click();
                      }}
                      className="bg-neutral-800 hover:bg-neutral-700 p-2 text-neutral-200 rounded-xl cursor-pointer"
                      title="Download"
                    >
                      <Download className="h-5 w-5" />
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
