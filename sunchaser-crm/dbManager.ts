import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import WebSocket from "ws";
import { buildClientPortalPayload } from "./src/lib/clientPortalTracker.ts";
import {
  mapDocumentRow,
  mapWarrantyClaimRow,
  mapWarrantyRow,
  buildDocumentWalletSlots,
  buildWarrantyCenterCards,
  type DocumentWalletType,
  type WarrantyComponentType,
} from "./src/lib/clientPortalPhase2.ts";
import {
  mapSupportTicketRow,
  mapSupportTicketUpdateRow,
  customerTimeline,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
} from "./src/lib/clientPortalSupport.ts";
import {
  mapServiceRequestRow,
  buildServiceMaintenanceSummary,
  buildEmptyServicePortalPayload,
  isServiceRequestsTableMissingError,
  SERVICE_TYPES,
  SERVICE_STATUSES,
} from "./src/lib/clientPortalService.ts";
import {
  buildSavingsDashboard,
  mapSavingsProfileRow,
  isCustomerSavingsTableMissingError,
  PERFORMANCE_STATUSES,
  DEFAULT_UNIT_RATE_PKR,
} from "./src/lib/clientPortalSavings.ts";

// Polyfill WebSocket globally for Node.js < 22 environments where Supabase Realtime requires it
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}

let clientInstance: SupabaseClient | null = null;
let isConfigured = false;

/** Map legacy Supabase role values to production app roles (until DB constraint includes new roles). */
const PRODUCTION_APP_ROLE_BY_USERNAME: Record<string, string> = {
  raza: "Technical CEO",
  sales: "Sales Advisor",
};

export function resolveAppUserRole(username: string, dbRole: string): string {
  return PRODUCTION_APP_ROLE_BY_USERNAME[String(username || "").toLowerCase()] || dbRole;
}

export function toSupabaseStorageRole(role: string): string {
  if (role === "Technical CEO") return "Sales Manager";
  if (role === "Sales Advisor") return "Sales Executive";
  return role;
}

export function getSupabase(): SupabaseClient | null {
  if (clientInstance) return clientInstance;

  let url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (url && url.endsWith("/rest/v1/")) {
    url = url.substring(0, url.length - "/rest/v1/".length);
  } else if (url && url.endsWith("/rest/v1")) {
    url = url.substring(0, url.length - "/rest/v1".length);
  }
  if (url && url.endsWith("/")) {
    url = url.substring(0, url.length - 1);
  }

  if (!url || !key) {
    console.warn(
      "\x1b[33m%s\x1b[0m",
      "⚠️ [Supabase Warning] Credentials missing. Running in local JSON database.json mode as fallback."
    );
    return null;
  }

  try {
    clientInstance = createClient(url, key, {
      auth: {
        persistSession: false,
      },
    });
    isConfigured = true;
    console.log("\x1b[32m%s\x1b[0m", "✅ [Supabase] Client initialized successfully.");
    return clientInstance;
  } catch (err: any) {
    console.error("❌ Failed to initialize Supabase client instance:", err);
    return null;
  }
}

export function isSupabaseActive(): boolean {
  if (isConfigured) return true;
  return getSupabase() !== null;
}

/** When false, CRM must not persist auto_sizer quotations (manual BOQ only). */
export const AUTO_SIZER_QUOTE_CREATION_ENABLED = false;

/* --- PERSISTENT FILE DATABASE ARCHITECTURE TYPES & SEED --- */
export interface Database {
  users: any[];
  leads: any[];
  tickets: any[];
  netMeteringHistory: any[];
  inventory: any[];
  projects: any[];
  netMeteringTrackers: Record<string, any>;
  paymentTracks: Record<string, any>;
  activityLogs: any[];
  whatsAppLogs: any[];
  purchaseOrders?: any[];
  categories?: any[];
  products?: any[];
  orders?: any[];
  warranties?: any[];
  notifications?: any[];
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
  customerDocuments?: any[];
  customerWarranties?: any[];
  warrantyClaims?: any[];
  supportTicketUpdates?: any[];
  serviceRequests?: any[];
  customerSavingsProfiles?: any[];
}

export const initialSeed: Database = {
  users: [
    { id: "u-allauddin", username: "allauddin", password: "123", name: "Muhammad Allauddin", email: "allauddin@sunchaser-energy.com", role: "Super Admin" },
    { id: "u-raza", username: "raza", password: "123", name: "Raza", email: "raza@sunchaser-energy.com", role: "Technical CEO" },
    { id: "u-sales", username: "sales", password: "123", name: "Sales Advisor", email: "sales@sunchaser-energy.com", role: "Sales Advisor" },
    { id: "u-portal-client", username: "portalclient", password: "123", name: "Portal Client", email: "portalclient@test.local", role: "Customer", customerId: "cust-demo-portal" },
  ],
  customerDocuments: [],
  customerWarranties: [],
  warrantyClaims: [],
  supportTicketUpdates: [],
  serviceRequests: [],
  customerSavingsProfiles: [],
  leads: [],
  tickets: [],
  netMeteringHistory: [
    { month: "Jan", consumption: 850, generation: 420 },
    { month: "Feb", consumption: 790, generation: 510 },
    { month: "Mar", consumption: 710, generation: 750 },
    { month: "Apr", consumption: 680, generation: 980 },
    { month: "May", consumption: 750, generation: 1220 }
  ],
  inventory: [
    { id: "p-400", name: "Sunchaser Ultra 400W", category: "Panels", desc: "Monocrystalline premium solar cells with 21.8% efficiency rating.", stock: 450, cost: 280 },
    { id: "p-hd", name: "Sunchaser Pro High-Efficiency 400W", category: "Panels", desc: "Top-tier high durability frame, 22.4% module efficiency.", stock: 240, cost: 350 },
    { id: "inv-en", name: "Enphase IQ8 Microinverter", category: "Inverters", desc: "Grid-forming smart microinverters with sunlight backup.", stock: 1210, cost: 180 },
    { id: "inv-te", name: "Tesla Inverter 7.6kW", category: "Inverters", desc: "Centralized power converting with full Tesla backup ecosystem integration.", stock: 35, cost: 1500 },
    { id: "bat-cs", name: "Sunchaser Core Battery 13.5kWh", category: "Storage", desc: "Stackable lithium-iron-phosphate clean solar battery.", stock: 80, cost: 6200 }
  ],
  projects: [],
  netMeteringTrackers: {},
  paymentTracks: {},
  activityLogs: [],
  whatsAppLogs: [],
  purchaseOrders: [
    { id: "PO-9001", vendor: "Canadian Solar Ltd", itemId: "p-400", itemName: "Sunchaser Ultra 400W", quantity: 200, status: "Delivered", date: "2026-05-18", cost: 56000 },
    { id: "PO-9002", vendor: "Enphase Energy", itemId: "inv-en", itemName: "Enphase IQ8 Microinverter", quantity: 500, status: "In Transit", date: "2026-05-24", cost: 90000 }
  ],
  categories: [
    { id: "cat-1", name: "Solar Systems", description: "Complete package solar generators and layout panels" },
    { id: "cat-2", name: "Solar Panels", description: "Premium photovoltaic silicon wafer panels" },
    { id: "cat-3", name: "Inverters", description: "Smart solar and battery power inverters" },
    { id: "cat-4", name: "Batteries", description: "Lithium iron phosphate storage cells" },
    { id: "cat-5", name: "EV Chargers", description: "Universal standard electric vehicle chargers" },
    { id: "cat-6", name: "Mobile Phones", description: "Next-gen communication handsets and devices" },
    { id: "cat-7", name: "Electronics", description: "Smart accessories and microprocessor electronics" },
    { id: "cat-8", name: "Accessories", description: "Peripheral mount brackets and device sound systems" },
    { id: "cat-9", name: "Appliances", description: "Energy star home appliances and micro-fridges" },
    { id: "cat-10", name: "Future Products", description: "Extended modules and service support care contracts" }
  ],
  products: [
    {
      id: "p-sol-jinko-580",
      name: "Jinko Tiger Neo 580W Panel",
      category: "Solar Panels",
      brand: "Jinko",
      model: "Tiger Neo N-type 580W",
      sku: "JK-PAN-580N",
      price: 26000,
      discount: 1000,
      stock: 500,
      images: ["https://images.unsplash.com/photo-1509391366360-2e959784a276?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "25 Years",
      specifications: { wattage: 580, costPrice: 19500, description: "Jinko Tiger Neo N-type high efficiency monocrystalline bifacial panels." }
    },
    {
      id: "p-sol-longi-575",
      name: "Longi Hi-MO 6 Explorer 575W",
      category: "Solar Panels",
      brand: "Longi",
      model: "Hi-MO 6 Explorer 575W",
      sku: "LG-PAN-575E",
      price: 25215,
      discount: 500,
      stock: 450,
      images: ["https://images.unsplash.com/photo-1509391366360-2e959784a276?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "25 Years",
      specifications: { wattage: 575, costPrice: 18900, description: "Longi Hi-MO 6 Explorer HPBC single glass modules." }
    },
    {
      id: "p-sol-ja-550",
      name: "JA Solar DeepBlue 550W",
      category: "Solar Panels",
      brand: "JA Solar",
      model: "DeepBlue 3.0 550W",
      sku: "JA-PAN-550D",
      price: 19500,
      discount: 0,
      stock: 350,
      images: ["https://images.unsplash.com/photo-1509391366360-2e959784a276?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "25 Years",
      specifications: { wattage: 550, costPrice: 15500, description: "JA Solar DeepBlue 3.0 Mono-crystalline assembly." }
    },
    {
      id: "p-sol-canadian-650",
      name: "Canadian Solar BiHiKu7 650W",
      category: "Solar Panels",
      brand: "Canadian Solar",
      model: "BiHiKu7 650W",
      sku: "CS-PAN-650B",
      price: 23000,
      discount: 1000,
      stock: 300,
      images: ["https://images.unsplash.com/photo-1509391366360-2e959784a276?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "25 Years",
      specifications: { wattage: 650, costPrice: 17500, description: "Canadian Solar BiHiKu7 double glass bifacial modules." }
    },
    {
      id: "p-sol-trina-430",
      name: "Trina Vertex S+ 430W",
      category: "Solar Panels",
      brand: "Trina",
      model: "Vertex S+ 430W",
      sku: "TR-PAN-430V",
      price: 16000,
      discount: 500,
      stock: 400,
      images: ["https://images.unsplash.com/photo-1509391366360-2e959784a276?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "25 Years",
      specifications: { wattage: 430, costPrice: 12500, description: "Trina Vertex S+ N-type dual glass solar modules." }
    },
    {
      id: "p-inv-knox-10",
      name: "Knox Smart Sync 10kW Inverter",
      category: "Inverters",
      brand: "Knox",
      model: "KNS-10K-G3",
      sku: "KX-INV-10K",
      price: 400000,
      discount: 15000,
      stock: 120,
      images: ["https://images.unsplash.com/photo-1620038896894-9165b2fa2c6e?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 10000, costPrice: 320000, description: "Knox Smart Sync 10kW three phase dual MPPT grid tied inverter." }
    },
    {
      id: "p-inv-solis-10",
      name: "Solis 3-Phase 10kW Inverter",
      category: "Inverters",
      brand: "Solis",
      model: "S6-GR3P10K",
      sku: "SL-INV-10K",
      price: 420000,
      discount: 10000,
      stock: 90,
      images: ["https://images.unsplash.com/photo-1620038896894-9165b2fa2c6e?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 10000, costPrice: 340000, description: "Solis S6 three phase grid-tied solar inverter." }
    },
    {
      id: "p-inv-growatt-6",
      name: "Growatt Hybrid 6kW Inverter",
      category: "Inverters",
      brand: "Growatt",
      model: "MIN 6000TL-XH",
      sku: "GW-INV-6K",
      price: 280000,
      discount: 5000,
      stock: 80,
      images: ["https://images.unsplash.com/photo-1620038896894-9165b2fa2c6e?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "5 Years",
      specifications: { wattage: 6000, costPrice: 220000, description: "Growatt MIN 6000TL-XH hybrid single phase storage inverter." }
    },
    {
      id: "p-inv-nitrox-12",
      name: "Nitrox Hybrid 12kW Inverter",
      category: "Inverters",
      brand: "Nitrox",
      model: "S-12K-SG04LP3",
      sku: "NX-INV-12K",
      price: 580000,
      discount: 20000,
      stock: 65,
      images: ["https://images.unsplash.com/photo-1620038896894-9165b2fa2c6e?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "5 Years",
      specifications: { wattage: 12000, costPrice: 480000, description: "Nitrox 12kW hybrid three phase storage inverter (low voltage battery supported)." }
    },
    {
      id: "p-inv-fox-10",
      name: "Fox ESS 3-Phase 10kW Hybrid",
      category: "Inverters",
      brand: "Fox ESS",
      model: "H3-10.0-E",
      sku: "FX-INV-10K",
      price: 490000,
      discount: 10000,
      stock: 40,
      images: ["https://images.unsplash.com/photo-1620038896894-9165b2fa2c6e?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 10000, costPrice: 410000, description: "Fox ESS high performance H3 series 10kW hybrid inverter." }
    },
    {
      id: "p-bat-dyness-5",
      name: "Dyness LFP 5.12kWh Battery",
      category: "Batteries",
      brand: "Dyness",
      model: "DL5.0C LFP",
      sku: "DN-BAT-5K",
      price: 235000,
      discount: 5000,
      stock: 150,
      images: ["https://images.unsplash.com/photo-1620714223084-8fcacc6dfd8d?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 5120, costPrice: 190000, description: "Dyness DL5.0C lithium iron phosphate (LiFePO4) 51.2V 100Ah rack battery." }
    },
    {
      id: "p-bat-pylontech-48",
      name: "Pylontech US5000 4.8kWh",
      category: "Batteries",
      brand: "Pylontech",
      model: "US5000 48V",
      sku: "PT-BAT-48",
      price: 260000,
      discount: 10000,
      stock: 80,
      images: ["https://images.unsplash.com/photo-1620714223084-8fcacc6dfd8d?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 4800, costPrice: 215000, description: "Pylontech US5000 LFP lithium energy storage battery module." }
    },
    {
      id: "p-bat-soluna-10",
      name: "Soluna EOS 10K Pack",
      category: "Batteries",
      brand: "Soluna",
      model: "EOS 10K LFP",
      sku: "SL-BAT-10K",
      price: 480000,
      discount: 15000,
      stock: 45,
      images: ["https://images.unsplash.com/photo-1620714223084-8fcacc6dfd8d?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 10240, costPrice: 380000, description: "Soluna EOS high capacity LFP stackable battery system." }
    },
    {
      id: "p-bat-narada-48",
      name: "Narada LFP 100Ah Battery",
      category: "Batteries",
      brand: "Narada",
      model: "48NPFC100",
      sku: "ND-BAT-48",
      price: 210000,
      discount: 5000,
      stock: 95,
      images: ["https://images.unsplash.com/photo-1620714223084-8fcacc6dfd8d?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "5 Years",
      specifications: { wattage: 4800, costPrice: 175000, description: "Narada 48V telecom-grade lithium iron phosphate rack batteries." }
    },
    {
      id: "p-str-std",
      name: "Standard A-Frame Mount Rails",
      category: "Structure",
      brand: "Mughal",
      model: "Standard A-Frame (Roof)",
      sku: "MG-STR-STD",
      price: 4800,
      discount: 0,
      stock: 1000,
      images: [],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 0, costPrice: 3500, description: "Standard hot-dip galvanized L3 14 gauge frame roof mounts." }
    },
    {
      id: "p-str-elv",
      name: "Elevated Steel Frame (10ft clearance)",
      category: "Structure",
      brand: "Mughal",
      model: "Elevated Frame (10ft)",
      sku: "MG-STR-ELV",
      price: 147600,
      discount: 5000,
      stock: 100,
      images: [],
      warrantyPeriod: "15 Years",
      specifications: { wattage: 0, costPrice: 120000, description: "Hot-dip galvanized C-Channel / H-Beam heavy fabrication structure." }
    },
    {
      id: "p-str-gir",
      name: "Premium Mughal Girder Heavy Frame",
      category: "Structure",
      brand: "Mughal",
      model: "Girder Heavy Frame",
      sku: "MG-STR-GIR",
      price: 180000,
      discount: 10000,
      stock: 80,
      images: [],
      warrantyPeriod: "15 Years",
      specifications: { wattage: 0, costPrice: 140000, description: "Extreme wind shear resistant structural steel girder system." }
    },
    {
      id: "p-cab-dc6",
      name: "Pakistan Cables 6mm Single Core DC",
      category: "Cables",
      brand: "Pakistan Cables",
      model: "6mm Single-Core DC Solar",
      sku: "PK-CAB-DC6",
      price: 280,
      discount: 10,
      stock: 5000,
      images: [],
      warrantyPeriod: "20 Years",
      specifications: { wattage: 0, costPrice: 220, description: "Double insulated copper core DC solar cable per meter." }
    },
    {
      id: "p-cab-ac16",
      name: "Fast Cables 16mm 4-Core AC Cable",
      category: "Cables",
      brand: "Fast Cables",
      model: "16mm 4-Core AC Copper",
      sku: "FC-CAB-AC16",
      price: 2200,
      discount: 100,
      stock: 2000,
      images: [],
      warrantyPeriod: "15 Years",
      specifications: { wattage: 0, costPrice: 1800, description: "Standard connection copper cable for AC distribution box per meter." }
    },
    {
      id: "p-pro-box",
      name: "DC Breaker & SPD Protection Box",
      category: "Protection",
      brand: "Chint",
      model: "DC Protection Box Equipped",
      sku: "CT-PRO-DCB",
      price: 22000,
      discount: 2000,
      stock: 150,
      images: [],
      warrantyPeriod: "3 Years",
      specifications: { wattage: 0, costPrice: 15000, description: "DC box with 1000V fuses, DC SPD, and heavy circuit breakers." }
    },
    {
      id: "p-acc-con",
      name: "PVC Conduit Ducting & MC4 Connectors",
      category: "Accessories",
      brand: "Beta",
      model: "Ducting Accessories Kit",
      sku: "BT-ACC-KIT",
      price: 18000,
      discount: 0,
      stock: 400,
      images: [],
      warrantyPeriod: "5 Years",
      specifications: { wattage: 0, costPrice: 12000, description: "Complete PVC conduit piping, ducting, flex pipes, joints, and MC4 kit." }
    },
    {
      id: "p-net-lesco",
      name: "LESCO Bidirectional Green Meter Filing",
      category: "Net Metering",
      brand: "LESCO",
      model: "Three-Phase Green Metering",
      sku: "LE-NET-FIL",
      price: 90000,
      discount: 0,
      stock: 999,
      images: [],
      warrantyPeriod: "N/A",
      specifications: { wattage: 0, costPrice: 75000, description: "Bidirectional meter licensing, NEPRA application filing, demand notice audit." }
    },
    {
      id: "p-civ-fnd",
      name: "Concrete Ballast Foundation Pillars",
      category: "Civil Works",
      brand: "Local",
      model: "Ballast Concrete Pad",
      sku: "LC-CIV-FND",
      price: 16000,
      discount: 0,
      stock: 500,
      images: [],
      warrantyPeriod: "N/A",
      specifications: { wattage: 0, costPrice: 11000, description: "1.5x1.5ft concrete blocks for anchor base foundation stabilization." }
    }
  ],
  orders: [],
  warranties: [],
  notifications: [],
  quoteTemplates: [
    { id: "tmpl-1", name: "Sunchaser Official Proposal Template", is_active: true }
  ],
  quoteTemplatePages: [
    { id: "tmpl-p-1", template_id: "tmpl-1", page_type: "cover", title: "Sunchaser Energy Systems", body_text: "Generational Energy Independence\nTechnical Feasibility & Engineering Quotation", is_enabled: true, sort_order: 1 },
    { id: "tmpl-p-2", template_id: "tmpl-1", page_type: "profile", title: "Sunchaser Group Profile", body_text: "Sunchaser Energy operates under a unified consortium of specialized engineering, supply chain, and logistics enterprises. Together, we bring a level of structural reliability and direct import authorization unmatched in the local solar industry.", is_enabled: true, sort_order: 2 },
    { id: "tmpl-p-3", template_id: "tmpl-1", page_type: "qr", title: "Why Partner with Sunchaser?", body_text: "Tier-1 Direct Imported Hardware: All solar modules are sourced directly from Bloomberg Tier-1 rated manufacturers (Jinko, Longi, JA Solar) with complete customs trace certificates.", is_enabled: true, sort_order: 3 },
    { id: "tmpl-p-4", template_id: "tmpl-1", page_type: "ceo", title: "Executive Board Assurances", body_text: "At Sunchaser, our engineering philosophy is simple: we build systems that outlast a generation.", is_enabled: true, sort_order: 4 },
    { id: "tmpl-p-5a", template_id: "tmpl-1", page_type: "structure_standard", title: "Mounting Structure - Standard A-Frame", body_text: "Standard Galvanized L3 14 Gauge structure with Rawal anchors wind-resistant up to 130 km/h.", is_enabled: true, sort_order: 5 },
    { id: "tmpl-p-5b", template_id: "tmpl-1", page_type: "structure_elevated", title: "Mounting Structure - Elevated Steel Frame", body_text: "10ft Roof clearance hot-dip galvanized elevated structure frame wind-resistant up to 130 km/h.", is_enabled: true, sort_order: 6 },
    { id: "tmpl-p-5c", template_id: "tmpl-1", page_type: "structure_girder", title: "Mounting Structure - Heavy Mughal Girder Frame", body_text: "Heavy duty C-Channel girder steel columns and girders wind-resistant up to 150 km/h.", is_enabled: true, sort_order: 7 },
    { id: "tmpl-p-5d", template_id: "tmpl-1", page_type: "structure_custom", title: "Mounting Structure - Custom Structural Drawing", body_text: "Custom designed mounting rails and brackets based on site constraints and calculations.", is_enabled: true, sort_order: 8 },
    { id: "tmpl-p-6", template_id: "tmpl-1", page_type: "terms1", title: "Terms, Conditions & Regulations (1/2)", body_text: "", is_enabled: true, sort_order: 9 },
    { id: "tmpl-p-7", template_id: "tmpl-1", page_type: "terms2", title: "Terms, Conditions & Regulations (2/2)", body_text: "", is_enabled: true, sort_order: 10 },
    { id: "tmpl-p-8", template_id: "tmpl-1", page_type: "signoff", title: "Client Verification & Sign-off", body_text: "", is_enabled: true, sort_order: 11 },
    { id: "tmpl-p-9", template_id: "tmpl-1", page_type: "bank", title: "Official Payment Channels", body_text: "", is_enabled: true, sort_order: 12 },
    { id: "tmpl-p-10", template_id: "tmpl-1", page_type: "final", title: "Sunchaser Energy Systems", body_text: "Thank you for choosing Sunchaser Energy Systems! We are committed to delivering the highest caliber of electrical integration, structural safety, and long-term utility savings.", is_enabled: true, sort_order: 13 }
  ],
  bankAccounts: [
    { id: "bank-1", bank_name: "Allied Bank Limited", account_title: "SUNCHASER ENERGY", account_number: "04190010112276940012", iban: "PK81ABPA0010112276940012", is_active: true, sort_order: 1 },
    { id: "bank-2", bank_name: "Bank Alfalah Limited", account_title: "AL ADAM", account_number: "55265001858603", iban: "PK12ALFH5526005001858603", is_active: true, sort_order: 2 },
    { id: "bank-3", bank_name: "Allied Bank Limited", account_title: "SIGNALS GLOBAL", account_number: "09090010112284650035", iban: "N/A", is_active: true, sort_order: 3 },
    { id: "bank-4", bank_name: "Meezan Bank Limited", account_title: "HELIOS SOLAR ENERGY", account_number: "02490109527492", iban: "PK49MEZN0002490109527492", is_active: true, sort_order: 4 },
    { id: "bank-5", bank_name: "Standard Chartered Bank", account_title: "HELIOS SOLAR ENERGY", account_number: "1702559001", iban: "PK91SCBL0000001702559001", is_active: true, sort_order: 5 },
    { id: "bank-6", bank_name: "United Bank Limited", account_title: "HELIOS SOLAR ENERGY", account_number: "1305307203838", iban: "PK93UNIL0109000307203838", is_active: true, sort_order: 6 },
    { id: "bank-7", bank_name: "Habib Metropolitan Bank", account_title: "HELIOS SOLAR ENERGY", account_number: "6121020301714129916", iban: "PK42MPBL1210067140129916", is_active: true, sort_order: 7 },
    { id: "bank-8", bank_name: "Bank Al Habib Limited", account_title: "HELIOS SOLAR ENERGY", account_number: "03440981001290017", iban: "PK62BAHL0344098100129001", is_active: true, sort_order: 8 }
  ],
  companyTerms: [
    { id: "term-1", term_text: "Quotation validity: 3 days from date of issuance.", sort_order: 1 },
    { id: "term-2", term_text: "Rates are based on current fiscal/DISCO tariffs and duties. Any change will affect the net final price.", sort_order: 2 },
    { id: "term-3", term_text: "Standard Payment schedule: 50% Advance, 40% on delivery of equipment, 10% post-commissioning.", sort_order: 3 },
    { id: "term-4", term_text: "Accepted Payment methods: Bank transfer, pay order, or direct bank deposit.", sort_order: 4 },
    { id: "term-5", term_text: "Work will commence within 3 days after receipt of the advance payment.", sort_order: 5 },
    { id: "term-6", term_text: "Product substitution: In case of hardware supply limitations, Sunchaser may substitute components with equivalent grade models.", sort_order: 6 },
    { id: "term-7", term_text: "Installation standards: All electrical and mechanical works follow Sunchaser's ISO quality controls.", sort_order: 7 },
    { id: "term-8", term_text: "Client interference: Any on-site construction delays caused by the client will affect the completion timeline.", sort_order: 8 },
    { id: "term-9", term_text: "Grid connection: Net metering facilitation requires valid property documents and sanctioned load compliance.", sort_order: 9 },
    { id: "term-10", term_text: "System earthing: Dedicated chemical earthing bores will be created for DC, AC, and frame grounding safety.", sort_order: 10 },
    { id: "term-11", term_text: "Smart online monitoring: Active monitoring requires stable client Wi-Fi connection at the inverter site.", sort_order: 11 },
    { id: "term-12", term_text: "Wi-Fi requirement: Customer must provide stable continuous Wi-Fi access for monitoring data synch.", sort_order: 12 },
    { id: "term-13", term_text: "Client scope of work: Providing masonry work access, temporary electricity & water during construction.", sort_order: 13 },
    { id: "term-14", term_text: "Civil work exclusions: Cutting of structural concrete slabs or custom aesthetic tiles is excluded unless quoted.", sort_order: 14 },
    { id: "term-15", term_text: "Net metering clearance remains the client's responsibility if document verification faults occur.", sort_order: 15 },
    { id: "term-16", term_text: "Panel washing advisory: Clean arrays bi-weekly for optimal generation yield performance.", sort_order: 16 },
    { id: "term-17", term_text: "Force majeure: Sunchaser is not liable for delays caused by national strikes, weather anomalies, or utility board freezes.", sort_order: 17 }
  ],
  ceoMessages: [
    { id: "ceo-1", name: "Muhammad Allauddin", designation: "CEO, Engineering & Operations", message: "At Sunchaser, our engineering philosophy is simple: we build systems that outlast a generation. We refuse to cut corners on material gauges, hot-dip zinc coating parameters, wire thicknesses, or chemical earthing bores. Every layout is physically verified, and every termination complies with ISO standards. Sunchaser means ultimate power security.", signature_url: "", photo_url: "" },
    { id: "ceo-2", name: "Barrister Raza Khan Niazi", designation: "CEO Strategy & Innovation / Compliance", message: "Liaison with utility boards and regulatory licensing can be daunting for clients. Sunchaser handles the entire paperwork and NEPRA filing process transparently. We promise that all governmental files are processed legally, demand notices are audited, and net metering activations are completed with maximal efficiency.", signature_url: "", photo_url: "" }
  ],
  socialLinks: [
    { id: "soc-1", platform: "Customer Portal", url: "http://sunchaser.co/portal", qr_code_url: "" },
    { id: "soc-2", platform: "Corporate Registry", url: "http://sunchaser.co/registry", qr_code_url: "" }
  ],
  structureDescriptions: [
    { id: "struct-1", structure_type: "standard", title: "Standard Structure", description_en: "Premium Galvanized Mounting Structure, wind resistant up to 130 km/h.", description_ur: "پریمیم گیلوانائزڈ ماونٹنگ سٹرکچر، 130 کلومیٹر فی گھنٹہ تک ہوا کے خلاف مزاحم۔", material_type: "Galvanized L3 Steel", weight: "Standard Frame", wind_rating: "130 km/h", warranty: "10 Years Warranty", image_url: "" },
    { id: "struct-2", structure_type: "elevated", title: "Elevated Structure", description_en: "10ft Roof clearance hot-dip galvanized elevated structure frame.", description_ur: "10 فٹ چھت کی اونچائی کا ہاٹ ڈِپ گیلوانائزڈ ایلیویٹڈ سٹرکچر فریم۔", material_type: "Hot-dip Galvanized Steel", weight: "Heavy Frame", wind_rating: "130 km/h", warranty: "10 Years Warranty", image_url: "" },
    { id: "struct-3", structure_type: "girder", title: "Girder Structure", description_en: "Heavy-Duty Mughal Girder Frame supporting extreme wind shear.", description_ur: "ہیوی ڈیوٹی مغل گارڈر فریم جو شدید ہوا کے دباؤ کو برداشت کرتا ہے۔", material_type: "Mughal Girder Steel", weight: "1600g/ft Structural Load", wind_rating: "150 km/h", warranty: "15 Years Warranty", image_url: "" }
  ],
  quotePdfSettings: [
    { id: "settings-1", company_name: "SUNCHASER ENERGY SYSTEMS", office_address: "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore", hotline_phones: "0309-0236666, 0330-7776444", billing_email: "billing@sunchaser-energy.com", website_url: "www.sunchaser-energy.com", logo_url: "" }
  ]
};

/* --- CALCULATIONS HELPERS --- */
export function calculateLeadScore(lead: any) {
  let score = 30; // base score

  if (lead.monthlyBill > 300) score += 25;
  else if (lead.monthlyBill > 200) score += 18;
  else if (lead.monthlyBill > 100) score += 10;
  else score += 5;

  if (lead.roofSpace > 1200) score += 20;
  else if (lead.roofSpace > 800) score += 12;
  else score += 5;

  if (lead.shading === "None") score += 25;
  else if (lead.shading === "Low") score += 20;
  else if (lead.shading === "Medium") score += 10;
  else score += 2;

  if (lead.engagementLevel === "High") score += 20;
  else if (lead.engagementLevel === "Medium") score += 10;
  else score += 2;

  if (lead.leadSource === "Direct/Referral") score += 10;
  else if (lead.leadSource === "Web Search") score += 8;
  else score += 5;

  const finalScore = Math.min(100, Math.max(10, score));
  const pb = Math.round(finalScore * 0.95);

  lead.conversionScore = finalScore;
  lead.conversionProbability = pb;
}

export function getDashboardStats(activeDb: Database) {
  const totalRevenue = activeDb.leads.reduce((sum: number, lead: any) => {
    const acceptedQuotes = (lead.quotes || []).filter((q: any) => q.status === "Accepted");
    return sum + acceptedQuotes.reduce((s: number, q: any) => s + q.totalCost, 0);
  }, 0);

  const pendingRevenue = activeDb.leads.reduce((sum: number, lead: any) => {
    if (lead.status !== "Installed" && lead.status !== "Contracted") {
      const pendingQuotes = (lead.quotes || []).filter((q: any) => q.status !== "Accepted");
      return sum + (pendingQuotes.length > 0 ? pendingQuotes[0].totalCost : 0);
    }
    return sum;
  }, 0);

  const totalLeads = activeDb.leads.length;
  const installedCount = activeDb.leads.filter((l: any) => l.status === "Installed").length;
  const contractedCount = activeDb.leads.filter((l: any) => l.status === "Contracted").length;
  const pipelineCount = totalLeads - installedCount;

  const statusBins: Record<string, number> = {
    New: 0,
    Contacted: 0,
    "Survey Scheduled": 0,
    Quoted: 0,
    Contracted: 0,
    Installed: 0,
    Negotiation: 0,
    Won: 0,
    Lost: 0
  };

  activeDb.leads.forEach((l: any) => {
    if (statusBins[l.status] !== undefined) {
      statusBins[l.status]++;
    } else {
      statusBins[l.status] = 1;
    }
  });

  return {
    totalRevenue,
    pendingRevenue,
    totalLeads,
    installedCount,
    contractedCount,
    pipelineCount,
    leadsByStatus: statusBins
  };
}

const QUOTE_EXT_FALLBACK_PREFIX = "__SUNCHASER_EXT__:";

export function buildQuoteExtendedPayload(quote: any): Record<string, any> {
  return {
    clientName: quote.clientName,
    clientPhone: quote.clientPhone,
    clientEmail: quote.clientEmail,
    clientAddress: quote.clientAddress,
    cnic: quote.cnic,
    cityArea: quote.cityArea,
    bdmName: quote.bdmName,
    quoteDate: quote.quoteDate,
    systemType: quote.systemType,
    panelBrand: quote.panelBrand,
    panelWattage: quote.panelWattage,
    inverterBrand: quote.inverterBrand,
    inverterCapacity: quote.inverterCapacity,
    batteryOption: quote.batteryOption,
    netMeteringRequired: quote.netMeteringRequired,
    discount: quote.discount,
    paymentSchedule: quote.paymentSchedule,
    boqItems: quote.boqItems,
    lescoSettings: quote.lescoSettings,
    societyCharges: quote.societyCharges,
    taxEnabled: quote.taxEnabled,
    taxRate: quote.taxRate,
    taxAmount: quote.taxAmount,
    selectedStructure: quote.selectedStructure,
    customStructure: quote.customStructure,
    boqRows: quote.boqRows,
    customNotes: quote.customNotes,
    grandTotal: quote.grandTotal,
    netTotal: quote.netTotal,
    idempotencyKey: quote.idempotencyKey,
    templateId: quote.templateId,
    includedPages: quote.includedPages,
    includeSizerItems: quote.includeSizerItems === true,
    quote_type: quote.quote_type || (AUTO_SIZER_QUOTE_CREATION_ENABLED ? "auto_sizer" : "manual_boq"),
    termsAndConditions: quote.termsAndConditions,
  };
}

export function parseQuotationExtendedData(row: any): Record<string, any> {
  if (row?.extended_data) {
    return typeof row.extended_data === "string"
      ? JSON.parse(row.extended_data)
      : row.extended_data;
  }
  const terms = row?.terms_and_conditions;
  if (typeof terms === "string" && terms.startsWith(QUOTE_EXT_FALLBACK_PREFIX)) {
    try {
      return JSON.parse(terms.slice(QUOTE_EXT_FALLBACK_PREFIX.length));
    } catch {
      return {};
    }
  }
  return {};
}

export function buildQuotationSupabaseRow(
  leadId: string,
  customerId: string,
  quote: any,
  options?: { includeExtendedColumn?: boolean }
): Record<string, any> {
  const ext = buildQuoteExtendedPayload(quote);
  const row: Record<string, any> = {
    id: quote.id,
    lead_id: leadId,
    customer_id: customerId,
    system_size_kw: quote.systemSizekW,
    panel_count: quote.panelCount,
    panel_type: quote.panelType,
    inverter_type: quote.inverterType,
    battery_capacity: quote.batteryCapacity,
    total_cost: quote.totalCost,
    federal_tax_credit: quote.federalTaxCredit ?? 0,
    net_cost: quote.netCost,
    estimated_annual_savings: quote.estimatedAnnualSavings,
    payback_period_years: quote.paybackPeriodYears,
    status: quote.status,
    structure_type: quote.structureType,
    accessories: quote.accessories,
    installation_charges: quote.installationCharges || 0,
    net_metering_charges: quote.netMeteringCharges || 0,
    payment_terms: quote.paymentTerms,
    warranty_terms: quote.warrantyTerms,
    terms_and_conditions: quote.termsAndConditions,
  };
  if (options?.includeExtendedColumn !== false) {
    row.extended_data = ext;
  } else {
    row.terms_and_conditions =
      QUOTE_EXT_FALLBACK_PREFIX + JSON.stringify(ext);
  }
  return row;
}

export async function persistQuotationToSupabase(
  supabase: SupabaseClient,
  leadId: string,
  customerId: string,
  quote: any,
  mode: "insert" | "upsert" = "insert"
): Promise<{ ok: boolean; error?: string }> {
  const withExt = buildQuotationSupabaseRow(leadId, customerId, quote, {
    includeExtendedColumn: true,
  });
  const attempt =
    mode === "upsert"
      ? await supabase.from("quotations").upsert(withExt, { onConflict: "id" })
      : await supabase.from("quotations").insert(withExt);

  if (!attempt.error) return { ok: true };

  const missingExt =
    attempt.error.message?.includes("extended_data") ||
    attempt.error.message?.includes("schema cache");
  if (!missingExt) {
    return { ok: false, error: attempt.error.message };
  }

  const fallback = buildQuotationSupabaseRow(leadId, customerId, quote, {
    includeExtendedColumn: false,
  });
  const retry =
    mode === "upsert"
      ? await supabase.from("quotations").upsert(fallback, { onConflict: "id" })
      : await supabase.from("quotations").insert(fallback);

  if (retry.error) return { ok: false, error: retry.error.message };
  return { ok: true };
}

/* --- SUPABASE GETTER / JOINER --- */
export async function fetchAppStateFromSupabase(): Promise<Database> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
  const useLocalConfigFallback = false;

  let localBackup: any = {};
  try {
    const backupPath = path.join(process.cwd(), "database.json");
    if (fs.existsSync(backupPath)) {
      localBackup = JSON.parse(fs.readFileSync(backupPath, "utf-8"));
    }
  } catch (e) {
    // ignore
  }

  // Safe table fetch function that prevents crashing if a table hasn't been created yet
  const safeFetch = async (tableName: string, defaultVal: any = []) => {
    try {
      const { data, error } = await supabase.from(tableName).select("*");
      if (error) {
        console.warn(`[Supabase Warning] Could not fetch table '${tableName}' (might not exist yet):`, error.message);
        return defaultVal;
      }
      return data || defaultVal;
    } catch (err: any) {
      console.warn(`[Supabase Error] Exception fetching table '${tableName}':`, err.message);
      return defaultVal;
    }
  };

  // Fetch all tables in parallel safely
  const [
    users,
    leadsData,
    quotesData,
    surveysData,
    tasksData,
    projectsData,
    trackersData,
    paymentsData,
    ticketsData,
    productsInventoryData,
    activityLogsData,
    whatsappLogsData,
    categoriesData,
    productsCatalogData,
    ordersData,
    warrantiesData,
    notificationsData,
    solarPackagesData,
    settingsData,
    websiteContentData,
    purchaseOrdersData,
    quoteTemplatesData,
    quoteTemplatePagesData,
    bankAccountsData,
    companyTermsData,
    ceoMessagesData,
    socialLinksData,
    structureDescriptionsData,
    quotePdfSettingsData
  ] = await Promise.all([
    safeFetch("users"),
    safeFetch("leads"),
    safeFetch("quotations"),
    safeFetch("site_surveys"),
    safeFetch("installation_tasks"),
    safeFetch("projects"),
    safeFetch("net_metering_trackers"),
    safeFetch("payments"),
    safeFetch("support_tickets"),
    safeFetch("products_inventory"),
    safeFetch("activity_logs"),
    safeFetch("whatsapp_logs"),
    safeFetch("categories"),
    safeFetch("products"),
    safeFetch("orders"),
    safeFetch("warranties"),
    safeFetch("notifications"),
    safeFetch("solar_packages"),
    safeFetch("settings"),
    safeFetch("website_content"),
    safeFetch("purchase_orders"),
    safeFetch("quote_templates"),
    safeFetch("quote_template_pages"),
    safeFetch("bank_accounts"),
    safeFetch("company_terms"),
    safeFetch("ceo_messages"),
    safeFetch("social_links"),
    safeFetch("structure_descriptions"),
    safeFetch("quote_pdf_settings")
  ]);

  // Assemble leads with nested attributes
  const leadsMapped = (leadsData || []).map((lead: any) => {
    const quotes = (quotesData || [])
      .filter((q: any) => q.lead_id === lead.id)
      .map((q: any) => {
        const ext = parseQuotationExtendedData(q);
        return {
          id: q.id,
          systemSizekW: Number(q.system_size_kw),
          panelCount: q.panel_count,
          panelType: q.panel_type,
          inverterType: q.inverter_type,
          batteryCapacity: q.battery_capacity,
          totalCost: Number(q.total_cost),
          federalTaxCredit: Number(q.federal_tax_credit),
          netCost: Number(q.net_cost),
          estimatedAnnualSavings: Number(q.estimated_annual_savings),
          paybackPeriodYears: Number(q.payback_period_years),
          status: q.status,
          createdAt: q.created_at,
          structureType: q.structure_type,
          accessories: q.accessories,
          installationCharges: Number(q.installation_charges || 0),
          netMeteringCharges: Number(q.net_metering_charges || 0),
          paymentTerms: q.payment_terms,
          warrantyTerms: q.warranty_terms,
          termsAndConditions: q.terms_and_conditions,
          ...ext
        };
      });

    const s = (surveysData || []).find((sd: any) => sd.lead_id === lead.id);
    let surveyObj: any = undefined;
    if (s) {
      let panels = [];
      try {
        panels = typeof s.panel_placements === "string" ? JSON.parse(s.panel_placements) : (s.panel_placements || []);
      } catch (e) {
        panels = [];
      }
      surveyObj = {
        scheduledDate: s.scheduled_date,
        status: s.status,
        notes: s.notes,
        shadingPercent: Number(s.shading_percent || 0),
        optimalPlacement: s.optimal_placement,
        photos: s.photos || [],
        measurements: {
          roofPitch: s.roof_pitch,
          rafterSpacing: s.rafter_spacing,
          dimensions: s.dimensions,
          obstructions: s.obstructions
        },
        structureRecommendation: s.structure_recommendation,
        dbInverterLocation: s.db_inverter_location,
        panelPlacements: panels
      };
    }

    const relatedTasks = (tasksData || [])
      .filter((td: any) => td.lead_id === lead.id)
      .map((t: any) => ({
        id: t.id.split("-").pop() || t.id, // strip the uniqueness prefix
        name: t.name,
        done: t.done
      }));

    let installationObj: any = undefined;
    const proj = (projectsData || []).find((pd: any) => pd.lead_id === lead.id);
    if (proj || relatedTasks.length > 0) {
      installationObj = {
        status: lead.status === "Installed" ? "Completed" : (lead.status === "Contracted" ? "Scheduled" : "In Progress"),
        scheduledDate: s?.scheduled_date || new Date().toISOString(),
        progress: lead.status === "Installed" ? 100 : (relatedTasks.length > 0 ? Math.round((relatedTasks.filter((t: any) => t.done).length / relatedTasks.length) * 100) : 20),
        tasks: relatedTasks,
        completionPhotos: s?.photos || [],
        report: s?.notes || ""
      };
    }

    return {
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      address: lead.address,
      status: lead.status,
      monthlyBill: Number(lead.monthly_bill || 0),
      monthlyUnits: Number(lead.monthly_units || 0),
      sanctionedLoad: Number(lead.sanctioned_load || 0),
      backupRequirement: lead.backup_requirement,
      location: lead.location,
      roofType: lead.roof_type,
      roofSpace: Number(lead.roof_space || 0),
      shading: lead.shading,
      rating: lead.rating,
      assignedSalesperson: lead.assigned_salesperson,
      notes: lead.notes,
      leadSource: lead.lead_source,
      engagementLevel: lead.engagement_level,
      conversionProbability: Number(lead.conversion_probability || 50),
      conversionScore: Number(lead.conversion_score || 50),
      createdAt: lead.created_at,
      quotes,
      survey: surveyObj,
      installation: installationObj
    };
  });

  const netMeteringTrackers: Record<string, any> = {};
  (trackersData || []).forEach((tracker: any) => {
    netMeteringTrackers[tracker.lead_id] = {
      leadId: tracker.lead_id,
      documentsCollected: tracker.documents_collected,
      applicationSubmitted: tracker.application_submitted,
      discoInspection: tracker.disco_inspection,
      demandNotice: tracker.demand_notice,
      meterInstallation: tracker.meter_installation,
      greenMeterActive: tracker.green_meter_active
    };
  });

  const paymentTracks: Record<string, any> = {};
  (paymentsData || []).forEach((pay: any) => {
    let milestones = [];
    try {
      milestones = typeof pay.milestones === "string" ? JSON.parse(pay.milestones) : (pay.milestones || []);
    } catch (e) {
      milestones = [];
    }
    paymentTracks[pay.lead_id] = {
      leadId: pay.lead_id,
      totalValue: Number(pay.total_value || 0),
      advanceReceived: Number(pay.advance_received || 0),
      pendingAmount: Number(pay.pending_amount || 0),
      reminderSent: pay.reminder_sent,
      invoiceStatus: pay.invoice_status,
      milestones
    };
  });

  const inventoryMapped = (productsInventoryData || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    desc: p.description,
    stock: p.stock,
    cost: Number(p.cost || 0)
  }));

  const projectsMapped = (projectsData || []).map((p: any) => ({
    id: p.id,
    leadId: p.lead_id,
    customerName: p.customer_name,
    address: p.address,
    systemSizekW: Number(p.system_size_kw || 0),
    stage: p.stage,
    createdAt: p.created_at,
    updatedAt: p.updated_at
  }));

  const ticketsMapped = (ticketsData || []).map((t: any) => {
    let msgs = [];
    try {
      msgs = typeof t.messages === "string" ? JSON.parse(t.messages) : (t.messages || []);
    } catch (e) {
      msgs = [];
    }
    let pObj = [];
    try {
      pObj = typeof t.photos === "string" ? JSON.parse(t.photos) : (t.photos || []);
    } catch (e) {
      pObj = [];
    }
    let vObj = [];
    try {
      vObj = typeof t.videos === "string" ? JSON.parse(t.videos) : (t.videos || []);
    } catch (e) {
      vObj = [];
    }
    return {
      id: t.id,
      customerName: t.customer_name,
      email: t.email,
      subject: t.subject,
      description: t.description,
      status: t.status,
      priority: t.priority,
      createdAt: t.created_at,
      messages: msgs,
      productSelection: t.product_selection,
      photos: pObj,
      videos: vObj,
      voiceNoteUrl: t.voice_note_url,
      location: t.location,
      preferredVisitTime: t.preferred_visit_time,
      assignedTechnician: t.assigned_technician,
      internalNotes: t.internal_notes,
      resolutionProofUrl: t.resolution_proof_url
    };
  });

  const activityLogsMapped = (activityLogsData || []).map((l: any) => ({
    id: l.id,
    timestamp: l.timestamp,
    userId: l.user_id,
    userName: l.user_name,
    role: l.role,
    action: l.action,
    details: l.details
  }));

  const whatsappLogsMapped = (whatsappLogsData || []).map((l: any) => ({
    id: l.id,
    timestamp: l.timestamp,
    customerName: l.customer_name,
    phone: l.phone,
    eventType: l.event_type,
    messageText: l.message_text,
    status: l.status
  }));

  // Resolve config keys (settings & CMS website content)
  const settingsObj = (settingsData || []).find((s: any) => s.key === "global")?.value || null;
  const websiteContentObj = (websiteContentData || []).find((w: any) => w.key === "global")?.value || null;

  // Additional ERP metrics mapping
  const productsCatalogMapped = (productsCatalogData || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    brand: p.brand,
    model: p.model,
    sku: p.sku,
    price: Number(p.price || 0),
    discount: Number(p.discount || 0),
    stock: Number(p.stock || 0),
    images: p.images || [],
    warrantyPeriod: p.warranty_period,
    specifications: typeof p.specifications === "string" ? JSON.parse(p.specifications) : (p.specifications || {})
  }));

  const ordersMapped = (ordersData || []).map((o: any) => ({
    id: o.id,
    customerName: o.customer_name,
    email: o.email,
    phone: o.phone,
    address: o.address,
    orderType: o.order_type,
    status: o.status,
    items: typeof o.items === "string" ? JSON.parse(o.items) : (o.items || []),
    totalCost: Number(o.total_cost || 0),
    createdAt: o.created_at || new Date().toISOString(),
    installationRequired: !!o.installation_required
  }));

  const warrantiesMapped = (warrantiesData || []).map((w: any) => ({
    id: w.id,
    customerName: w.customer_name,
    email: w.email,
    productName: w.product_name,
    productSku: w.product_sku,
    serialNumber: w.serial_number,
    startDate: w.start_date,
    endDate: w.end_date,
    installationDate: w.installation_date,
    claimHistory: typeof w.claim_history === "string" ? JSON.parse(w.claim_history) : (w.claim_history || []),
    status: w.status
  }));

  const solarPackagesMapped = (solarPackagesData || []).map((sp: any) => ({
    id: sp.id,
    name: sp.name,
    panelBrand: sp.panel_brand,
    inverterBrand: sp.inverter_brand,
    batteryOption: sp.battery_option,
    price: Number(sp.price || 0),
    structureType: sp.structure_type,
    profitMargin: Number(sp.profit_margin || 0),
    enabled: !!sp.enabled
  }));

  const categoriesMapped = (categoriesData || []).map((cat: any) => ({
    id: cat.id,
    name: cat.name,
    description: cat.description,
    icon: cat.icon
  }));

  const notificationsMapped = (notificationsData || []).map((n: any) => ({
    id: n.id,
    customerName: n.customer_name,
    message: n.message,
    type: n.type,
    read: !!n.read,
    createdAt: n.created_at || new Date().toISOString()
  }));

  const purchaseOrdersMapped = (purchaseOrdersData || []).map((po: any) => ({
    id: po.id,
    supplierName: po.supplier_name,
    orderDate: po.order_date,
    totalCost: Number(po.total_cost || 0),
    status: po.status,
    items: typeof po.items === "string" ? JSON.parse(po.items) : (po.items || [])
  }));

  const quoteTemplatesMapped = (quoteTemplatesData || []).map((qt: any) => ({
    id: qt.id,
    name: qt.name,
    isActive: !!qt.is_active
  }));

  const quoteTemplatePagesMapped = (quoteTemplatePagesData || []).map((qtp: any) => ({
    id: qtp.id,
    template_id: qtp.template_id,
    templateId: qtp.template_id,
    page_type: qtp.page_type,
    pageType: qtp.page_type,
    title: qtp.title,
    body_text: qtp.body_text,
    bodyText: qtp.body_text,
    image_url: qtp.image_url,
    imageUrl: qtp.image_url,
    bg_image_url: qtp.bg_image_url,
    bgImageUrl: qtp.bg_image_url,
    is_enabled: !!qtp.is_enabled,
    isEnabled: !!qtp.is_enabled,
    sort_order: Number(qtp.sort_order || 0),
    sortOrder: Number(qtp.sort_order || 0)
  }));

  const bankAccountsMapped = (bankAccountsData || []).map((ba: any) => ({
    id: ba.id,
    bankName: ba.bank_name,
    accountTitle: ba.account_title || ba.title,
    accountNumber: ba.account_number || ba.accountNo,
    iban: ba.iban,
    branchCode: ba.branch_code,
    isActive: !!ba.is_active,
    sortOrder: Number(ba.sort_order || 0)
  }));

  const companyTermsMapped = (companyTermsData || []).map((ct: any) => ({
    id: ct.id,
    termText: ct.term_text || ct.termText,
    sortOrder: Number(ct.sort_order || 0)
  }));

  const ceoMessagesMapped = (ceoMessagesData || []).map((cm: any) => ({
    id: cm.id,
    name: cm.name,
    designation: cm.designation,
    message: cm.message,
    signatureUrl: cm.signature_url || cm.signatureUrl,
    photoUrl: cm.photo_url || cm.photoUrl
  }));

  const socialLinksMapped = (socialLinksData || []).map((sl: any) => ({
    id: sl.id,
    platform: sl.platform,
    url: sl.url,
    qrCodeUrl: sl.qr_code_url || sl.qrCodeUrl
  }));

  const structureDescriptionsMapped = (structureDescriptionsData || []).map((sd: any) => ({
    id: sd.id,
    structureType: sd.structure_type || sd.structureType,
    title: sd.title,
    descriptionEn: sd.description_en || sd.descriptionEn,
    descriptionUr: sd.description_ur || sd.descriptionUr,
    materialType: sd.material_type || sd.materialType,
    weight: sd.weight,
    windRating: sd.wind_rating || sd.windRating,
    warranty: sd.warranty,
    imageUrl: sd.image_url || sd.imageUrl
  }));

  const quotePdfSettingsMapped = (quotePdfSettingsData || []).map((qps: any) => ({
    id: qps.id,
    companyName: qps.company_name || qps.companyName,
    officeAddress: qps.office_address || qps.officeAddress,
    hotlinePhones: qps.hotline_phones || qps.hotlinePhones,
    billingEmail: qps.billing_email || qps.billingEmail,
    websiteUrl: qps.website_url || qps.websiteUrl,
    logoUrl: qps.logo_url || qps.logoUrl
  }));

  const usersMapped = (users || []).map((u: any) => ({
    id: u.id,
    username: u.username,
    password: u.password,
    name: u.name,
    email: u.email,
    role: resolveAppUserRole(u.username, u.role),
  }));

  return {
    users: usersMapped,
    leads: leadsMapped,
    tickets: ticketsMapped,
    netMeteringHistory: [
      { month: "Jan", consumption: 850, generation: 420 },
      { month: "Feb", consumption: 790, generation: 510 },
      { month: "Mar", consumption: 710, generation: 750 },
      { month: "Apr", consumption: 680, generation: 980 },
      { month: "May", consumption: 750, generation: 1220 }
    ],
    inventory: inventoryMapped,
    projects: projectsMapped,
    netMeteringTrackers,
    paymentTracks,
    activityLogs: activityLogsMapped,
    whatsAppLogs: whatsappLogsMapped,
    categories: categoriesMapped.length > 0 ? categoriesMapped : undefined,
    products: productsCatalogMapped.length > 0 ? productsCatalogMapped : undefined,
    orders: ordersMapped.length > 0 ? ordersMapped : undefined,
    warranties: warrantiesMapped.length > 0 ? warrantiesMapped : undefined,
    notifications: notificationsMapped.length > 0 ? notificationsMapped : undefined,
    solarPackages: solarPackagesMapped.length > 0 ? solarPackagesMapped : undefined,
    settings: settingsObj || (useLocalConfigFallback ? localBackup.settings : undefined),
    websiteContent: websiteContentObj || (useLocalConfigFallback ? localBackup.websiteContent : undefined),
    purchaseOrders: purchaseOrdersMapped.length > 0 ? purchaseOrdersMapped : (useLocalConfigFallback ? (localBackup.purchaseOrders || []) : []),
    quoteTemplates: quoteTemplatesMapped.length > 0 ? quoteTemplatesMapped : (localBackup.quoteTemplates || initialSeed.quoteTemplates || []),
    quoteTemplatePages: quoteTemplatePagesMapped.length > 0 ? quoteTemplatePagesMapped : (localBackup.quoteTemplatePages || initialSeed.quoteTemplatePages || []),
    bankAccounts: bankAccountsMapped.length > 0 ? bankAccountsMapped : (localBackup.bankAccounts || initialSeed.bankAccounts || []),
    companyTerms: companyTermsMapped.length > 0 ? companyTermsMapped : (localBackup.companyTerms || initialSeed.companyTerms || []),
    ceoMessages: ceoMessagesMapped.length > 0 ? ceoMessagesMapped : (localBackup.ceoMessages || initialSeed.ceoMessages || []),
    socialLinks: socialLinksMapped.length > 0 ? socialLinksMapped : (localBackup.socialLinks || initialSeed.socialLinks || []),
    structureDescriptions: structureDescriptionsMapped.length > 0 ? structureDescriptionsMapped : (localBackup.structureDescriptions || initialSeed.structureDescriptions || []),
    quotePdfSettings: quotePdfSettingsMapped.length > 0 ? quotePdfSettingsMapped : (localBackup.quotePdfSettings || initialSeed.quotePdfSettings || [])
  };
}

/* --- AUTOMATIC RELATION STATE MIGRATOR --- */
export async function runDatabaseMigration(localDbData: any): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  console.log("🚀 [Sunchaser Migration] Migrating seed data to Supabase...");

  try {
    // 1. Users
    if (localDbData.users) {
      for (const u of localDbData.users) {
        await supabase.from("users").upsert({
          id: u.id,
          username: u.username,
          password: u.password,
          name: u.name,
          email: u.email,
          role: u.role
        }, { onConflict: "id" });
      }
    }

    // 2. Inventory
    if (localDbData.inventory) {
      for (const item of localDbData.inventory) {
        await supabase.from("products_inventory").upsert({
          id: item.id,
          name: item.name,
          category: item.category,
          description: item.desc || "",
          stock: item.stock || 0,
          cost: item.cost || 0
        }, { onConflict: "id" });
      }
    }

    // 3. Customers, Leads, Site Surveys, Installation Tasks, Quotations
    if (localDbData.leads) {
      for (const l of localDbData.leads) {
        const customerId = `cust-${l.id.replace("lead-", "")}`;

        await supabase.from("customers").upsert({
          id: customerId,
          name: l.name,
          email: l.email,
          phone: l.phone,
          address: l.address
        }, { onConflict: "id" });

        await supabase.from("leads").upsert({
          id: l.id,
          customer_id: customerId,
          name: l.name,
          email: l.email,
          phone: l.phone,
          address: l.address,
          status: l.status,
          monthly_bill: l.monthlyBill || 0,
          monthly_units: l.monthlyUnits || 0,
          sanctioned_load: l.sanctionedLoad || 0,
          backup_requirement: l.backupRequirement || "None",
          location: l.location || "Springfield",
          roof_type: l.roofType || "Asphalt Shingle",
          roof_space: l.roofSpace || 0,
          shading: l.shading || "None",
          rating: l.rating || 3,
          assigned_salesperson: l.assignedSalesperson || "",
          notes: l.notes || "",
          lead_source: l.leadSource || "",
          engagement_level: l.engagementLevel || "Medium",
          conversion_probability: l.conversionProbability || 50,
          conversion_score: l.conversionScore || 50,
          created_at: l.createdAt || new Date().toISOString()
        }, { onConflict: "id" });

        if (l.survey) {
          await supabase.from("site_surveys").upsert({
            lead_id: l.id,
            scheduled_date: l.survey.scheduledDate || null,
            status: l.survey.status || "Pending",
            notes: l.survey.notes || "",
            shading_percent: l.survey.shadingPercent || 0,
            optimal_placement: l.survey.optimalPlacement || "",
            photos: l.survey.photos || [],
            roof_pitch: l.survey.measurements?.roofPitch || "",
            rafter_spacing: l.survey.measurements?.rafterSpacing || "",
            dimensions: l.survey.measurements?.dimensions || "",
            obstructions: l.survey.measurements?.obstructions || "",
            structure_recommendation: l.survey.structureRecommendation || "",
            db_inverter_location: l.survey.dbInverterLocation || "",
            panel_placements: JSON.stringify(l.survey.panelPlacements || [])
          }, { onConflict: "lead_id" });
        }

        if (l.installation && Array.isArray(l.installation.tasks)) {
          for (const task of l.installation.tasks) {
            await supabase.from("installation_tasks").upsert({
              id: `${l.id}-${task.id}`,
              lead_id: l.id,
              name: task.name,
              done: task.done || false
            }, { onConflict: "id" });
          }
        }

        if (l.quotes) {
          for (const q of l.quotes) {
            await supabase.from("quotations").upsert({
              id: q.id,
              lead_id: l.id,
              customer_id: customerId,
              system_size_kw: q.systemSizekW || 0,
              panel_count: q.panelCount || 0,
              panel_type: q.panelType || "Sunchaser Ultra 400W",
              inverter_type: q.inverterType || "Enphase IQ8 Microinverter",
              battery_capacity: q.batteryCapacity || "",
              total_cost: q.totalCost || 0,
              federal_tax_credit: q.federalTaxCredit || 0,
              net_cost: q.netCost || 0,
              estimated_annual_savings: q.estimatedAnnualSavings || 0,
              payback_period_years: q.paybackPeriodYears || 0,
              status: q.status || "Pending",
              structure_type: q.structureType || "",
              accessories: q.accessories || "",
              installation_charges: q.installationCharges || 0,
              net_metering_charges: q.netMeteringCharges || 0,
              payment_terms: q.paymentTerms || "",
              warranty_terms: q.warrantyTerms || "",
              terms_and_conditions: q.termsAndConditions || "",
              extended_data: {
                clientName: q.clientName,
                clientPhone: q.clientPhone,
                clientEmail: q.clientEmail,
                clientAddress: q.clientAddress,
                cnic: q.cnic,
                cityArea: q.cityArea,
                bdmName: q.bdmName,
                quoteDate: q.quoteDate,
                systemType: q.systemType,
                panelBrand: q.panelBrand,
                panelWattage: q.panelWattage,
                inverterBrand: q.inverterBrand,
                inverterCapacity: q.inverterCapacity,
                batteryOption: q.batteryOption,
                netMeteringRequired: q.netMeteringRequired,
                discount: q.discount,
                paymentSchedule: q.paymentSchedule,
                boqItems: q.boqItems,
                lescoSettings: q.lescoSettings,
                societyCharges: q.societyCharges,
                taxEnabled: q.taxEnabled,
                taxRate: q.taxRate,
                taxAmount: q.taxAmount,
                selectedStructure: q.selectedStructure,
                customStructure: q.customStructure,
                boqRows: q.boqRows,
                customNotes: q.customNotes,
                grandTotal: q.grandTotal,
                netTotal: q.netTotal,
                templateId: q.templateId,
                includedPages: q.includedPages,
                includeSizerItems: q.includeSizerItems === true,
                quote_type: q.quote_type || "auto_sizer"
              },
              created_at: q.createdAt || new Date().toISOString()
            }, { onConflict: "id" });
          }
        }
      }
    }

    // 4. Projects
    if (localDbData.projects) {
      for (const p of localDbData.projects) {
        const customerId = `cust-${p.leadId.replace("lead-", "")}`;
        await supabase.from("projects").upsert({
          id: p.id,
          lead_id: p.leadId,
          customer_id: customerId,
          customer_name: p.customerName || "N/A",
          address: p.address || "N/A",
          system_size_kw: p.systemSizekW || 0,
          stage: p.stage || "Advance Received",
          created_at: p.createdAt || new Date().toISOString(),
          updated_at: p.updatedAt || new Date().toISOString()
        }, { onConflict: "id" });
      }
    }

    // 5. Net Metering
    if (localDbData.netMeteringTrackers) {
      for (const leadId of Object.keys(localDbData.netMeteringTrackers)) {
        const tracker = localDbData.netMeteringTrackers[leadId];
        await supabase.from("net_metering_trackers").upsert({
          lead_id: leadId,
          documents_collected: tracker.documentsCollected || false,
          application_submitted: tracker.applicationSubmitted || false,
          disco_inspection: tracker.discoInspection || false,
          demand_notice: tracker.demandNotice || false,
          meter_installation: tracker.meterInstallation || false,
          green_meter_active: tracker.greenMeterActive || false,
          updated_at: new Date().toISOString()
        }, { onConflict: "lead_id" });
      }
    }

    // 6. Payments Tracker
    if (localDbData.paymentTracks) {
      for (const leadId of Object.keys(localDbData.paymentTracks)) {
        const pay = localDbData.paymentTracks[leadId];
        const customerId = `cust-${leadId.replace("lead-", "")}`;
        await supabase.from("payments").upsert({
          lead_id: leadId,
          customer_id: customerId,
          total_value: pay.totalValue || 0,
          advance_received: pay.advanceReceived || 0,
          pending_amount: pay.pendingAmount || 0,
          reminder_sent: pay.reminder_sent || false,
          invoice_status: pay.invoiceStatus || "Pending",
          milestones: JSON.stringify(pay.milestones || []),
          updated_at: new Date().toISOString()
        }, { onConflict: "lead_id" });
      }
    }

    // 7. Support Tickets
    if (localDbData.tickets) {
      for (const t of localDbData.tickets) {
        await supabase.from("support_tickets").upsert({
          id: t.id,
          customer_name: t.customerName,
          email: t.email,
          subject: t.subject,
          description: t.description,
          status: t.status,
          priority: t.priority,
          messages: JSON.stringify(t.messages || [])
        }, { onConflict: "id" });
      }
    }

    // 8. WhatsApp Logs
    if (localDbData.whatsAppLogs) {
      for (const log of localDbData.whatsAppLogs) {
        await supabase.from("whatsapp_logs").upsert({
          id: log.id,
          timestamp: log.timestamp || new Date().toISOString(),
          customer_name: log.customerName,
          phone: log.phone,
          event_type: log.eventType,
          message_text: log.messageText,
          status: log.status || "Delivered"
        }, { onConflict: "id" });
      }
    }

    // 9. Activity Logs
    if (localDbData.activityLogs) {
      for (const log of localDbData.activityLogs) {
        await supabase.from("activity_logs").upsert({
          id: log.id,
          timestamp: log.timestamp || new Date().toISOString(),
          user_id: log.userId || "system",
          user_name: log.userName || "System",
          role: log.role || "CRM",
          action: log.action || "Log",
          details: log.details || ""
        }, { onConflict: "id" });
      }
    }

    // 10. Categories
    if (localDbData.categories) {
      for (const cat of localDbData.categories) {
        await supabase.from("categories").upsert({
          id: cat.id,
          name: cat.name,
          description: cat.description,
          icon: cat.icon
        }, { onConflict: "id" });
      }
    }

    // 11. Products (Catalog)
    if (localDbData.products) {
      for (const p of localDbData.products) {
        await supabase.from("products").upsert({
          id: p.id,
          name: p.name,
          category: p.category,
          brand: p.brand,
          model: p.model,
          sku: p.sku,
          price: Number(p.price || 0),
          discount: Number(p.discount || 0),
          stock: Number(p.stock || 0),
          images: p.images || [],
          warranty_period: p.warrantyPeriod || "2 Years",
          specifications: p.specifications || {}
        }, { onConflict: "id" });
      }
    }

    // 12. Solar Packages
    if (localDbData.solarPackages) {
      for (const sp of localDbData.solarPackages) {
        await supabase.from("solar_packages").upsert({
          id: sp.id,
          name: sp.name,
          panel_brand: sp.panelBrand,
          inverter_brand: sp.inverterBrand,
          battery_option: sp.batteryOption,
          price: Number(sp.price || 0),
          structure_type: sp.structureType,
          profit_margin: Number(sp.profitMargin || 0),
          enabled: !!sp.enabled
        }, { onConflict: "id" });
      }
    }

    // 13. Orders
    if (localDbData.orders) {
      for (const o of localDbData.orders) {
        await supabase.from("orders").upsert({
          id: o.id,
          customer_name: o.customerName,
          email: o.email,
          phone: o.phone,
          address: o.address,
          order_type: o.orderType || "Product",
          status: o.status || "Pending",
          items: o.items || [],
          total_cost: Number(o.totalCost || 0),
          installation_required: !!o.installationRequired,
          created_at: o.createdAt || new Date().toISOString()
        }, { onConflict: "id" });
      }
    }

    // 14. Warranties
    if (localDbData.warranties) {
      for (const w of localDbData.warranties) {
        await supabase.from("warranties").upsert({
          id: w.id,
          customer_name: w.customerName,
          email: w.email,
          product_name: w.productName,
          product_sku: w.productSku,
          serial_number: w.serialNumber,
          start_date: w.startDate,
          end_date: w.endDate,
          installation_date: w.installationDate,
          claim_history: w.claimHistory || [],
          status: w.status || "Active"
        }, { onConflict: "id" });
      }
    }

    // 15. Notifications
    if (localDbData.notifications) {
      for (const n of localDbData.notifications) {
        await supabase.from("notifications").upsert({
          id: n.id,
          customer_name: n.customerName,
          message: n.message,
          type: n.type,
          read: !!n.read,
          created_at: n.createdAt || new Date().toISOString()
        }, { onConflict: "id" });
      }
    }

    // 16. Settings
    if (localDbData.settings) {
      await supabase.from("settings").upsert({
        key: "global",
        value: localDbData.settings
      }, { onConflict: "key" });
    }

    // 17. Website Content
    if (localDbData.websiteContent) {
      await supabase.from("website_content").upsert({
        key: "global",
        value: localDbData.websiteContent
      }, { onConflict: "key" });
    }

    // 18. Purchase Orders
    if (localDbData.purchaseOrders) {
      for (const po of localDbData.purchaseOrders) {
        await supabase.from("purchase_orders").upsert({
          id: po.id,
          supplier_name: po.supplierName || po.vendor || "Supplier",
          order_date: po.orderDate || po.date || new Date().toISOString(),
          total_cost: Number(po.totalCost || po.cost || 0),
          status: po.status || "Pending",
          items: po.items || []
        }, { onConflict: "id" });
      }
    }

    // 19. Quote Templates
    if (localDbData.quoteTemplates) {
      for (const qt of localDbData.quoteTemplates) {
        await supabase.from("quote_templates").upsert({
          id: qt.id,
          name: qt.name,
          is_active: qt.isActive !== undefined ? qt.isActive : qt.is_active
        }, { onConflict: "id" });
      }
    }

    // 20. Quote Template Pages
    if (localDbData.quoteTemplatePages) {
      for (const qtp of localDbData.quoteTemplatePages) {
        await supabase.from("quote_template_pages").upsert({
          id: qtp.id,
          template_id: qtp.templateId || qtp.template_id,
          page_type: qtp.pageType || qtp.page_type,
          title: qtp.title,
          body_text: qtp.bodyText || qtp.body_text,
          image_url: qtp.imageUrl || qtp.image_url,
          bg_image_url: qtp.bgImageUrl || qtp.bg_image_url,
          is_enabled: qtp.isEnabled !== undefined ? qtp.isEnabled : qtp.is_enabled,
          sort_order: qtp.sortOrder || qtp.sort_order || 0
        }, { onConflict: "id" });
      }
    }

    // 21. Bank Accounts
    if (localDbData.bankAccounts) {
      for (const ba of localDbData.bankAccounts) {
        await supabase.from("bank_accounts").upsert({
          id: ba.id,
          bank_name: ba.bankName || ba.bank_name,
          account_title: ba.accountTitle || ba.account_title || ba.title,
          account_number: ba.accountNumber || ba.account_number || ba.accountNo,
          iban: ba.iban,
          branch_code: ba.branchCode || ba.branch_code || "",
          is_active: ba.isActive !== undefined ? ba.isActive : ba.is_active,
          sort_order: ba.sortOrder || ba.sort_order || 0
        }, { onConflict: "id" });
      }
    }

    // 22. Company Terms
    if (localDbData.companyTerms) {
      for (const ct of localDbData.companyTerms) {
        await supabase.from("company_terms").upsert({
          id: ct.id,
          term_text: ct.termText || ct.term_text,
          sort_order: ct.sortOrder || ct.sort_order || 0
        }, { onConflict: "id" });
      }
    }

    // 23. CEO Messages
    if (localDbData.ceoMessages) {
      for (const cm of localDbData.ceoMessages) {
        await supabase.from("ceo_messages").upsert({
          id: cm.id,
          name: cm.name,
          designation: cm.designation,
          message: cm.message,
          signature_url: cm.signatureUrl || cm.signature_url || "",
          photo_url: cm.photoUrl || cm.photo_url || ""
        }, { onConflict: "id" });
      }
    }

    // 24. Social Links
    if (localDbData.socialLinks) {
      for (const sl of localDbData.socialLinks) {
        await supabase.from("social_links").upsert({
          id: sl.id,
          platform: sl.platform,
          url: sl.url,
          qr_code_url: sl.qrCodeUrl || sl.qr_code_url || ""
        }, { onConflict: "id" });
      }
    }

    // 25. Structure Descriptions
    if (localDbData.structureDescriptions) {
      for (const sd of localDbData.structureDescriptions) {
        await supabase.from("structure_descriptions").upsert({
          id: sd.id,
          structure_type: sd.structureType || sd.structure_type,
          title: sd.title,
          description_en: sd.descriptionEn || sd.description_en,
          description_ur: sd.descriptionUr || sd.description_ur,
          material_type: sd.materialType || sd.material_type || "",
          weight: sd.weight || "",
          wind_rating: sd.windRating || sd.wind_rating || "",
          warranty: sd.warranty || "",
          image_url: sd.imageUrl || sd.image_url || ""
        }, { onConflict: "id" });
      }
    }

    // 26. PDF Settings
    if (localDbData.quotePdfSettings) {
      for (const qps of localDbData.quotePdfSettings) {
        await supabase.from("quote_pdf_settings").upsert({
          id: qps.id,
          company_name: qps.companyName || qps.company_name,
          office_address: qps.officeAddress || qps.office_address,
          hotline_phones: qps.hotlinePhones || qps.hotline_phones,
          billing_email: qps.billingEmail || qps.billing_email,
          website_url: qps.websiteUrl || qps.website_url,
          logo_url: qps.logoUrl || qps.logo_url || ""
        }, { onConflict: "id" });
      }
    }

    console.log("🍀 [Sunchaser Migration] Migration successfully completed!");
    return true;
  } catch (err: any) {
    console.error("❌ Exception during Supabase data migration:", err);
    return false;
  }
}

export class CustomerPortalAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerPortalAuthError";
  }
}

function mapLeadRowForPortal(
  lead: any,
  quotesData: any[],
  surveysData: any[],
  tasksData: any[],
  projectsData: any[]
): any {
  const quotes = (quotesData || [])
    .filter((q: any) => q.lead_id === lead.id)
    .map((q: any) => ({
      id: q.id,
      systemSizekW: Number(q.system_size_kw),
      panelCount: q.panel_count,
      panelType: q.panel_type,
      inverterType: q.inverter_type,
      batteryCapacity: q.battery_capacity,
      totalCost: Number(q.total_cost),
      federalTaxCredit: Number(q.federal_tax_credit),
      netCost: Number(q.net_cost),
      estimatedAnnualSavings: Number(q.estimated_annual_savings),
      paybackPeriodYears: Number(q.payback_period_years),
      status: q.status,
      createdAt: q.created_at,
    }));

  const s = (surveysData || []).find((sd: any) => sd.lead_id === lead.id);
  const surveyObj = s
    ? {
        scheduledDate: s.scheduled_date,
        status: s.status,
        notes: s.notes,
      }
    : undefined;

  const relatedTasks = (tasksData || [])
    .filter((td: any) => td.lead_id === lead.id)
    .map((t: any) => ({
      id: t.id,
      name: t.name,
      done: t.done,
    }));

  let installationObj: any = undefined;
  const proj = (projectsData || []).find((pd: any) => pd.lead_id === lead.id);
  if (proj || relatedTasks.length > 0) {
    installationObj = {
      status:
        lead.status === "Installed"
          ? "Completed"
          : lead.status === "Contracted"
            ? "Scheduled"
            : "In Progress",
      scheduledDate: s?.scheduled_date || undefined,
      progress:
        lead.status === "Installed"
          ? 100
          : relatedTasks.length > 0
            ? Math.round(
                (relatedTasks.filter((t: any) => t.done).length / relatedTasks.length) * 100
              )
            : 0,
      tasks: relatedTasks,
    };
  }

  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    address: lead.address,
    status: lead.status,
    createdAt: lead.created_at,
    quotes,
    survey: surveyObj,
    installation: installationObj,
  };
}

async function resolveCustomerIdForPortalUser(
  supabase: SupabaseClient,
  userRow: any
): Promise<string | null> {
  if (userRow.customer_id) return userRow.customer_id;

  const { data: byUser } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", userRow.id)
    .maybeSingle();
  if (byUser?.id) return byUser.id;

  const { data: byEmail } = await supabase
    .from("customers")
    .select("id")
    .eq("email", userRow.email)
    .maybeSingle();
  return byEmail?.id ?? null;
}

export async function fetchCustomerPortalData(
  userId: string,
  username: string,
  localDb?: Database
): Promise<any> {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedUserId = String(userId || "").trim();

  if (!normalizedUserId || !normalizedUsername) {
    throw new CustomerPortalAuthError("User credentials required.");
  }

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("*")
      .eq("id", normalizedUserId)
      .single();

    if (userErr || !userRow) {
      throw new CustomerPortalAuthError("Invalid portal user.");
    }
    if (String(userRow.username || "").trim().toLowerCase() !== normalizedUsername) {
      throw new CustomerPortalAuthError("Invalid portal user.");
    }
    const role = resolveAppUserRole(userRow.username, userRow.role);
    if (role !== "Customer") {
      throw new CustomerPortalAuthError("Not authorized for customer portal.");
    }

    const customerId = await resolveCustomerIdForPortalUser(supabase, userRow);

    let customer: any = null;
    if (customerId) {
      const { data: c } = await supabase.from("customers").select("*").eq("id", customerId).single();
      if (c) {
        customer = {
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone || undefined,
          address: c.address || undefined,
        };
      }
    }

    let leadsQuery = supabase.from("leads").select("*").order("created_at", { ascending: false });
    if (customerId) {
      leadsQuery = leadsQuery.eq("customer_id", customerId);
    } else {
      leadsQuery = leadsQuery.eq("email", userRow.email).limit(1);
    }
    const { data: leadsData } = await leadsQuery;
    const primaryLeadRow = (leadsData || [])[0];

    let lead: any = null;
    let project: any = null;
    let netMetering: any = null;
    let payment: any = null;

    if (primaryLeadRow) {
      const leadId = primaryLeadRow.id;
      const [
        { data: quotesData },
        { data: surveysData },
        { data: tasksData },
        { data: projectsData },
        { data: trackerRow },
        { data: paymentRow },
      ] = await Promise.all([
        supabase.from("quotations").select("*").eq("lead_id", leadId),
        supabase.from("site_surveys").select("*").eq("lead_id", leadId),
        supabase.from("installation_tasks").select("*").eq("lead_id", leadId),
        supabase.from("projects").select("*").eq("lead_id", leadId),
        supabase.from("net_metering_trackers").select("*").eq("lead_id", leadId).maybeSingle(),
        supabase.from("payments").select("*").eq("lead_id", leadId).maybeSingle(),
      ]);

      lead = mapLeadRowForPortal(
        primaryLeadRow,
        quotesData || [],
        surveysData || [],
        tasksData || [],
        projectsData || []
      );

      let proj = (projectsData || [])[0];
      if (!proj && customerId) {
        const { data: projByCustomer } = await supabase
          .from("projects")
          .select("*")
          .eq("customer_id", customerId)
          .order("updated_at", { ascending: false })
          .limit(1);
        proj = (projByCustomer || [])[0];
      }
      if (proj) {
        project = {
          id: proj.id,
          leadId: proj.lead_id,
          customerName: proj.customer_name,
          address: proj.address,
          systemSizekW: Number(proj.system_size_kw || 0),
          stage: proj.stage,
          createdAt: proj.created_at,
          updatedAt: proj.updated_at,
        };
      }

      if (trackerRow) {
        netMetering = {
          leadId: trackerRow.lead_id,
          documentsCollected: trackerRow.documents_collected,
          applicationSubmitted: trackerRow.application_submitted,
          discoInspection: trackerRow.disco_inspection,
          demandNotice: trackerRow.demand_notice,
          meterInstallation: trackerRow.meter_installation,
          greenMeterActive: trackerRow.green_meter_active,
        };
      }

      if (paymentRow) {
        let milestones = [];
        try {
          milestones =
            typeof paymentRow.milestones === "string"
              ? JSON.parse(paymentRow.milestones)
              : paymentRow.milestones || [];
        } catch {
          milestones = [];
        }
        payment = {
          leadId: paymentRow.lead_id,
          totalValue: Number(paymentRow.total_value || 0),
          advanceReceived: Number(paymentRow.advance_received || 0),
          pendingAmount: Number(paymentRow.pending_amount || 0),
          reminderSent: paymentRow.reminder_sent,
          invoiceStatus: paymentRow.invoice_status,
          milestones,
        };
      }
    }

    let supportTicketsQuery = supabase.from("support_tickets").select("id, status, email, customer_id");
    if (customerId) {
      supportTicketsQuery = supportTicketsQuery.eq("customer_id", customerId);
    } else {
      supportTicketsQuery = supportTicketsQuery.eq("email", userRow.email);
    }
    const { data: ticketsData } = await supportTicketsQuery;
    const openTicketsCount = (ticketsData || []).filter(
      (t: any) => !["Closed", "Resolved"].includes(t.status)
    ).length;

    let warrantySummary = "No data available";
    if (customerId) {
      const { data: warrRows } = await supabase
        .from("customer_warranties")
        .select("id, component_type, end_date")
        .eq("customer_id", customerId);
      if (warrRows && warrRows.length > 0) {
        warrantySummary = `${warrRows.length} registered component(s)`;
      }
    }

    const payload = buildClientPortalPayload({
      customer,
      lead,
      project,
      netMetering,
      payment,
      openTicketsCount,
    });
    payload.dashboard.warrantySummary = warrantySummary;

    return {
      user: {
        id: userRow.id,
        username: userRow.username,
        name: userRow.name,
        email: userRow.email,
        role,
        customerId: customerId || undefined,
      },
      ...payload,
    };
  }

  if (!localDb) {
    throw new CustomerPortalAuthError("Database unavailable.");
  }

  const userRow = (localDb.users || []).find(
    (u: any) =>
      u.id === normalizedUserId &&
      String(u.username || "").trim().toLowerCase() === normalizedUsername
  );
  if (!userRow) {
    throw new CustomerPortalAuthError("Invalid portal user.");
  }
  const role = resolveAppUserRole(userRow.username, userRow.role);
  if (role !== "Customer") {
    throw new CustomerPortalAuthError("Not authorized for customer portal.");
  }

  const customerId = userRow.customerId || userRow.customer_id || null;
  const lead =
    (localDb.leads || []).find(
      (l: any) =>
        (customerId && l.customerId === customerId) ||
        (!customerId && l.email === userRow.email)
    ) || null;

  const project =
    (localDb.projects || []).find(
      (p: any) =>
        p.leadId === lead?.id ||
        (customerId && (p.customerId === customerId || p.customer_id === customerId))
    ) || null;
  const netMetering = lead ? localDb.netMeteringTrackers?.[lead.id] : null;
  const payment = lead ? localDb.paymentTracks?.[lead.id] : null;
  const openTicketsCount = (localDb.tickets || []).filter(
    (t: any) =>
      (customerId
        ? t.customerId === customerId || t.customer_id === customerId
        : t.email === userRow.email) && !["Closed", "Resolved"].includes(t.status)
  ).length;

  let warrantySummary = "No data available";
  const warrLocal = (localDb.customerWarranties || []).filter(
    (w: any) =>
      w.customerId === customerId ||
      w.customer_id === customerId
  );
  if (warrLocal.length > 0) {
    warrantySummary = `${warrLocal.length} registered component(s)`;
  }

  const customer =
    customerId && lead
      ? {
          id: customerId,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          address: lead.address,
        }
      : lead
        ? {
            id: customerId || `cust-${lead.id}`,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            address: lead.address,
          }
        : null;

  const payload = buildClientPortalPayload({
    customer,
    lead,
    project,
    netMetering,
    payment,
    openTicketsCount,
  });
  payload.dashboard.warrantySummary = warrantySummary;

  return {
    user: {
      id: userRow.id,
      username: userRow.username,
      name: userRow.name,
      email: userRow.email,
      role,
      customerId: customerId || undefined,
    },
    ...payload,
  };
}

export class StaffPortalAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffPortalAuthError";
  }
}

const STAFF_PORTAL_ROLES = new Set([
  "Super Admin",
  "Technical CEO",
  "Sales Manager",
  "Sales Advisor",
  "Sales Executive",
  "Admin",
  "Inventory Manager",
  "Support Agent",
]);

export async function verifyCustomerPortalUser(
  userId: string,
  username: string,
  localDb?: Database
): Promise<{ user: any; customerId: string | null; role: string }> {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId || !normalizedUsername) {
    throw new CustomerPortalAuthError("User credentials required.");
  }

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: userRow, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", normalizedUserId)
      .single();
    if (error || !userRow) throw new CustomerPortalAuthError("Invalid portal user.");
    if (String(userRow.username || "").trim().toLowerCase() !== normalizedUsername) {
      throw new CustomerPortalAuthError("Invalid portal user.");
    }
    const role = resolveAppUserRole(userRow.username, userRow.role);
    if (role !== "Customer") throw new CustomerPortalAuthError("Not authorized for customer portal.");
    const customerId = await resolveCustomerIdForPortalUser(supabase, userRow);
    return { user: userRow, customerId, role };
  }

  if (!localDb) throw new CustomerPortalAuthError("Database unavailable.");
  const userRow = (localDb.users || []).find(
    (u: any) =>
      u.id === normalizedUserId &&
      String(u.username || "").trim().toLowerCase() === normalizedUsername
  );
  if (!userRow) throw new CustomerPortalAuthError("Invalid portal user.");
  const role = resolveAppUserRole(userRow.username, userRow.role);
  if (role !== "Customer") throw new CustomerPortalAuthError("Not authorized for customer portal.");
  return {
    user: userRow,
    customerId: userRow.customerId || userRow.customer_id || null,
    role,
  };
}

export async function verifyStaffPortalUser(
  userId: string,
  username: string,
  localDb?: Database
): Promise<{ user: any; role: string }> {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId || !normalizedUsername) {
    throw new StaffPortalAuthError("Staff credentials required.");
  }

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: userRow, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", normalizedUserId)
      .single();
    if (error || !userRow) throw new StaffPortalAuthError("Invalid staff user.");
    if (String(userRow.username || "").trim().toLowerCase() !== normalizedUsername) {
      throw new StaffPortalAuthError("Invalid staff user.");
    }
    const role = resolveAppUserRole(userRow.username, userRow.role);
    if (!STAFF_PORTAL_ROLES.has(role)) {
      throw new StaffPortalAuthError("Not authorized for staff portal tools.");
    }
    return { user: userRow, role };
  }

  if (!localDb) throw new StaffPortalAuthError("Database unavailable.");
  const userRow = (localDb.users || []).find(
    (u: any) =>
      u.id === normalizedUserId &&
      String(u.username || "").trim().toLowerCase() === normalizedUsername
  );
  if (!userRow) throw new StaffPortalAuthError("Invalid staff user.");
  const role = resolveAppUserRole(userRow.username, userRow.role);
  if (!STAFF_PORTAL_ROLES.has(role)) {
    throw new StaffPortalAuthError("Not authorized for staff portal tools.");
  }
  return { user: userRow, role };
}

function assertCustomerScope(customerId: string | null, requestedCustomerId?: string) {
  if (!customerId) throw new CustomerPortalAuthError("Customer account is not linked to a project yet.");
  if (requestedCustomerId && requestedCustomerId !== customerId) {
    throw new CustomerPortalAuthError("You cannot access another customer's data.");
  }
}

export async function fetchCustomerPortalDocuments(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  assertCustomerScope(customerId);

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("customer_documents")
      .select("*")
      .eq("customer_id", customerId)
      .order("uploaded_at", { ascending: false });
    if (error) throw error;
    const documents = (data || []).map(mapDocumentRow);
    return { customerId, documents, wallet: buildDocumentWalletSlots(documents) };
  }

  const documents = (localDb!.customerDocuments || [])
    .filter((d: any) => d.customerId === customerId || d.customer_id === customerId)
    .map((d: any) =>
      mapDocumentRow({
        id: d.id,
        customer_id: d.customerId || d.customer_id,
        project_id: d.projectId || d.project_id,
        document_type: d.documentType || d.document_type,
        title: d.title,
        file_url: d.fileUrl || d.file_url,
        uploaded_by: d.uploadedBy || d.uploaded_by,
        uploaded_at: d.uploadedAt || d.uploaded_at,
      })
    );
  return { customerId, documents, wallet: buildDocumentWalletSlots(documents) };
}

export async function fetchCustomerPortalWarranties(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  assertCustomerScope(customerId);

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("customer_warranties")
      .select("*")
      .eq("customer_id", customerId);
    if (error) throw error;
    const warranties = (data || []).map(mapWarrantyRow);
    return { customerId, warranties, cards: buildWarrantyCenterCards(warranties) };
  }

  const warranties = (localDb!.customerWarranties || [])
    .filter((w: any) => w.customerId === customerId || w.customer_id === customerId)
    .map((w: any) =>
      mapWarrantyRow({
        id: w.id,
        customer_id: w.customerId || w.customer_id,
        project_id: w.projectId || w.project_id,
        component_type: w.componentType || w.component_type,
        brand: w.brand,
        model: w.model,
        serial_number: w.serialNumber || w.serial_number,
        start_date: w.startDate || w.start_date,
        end_date: w.endDate || w.end_date,
      })
    );
  return { customerId, warranties, cards: buildWarrantyCenterCards(warranties) };
}

export async function createCustomerWarrantyClaim(
  userId: string,
  username: string,
  body: { component: string; issueDescription: string; photoUrl?: string },
  localDb?: Database
) {
  const { user, customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  assertCustomerScope(customerId);

  const component = String(body.component || "").trim();
  const issueDescription = String(body.issueDescription || "").trim();
  const photoUrl = body.photoUrl ? String(body.photoUrl).trim() : null;
  if (!component || !issueDescription) {
    throw new CustomerPortalAuthError("Component and issue description are required.");
  }

  const claimId = `wc-${Date.now()}`;
  const ticketId = `ticket-wc-${Date.now()}`;
  const now = new Date().toISOString();

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    await supabase.from("support_tickets").insert({
      id: ticketId,
      customer_name: user.name,
      email: user.email,
      subject: `Warranty: ${component}`,
      description: issueDescription,
      status: "New",
      priority: "Medium",
      messages: JSON.stringify([
        { sender: "Customer", text: issueDescription, time: now },
      ]),
    });
    const { data, error } = await supabase
      .from("warranty_claims")
      .insert({
        id: claimId,
        customer_id: customerId,
        ticket_id: ticketId,
        component,
        issue_description: issueDescription,
        photo_url: photoUrl,
        status: "New",
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapWarrantyClaimRow(data);
  }

  const claim = {
    id: claimId,
    customerId,
    ticketId,
    component,
    issueDescription,
    photoUrl,
    status: "New",
    createdAt: now,
    updatedAt: now,
  };
  localDb!.warrantyClaims = localDb!.warrantyClaims || [];
  localDb!.warrantyClaims.unshift(claim);
  localDb!.tickets = localDb!.tickets || [];
  localDb!.tickets.unshift({
    id: ticketId,
    customerName: user.name,
    email: user.email,
    subject: `Warranty: ${component}`,
    description: issueDescription,
    status: "New",
    priority: "Medium",
    createdAt: now,
    messages: [{ sender: "Customer", text: issueDescription, time: now }],
  });
  return mapWarrantyClaimRow({
    id: claim.id,
    customer_id: claim.customerId,
    ticket_id: claim.ticketId,
    component: claim.component,
    issue_description: claim.issueDescription,
    photo_url: claim.photoUrl,
    status: claim.status,
    created_at: claim.createdAt,
    updated_at: claim.updatedAt,
  });
}

export async function createAdminCustomerDocument(
  staffUserId: string,
  staffUsername: string,
  body: {
    customerId: string;
    projectId?: string;
    documentType: DocumentWalletType;
    title: string;
    fileUrl: string;
    uploadedBy: string;
  },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const customerId = String(body.customerId || "").trim();
  if (!customerId) throw new StaffPortalAuthError("customerId is required.");

  const doc = {
    id: `doc-${Date.now()}`,
    customer_id: customerId,
    project_id: body.projectId || null,
    document_type: body.documentType,
    title: String(body.title || "").trim() || body.documentType,
    file_url: String(body.fileUrl || "").trim(),
    uploaded_by: String(body.uploadedBy || staffUsername).trim(),
    uploaded_at: new Date().toISOString(),
  };
  if (!doc.file_url) throw new StaffPortalAuthError("fileUrl is required.");

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.from("customer_documents").insert(doc).select("*").single();
    if (error) throw error;
    return mapDocumentRow(data);
  }

  localDb!.customerDocuments = localDb!.customerDocuments || [];
  localDb!.customerDocuments.unshift({
    id: doc.id,
    customerId: doc.customer_id,
    projectId: doc.project_id,
    documentType: doc.document_type,
    title: doc.title,
    fileUrl: doc.file_url,
    uploadedBy: doc.uploaded_by,
    uploadedAt: doc.uploaded_at,
  });
  return mapDocumentRow(doc);
}

export async function upsertAdminCustomerWarranty(
  staffUserId: string,
  staffUsername: string,
  body: {
    customerId: string;
    projectId?: string;
    componentType: WarrantyComponentType;
    brand?: string;
    model?: string;
    serialNumber?: string;
    startDate?: string;
    endDate?: string;
  },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const customerId = String(body.customerId || "").trim();
  if (!customerId) throw new StaffPortalAuthError("customerId is required.");

  const row = {
    id: `cw-${body.componentType}-${customerId}`,
    customer_id: customerId,
    project_id: body.projectId || null,
    component_type: body.componentType,
    brand: body.brand || null,
    model: body.model || null,
    serial_number: body.serialNumber || null,
    start_date: body.startDate || null,
    end_date: body.endDate || null,
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("customer_warranties")
      .upsert(row, { onConflict: "customer_id,component_type" })
      .select("*")
      .single();
    if (error) {
      const { data: data2, error: error2 } = await supabase
        .from("customer_warranties")
        .upsert({ ...row, id: `cw-${Date.now()}` })
        .select("*")
        .single();
      if (error2) throw error2;
      return mapWarrantyRow(data2);
    }
    return mapWarrantyRow(data);
  }

  localDb!.customerWarranties = localDb!.customerWarranties || [];
  const idx = localDb!.customerWarranties.findIndex(
    (w: any) =>
      (w.customerId || w.customer_id) === customerId &&
      (w.componentType || w.component_type) === body.componentType
  );
  const mapped = {
    id: row.id,
    customerId,
    projectId: row.project_id,
    componentType: row.component_type,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serial_number,
    startDate: row.start_date,
    endDate: row.end_date,
  };
  if (idx >= 0) localDb!.customerWarranties[idx] = mapped;
  else localDb!.customerWarranties.push(mapped);
  return mapWarrantyRow({
    id: mapped.id,
    customer_id: mapped.customerId,
    project_id: mapped.projectId,
    component_type: mapped.componentType,
    brand: mapped.brand,
    model: mapped.model,
    serial_number: mapped.serialNumber,
    start_date: mapped.startDate,
    end_date: mapped.endDate,
  });
}

export async function listAdminWarrantyClaims(
  staffUserId: string,
  staffUsername: string,
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("warranty_claims")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapWarrantyClaimRow);
  }

  return (localDb!.warrantyClaims || []).map((c: any) =>
    mapWarrantyClaimRow({
      id: c.id,
      customer_id: c.customerId || c.customer_id,
      ticket_id: c.ticketId || c.ticket_id,
      component: c.component,
      issue_description: c.issueDescription || c.issue_description,
      photo_url: c.photoUrl || c.photo_url,
      status: c.status,
      created_at: c.createdAt || c.created_at,
      updated_at: c.updatedAt || c.updated_at,
    })
  );
}

export async function patchAdminWarrantyClaim(
  staffUserId: string,
  staffUsername: string,
  claimId: string,
  status: string,
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const allowed = ["New", "In Review", "Technician Assigned", "Resolved", "Rejected"];
  if (!allowed.includes(status)) throw new StaffPortalAuthError("Invalid claim status.");

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("warranty_claims")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", claimId)
      .select("*")
      .single();
    if (error) throw error;
    if (data.ticket_id) {
      const ticketStatus =
        status === "Resolved" ? "Resolved" : status === "Rejected" ? "Rejected" : "In Progress";
      await supabase.from("support_tickets").update({ status: ticketStatus }).eq("id", data.ticket_id);
    }
    return mapWarrantyClaimRow(data);
  }

  const claim = (localDb!.warrantyClaims || []).find((c: any) => c.id === claimId);
  if (!claim) throw new StaffPortalAuthError("Warranty claim not found.");
  claim.status = status;
  claim.updatedAt = new Date().toISOString();
  return mapWarrantyClaimRow({
    id: claim.id,
    customer_id: claim.customerId || claim.customer_id,
    ticket_id: claim.ticketId || claim.ticket_id,
    component: claim.component,
    issue_description: claim.issueDescription || claim.issue_description,
    photo_url: claim.photoUrl || claim.photo_url,
    status: claim.status,
    created_at: claim.createdAt || claim.created_at,
    updated_at: claim.updatedAt || claim.updated_at,
  });
}

async function fetchTicketUpdates(
  supabase: SupabaseClient,
  ticketIds: string[]
): Promise<Record<string, any[]>> {
  if (ticketIds.length === 0) return {};
  const { data, error } = await supabase
    .from("support_ticket_updates")
    .select("*")
    .in("ticket_id", ticketIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const byTicket: Record<string, any[]> = {};
  (data || []).forEach((row: any) => {
    if (!byTicket[row.ticket_id]) byTicket[row.ticket_id] = [];
    byTicket[row.ticket_id].push(row);
  });
  return byTicket;
}

async function insertTicketUpdate(
  supabase: SupabaseClient | null,
  localDb: Database | undefined,
  input: {
    ticketId: string;
    status?: string;
    note?: string;
    visibility: "customer" | "internal" | "system";
    createdBy: string;
  }
) {
  const row = {
    id: `stu-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    ticket_id: input.ticketId,
    status: input.status || null,
    note: input.note || null,
    visibility: input.visibility,
    created_by: input.createdBy,
    created_at: new Date().toISOString(),
  };

  if (supabase) {
    const { error } = await supabase.from("support_ticket_updates").insert(row);
    if (error) throw error;
    return mapSupportTicketUpdateRow(row);
  }

  localDb!.supportTicketUpdates = localDb!.supportTicketUpdates || [];
  localDb!.supportTicketUpdates.push({
    id: row.id,
    ticketId: row.ticket_id,
    status: row.status,
    note: row.note,
    visibility: row.visibility,
    createdBy: row.created_by,
    createdAt: row.created_at,
  });
  return mapSupportTicketUpdateRow(row);
}

function mapTicketWithTimeline(row: any, updates: any[]): any {
  const timeline = (updates || []).map(mapSupportTicketUpdateRow);
  return mapSupportTicketRow(row, timeline);
}

function ticketBelongsToCustomer(row: any, customerId: string | null, email: string) {
  if (customerId && row.customer_id === customerId) return true;
  return String(row.email || "").toLowerCase() === String(email || "").toLowerCase();
}

export async function fetchCustomerSupportTickets(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { user, customerId } = await verifyCustomerPortalUser(userId, username, localDb);

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    let query = supabase.from("support_tickets").select("*").order("created_at", { ascending: false });
    if (customerId) {
      query = query.eq("customer_id", customerId);
    } else {
      query = query.eq("email", user.email);
    }
    const { data, error } = await query;
    if (error) throw error;
    const ids = (data || []).map((t: any) => t.id);
    const updatesByTicket = await fetchTicketUpdates(supabase, ids);
    const tickets = (data || []).map((row: any) =>
      mapTicketWithTimeline(row, updatesByTicket[row.id] || [])
    );
    return { customerId, tickets };
  }

  const tickets = (localDb!.tickets || [])
    .filter((t: any) =>
      customerId
        ? t.customerId === customerId || t.customer_id === customerId
        : t.email === user.email
    )
    .map((t: any) => {
      const updates = (localDb!.supportTicketUpdates || []).filter(
        (u: any) => (u.ticketId || u.ticket_id) === t.id
      );
      return mapTicketWithTimeline(
        {
          id: t.id,
          customer_id: t.customerId || t.customer_id,
          customer_name: t.customerName,
          email: t.email,
          category: t.category,
          priority: t.priority,
          subject: t.subject,
          description: t.description,
          fault_code: t.faultCode,
          photo_url: t.photoUrl,
          preferred_visit_date: t.preferredVisitDate,
          assigned_technician: t.assignedTechnician,
          scheduled_visit_date: t.scheduledVisitDate,
          status: t.status,
          customer_visible_notes: t.customerVisibleNotes,
          internal_notes: t.internalNotes,
          resolution_summary: t.resolutionSummary,
          created_at: t.createdAt,
          updated_at: t.updatedAt || t.createdAt,
        },
        updates.map((u: any) => ({
          id: u.id,
          ticket_id: u.ticketId || u.ticket_id,
          status: u.status,
          note: u.note,
          visibility: u.visibility,
          created_by: u.createdBy || u.created_by,
          created_at: u.createdAt || u.created_at,
        }))
      );
    });
  return { customerId, tickets };
}

export async function fetchCustomerSupportTicketById(
  userId: string,
  username: string,
  ticketId: string,
  localDb?: Database
) {
  const { user, customerId } = await verifyCustomerPortalUser(userId, username, localDb);

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: row, error } = await supabase.from("support_tickets").select("*").eq("id", ticketId).single();
    if (error || !row) throw new CustomerPortalAuthError("Ticket not found.");
    if (!ticketBelongsToCustomer(row, customerId, user.email)) {
      throw new CustomerPortalAuthError("You cannot access another customer's ticket.");
    }
    const updatesByTicket = await fetchTicketUpdates(supabase, [ticketId]);
    const ticket = mapTicketWithTimeline(row, updatesByTicket[ticketId] || []);
    return {
      ticket: {
        ...ticket,
        timeline: customerTimeline(ticket.timeline),
        internalNotes: undefined,
      },
    };
  }

  const row = (localDb!.tickets || []).find((t: any) => t.id === ticketId);
  if (!row) throw new CustomerPortalAuthError("Ticket not found.");
  if (
    !ticketBelongsToCustomer(
      { customer_id: row.customerId || row.customer_id, email: row.email },
      customerId,
      user.email
    )
  ) {
    throw new CustomerPortalAuthError("You cannot access another customer's ticket.");
  }
  const updates = (localDb!.supportTicketUpdates || []).filter(
    (u: any) => (u.ticketId || u.ticket_id) === ticketId
  );
  const ticket = mapTicketWithTimeline(
    {
      id: row.id,
      customer_id: row.customerId || row.customer_id,
      customer_name: row.customerName,
      email: row.email,
      category: row.category,
      priority: row.priority,
      subject: row.subject,
      description: row.description,
      fault_code: row.faultCode,
      photo_url: row.photoUrl,
      preferred_visit_date: row.preferredVisitDate,
      assigned_technician: row.assignedTechnician,
      scheduled_visit_date: row.scheduledVisitDate,
      status: row.status,
      customer_visible_notes: row.customerVisibleNotes,
      internal_notes: row.internalNotes,
      resolution_summary: row.resolutionSummary,
      created_at: row.createdAt,
      updated_at: row.updatedAt || row.createdAt,
    },
    updates.map((u: any) => ({
      id: u.id,
      ticket_id: u.ticketId || u.ticket_id,
      status: u.status,
      note: u.note,
      visibility: u.visibility,
      created_by: u.createdBy || u.created_by,
      created_at: u.createdAt || u.created_at,
    }))
  );
  return {
    ticket: {
      ...ticket,
      timeline: customerTimeline(ticket.timeline),
      internalNotes: undefined,
    },
  };
}

export async function createCustomerSupportTicket(
  userId: string,
  username: string,
  body: {
    category: string;
    priority: string;
    subject: string;
    description: string;
    faultCode?: string;
    photoUrl?: string;
    preferredVisitDate?: string;
  },
  localDb?: Database
) {
  const { user, customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  const category = String(body.category || "").trim();
  const priority = String(body.priority || "Medium").trim();
  const subject = String(body.subject || "").trim();
  const description = String(body.description || "").trim();

  if (!subject || !description) {
    throw new CustomerPortalAuthError("Subject and description are required.");
  }
  if (!SUPPORT_CATEGORIES.includes(category as any)) {
    throw new CustomerPortalAuthError("Invalid ticket category.");
  }
  if (!SUPPORT_PRIORITIES.includes(priority as any)) {
    throw new CustomerPortalAuthError("Invalid priority.");
  }

  const ticketId = `ticket-st-${Date.now()}`;
  const now = new Date().toISOString();
  const row = {
    id: ticketId,
    customer_id: customerId,
    customer_name: user.name,
    email: user.email,
    category,
    priority,
    subject,
    description,
    fault_code: body.faultCode || null,
    photo_url: body.photoUrl || null,
    preferred_visit_date: body.preferredVisitDate || null,
    status: "New",
    messages: JSON.stringify([{ sender: "Customer", text: description, time: now }]),
    assigned_technician: null,
    scheduled_visit_date: null,
    customer_visible_notes: null,
    internal_notes: null,
    resolution_summary: null,
    created_at: now,
    updated_at: now,
  };

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.from("support_tickets").insert(row).select("*").single();
    if (error) throw error;
    await insertTicketUpdate(supabase, undefined, {
      ticketId,
      status: "New",
      note: "Support ticket created by customer.",
      visibility: "system",
      createdBy: user.name,
    });
    return mapTicketWithTimeline(data, [
      {
        id: `stu-${Date.now()}`,
        ticket_id: ticketId,
        status: "New",
        note: "Support ticket created by customer.",
        visibility: "system",
        created_by: user.name,
        created_at: now,
      },
    ]);
  }

  localDb!.tickets = localDb!.tickets || [];
  localDb!.tickets.unshift({
    id: ticketId,
    customerId,
    customerName: user.name,
    email: user.email,
    category,
    priority,
    subject,
    description,
    faultCode: body.faultCode,
    photoUrl: body.photoUrl,
    preferredVisitDate: body.preferredVisitDate,
    status: "New",
    createdAt: now,
    updatedAt: now,
    messages: [{ sender: "Customer", text: description, time: now }],
  });
  await insertTicketUpdate(null, localDb, {
    ticketId,
    status: "New",
    note: "Support ticket created by customer.",
    visibility: "system",
    createdBy: user.name,
  });
  return mapTicketWithTimeline(row, []);
}

export async function listAdminSupportTickets(
  staffUserId: string,
  staffUsername: string,
  filters: { status?: string; category?: string; priority?: string },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    let query = supabase.from("support_tickets").select("*");
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.category) query = query.eq("category", filters.category);
    if (filters.priority) query = query.eq("priority", filters.priority);
    let { data, error } = await query.order("updated_at", { ascending: false });
    if (error) {
      const fallback = await query.order("created_at", { ascending: false });
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw error;
    const ids = (data || []).map((t: any) => t.id);
    const updatesByTicket = await fetchTicketUpdates(supabase, ids);
    return (data || []).map((row: any) => mapTicketWithTimeline(row, updatesByTicket[row.id] || []));
  }

  let list = [...(localDb!.tickets || [])];
  if (filters.status) list = list.filter((t: any) => t.status === filters.status);
  if (filters.category) list = list.filter((t: any) => t.category === filters.category);
  if (filters.priority) list = list.filter((t: any) => t.priority === filters.priority);
  return list.map((t: any) =>
    mapTicketWithTimeline(
      {
        id: t.id,
        customer_id: t.customerId,
        customer_name: t.customerName,
        email: t.email,
        category: t.category,
        priority: t.priority,
        subject: t.subject,
        description: t.description,
        fault_code: t.faultCode,
        photo_url: t.photoUrl,
        preferred_visit_date: t.preferredVisitDate,
        assigned_technician: t.assignedTechnician,
        scheduled_visit_date: t.scheduledVisitDate,
        status: t.status,
        customer_visible_notes: t.customerVisibleNotes,
        internal_notes: t.internalNotes,
        resolution_summary: t.resolutionSummary,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      },
      []
    )
  );
}

export async function updateAdminSupportTicket(
  staffUserId: string,
  staffUsername: string,
  ticketId: string,
  body: {
    status?: string;
    assignedTechnician?: string;
    scheduledVisitDate?: string;
    customerVisibleNote?: string;
    internalNote?: string;
    resolutionSummary?: string;
  },
  localDb?: Database
) {
  const { user } = await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const patch: any = { updated_at: new Date().toISOString() };

  if (body.status) {
    if (!SUPPORT_STATUSES.includes(body.status as any)) {
      throw new StaffPortalAuthError("Invalid ticket status.");
    }
    patch.status = body.status;
  }
  if (body.assignedTechnician !== undefined) patch.assigned_technician = body.assignedTechnician || null;
  if (body.scheduledVisitDate !== undefined) patch.scheduled_visit_date = body.scheduledVisitDate || null;
  if (body.resolutionSummary !== undefined) patch.resolution_summary = body.resolutionSummary || null;

  const existingRow = await getTicketRow(ticketId, localDb);
  if (body.customerVisibleNote) {
    const existing = existingRow?.customer_visible_notes || existingRow?.customerVisibleNotes || "";
    patch.customer_visible_notes = existing
      ? `${existing}\n${body.customerVisibleNote}`
      : body.customerVisibleNote;
  }
  if (body.internalNote) {
    const existing = existingRow?.internal_notes || existingRow?.internalNotes || "";
    patch.internal_notes = existing ? `${existing}\n${body.internalNote}` : body.internalNote;
  }

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("support_tickets")
      .update(patch)
      .eq("id", ticketId)
      .select("*")
      .single();
    if (error) throw error;

    if (body.status) {
      await insertTicketUpdate(supabase, undefined, {
        ticketId,
        status: body.status,
        note: `Status updated to ${body.status}.`,
        visibility: "customer",
        createdBy: user.name,
      });
    }
    if (body.customerVisibleNote) {
      await insertTicketUpdate(supabase, undefined, {
        ticketId,
        note: body.customerVisibleNote,
        visibility: "customer",
        createdBy: user.name,
      });
    }
    if (body.internalNote) {
      await insertTicketUpdate(supabase, undefined, {
        ticketId,
        note: body.internalNote,
        visibility: "internal",
        createdBy: user.name,
      });
    }

    const updatesByTicket = await fetchTicketUpdates(supabase, [ticketId]);
    return mapTicketWithTimeline(data, updatesByTicket[ticketId] || []);
  }

  const ticket = (localDb!.tickets || []).find((t: any) => t.id === ticketId);
  if (!ticket) throw new StaffPortalAuthError("Ticket not found.");
  Object.assign(ticket, {
    status: patch.status ?? ticket.status,
    assignedTechnician: patch.assigned_technician ?? ticket.assignedTechnician,
    scheduledVisitDate: patch.scheduled_visit_date ?? ticket.scheduledVisitDate,
    customerVisibleNotes: patch.customer_visible_notes ?? ticket.customerVisibleNotes,
    internalNotes: patch.internal_notes ?? ticket.internalNotes,
    resolutionSummary: patch.resolution_summary ?? ticket.resolutionSummary,
    updatedAt: patch.updated_at,
  });
  return mapTicketWithTimeline(
    {
      id: ticket.id,
      customer_id: ticket.customerId,
      customer_name: ticket.customerName,
      email: ticket.email,
      category: ticket.category,
      priority: ticket.priority,
      subject: ticket.subject,
      description: ticket.description,
      fault_code: ticket.faultCode,
      photo_url: ticket.photoUrl,
      preferred_visit_date: ticket.preferredVisitDate,
      assigned_technician: ticket.assignedTechnician,
      scheduled_visit_date: ticket.scheduledVisitDate,
      status: ticket.status,
      customer_visible_notes: ticket.customerVisibleNotes,
      internal_notes: ticket.internalNotes,
      resolution_summary: ticket.resolutionSummary,
      created_at: ticket.createdAt,
      updated_at: ticket.updatedAt,
    },
    []
  );
}

async function getTicketRow(ticketId: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase.from("support_tickets").select("*").eq("id", ticketId).single();
    return data;
  }
  return (localDb?.tickets || []).find((t: any) => t.id === ticketId);
}

async function resolveProjectIdForCustomer(
  customerId: string,
  localDb?: Database
): Promise<string | null> {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase
      .from("projects")
      .select("id")
      .eq("customer_id", customerId)
      .order("updated_at", { ascending: false })
      .limit(1);
    return data?.[0]?.id || null;
  }
  const proj = (localDb?.projects || []).find(
    (p: any) => p.customerId === customerId || p.customer_id === customerId
  );
  return proj?.id || null;
}

function serviceRequestBelongsToCustomer(row: any, customerId: string) {
  return String(row.customer_id || row.customerId || "") === customerId;
}

export async function fetchCustomerServicePortal(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  assertCustomerScope(customerId);

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("service_requests")
      .select("*")
      .eq("customer_id", customerId)
      .order("updated_at", { ascending: false });
    if (error) {
      if (isServiceRequestsTableMissingError(error)) {
        return buildEmptyServicePortalPayload(customerId!);
      }
      throw error;
    }
    const requests = (data || []).map(mapServiceRequestRow);
    return {
      customerId,
      summary: buildServiceMaintenanceSummary(requests),
      requests,
    };
  }

  const rows = (localDb!.serviceRequests || []).filter(
    (r: any) => serviceRequestBelongsToCustomer(r, customerId!)
  );
  const requests = rows.map((r: any) =>
    mapServiceRequestRow({
      id: r.id,
      customer_id: r.customerId || r.customer_id,
      project_id: r.projectId || r.project_id,
      service_type: r.serviceType || r.service_type,
      status: r.status,
      preferred_date: r.preferredDate || r.preferred_date,
      preferred_time: r.preferredTime || r.preferred_time,
      notes: r.notes,
      assigned_technician: r.assignedTechnician || r.assigned_technician,
      scheduled_visit_date: r.scheduledVisitDate || r.scheduled_visit_date,
      before_photo_url: r.beforePhotoUrl || r.before_photo_url,
      after_photo_url: r.afterPhotoUrl || r.after_photo_url,
      completion_notes: r.completionNotes || r.completion_notes,
      created_at: r.createdAt || r.created_at,
      updated_at: r.updatedAt || r.updated_at,
    })
  );
  return {
    customerId,
    summary: buildServiceMaintenanceSummary(requests),
    requests,
  };
}

export async function createCustomerServiceRequest(
  userId: string,
  username: string,
  body: {
    serviceType: string;
    preferredDate?: string;
    preferredTime?: string;
    notes?: string;
    customer_id?: string;
    customerId?: string;
  },
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  assertCustomerScope(customerId);

  if (body.customer_id || body.customerId) {
    const attempted = String(body.customer_id || body.customerId);
    if (attempted !== customerId) {
      throw new CustomerPortalAuthError("You cannot create a request for another customer.");
    }
  }

  const serviceType = String(body.serviceType || "").trim();
  if (!SERVICE_TYPES.includes(serviceType as any)) {
    throw new CustomerPortalAuthError("Invalid service type.");
  }

  const requestId = `svc-req-${Date.now()}`;
  const now = new Date().toISOString();
  const projectId = await resolveProjectIdForCustomer(customerId!, localDb);
  const row = {
    id: requestId,
    customer_id: customerId,
    project_id: projectId,
    service_type: serviceType,
    status: "Submitted",
    preferred_date: body.preferredDate || null,
    preferred_time: body.preferredTime || null,
    notes: body.notes || null,
    assigned_technician: null,
    scheduled_visit_date: null,
    before_photo_url: null,
    after_photo_url: null,
    completion_notes: null,
    created_at: now,
    updated_at: now,
  };

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.from("service_requests").insert(row).select("*").single();
    if (error) {
      if (isServiceRequestsTableMissingError(error)) {
        throw new CustomerPortalAuthError(
          "Service scheduling is not available yet. Please contact support."
        );
      }
      throw error;
    }
    return mapServiceRequestRow(data);
  }

  localDb!.serviceRequests = localDb!.serviceRequests || [];
  localDb!.serviceRequests.unshift({
    id: requestId,
    customerId,
    projectId,
    serviceType,
    status: "Submitted",
    preferredDate: body.preferredDate,
    preferredTime: body.preferredTime,
    notes: body.notes,
    createdAt: now,
    updatedAt: now,
  });
  return mapServiceRequestRow(row);
}

export async function fetchCustomerServiceRequestById(
  userId: string,
  username: string,
  requestId: string,
  localDb?: Database
) {
  const { customerId, role } = await verifyCustomerPortalUser(userId, username, localDb);
  if (role !== "Customer") {
    throw new CustomerPortalAuthError("Not authorized for customer portal.");
  }
  assertCustomerScope(customerId);

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("service_requests")
      .select("*")
      .eq("id", requestId)
      .single();
    if (isServiceRequestsTableMissingError(error)) {
      throw new CustomerPortalAuthError("Service request not found.");
    }
    if (error || !data) throw new CustomerPortalAuthError("Service request not found.");
    if (!serviceRequestBelongsToCustomer(data, customerId!)) {
      throw new CustomerPortalAuthError("You cannot access another customer's service request.");
    }
    return { request: mapServiceRequestRow(data) };
  }

  const row = (localDb!.serviceRequests || []).find((r: any) => r.id === requestId);
  if (!row || !serviceRequestBelongsToCustomer(row, customerId!)) {
    throw new CustomerPortalAuthError("Service request not found.");
  }
  return {
    request: mapServiceRequestRow({
      id: row.id,
      customer_id: row.customerId || row.customer_id,
      project_id: row.projectId || row.project_id,
      service_type: row.serviceType || row.service_type,
      status: row.status,
      preferred_date: row.preferredDate || row.preferred_date,
      preferred_time: row.preferredTime || row.preferred_time,
      notes: row.notes,
      assigned_technician: row.assignedTechnician || row.assigned_technician,
      scheduled_visit_date: row.scheduledVisitDate || row.scheduled_visit_date,
      before_photo_url: row.beforePhotoUrl || row.before_photo_url,
      after_photo_url: row.afterPhotoUrl || row.after_photo_url,
      completion_notes: row.completionNotes || row.completion_notes,
      created_at: row.createdAt || row.created_at,
      updated_at: row.updatedAt || row.updated_at,
    }),
  };
}

export async function listAdminServiceRequests(
  staffUserId: string,
  staffUsername: string,
  filters: { status?: string },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    let query = supabase.from("service_requests").select("*");
    if (filters.status) query = query.eq("status", filters.status);
    const { data, error } = await query.order("updated_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapServiceRequestRow);
  }

  let list = [...(localDb!.serviceRequests || [])];
  if (filters.status) list = list.filter((r: any) => r.status === filters.status);
  return list.map((r: any) =>
    mapServiceRequestRow({
      id: r.id,
      customer_id: r.customerId || r.customer_id,
      project_id: r.projectId || r.project_id,
      service_type: r.serviceType || r.service_type,
      status: r.status,
      preferred_date: r.preferredDate || r.preferred_date,
      preferred_time: r.preferredTime || r.preferred_time,
      notes: r.notes,
      assigned_technician: r.assignedTechnician || r.assigned_technician,
      scheduled_visit_date: r.scheduledVisitDate || r.scheduled_visit_date,
      before_photo_url: r.beforePhotoUrl || r.before_photo_url,
      after_photo_url: r.afterPhotoUrl || r.after_photo_url,
      completion_notes: r.completionNotes || r.completion_notes,
      created_at: r.createdAt || r.created_at,
      updated_at: r.updatedAt || r.updated_at,
    })
  );
}

export async function updateAdminServiceRequest(
  staffUserId: string,
  staffUsername: string,
  requestId: string,
  body: {
    status?: string;
    assignedTechnician?: string;
    scheduledVisitDate?: string;
    beforePhotoUrl?: string;
    afterPhotoUrl?: string;
    completionNotes?: string;
  },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const patch: any = { updated_at: new Date().toISOString() };

  if (body.status) {
    if (!SERVICE_STATUSES.includes(body.status as any)) {
      throw new StaffPortalAuthError("Invalid service status.");
    }
    patch.status = body.status;
  }
  if (body.assignedTechnician !== undefined) {
    patch.assigned_technician = body.assignedTechnician || null;
  }
  if (body.scheduledVisitDate !== undefined) {
    patch.scheduled_visit_date = body.scheduledVisitDate || null;
  }
  if (body.beforePhotoUrl !== undefined) patch.before_photo_url = body.beforePhotoUrl || null;
  if (body.afterPhotoUrl !== undefined) patch.after_photo_url = body.afterPhotoUrl || null;
  if (body.completionNotes !== undefined) patch.completion_notes = body.completionNotes || null;

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("service_requests")
      .update(patch)
      .eq("id", requestId)
      .select("*")
      .single();
    if (error || !data) throw new StaffPortalAuthError("Service request not found.");
    return mapServiceRequestRow(data);
  }

  const row = (localDb!.serviceRequests || []).find((r: any) => r.id === requestId);
  if (!row) throw new StaffPortalAuthError("Service request not found.");
  if (patch.status) row.status = patch.status;
  if (body.assignedTechnician !== undefined) row.assignedTechnician = patch.assigned_technician;
  if (body.scheduledVisitDate !== undefined) row.scheduledVisitDate = patch.scheduled_visit_date;
  if (body.beforePhotoUrl !== undefined) row.beforePhotoUrl = patch.before_photo_url;
  if (body.afterPhotoUrl !== undefined) row.afterPhotoUrl = patch.after_photo_url;
  if (body.completionNotes !== undefined) row.completionNotes = patch.completion_notes;
  row.updatedAt = patch.updated_at;
  return mapServiceRequestRow({
    id: row.id,
    customer_id: row.customerId || row.customer_id,
    project_id: row.projectId || row.project_id,
    service_type: row.serviceType || row.service_type,
    status: row.status,
    preferred_date: row.preferredDate || row.preferred_date,
    preferred_time: row.preferredTime || row.preferred_time,
    notes: row.notes,
    assigned_technician: row.assignedTechnician || row.assigned_technician,
    scheduled_visit_date: row.scheduledVisitDate || row.scheduled_visit_date,
    before_photo_url: row.beforePhotoUrl || row.before_photo_url,
    after_photo_url: row.afterPhotoUrl || row.after_photo_url,
    completion_notes: row.completionNotes || row.completion_notes,
    created_at: row.createdAt || row.created_at,
    updated_at: row.updatedAt || row.updated_at,
  });
}

async function resolvePortalSystemSizeKw(
  customerId: string,
  localDb?: Database
): Promise<{ projectId: string | null; systemSizeKw: number }> {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: projects } = await supabase
      .from("projects")
      .select("id, system_size_kw, lead_id")
      .eq("customer_id", customerId)
      .order("updated_at", { ascending: false })
      .limit(1);
    const proj = projects?.[0];
    let systemSizeKw = Number(proj?.system_size_kw || 0);
    const projectId = proj?.id ?? null;

    if (systemSizeKw <= 0 && proj?.lead_id) {
      const { data: quotes } = await supabase
        .from("quotations")
        .select("system_size_kw")
        .eq("lead_id", proj.lead_id);
      for (const q of quotes || []) {
        systemSizeKw = Math.max(systemSizeKw, Number(q.system_size_kw || 0));
      }
    }

    if (systemSizeKw <= 0) {
      const { data: leads } = await supabase
        .from("leads")
        .select("id")
        .eq("customer_id", customerId)
        .limit(1);
      const leadId = leads?.[0]?.id;
      if (leadId) {
        const { data: quotes } = await supabase
          .from("quotations")
          .select("system_size_kw")
          .eq("lead_id", leadId);
        for (const q of quotes || []) {
          systemSizeKw = Math.max(systemSizeKw, Number(q.system_size_kw || 0));
        }
      }
    }

    return { projectId, systemSizeKw };
  }

  const proj = (localDb?.projects || []).find(
    (p: any) => p.customerId === customerId || p.customer_id === customerId
  );
  let systemSizeKw = Number(proj?.systemSizekW || proj?.system_size_kw || 0);
  const projectId = proj?.id ?? null;
  if (systemSizeKw <= 0 && proj?.leadId) {
    for (const q of localDb?.quotations || []) {
      if (q.leadId === proj.leadId || q.lead_id === proj.leadId) {
        systemSizeKw = Math.max(systemSizeKw, Number(q.systemSizekW || q.system_size_kw || 0));
      }
    }
  }
  return { projectId, systemSizeKw };
}

async function loadSavingsProfileRow(customerId: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("customer_savings_profiles")
      .select("*")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) {
      if (isCustomerSavingsTableMissingError(error)) return null;
      throw error;
    }
    return data ? mapSavingsProfileRow(data) : null;
  }

  const row = (localDb?.customerSavingsProfiles || []).find(
    (r: any) => (r.customerId || r.customer_id) === customerId
  );
  if (!row) return null;
  return mapSavingsProfileRow({
    id: row.id,
    customer_id: row.customerId || row.customer_id,
    project_id: row.projectId || row.project_id,
    system_size_kw: row.systemSizeKw ?? row.system_size_kw,
    unit_rate: row.unitRate ?? row.unit_rate,
    manual_today_generation: row.manualTodayGeneration ?? row.manual_today_generation,
    manual_month_generation: row.manualMonthGeneration ?? row.manual_month_generation,
    lifetime_generation: row.lifetimeGeneration ?? row.lifetime_generation,
    performance_status: row.performanceStatus ?? row.performance_status,
    notes: row.notes,
    updated_by: row.updatedBy ?? row.updated_by,
    created_at: row.createdAt || row.created_at,
    updated_at: row.updatedAt || row.updated_at,
  });
}

export async function fetchCustomerSavings(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  assertCustomerScope(customerId);

  const { projectId, systemSizeKw } = await resolvePortalSystemSizeKw(customerId!, localDb);
  const profile = await loadSavingsProfileRow(customerId!, localDb);
  const dashboard = buildSavingsDashboard({
    customerId: customerId!,
    projectId: profile?.projectId ?? projectId,
    systemSizeKw,
    profile,
  });

  return { customerId, dashboard, profile };
}

export async function fetchAdminCustomerSavings(
  staffUserId: string,
  staffUsername: string,
  customerId: string,
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const normalizedCustomerId = String(customerId || "").trim();
  if (!normalizedCustomerId) {
    throw new StaffPortalAuthError("customerId is required.");
  }

  const { projectId, systemSizeKw } = await resolvePortalSystemSizeKw(normalizedCustomerId, localDb);
  const profile = await loadSavingsProfileRow(normalizedCustomerId, localDb);
  const dashboard = buildSavingsDashboard({
    customerId: normalizedCustomerId,
    projectId: profile?.projectId ?? projectId,
    systemSizeKw,
    profile,
  });

  return { customerId: normalizedCustomerId, profile, dashboard };
}

export async function upsertAdminCustomerSavings(
  staffUserId: string,
  staffUsername: string,
  body: {
    customerId: string;
    projectId?: string;
    systemSizeKw?: number;
    unitRate?: number;
    manualTodayGeneration?: number;
    manualMonthGeneration?: number;
    lifetimeGeneration?: number;
    performanceStatus?: string;
    notes?: string;
  },
  localDb?: Database
) {
  const { user } = await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const customerId = String(body.customerId || "").trim();
  if (!customerId) throw new StaffPortalAuthError("customerId is required.");

  if (body.performanceStatus && !PERFORMANCE_STATUSES.includes(body.performanceStatus as any)) {
    throw new StaffPortalAuthError("Invalid performance status.");
  }

  const { projectId: resolvedProjectId, systemSizeKw: resolvedKw } =
    await resolvePortalSystemSizeKw(customerId, localDb);
  const profileId = `csp-${customerId}`;
  const now = new Date().toISOString();
  const existing = await loadSavingsProfileRow(customerId, localDb);

  const row = {
    id: profileId,
    customer_id: customerId,
    project_id: body.projectId ?? existing?.projectId ?? resolvedProjectId,
    system_size_kw:
      body.systemSizeKw !== undefined
        ? body.systemSizeKw
        : existing?.systemSizeKw ?? (resolvedKw > 0 ? resolvedKw : null),
    unit_rate:
      body.unitRate !== undefined
        ? body.unitRate
        : existing?.unitRate ?? DEFAULT_UNIT_RATE_PKR,
    manual_today_generation:
      body.manualTodayGeneration !== undefined
        ? body.manualTodayGeneration
        : existing?.manualTodayGeneration ?? null,
    manual_month_generation:
      body.manualMonthGeneration !== undefined
        ? body.manualMonthGeneration
        : existing?.manualMonthGeneration ?? null,
    lifetime_generation:
      body.lifetimeGeneration !== undefined
        ? body.lifetimeGeneration
        : existing?.lifetimeGeneration ?? null,
    performance_status:
      body.performanceStatus !== undefined
        ? body.performanceStatus
        : existing?.performanceStatus ?? null,
    notes: body.notes !== undefined ? body.notes : existing?.notes ?? null,
    updated_by: user.name || user.username,
    updated_at: now,
    created_at: existing?.createdAt ?? now,
  };

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("customer_savings_profiles")
      .upsert(row, { onConflict: "customer_id" })
      .select("*")
      .single();
    if (error) {
      if (isCustomerSavingsTableMissingError(error)) {
        throw new StaffPortalAuthError(
          "customer_savings_profiles table is missing. Run scripts/client-portal-phase5-schema.sql in Supabase."
        );
      }
      throw error;
    }
    const profile = mapSavingsProfileRow(data);
    const dashboard = buildSavingsDashboard({
      customerId,
      projectId: profile.projectId ?? resolvedProjectId,
      systemSizeKw: resolvedKw,
      profile,
    });
    return { profile, dashboard };
  }

  localDb!.customerSavingsProfiles = localDb!.customerSavingsProfiles || [];
  const idx = localDb!.customerSavingsProfiles.findIndex(
    (r: any) => (r.customerId || r.customer_id) === customerId
  );
  const localRow = {
    id: profileId,
    customerId,
    projectId: row.project_id,
    systemSizeKw: row.system_size_kw,
    unitRate: row.unit_rate,
    manualTodayGeneration: row.manual_today_generation,
    manualMonthGeneration: row.manual_month_generation,
    lifetimeGeneration: row.lifetime_generation,
    performanceStatus: row.performance_status,
    notes: row.notes,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (idx >= 0) localDb!.customerSavingsProfiles[idx] = localRow;
  else localDb!.customerSavingsProfiles.push(localRow);

  const profile = mapSavingsProfileRow(row);
  const dashboard = buildSavingsDashboard({
    customerId,
    projectId: profile.projectId ?? resolvedProjectId,
    systemSizeKw: resolvedKw,
    profile,
  });
  return { profile, dashboard };
}
