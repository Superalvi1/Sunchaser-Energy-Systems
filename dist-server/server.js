var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_fs2 = __toESM(require("fs"), 1);
var import_vite = require("vite");
var import_genai = require("@google/genai");
var import_dotenv = __toESM(require("dotenv"), 1);

// dbManager.ts
var import_supabase_js = require("@supabase/supabase-js");
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var import_ws = __toESM(require("ws"), 1);
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = import_ws.default;
}
var clientInstance = null;
var isConfigured = false;
var PRODUCTION_APP_ROLE_BY_USERNAME = {
  raza: "Technical CEO",
  sales: "Sales Advisor"
};
function resolveAppUserRole(username, dbRole) {
  return PRODUCTION_APP_ROLE_BY_USERNAME[String(username || "").toLowerCase()] || dbRole;
}
function getSupabase() {
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
      "\x1B[33m%s\x1B[0m",
      "\u26A0\uFE0F [Supabase Warning] Credentials missing. Running in local JSON database.json mode as fallback."
    );
    return null;
  }
  try {
    clientInstance = (0, import_supabase_js.createClient)(url, key, {
      auth: {
        persistSession: false
      }
    });
    isConfigured = true;
    console.log("\x1B[32m%s\x1B[0m", "\u2705 [Supabase] Client initialized successfully.");
    return clientInstance;
  } catch (err) {
    console.error("\u274C Failed to initialize Supabase client instance:", err);
    return null;
  }
}
function isSupabaseActive() {
  if (isConfigured) return true;
  return getSupabase() !== null;
}
var AUTO_SIZER_QUOTE_CREATION_ENABLED = false;
var initialSeed = {
  users: [
    { id: "u-allauddin", username: "allauddin", password: "123", name: "Muhammad Allauddin", email: "allauddin@sunchaser-energy.com", role: "Super Admin" },
    { id: "u-raza", username: "raza", password: "123", name: "Raza", email: "raza@sunchaser-energy.com", role: "Technical CEO" },
    { id: "u-sales", username: "sales", password: "123", name: "Sales Advisor", email: "sales@sunchaser-energy.com", role: "Sales Advisor" }
  ],
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
    { id: "PO-9001", vendor: "Canadian Solar Ltd", itemId: "p-400", itemName: "Sunchaser Ultra 400W", quantity: 200, status: "Delivered", date: "2026-05-18", cost: 56e3 },
    { id: "PO-9002", vendor: "Enphase Energy", itemId: "inv-en", itemName: "Enphase IQ8 Microinverter", quantity: 500, status: "In Transit", date: "2026-05-24", cost: 9e4 }
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
      price: 26e3,
      discount: 1e3,
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
      price: 23e3,
      discount: 1e3,
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
      price: 16e3,
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
      price: 4e5,
      discount: 15e3,
      stock: 120,
      images: ["https://images.unsplash.com/photo-1620038896894-9165b2fa2c6e?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 1e4, costPrice: 32e4, description: "Knox Smart Sync 10kW three phase dual MPPT grid tied inverter." }
    },
    {
      id: "p-inv-solis-10",
      name: "Solis 3-Phase 10kW Inverter",
      category: "Inverters",
      brand: "Solis",
      model: "S6-GR3P10K",
      sku: "SL-INV-10K",
      price: 42e4,
      discount: 1e4,
      stock: 90,
      images: ["https://images.unsplash.com/photo-1620038896894-9165b2fa2c6e?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 1e4, costPrice: 34e4, description: "Solis S6 three phase grid-tied solar inverter." }
    },
    {
      id: "p-inv-growatt-6",
      name: "Growatt Hybrid 6kW Inverter",
      category: "Inverters",
      brand: "Growatt",
      model: "MIN 6000TL-XH",
      sku: "GW-INV-6K",
      price: 28e4,
      discount: 5e3,
      stock: 80,
      images: ["https://images.unsplash.com/photo-1620038896894-9165b2fa2c6e?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "5 Years",
      specifications: { wattage: 6e3, costPrice: 22e4, description: "Growatt MIN 6000TL-XH hybrid single phase storage inverter." }
    },
    {
      id: "p-inv-nitrox-12",
      name: "Nitrox Hybrid 12kW Inverter",
      category: "Inverters",
      brand: "Nitrox",
      model: "S-12K-SG04LP3",
      sku: "NX-INV-12K",
      price: 58e4,
      discount: 2e4,
      stock: 65,
      images: ["https://images.unsplash.com/photo-1620038896894-9165b2fa2c6e?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "5 Years",
      specifications: { wattage: 12e3, costPrice: 48e4, description: "Nitrox 12kW hybrid three phase storage inverter (low voltage battery supported)." }
    },
    {
      id: "p-inv-fox-10",
      name: "Fox ESS 3-Phase 10kW Hybrid",
      category: "Inverters",
      brand: "Fox ESS",
      model: "H3-10.0-E",
      sku: "FX-INV-10K",
      price: 49e4,
      discount: 1e4,
      stock: 40,
      images: ["https://images.unsplash.com/photo-1620038896894-9165b2fa2c6e?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 1e4, costPrice: 41e4, description: "Fox ESS high performance H3 series 10kW hybrid inverter." }
    },
    {
      id: "p-bat-dyness-5",
      name: "Dyness LFP 5.12kWh Battery",
      category: "Batteries",
      brand: "Dyness",
      model: "DL5.0C LFP",
      sku: "DN-BAT-5K",
      price: 235e3,
      discount: 5e3,
      stock: 150,
      images: ["https://images.unsplash.com/photo-1620714223084-8fcacc6dfd8d?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 5120, costPrice: 19e4, description: "Dyness DL5.0C lithium iron phosphate (LiFePO4) 51.2V 100Ah rack battery." }
    },
    {
      id: "p-bat-pylontech-48",
      name: "Pylontech US5000 4.8kWh",
      category: "Batteries",
      brand: "Pylontech",
      model: "US5000 48V",
      sku: "PT-BAT-48",
      price: 26e4,
      discount: 1e4,
      stock: 80,
      images: ["https://images.unsplash.com/photo-1620714223084-8fcacc6dfd8d?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 4800, costPrice: 215e3, description: "Pylontech US5000 LFP lithium energy storage battery module." }
    },
    {
      id: "p-bat-soluna-10",
      name: "Soluna EOS 10K Pack",
      category: "Batteries",
      brand: "Soluna",
      model: "EOS 10K LFP",
      sku: "SL-BAT-10K",
      price: 48e4,
      discount: 15e3,
      stock: 45,
      images: ["https://images.unsplash.com/photo-1620714223084-8fcacc6dfd8d?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { wattage: 10240, costPrice: 38e4, description: "Soluna EOS high capacity LFP stackable battery system." }
    },
    {
      id: "p-bat-narada-48",
      name: "Narada LFP 100Ah Battery",
      category: "Batteries",
      brand: "Narada",
      model: "48NPFC100",
      sku: "ND-BAT-48",
      price: 21e4,
      discount: 5e3,
      stock: 95,
      images: ["https://images.unsplash.com/photo-1620714223084-8fcacc6dfd8d?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "5 Years",
      specifications: { wattage: 4800, costPrice: 175e3, description: "Narada 48V telecom-grade lithium iron phosphate rack batteries." }
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
      stock: 1e3,
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
      discount: 5e3,
      stock: 100,
      images: [],
      warrantyPeriod: "15 Years",
      specifications: { wattage: 0, costPrice: 12e4, description: "Hot-dip galvanized C-Channel / H-Beam heavy fabrication structure." }
    },
    {
      id: "p-str-gir",
      name: "Premium Mughal Girder Heavy Frame",
      category: "Structure",
      brand: "Mughal",
      model: "Girder Heavy Frame",
      sku: "MG-STR-GIR",
      price: 18e4,
      discount: 1e4,
      stock: 80,
      images: [],
      warrantyPeriod: "15 Years",
      specifications: { wattage: 0, costPrice: 14e4, description: "Extreme wind shear resistant structural steel girder system." }
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
      stock: 5e3,
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
      stock: 2e3,
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
      price: 22e3,
      discount: 2e3,
      stock: 150,
      images: [],
      warrantyPeriod: "3 Years",
      specifications: { wattage: 0, costPrice: 15e3, description: "DC box with 1000V fuses, DC SPD, and heavy circuit breakers." }
    },
    {
      id: "p-acc-con",
      name: "PVC Conduit Ducting & MC4 Connectors",
      category: "Accessories",
      brand: "Beta",
      model: "Ducting Accessories Kit",
      sku: "BT-ACC-KIT",
      price: 18e3,
      discount: 0,
      stock: 400,
      images: [],
      warrantyPeriod: "5 Years",
      specifications: { wattage: 0, costPrice: 12e3, description: "Complete PVC conduit piping, ducting, flex pipes, joints, and MC4 kit." }
    },
    {
      id: "p-net-lesco",
      name: "LESCO Bidirectional Green Meter Filing",
      category: "Net Metering",
      brand: "LESCO",
      model: "Three-Phase Green Metering",
      sku: "LE-NET-FIL",
      price: 9e4,
      discount: 0,
      stock: 999,
      images: [],
      warrantyPeriod: "N/A",
      specifications: { wattage: 0, costPrice: 75e3, description: "Bidirectional meter licensing, NEPRA application filing, demand notice audit." }
    },
    {
      id: "p-civ-fnd",
      name: "Concrete Ballast Foundation Pillars",
      category: "Civil Works",
      brand: "Local",
      model: "Ballast Concrete Pad",
      sku: "LC-CIV-FND",
      price: 16e3,
      discount: 0,
      stock: 500,
      images: [],
      warrantyPeriod: "N/A",
      specifications: { wattage: 0, costPrice: 11e3, description: "1.5x1.5ft concrete blocks for anchor base foundation stabilization." }
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
    { id: "struct-1", structure_type: "standard", title: "Standard Structure", description_en: "Premium Galvanized Mounting Structure, wind resistant up to 130 km/h.", description_ur: "\u067E\u0631\u06CC\u0645\u06CC\u0645 \u06AF\u06CC\u0644\u0648\u0627\u0646\u0627\u0626\u0632\u0688 \u0645\u0627\u0648\u0646\u0679\u0646\u06AF \u0633\u0679\u0631\u06A9\u0686\u0631\u060C 130 \u06A9\u0644\u0648\u0645\u06CC\u0679\u0631 \u0641\u06CC \u06AF\u06BE\u0646\u0679\u06C1 \u062A\u06A9 \u06C1\u0648\u0627 \u06A9\u06D2 \u062E\u0644\u0627\u0641 \u0645\u0632\u0627\u062D\u0645\u06D4", material_type: "Galvanized L3 Steel", weight: "Standard Frame", wind_rating: "130 km/h", warranty: "10 Years Warranty", image_url: "" },
    { id: "struct-2", structure_type: "elevated", title: "Elevated Structure", description_en: "10ft Roof clearance hot-dip galvanized elevated structure frame.", description_ur: "10 \u0641\u0679 \u0686\u06BE\u062A \u06A9\u06CC \u0627\u0648\u0646\u0686\u0627\u0626\u06CC \u06A9\u0627 \u06C1\u0627\u0679 \u0688\u0650\u067E \u06AF\u06CC\u0644\u0648\u0627\u0646\u0627\u0626\u0632\u0688 \u0627\u06CC\u0644\u06CC\u0648\u06CC\u0679\u0688 \u0633\u0679\u0631\u06A9\u0686\u0631 \u0641\u0631\u06CC\u0645\u06D4", material_type: "Hot-dip Galvanized Steel", weight: "Heavy Frame", wind_rating: "130 km/h", warranty: "10 Years Warranty", image_url: "" },
    { id: "struct-3", structure_type: "girder", title: "Girder Structure", description_en: "Heavy-Duty Mughal Girder Frame supporting extreme wind shear.", description_ur: "\u06C1\u06CC\u0648\u06CC \u0688\u06CC\u0648\u0679\u06CC \u0645\u063A\u0644 \u06AF\u0627\u0631\u0688\u0631 \u0641\u0631\u06CC\u0645 \u062C\u0648 \u0634\u062F\u06CC\u062F \u06C1\u0648\u0627 \u06A9\u06D2 \u062F\u0628\u0627\u0624 \u06A9\u0648 \u0628\u0631\u062F\u0627\u0634\u062A \u06A9\u0631\u062A\u0627 \u06C1\u06D2\u06D4", material_type: "Mughal Girder Steel", weight: "1600g/ft Structural Load", wind_rating: "150 km/h", warranty: "15 Years Warranty", image_url: "" }
  ],
  quotePdfSettings: [
    { id: "settings-1", company_name: "SUNCHASER ENERGY SYSTEMS", office_address: "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore", hotline_phones: "0309-0236666, 0330-7776444", billing_email: "billing@sunchaser-energy.com", website_url: "www.sunchaser-energy.com", logo_url: "" }
  ]
};
function calculateLeadScore(lead) {
  let score = 30;
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
function getDashboardStats(activeDb) {
  const totalRevenue = activeDb.leads.reduce((sum, lead) => {
    const acceptedQuotes = (lead.quotes || []).filter((q) => q.status === "Accepted");
    return sum + acceptedQuotes.reduce((s, q) => s + q.totalCost, 0);
  }, 0);
  const pendingRevenue = activeDb.leads.reduce((sum, lead) => {
    if (lead.status !== "Installed" && lead.status !== "Contracted") {
      const pendingQuotes = (lead.quotes || []).filter((q) => q.status !== "Accepted");
      return sum + (pendingQuotes.length > 0 ? pendingQuotes[0].totalCost : 0);
    }
    return sum;
  }, 0);
  const totalLeads = activeDb.leads.length;
  const installedCount = activeDb.leads.filter((l) => l.status === "Installed").length;
  const contractedCount = activeDb.leads.filter((l) => l.status === "Contracted").length;
  const pipelineCount = totalLeads - installedCount;
  const statusBins = {
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
  activeDb.leads.forEach((l) => {
    if (statusBins[l.status] !== void 0) {
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
var QUOTE_EXT_FALLBACK_PREFIX = "__SUNCHASER_EXT__:";
function buildQuoteExtendedPayload(quote) {
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
    termsAndConditions: quote.termsAndConditions
  };
}
function parseQuotationExtendedData(row) {
  if (row?.extended_data) {
    return typeof row.extended_data === "string" ? JSON.parse(row.extended_data) : row.extended_data;
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
function buildQuotationSupabaseRow(leadId, customerId, quote, options) {
  const ext = buildQuoteExtendedPayload(quote);
  const row = {
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
    terms_and_conditions: quote.termsAndConditions
  };
  if (options?.includeExtendedColumn !== false) {
    row.extended_data = ext;
  } else {
    row.terms_and_conditions = QUOTE_EXT_FALLBACK_PREFIX + JSON.stringify(ext);
  }
  return row;
}
async function persistQuotationToSupabase(supabase, leadId, customerId, quote, mode = "insert") {
  const withExt = buildQuotationSupabaseRow(leadId, customerId, quote, {
    includeExtendedColumn: true
  });
  const attempt = mode === "upsert" ? await supabase.from("quotations").upsert(withExt, { onConflict: "id" }) : await supabase.from("quotations").insert(withExt);
  if (!attempt.error) return { ok: true };
  const missingExt = attempt.error.message?.includes("extended_data") || attempt.error.message?.includes("schema cache");
  if (!missingExt) {
    return { ok: false, error: attempt.error.message };
  }
  const fallback = buildQuotationSupabaseRow(leadId, customerId, quote, {
    includeExtendedColumn: false
  });
  const retry = mode === "upsert" ? await supabase.from("quotations").upsert(fallback, { onConflict: "id" }) : await supabase.from("quotations").insert(fallback);
  if (retry.error) return { ok: false, error: retry.error.message };
  return { ok: true };
}
async function fetchAppStateFromSupabase() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
  const useLocalConfigFallback = false;
  let localBackup = {};
  try {
    const backupPath = import_path.default.join(process.cwd(), "database.json");
    if (import_fs.default.existsSync(backupPath)) {
      localBackup = JSON.parse(import_fs.default.readFileSync(backupPath, "utf-8"));
    }
  } catch (e) {
  }
  const safeFetch = async (tableName, defaultVal = []) => {
    try {
      const { data, error } = await supabase.from(tableName).select("*");
      if (error) {
        console.warn(`[Supabase Warning] Could not fetch table '${tableName}' (might not exist yet):`, error.message);
        return defaultVal;
      }
      return data || defaultVal;
    } catch (err) {
      console.warn(`[Supabase Error] Exception fetching table '${tableName}':`, err.message);
      return defaultVal;
    }
  };
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
  const leadsMapped = (leadsData || []).map((lead) => {
    const quotes = (quotesData || []).filter((q) => q.lead_id === lead.id).map((q) => {
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
    const s = (surveysData || []).find((sd) => sd.lead_id === lead.id);
    let surveyObj = void 0;
    if (s) {
      let panels = [];
      try {
        panels = typeof s.panel_placements === "string" ? JSON.parse(s.panel_placements) : s.panel_placements || [];
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
    const relatedTasks = (tasksData || []).filter((td) => td.lead_id === lead.id).map((t) => ({
      id: t.id.split("-").pop() || t.id,
      // strip the uniqueness prefix
      name: t.name,
      done: t.done
    }));
    let installationObj = void 0;
    const proj = (projectsData || []).find((pd) => pd.lead_id === lead.id);
    if (proj || relatedTasks.length > 0) {
      installationObj = {
        status: lead.status === "Installed" ? "Completed" : lead.status === "Contracted" ? "Scheduled" : "In Progress",
        scheduledDate: s?.scheduled_date || (/* @__PURE__ */ new Date()).toISOString(),
        progress: lead.status === "Installed" ? 100 : relatedTasks.length > 0 ? Math.round(relatedTasks.filter((t) => t.done).length / relatedTasks.length * 100) : 20,
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
  const netMeteringTrackers = {};
  (trackersData || []).forEach((tracker) => {
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
  const paymentTracks = {};
  (paymentsData || []).forEach((pay) => {
    let milestones = [];
    try {
      milestones = typeof pay.milestones === "string" ? JSON.parse(pay.milestones) : pay.milestones || [];
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
  const inventoryMapped = (productsInventoryData || []).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    desc: p.description,
    stock: p.stock,
    cost: Number(p.cost || 0)
  }));
  const projectsMapped = (projectsData || []).map((p) => ({
    id: p.id,
    leadId: p.lead_id,
    customerName: p.customer_name,
    address: p.address,
    systemSizekW: Number(p.system_size_kw || 0),
    stage: p.stage,
    createdAt: p.created_at,
    updatedAt: p.updated_at
  }));
  const ticketsMapped = (ticketsData || []).map((t) => {
    let msgs = [];
    try {
      msgs = typeof t.messages === "string" ? JSON.parse(t.messages) : t.messages || [];
    } catch (e) {
      msgs = [];
    }
    let pObj = [];
    try {
      pObj = typeof t.photos === "string" ? JSON.parse(t.photos) : t.photos || [];
    } catch (e) {
      pObj = [];
    }
    let vObj = [];
    try {
      vObj = typeof t.videos === "string" ? JSON.parse(t.videos) : t.videos || [];
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
  const activityLogsMapped = (activityLogsData || []).map((l) => ({
    id: l.id,
    timestamp: l.timestamp,
    userId: l.user_id,
    userName: l.user_name,
    role: l.role,
    action: l.action,
    details: l.details
  }));
  const whatsappLogsMapped = (whatsappLogsData || []).map((l) => ({
    id: l.id,
    timestamp: l.timestamp,
    customerName: l.customer_name,
    phone: l.phone,
    eventType: l.event_type,
    messageText: l.message_text,
    status: l.status
  }));
  const settingsObj = (settingsData || []).find((s) => s.key === "global")?.value || null;
  const websiteContentObj = (websiteContentData || []).find((w) => w.key === "global")?.value || null;
  const productsCatalogMapped = (productsCatalogData || []).map((p) => ({
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
    specifications: typeof p.specifications === "string" ? JSON.parse(p.specifications) : p.specifications || {}
  }));
  const ordersMapped = (ordersData || []).map((o) => ({
    id: o.id,
    customerName: o.customer_name,
    email: o.email,
    phone: o.phone,
    address: o.address,
    orderType: o.order_type,
    status: o.status,
    items: typeof o.items === "string" ? JSON.parse(o.items) : o.items || [],
    totalCost: Number(o.total_cost || 0),
    createdAt: o.created_at || (/* @__PURE__ */ new Date()).toISOString(),
    installationRequired: !!o.installation_required
  }));
  const warrantiesMapped = (warrantiesData || []).map((w) => ({
    id: w.id,
    customerName: w.customer_name,
    email: w.email,
    productName: w.product_name,
    productSku: w.product_sku,
    serialNumber: w.serial_number,
    startDate: w.start_date,
    endDate: w.end_date,
    installationDate: w.installation_date,
    claimHistory: typeof w.claim_history === "string" ? JSON.parse(w.claim_history) : w.claim_history || [],
    status: w.status
  }));
  const solarPackagesMapped = (solarPackagesData || []).map((sp) => ({
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
  const categoriesMapped = (categoriesData || []).map((cat) => ({
    id: cat.id,
    name: cat.name,
    description: cat.description,
    icon: cat.icon
  }));
  const notificationsMapped = (notificationsData || []).map((n) => ({
    id: n.id,
    customerName: n.customer_name,
    message: n.message,
    type: n.type,
    read: !!n.read,
    createdAt: n.created_at || (/* @__PURE__ */ new Date()).toISOString()
  }));
  const purchaseOrdersMapped = (purchaseOrdersData || []).map((po) => ({
    id: po.id,
    supplierName: po.supplier_name,
    orderDate: po.order_date,
    totalCost: Number(po.total_cost || 0),
    status: po.status,
    items: typeof po.items === "string" ? JSON.parse(po.items) : po.items || []
  }));
  const quoteTemplatesMapped = (quoteTemplatesData || []).map((qt) => ({
    id: qt.id,
    name: qt.name,
    isActive: !!qt.is_active
  }));
  const quoteTemplatePagesMapped = (quoteTemplatePagesData || []).map((qtp) => ({
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
  const bankAccountsMapped = (bankAccountsData || []).map((ba) => ({
    id: ba.id,
    bankName: ba.bank_name,
    accountTitle: ba.account_title || ba.title,
    accountNumber: ba.account_number || ba.accountNo,
    iban: ba.iban,
    branchCode: ba.branch_code,
    isActive: !!ba.is_active,
    sortOrder: Number(ba.sort_order || 0)
  }));
  const companyTermsMapped = (companyTermsData || []).map((ct) => ({
    id: ct.id,
    termText: ct.term_text || ct.termText,
    sortOrder: Number(ct.sort_order || 0)
  }));
  const ceoMessagesMapped = (ceoMessagesData || []).map((cm) => ({
    id: cm.id,
    name: cm.name,
    designation: cm.designation,
    message: cm.message,
    signatureUrl: cm.signature_url || cm.signatureUrl,
    photoUrl: cm.photo_url || cm.photoUrl
  }));
  const socialLinksMapped = (socialLinksData || []).map((sl) => ({
    id: sl.id,
    platform: sl.platform,
    url: sl.url,
    qrCodeUrl: sl.qr_code_url || sl.qrCodeUrl
  }));
  const structureDescriptionsMapped = (structureDescriptionsData || []).map((sd) => ({
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
  const quotePdfSettingsMapped = (quotePdfSettingsData || []).map((qps) => ({
    id: qps.id,
    companyName: qps.company_name || qps.companyName,
    officeAddress: qps.office_address || qps.officeAddress,
    hotlinePhones: qps.hotline_phones || qps.hotlinePhones,
    billingEmail: qps.billing_email || qps.billingEmail,
    websiteUrl: qps.website_url || qps.websiteUrl,
    logoUrl: qps.logo_url || qps.logoUrl
  }));
  const usersMapped = (users || []).map((u) => ({
    id: u.id,
    username: u.username,
    password: u.password,
    name: u.name,
    email: u.email,
    role: resolveAppUserRole(u.username, u.role)
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
    categories: categoriesMapped.length > 0 ? categoriesMapped : void 0,
    products: productsCatalogMapped.length > 0 ? productsCatalogMapped : void 0,
    orders: ordersMapped.length > 0 ? ordersMapped : void 0,
    warranties: warrantiesMapped.length > 0 ? warrantiesMapped : void 0,
    notifications: notificationsMapped.length > 0 ? notificationsMapped : void 0,
    solarPackages: solarPackagesMapped.length > 0 ? solarPackagesMapped : void 0,
    settings: settingsObj || (useLocalConfigFallback ? localBackup.settings : void 0),
    websiteContent: websiteContentObj || (useLocalConfigFallback ? localBackup.websiteContent : void 0),
    purchaseOrders: purchaseOrdersMapped.length > 0 ? purchaseOrdersMapped : useLocalConfigFallback ? localBackup.purchaseOrders || [] : [],
    quoteTemplates: quoteTemplatesMapped.length > 0 ? quoteTemplatesMapped : localBackup.quoteTemplates || initialSeed.quoteTemplates || [],
    quoteTemplatePages: quoteTemplatePagesMapped.length > 0 ? quoteTemplatePagesMapped : localBackup.quoteTemplatePages || initialSeed.quoteTemplatePages || [],
    bankAccounts: bankAccountsMapped.length > 0 ? bankAccountsMapped : localBackup.bankAccounts || initialSeed.bankAccounts || [],
    companyTerms: companyTermsMapped.length > 0 ? companyTermsMapped : localBackup.companyTerms || initialSeed.companyTerms || [],
    ceoMessages: ceoMessagesMapped.length > 0 ? ceoMessagesMapped : localBackup.ceoMessages || initialSeed.ceoMessages || [],
    socialLinks: socialLinksMapped.length > 0 ? socialLinksMapped : localBackup.socialLinks || initialSeed.socialLinks || [],
    structureDescriptions: structureDescriptionsMapped.length > 0 ? structureDescriptionsMapped : localBackup.structureDescriptions || initialSeed.structureDescriptions || [],
    quotePdfSettings: quotePdfSettingsMapped.length > 0 ? quotePdfSettingsMapped : localBackup.quotePdfSettings || initialSeed.quotePdfSettings || []
  };
}

// server.ts
if (import_fs2.default.existsSync(".env.local")) {
  import_dotenv.default.config({ path: ".env.local" });
}
import_dotenv.default.config();
var ai = new import_genai.GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "MOCK_KEY_FOR_TESTING",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
});
var app = (0, import_express.default)();
var PORT = 3e3;
app.use(import_express.default.json({ limit: "15mb" }));
app.use(import_express.default.urlencoded({ extended: true, limit: "15mb" }));
app.use("/uploads", import_express.default.static(import_path2.default.join(__dirname, "public", "uploads")));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});
if (process.env.NODE_ENV === "production") {
  if (!isSupabaseActive()) {
    console.error(
      "\x1B[31m%s\x1B[0m",
      "\u{1F6A8} [CRITICAL WARNING] Running Sunchaser CRM in PRODUCTION mode but Supabase is NOT active/configured! Falling back to local database.json fallback as emergency measure only. Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set."
    );
  } else {
    console.log(
      "\x1B[32m%s\x1B[0m",
      "\u2728 [Production Mode] Supabase production database is active and set as the primary database."
    );
  }
}
var DB_FILE = import_path2.default.join(process.cwd(), "database.json");
var BACKUPS_DIR = import_path2.default.join(process.cwd(), "backups");
var db = initialSeed;
function loadDb() {
  try {
    if (import_fs2.default.existsSync(DB_FILE)) {
      const content = import_fs2.default.readFileSync(DB_FILE, "utf8");
      try {
        db = JSON.parse(content);
        if (!db.users) db.users = initialSeed.users;
        if (!db.leads) db.leads = initialSeed.leads;
        if (!db.tickets) db.tickets = initialSeed.tickets;
        if (!db.netMeteringHistory) db.netMeteringHistory = initialSeed.netMeteringHistory;
        if (!db.inventory) db.inventory = initialSeed.inventory;
        if (!db.projects) db.projects = initialSeed.projects;
        if (!db.netMeteringTrackers) db.netMeteringTrackers = initialSeed.netMeteringTrackers;
        if (!db.paymentTracks) db.paymentTracks = initialSeed.paymentTracks;
        if (!db.activityLogs) db.activityLogs = initialSeed.activityLogs;
        if (!db.whatsAppLogs) db.whatsAppLogs = initialSeed.whatsAppLogs;
        if (!db.categories) db.categories = initialSeed.categories;
        if (!db.products) db.products = initialSeed.products;
        if (!db.orders) db.orders = initialSeed.orders;
        if (!db.warranties) db.warranties = initialSeed.warranties;
        if (!db.notifications) db.notifications = initialSeed.notifications;
        if (!db.quoteTemplates) db.quoteTemplates = initialSeed.quoteTemplates;
        if (!db.quoteTemplatePages) db.quoteTemplatePages = initialSeed.quoteTemplatePages;
        if (!db.bankAccounts) db.bankAccounts = initialSeed.bankAccounts;
        if (!db.companyTerms) db.companyTerms = initialSeed.companyTerms;
        if (!db.ceoMessages) db.ceoMessages = initialSeed.ceoMessages;
        if (!db.socialLinks) db.socialLinks = initialSeed.socialLinks;
        if (!db.structureDescriptions) db.structureDescriptions = initialSeed.structureDescriptions;
        if (!db.quotePdfSettings) db.quotePdfSettings = initialSeed.quotePdfSettings;
        if (!db.solarPackages) {
          db.solarPackages = [
            { id: "sp-5kw", name: "Sunchaser 5kW Premium Suite", panelBrand: "Canadian Solar 400W", inverterBrand: "Enphase IQ8", batteryOption: "Tesla Powerwall 2", price: 12e3, structureType: "Roofs", profitMargin: 0.25, enabled: true },
            { id: "sp-10kw", name: "Sunchaser 10kW Premium Suite", panelBrand: "Canadian Solar 400W", inverterBrand: "Enphase IQ8", batteryOption: "Tesla Powerwall Plus", price: 21e3, structureType: "Roofs", profitMargin: 0.3, enabled: true },
            { id: "sp-15kw", name: "Sunchaser 15kW Premium Suite", panelBrand: "Canadian Solar 400W", inverterBrand: "Enphase IQ8", batteryOption: "Tesla Powerwall 3", price: 3e4, structureType: "Ground Mount", profitMargin: 0.32, enabled: true }
          ];
        }
        if (!db.settings) {
          db.settings = {
            companyName: "Sunchaser Energy Systems",
            companyLogo: "https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=100&q=80",
            phoneNumber: "0309-0236666",
            whatsAppNumber: "0330-7776444",
            bankDetails: "SUNCHASER SOLAR LOGISTICS PVT LTD - Bank Alfalah DHA Phase 6 - Account: 5520-1014-4892-0199",
            termsAndConditions: "System activation and commissioning subject to grid interconnect agreements.",
            warrantyText: "Sunchaser certified modules are backed by a 25-Year performance warranty, and 10-Year hardware replacement guarantee.",
            taxSettings: "Lahore/Pakistan tax settings apply. Standard sales tax included.",
            currencySettings: "PKR (Rs.)",
            officeAddress: "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore",
            phoneNumbers: "0309-0236666, 0330-7776444",
            bankAccounts: [
              { "title": "SUNCHASER ENERGY", "bankName": "Allied Bank", "accountNo": "04190010112276940012", "iban": "PK81ABPA0010112276940012", "isAlternate": false },
              { "title": "AL ADAM", "bankName": "Bank Alfalah", "accountNo": "55265001858603", "iban": "PK12ALFH5526005001858603", "isAlternate": false },
              { "title": "SIGNALS GLOBAL", "bankName": "Allied Bank", "accountNo": "09090010112284650035", "iban": "N/A", "isAlternate": false },
              { "title": "HELIOS SOLAR ENERGY", "bankName": "Meezan Bank", "accountNo": "02490109527492", "iban": "PK49MEZN0002490109527492", "isAlternate": false },
              { "title": "HELIOS SOLAR ENERGY", "bankName": "Standard Chartered", "accountNo": "1702559001", "iban": "PK91SCBL0000001702559001", "isAlternate": false },
              { "title": "HELIOS SOLAR ENERGY", "bankName": "UBL", "accountNo": "1305307203838", "iban": "PK93UNIL0109000307203838", "isAlternate": false },
              { "title": "HELIOS SOLAR ENERGY", "bankName": "Habib Metro", "accountNo": "6121020301714129916", "iban": "PK42MPBL1210067140129916", "isAlternate": false },
              { "title": "HELIOS SOLAR ENERGY", "bankName": "Al Habib Bank", "accountNo": "03440981001290017", "iban": "PK62BAHL0344098100129001", "isAlternate": false }
            ],
            termsAndConditionsList: [
              "Quotation and Payment Terms: 1.1. Quote Validity: This quotation is valid for three (3) calendar days from the date of issue.",
              "1.2. Pricing: Quoted prices are final and inclusive of all applicable taxes as of the quotation date. Any new or additional taxes imposed after this date will be added to the final invoice.",
              "1.3. Payment Schedule: Ninety percent (90%) of the total quoted price is due upon issuance of the Purchase Order (PO) or Work Order (WO). The remaining Ten percent (10%) is due upon successful installation of the solar energy system. CASH ON DELIVERY ALSO AVAILABLE.",
              "1.4. Payment Methods: Payments to SUNCHASER ENERGY can be made via crossed cheques, pay orders, or online bank transfers.",
              "1.5. Commencement of Work: The Company will commence installation or delivery processes only upon receipt of the initial payment as stipulated in Section 1.3.",
              "Technical Specifications and Products: 2.1. System Functionality (On-Grid Systems): On-grid solar energy systems are designed to operate in conjunction with the utility grid and will not provide backup power during grid outages or at night.",
              "2.2. Component Substitution: In the event of non-availability of specific solar panel or inverter sizes/brands, the Company reserves the right to substitute with alternative products of equivalent or superior quality and specifications. Should the installed capacity deviate by more than two percent (2%) from the quoted capacity due to such substitutions, prices will be adjusted accordingly.",
              "2.3. Installation Standards: The Company will install the solar energy system and associated accessories in accordance with its standard policies and industry best practices. Any requirement for customization or alteration from the standard installation must be communicated and agreed upon in writing at the time of quotation.",
              "2.4. Client Interference: The Company expects no interference from the Client or their representatives during the installation process. Any customization or alteration requested by the Client during installation that was not previously agreed upon will incur additional charges.",
              "2.5. Grid Connection Requirement: The quoted system is designed based on the availability of a stable grid connection at the Client's site. The Company shall not be responsible for any issues or malfunctions arising if the Client subsequently disconnects from the grid.",
              "2.6. Earthing: The included earthing system is solely for net metering compliance and inverter protection. Any additional protective earthing needs to be quoted separately.",
              "Smart Online Services & Maintenance: 4.1. Remote Monitoring & Troubleshooting (Initial Year): The Company will provide 1 year of complimentary remote monitoring and troubleshooting services for complete solar energy systems, provided the Client has made full payment.",
              "4.2. Service Extension: Should the Client wish to extend Smart Online Services beyond the initial year, a separate agreement will be required.",
              "4.3. Self-Monitoring: Clients are welcome to utilize online monitoring functionalities independently without any charge.",
              "4.4. On-Site Visits: The initial year of free services covers all on-grid, hybrid, and off-grid solar systems. Any unnecessary on-site visits requested by the Client that are not attributable to system malfunction or covered under warranty will be charged.",
              "4.5. Elevated Structure Guarantee: A ten (10) year guarantee is provided for the elevated structure, based on SAP 2000 wind analysis report at 130 km/h, applicable to complete systems only.",
              "4.6. Warranty Exclusions: No warranty or free services will be provided for physical damages to any products.",
              "4.7. Wi-Fi Requirement: Continuous Wi-Fi/internet availability at the site is mandatory for free online monitoring services for on-grid and hybrid systems. On-site visits necessitated by the absence of Wi-Fi/internet will be charged.",
              "Client's Scope of Work: The Client is solely responsible for: 5.1. Site Readiness: Ensuring the installation area is prepared, a stable grid connection is available, and there is clear and easy access to the site/rooftop.",
              "5.2. Civil Works: All necessary civil works, unless explicitly included in the quotation.",
              "5.3. Electrical Cabling (Exclusions): The provision of a four-core service cable from the Energy Meter to the Distribution Box (where the inverter will be installed), if required. Also excluded is the line cable from the distribution line to the Energy Meter, if required.",
              "5.4. Wi-Fi Availability: Ensuring consistent Wi-Fi availability for online monitoring purposes.",
              "5.5. Electricity Meter & Sanctioned Load (Net Metering): Ownership of the electricity meter and ensuring the availability of the sanctioned load, specifically for net metering installations.",
              "5.6. Load Distribution: Managing and distributing the internal electrical load within the premises.",
              "Advisory for Solar: Panels should be washed at Fajr. Panels should be washed/cleaned after every 15 days.",
              "Force Majeure: Elevated Structure Guarantee: A ten (10) year guarantee is provided for the elevated structure, based on SAP 2000 wind analysis report at 100 km/h, applicable to complete systems only."
            ],
            "structureDescriptions": {
              "standard": {
                "en": "Premium Galvanized Standard Mounting Structure (L3 14 Gauge), wind resistant up to 130 km/h.",
                "ur": "\u067E\u0631\u06CC\u0645\u06CC\u0645 \u06AF\u06CC\u0644\u0648\u0627\u0646\u0627\u0626\u0632\u0688 \u0633\u0679\u06CC\u0646\u0688\u0631\u0688 \u0645\u0627\u0648\u0646\u0679\u0646\u06AF \u0633\u0679\u0631\u06A9\u0686\u0631 (\u0627\u06CC\u0644 \u062A\u06BE\u0631\u06CC 14 \u06AF\u06CC\u062C)\u060C 130 \u06A9\u0644\u0648\u0645\u06CC\u0679\u0631 \u0641\u06CC \u06AF\u06BE\u0646\u0679\u06C1 \u062A\u06A9 \u06C1\u0648\u0627 \u06A9\u06D2 \u062E\u0644\u0627\u0641 \u0645\u0632\u0627\u062D\u0645\u06D4",
                "rate": 4800,
                "weight": "25 kg per panel frame",
                "materialType": "Galvanized L3 Steel 14 Gauge",
                "warranty": "10 Years Structural Warranty",
                "windRating": "130 km/h wind shear certified"
              },
              "elevated": {
                "en": 'Premium Elevated Mounting Structure: Columns 62x125x3mm H Beam, Rafter:3"x1.5" Channel, Purlin:62x125x3mm H Beam, wind resistant up to 130 km/h.',
                "ur": '\u067E\u0631\u06CC\u0645\u06CC\u0645 \u0627\u06CC\u0644\u06CC\u0648\u06CC\u0679\u0688 \u0645\u0627\u0648\u0646\u0679\u0646\u06AF \u0633\u0679\u0631\u06A9\u0686\u0631: \u06A9\u0627\u0644\u0645\u0632 62x125x3mm \u0627\u06CC\u0686 \u0628\u06CC\u0645\u060C \u0631\u0627\u0641\u0679\u0631 3"x1.5" \u0686\u06CC\u0646\u0644\u060C \u067E\u0631\u0644\u0646 62x125x3mm \u0627\u06CC\u0686 \u0628\u06CC\u0645\u06D4 130 \u06A9\u0644\u0648\u0645\u06CC\u0679\u0631 \u0641\u06CC \u06AF\u06BE\u0646\u0679\u06C1 \u062A\u06A9 \u06C1\u0648\u0627 \u06A9\u06D2 \u062E\u0644\u0627\u0641 \u0645\u0632\u0627\u062D\u0645\u06D4',
                "rate": 147600,
                "weight": "850 kg total weight",
                "materialType": "Hot-Dip Galvanized H-Beam & C-Channel Mughal Steel",
                "warranty": "15 Years Structural Warranty",
                "windRating": "130 km/h wind shear certified"
              },
              "girder": {
                "en": "Premium Mughal Girder Structure, 1600 grams per foot for heavy load and long spans. Wind-certified up to 150 km/h.",
                "ur": "\u067E\u0631\u06CC\u0645\u06CC\u0645 \u0645\u063A\u0644 \u06AF\u0627\u0631\u0688\u0631 \u0633\u0679\u0631\u06A9\u0686\u0631\u060C 1600 \u06AF\u0631\u0627\u0645 \u0641\u06CC \u0641\u0679 \u0645\u0636\u0628\u0648\u0637\u06CC \u0627\u0648\u0631 \u0637\u0648\u06CC\u0644 \u0644\u0627\u0626\u0641 \u06A9\u06D2 \u0644\u06CC\u06D2\u06D4 150 \u06A9\u0644\u0648\u0645\u06CC\u0679\u0631 \u0641\u06CC \u06AF\u06BE\u0646\u0679\u06C1 \u062A\u06A9 \u06C1\u0648\u0627 \u06A9\u06D2 \u062E\u0644\u0627\u0641 \u0645\u0632\u0627\u062D\u0645\u06D4",
                "rate": 18e4,
                "weight": "1200 kg total weight",
                "materialType": "Heavy Gauge Hot-Rolled Mughal Girder & Channel",
                "warranty": "20 Years Structural Warranty",
                "windRating": "150 km/h wind shear certified"
              }
            },
            "boqMasterLibrary": [
              { "id": "panel_longi", "category": "Solar Panels", "brand": "Longi", "model": "Hi-MO X10 645W", "wattageCapacity": "645W", "unit": "Pcs", "costPrice": 22e3, "salePrice": 25215, "warranty": "30 Years Warranty", "description": "Longi Tier 1 A+ Grade Monocrystalline solar panels" },
              { "id": "panel_jinko", "category": "Solar Panels", "brand": "Jinko", "model": "Tiger Neo 580W", "wattageCapacity": "580W", "unit": "Pcs", "costPrice": 18e3, "salePrice": 21e3, "warranty": "25 Years Warranty", "description": "Jinko N-Type high efficiency monocrystalline solar panels" },
              { "id": "panel_ja", "category": "Solar Panels", "brand": "JA Solar", "model": "DeepBlue 550W", "wattageCapacity": "550W", "unit": "Pcs", "costPrice": 17e3, "salePrice": 19500, "warranty": "25 Years Warranty", "description": "JA Solar Tier-1 A+ Grade Monocrystalline cells" },
              { "id": "panel_canadian", "category": "Solar Panels", "brand": "Canadian Solar", "model": "BiHiKu7 600W", "wattageCapacity": "600W", "unit": "Pcs", "costPrice": 2e4, "salePrice": 23e3, "warranty": "25 Years Warranty", "description": "Canadian Solar Bifacial Dual-Glass Tier-1 modules" },
              { "id": "inverter_goodwe_10kw", "category": "Inverter", "brand": "Goodwe", "model": "10kW Hybrid", "wattageCapacity": "10kW", "unit": "Pcs", "costPrice": 36e4, "salePrice": 4e5, "warranty": "5 Years Local Warranty", "description": "Goodwe 10kW Hybrid Inverter Pure Sinewave smart grid" },
              { "id": "inverter_solis_10kw", "category": "Inverter", "brand": "Solis", "model": "10kW Hybrid", "wattageCapacity": "10kW", "unit": "Pcs", "costPrice": 35e4, "salePrice": 4e5, "warranty": "5 Years Local Warranty", "description": "Solis 10kW Hybrid Inverter Pure Sinewave smart grid" },
              { "id": "inverter_growatt_5kw", "category": "Inverter", "brand": "Growatt", "model": "5kW Hybrid", "wattageCapacity": "5kW", "unit": "Pcs", "costPrice": 18e4, "salePrice": 22e4, "warranty": "5 Years Local Warranty", "description": "Growatt 5kW Hybrid Inverter Pure Sinewave" },
              { "id": "inverter_goodwe_20kw", "category": "Inverter", "brand": "Goodwe", "model": "20kW On-grid", "wattageCapacity": "20kW", "unit": "Pcs", "costPrice": 24e4, "salePrice": 28e4, "warranty": "5 Years Warranty", "description": "Goodwe 20kW On-grid Smart Sync Inverter" },
              { "id": "battery_soluna_5kwh", "category": "Battery", "brand": "Soluna", "model": "Soluna 51V 5kWh", "wattageCapacity": "5kWh", "unit": "Pcs", "costPrice": 2e5, "salePrice": 235e3, "warranty": "10 Years Warranty", "description": "Soluna LiFePO4 Lithium deep discharge storage battery pack" },
              { "id": "battery_goodwe_pro", "category": "Battery", "brand": "Goodwe", "model": "PRO Lithium 5.4kWh", "wattageCapacity": "5.4kWh", "unit": "Pcs", "costPrice": 23e4, "salePrice": 27e4, "warranty": "10 Years Warranty", "description": "Goodwe PRO Lithium storage battery pack" },
              { "id": "cable_dc_4mm", "category": "Cables & Conductors", "brand": "GM/FAST", "model": "4 sq.mm DC Cable", "wattageCapacity": "N/A", "unit": "Meter", "costPrice": 200, "salePrice": 250, "warranty": "1 Year Free Service", "description": "4 sq.mm, 1C s/c CU/XLPE/PVC Double Insulated Tin Coated DC Cable" },
              { "id": "cable_dc_6mm", "category": "Cables & Conductors", "brand": "GM/FAST", "model": "6 sq.mm DC Cable", "wattageCapacity": "N/A", "unit": "Meter", "costPrice": 220, "salePrice": 280, "warranty": "1 Year Free Service", "description": "6 sq.mm, 1C s/c CU/XLPE/PVC Double Insulated Tin Coated DC Cable" },
              { "id": "cable_ac_copper", "category": "Cables & Conductors", "brand": "GM/FAST", "model": "AC Copper Cable", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 8e3, "salePrice": 1e4, "warranty": "1 Year Free Service", "description": "AC Copper flexible connection cable job" },
              { "id": "supplies_pvc", "category": "Ducts / Pipes / Conduits", "brand": "Beta/Equivalent", "model": "PVC Materials Job", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 12e3, "salePrice": 18e3, "warranty": "1 Year Free Service", "description": "All type of PVC material including pipes, elbows, connectors, joints, bends, clumps, PVC trunks/ducts" },
              { "id": "db_equipped", "category": "DB Boxes", "brand": "GADA/Chint", "model": "Equipped DB Box", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 25e3, "salePrice": 32e3, "warranty": "1 Year Free Service", "description": "Fine Powder Coated DB, Miniature Circuit Breakers (4Pole 63A & 2Pole 1000V), SPDs (40KA)" },
              { "id": "structure_std", "category": "Structure / Fabrication", "brand": "Mughal", "model": "Standard GI Structure L3", "wattageCapacity": "N/A", "unit": "Pcs", "costPrice": 4e3, "salePrice": 4800, "warranty": "10 Years Warranty", "description": "Galvanized Iron Frame with Rawal Bolts (L3) 14 Gauge" },
              { "id": "structure_elv", "category": "Structure / Fabrication", "brand": "Mughal", "model": "Elevated Structure Spec", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 12e4, "salePrice": 147600, "warranty": "15 Years Warranty", "description": "Elevated Structure H-Beam/C-Channel Mughal Steel mechanical work" },
              { "id": "structure_gdr", "category": "Structure / Fabrication", "brand": "Mughal", "model": "Mughal Girder Custom", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 15e4, "salePrice": 18e4, "warranty": "20 Years Warranty", "description": "Heavy Gauge Hot-Rolled Mughal Girder & Channel Frame" },
              { "id": "civil_works", "category": "Civil Works", "brand": "Local", "model": "Concrete Pillars Foundations", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 1e4, "salePrice": 16e3, "warranty": "N/A", "description": "Foundation Work for Structure pillars with concrete filling" },
              { "id": "installation_complete", "category": "Installation & Commissioning", "brand": "Sunchaser", "model": "Complete Installation", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 6e4, "salePrice": 8e4, "warranty": "1 Year Free Service", "description": "Installation of solar panels, electrical wiring, testing, and equipment commissioning" },
              { "id": "transportation_job", "category": "Transportation", "brand": "Local", "model": "Transportation & Logistics", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 8e3, "salePrice": 1e4, "warranty": "N/A", "description": "Transportation, logistics freight and manual lifting" },
              { "id": "net_metering_lesco", "category": "Net Metering", "brand": "LESCO", "model": "Net Metering Process", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 75e3, "salePrice": 9e4, "warranty": "N/A", "description": "LESCO three-phase net-metering licensing & demand notices processing" },
              { "id": "designing_testing", "category": "Survey / Designing / Testing", "brand": "Helios", "model": "Survey & Design Suite", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 3e3, "salePrice": 5e3, "warranty": "N/A", "description": "Survey, Designing, Testing, Commissioning, Execution Project management" }
            ]
          };
        }
        if (!db.websiteContent) {
          db.websiteContent = {
            banners: [
              { id: "b1", title: "Go Solar, Save Thousands", subtitle: "Sunchaser Professional installation sets starting from $2,420/kW", image: "https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=800&q=80" },
              { id: "b2", title: "Smart Home Automation Systems", subtitle: "Integrate solar power with advanced modern smart controls", image: "https://images.unsplash.com/photo-1558002038-1055907df827?w=800&q=80" }
            ],
            promotions: [
              { id: "p1", title: "Summer Green Rebate", code: "SUMMER30", discount: "30% Federal Tax Credit Sync (ITC)", active: true }
            ],
            blogs: [
              { id: "bg1", title: "How 400W Micro-Inverters Maximize Generation Shaded Overhangs", author: "Bob Surveyor", date: "June 2026" }
            ],
            faqs: [
              { id: "f1", question: "How long does a 10kW residential installation process take?", answer: "Usually 3-4 days including staging permits and net metering configuration." }
            ],
            testimonials: [
              { id: "t1", name: "Sarah Connor", quote: "Saving $200 a month on bills with zero net metering issues!" }
            ],
            serviceAreas: ["Springfield", "Capital District", "Shelbyville", "Westwood"]
          };
        }
        if (!db.quotations) {
          db.quotations = [];
        }
      } catch (parseErr) {
        console.error("Failed to parse database.json. Overwriting with seed.", parseErr);
        db = initialSeed;
        saveDb();
      }
    } else {
      db = initialSeed;
      saveDb();
    }
  } catch (err) {
    console.error("FS Read error inside loadDb:", err);
    db = initialSeed;
  }
}
function saveDb() {
  try {
    import_fs2.default.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("FS Write error inside saveDb:", err);
  }
}
loadDb();
async function appendActivityLog(userId, userName, role, action, details) {
  const newLog = {
    id: `log-${Date.now()}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    userId,
    userName,
    role,
    action,
    details
  };
  db.activityLogs.unshift(newLog);
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("activity_logs").insert({
        id: newLog.id,
        timestamp: newLog.timestamp,
        user_id: newLog.userId,
        user_name: newLog.userName,
        role: newLog.role,
        action: newLog.action,
        details: newLog.details
      });
    } catch (err) {
      console.error("[Supabase Error] Failed to synclog:", err);
    }
  }
  return newLog;
}
async function triggerWhatsAppNotification(customerName, phone, eventType, messageText) {
  const newWa = {
    id: `wa-${Date.now()}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    customerName,
    phone,
    eventType,
    messageText,
    status: "Delivered"
  };
  db.whatsAppLogs.unshift(newWa);
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("whatsapp_logs").insert({
        id: newWa.id,
        timestamp: newWa.timestamp,
        customer_name: newWa.customerName,
        phone: newWa.phone,
        event_type: newWa.eventType,
        message_text: newWa.messageText,
        status: newWa.status
      });
    } catch (err) {
      console.error("[Supabase Error] Failed to sync WhatsApp log:", err);
    }
  }
  return newWa;
}
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      const { data: users, error } = await supabase.from("users").select("*").eq("username", username.toLowerCase()).eq("password", password);
      if (error) throw error;
      if (users && users.length > 0) {
        const u = users[0];
        const userObj = {
          id: u.id,
          username: u.username,
          name: u.name,
          email: u.email,
          role: resolveAppUserRole(u.username, u.role)
        };
        await appendActivityLog(u.id, u.name, u.role, "User Logged In", "Authorized access via Supabase PostgreSQL security clearance.");
        return res.json({ success: true, user: userObj });
      } else {
        return res.status(401).json({ error: "Invalid credentials. Sunchaser identity rejected." });
      }
    } catch (err) {
      console.error("[Supabase Login Error]:", err.message);
      return res.status(500).json({ error: `Supabase database error: ${err.message}` });
    }
  }
  const user = db.users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase() && u.password === password
  );
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials. Sunchaser identity rejected." });
  }
  await appendActivityLog(user.id, user.name, user.role, "User Logged In", "Authorized access via local file persistence layout.");
  res.json({ success: true, user });
});
app.get("/api/state", async (req, res) => {
  if (isSupabaseActive()) {
    try {
      const stateObj = await fetchAppStateFromSupabase();
      return res.json({
        ...stateObj,
        stats: getDashboardStats(stateObj),
        currentUser: null
      });
    } catch (err) {
      console.error("[Supabase State Fetch Error]: Enforced primary db failure.", err.message);
      return res.status(500).json({ error: `Supabase database loading error: ${err.message}` });
    }
  }
  loadDb();
  res.json({
    leads: db.leads,
    tickets: db.tickets,
    netMeteringHistory: db.netMeteringHistory,
    inventory: db.inventory,
    stats: getDashboardStats(db),
    currentUser: null,
    projects: db.projects,
    netMeteringTrackers: db.netMeteringTrackers,
    paymentTracks: db.paymentTracks,
    activityLogs: db.activityLogs,
    whatsAppLogs: db.whatsAppLogs,
    purchaseOrders: db.purchaseOrders || [],
    categories: db.categories || [],
    products: db.products || [],
    orders: db.orders || [],
    warranties: db.warranties || [],
    notifications: db.notifications || [],
    solarPackages: db.solarPackages || [],
    settings: db.settings || {},
    websiteContent: db.websiteContent || {},
    quotations: db.quotations || [],
    quoteTemplates: db.quoteTemplates || [],
    quoteTemplatePages: db.quoteTemplatePages || [],
    bankAccounts: db.bankAccounts || [],
    companyTerms: db.companyTerms || [],
    ceoMessages: db.ceoMessages || [],
    socialLinks: db.socialLinks || [],
    structureDescriptions: db.structureDescriptions || [],
    quotePdfSettings: db.quotePdfSettings || []
  });
});
app.get("/api/diagnostics/db", async (req, res) => {
  const supabase = getSupabase();
  const active = isSupabaseActive();
  let supabaseUrlMasked = "NONE";
  if (process.env.SUPABASE_URL) {
    try {
      const parsed = new URL(process.env.SUPABASE_URL);
      supabaseUrlMasked = parsed.origin;
    } catch {
      supabaseUrlMasked = "INVALID_URL_FORMAT";
    }
  }
  const envKeysFound = Object.keys(process.env).filter(
    (key) => key.includes("SUPABASE") || key.includes("JWT") || key.includes("GEMINI")
  );
  let supabaseUsersCount = 0;
  let supabaseError = null;
  if (active && supabase) {
    try {
      const { count, error } = await supabase.from("users").select("*", { count: "exact", head: true });
      if (error) {
        supabaseError = error.message;
      } else {
        supabaseUsersCount = count || 0;
      }
    } catch (err) {
      supabaseError = err.message;
    }
  }
  res.json({
    supabaseActive: active,
    supabaseUrl: supabaseUrlMasked,
    envKeysFound,
    supabaseUsersCount,
    supabaseError,
    localDbExists: import_fs2.default.existsSync(DB_FILE),
    localUsersCount: db.users?.length || 0,
    nodeEnv: process.env.NODE_ENV
  });
});
app.post("/api/leads", async (req, res) => {
  loadDb();
  const {
    name,
    email,
    phone,
    address,
    monthlyBill,
    monthlyUnits,
    sanctionedLoad,
    backupRequirement,
    location,
    roofType,
    roofSpace,
    shading,
    notes,
    leadSource,
    engagementLevel
  } = req.body;
  const leadId = `lead-${db.leads.length + 101}`;
  const newLead = {
    id: leadId,
    name: name || "Anonymous Lead",
    email: email || "no-email@example.com",
    phone: phone || "",
    address: address || "",
    status: "New",
    monthlyBill: monthlyBill === void 0 || monthlyBill === null || monthlyBill === "" ? 0 : Number(monthlyBill),
    monthlyUnits: monthlyUnits === void 0 || monthlyUnits === null || monthlyUnits === "" ? 0 : Number(monthlyUnits),
    sanctionedLoad: Number(sanctionedLoad) || 7,
    backupRequirement: backupRequirement || "None",
    location: location || "Springfield",
    roofType: roofType || "Asphalt Shingle",
    roofSpace: Number(roofSpace) || 800,
    shading: shading || "Medium",
    rating: 3,
    assignedSalesperson: "Sarah Connor",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    notes: notes || "Submitted via Sunchaser Sizing Calculator.",
    leadSource: leadSource || "Self-registration Web Portal",
    engagementLevel: engagementLevel || "Medium",
    quotes: []
  };
  calculateLeadScore(newLead);
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      const customerId = `cust-${leadId.replace("lead-", "")}`;
      await supabase.from("customers").insert({
        id: customerId,
        name: newLead.name,
        email: newLead.email,
        phone: newLead.phone,
        address: newLead.address
      });
      await supabase.from("leads").insert({
        id: newLead.id,
        customer_id: customerId,
        name: newLead.name,
        email: newLead.email,
        phone: newLead.phone,
        address: newLead.address,
        status: newLead.status,
        monthly_bill: newLead.monthlyBill,
        monthly_units: newLead.monthlyUnits,
        sanctioned_load: newLead.sanctionedLoad,
        backup_requirement: newLead.backupRequirement,
        location: newLead.location,
        roof_type: newLead.roofType,
        roof_space: newLead.roofSpace,
        shading: newLead.shading,
        rating: newLead.rating,
        assigned_salesperson: newLead.assignedSalesperson,
        notes: newLead.notes,
        lead_source: newLead.leadSource,
        engagement_level: newLead.engagementLevel,
        conversion_probability: newLead.conversionProbability,
        conversion_score: newLead.conversionScore,
        created_at: newLead.createdAt
      });
    } catch (err) {
      console.error("[Supabase Lead Insertion Error]:", err.message);
    }
  }
  db.leads.push(newLead);
  saveDb();
  await appendActivityLog("guest", newLead.name, "Customer", "Lead Created", `Registered details profile for home assessment sizing.`);
  const msgText = `\u2600\uFE0F Hi ${newLead.name}! Sunchaser Energy has scheduled your structural solar survey. Our advisor Sarah Connor will coordinate framing loads and meter layout. Review options: http://sunchaser.co/portal`;
  await triggerWhatsAppNotification(newLead.name, newLead.phone, "survey_confirmation", msgText);
  res.status(201).json(newLead);
});
app.put("/api/leads/:id", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const index = db.leads.findIndex((l) => l.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Lead not found" });
  }
  db.leads[index] = {
    ...db.leads[index],
    ...req.body
  };
  calculateLeadScore(db.leads[index]);
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      const l = db.leads[index];
      await supabase.from("leads").update({
        status: l.status,
        monthly_bill: l.monthlyBill,
        monthly_units: l.monthlyUnits,
        sanctioned_load: l.sanctionedLoad,
        backup_requirement: l.backupRequirement,
        location: l.location,
        roof_type: l.roofType,
        roof_space: l.roofSpace,
        shading: l.shading,
        rating: l.rating,
        assigned_salesperson: l.assignedSalesperson,
        notes: l.notes,
        lead_source: l.leadSource,
        engagement_level: l.engagementLevel,
        conversion_probability: l.conversionProbability,
        conversion_score: l.conversionScore
      }).eq("id", id);
    } catch (err) {
      console.error("[Supabase Lead Update Error]:", err.message);
    }
  }
  res.json(db.leads[index]);
});
app.delete("/api/leads/:id", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const localLeadIndex = db.leads.findIndex((l) => l.id === id);
  const localLeadExistsBefore = localLeadIndex !== -1;
  console.log(`[DELETE TRACE] before delete lead=${id} localExists=${localLeadExistsBefore} localLeadsCount=${db.leads.length}`);
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      const childTables = [
        "quotations",
        "projects",
        "site_surveys",
        "installation_tasks",
        "net_metering_trackers",
        "payments"
      ];
      for (const table of childTables) {
        const { error: childDeleteError } = await supabase.from(table).delete().eq("lead_id", id);
        if (childDeleteError) {
          console.error(`[DELETE TRACE] child delete failed table=${table} lead=${id} error=${childDeleteError.message}`);
          throw childDeleteError;
        }
      }
      const { error: leadDeleteError, count: leadDeleteCount } = await supabase.from("leads").delete({ count: "exact" }).eq("id", id);
      if (leadDeleteError) throw leadDeleteError;
      console.log(`[DELETE TRACE] after Supabase delete lead=${id} deletedRows=${leadDeleteCount ?? 0}`);
    } catch (err) {
      console.error("[Supabase Lead Deletion Error]:", err.message);
      return res.status(500).json({ error: "Failed to delete lead from Supabase." });
    }
  }
  db.leads = db.leads.filter((l) => l.id !== id);
  db.projects = db.projects.filter((p) => p.leadId !== id);
  if (db.netMeteringTrackers[id]) delete db.netMeteringTrackers[id];
  if (db.paymentTracks[id]) delete db.paymentTracks[id];
  console.log(`[DELETE TRACE] after local delete lead=${id} localExists=${db.leads.some((l) => l.id === id)} localLeadsCount=${db.leads.length}`);
  saveDb();
  console.log(`[DELETE TRACE] after saveDb lead=${id}`);
  await appendActivityLog("admin", "Admin", "Super Admin", "Lead Deleted", `Deleted lead ${id}`);
  res.json({ success: true, message: `Lead ${id} and all related quotes/projects deleted successfully.` });
});
app.delete("/api/leads/:leadId/quotes/:quoteId", async (req, res) => {
  loadDb();
  const { leadId, quoteId } = req.params;
  const lead = db.leads.find((l) => l.id === leadId);
  if (!lead) {
    return res.status(404).json({ error: "Lead not found" });
  }
  if (!lead.quotes) lead.quotes = [];
  const quoteIndex = lead.quotes.findIndex((q) => q.id === quoteId);
  if (quoteIndex === -1) {
    return res.status(404).json({ error: "Quote not found" });
  }
  lead.quotes.splice(quoteIndex, 1);
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("quotations").delete().eq("id", quoteId).eq("lead_id", leadId);
    } catch (err) {
      console.error("[Supabase Quote Deletion Error]:", err.message);
    }
  }
  await appendActivityLog("admin", "Admin", "Super Admin", "Quote Deleted", `Deleted quote ${quoteId} for lead ${leadId}`);
  res.json({ success: true, message: `Quote ${quoteId} deleted successfully.` });
});
app.put("/api/leads/:id/assign", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { salespersonName } = req.body;
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  lead.assignedSalesperson = salespersonName;
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("leads").update({ assigned_salesperson: salespersonName }).eq("id", id);
    } catch (err) {
      console.error("[Supabase Reassign Error]:", err.message);
    }
  }
  await appendActivityLog("admin", "Super Admin", "Super Admin", "Lead Assigned", `Assigned lead ${lead.name} to salesperson ${salespersonName}`);
  res.json(lead);
});
app.post("/api/leads/:id/ai-score", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  try {
    const aiPrompt = `Perform a predictive marketing conversion scoring diagnostics for Sunchaser solar candidate:
Name: ${lead.name}
Electricity Bill Rate: $${lead.monthlyBill}/mo
Roof Dimensioning Space: ${lead.roofSpace} sq ft
Shading Obstruction Level: ${lead.shading}
Candidate Engagement Level: ${lead.engagementLevel || "Medium"}
Marketing Lead Acquisition Source: ${lead.leadSource || "Self Website Sunkap"}

Analyze demographic feasibility and output a qualitative lead conversion rating report. Deliver two high-impact bullet items focusing on:
1. **Closing Strategy**: Key recommendation on how to secure an acceptance quote.
2. **Technical Hotspots**: Solar incentives, Powerwall battery suitability, or structural hazards to watch for.
Keep your answer under 100 words in concise professional clean markdown text.`;
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: aiPrompt,
      config: {
        systemInstruction: "You are the Director of Commercial Conversions at Sunchaser Energy, giving bulleted closing directives.",
        temperature: 0.1
      }
    });
    res.json({ scoreAnalysis: response.text });
  } catch (err) {
    console.error("Gemini AI Lead Score error:", err);
    res.json({
      scoreAnalysis: `* **Closing Strategy**: Highlight the immediate 30% Federal Investment Tax Credit lowering total out-of-pocket costs on their sizing layout.
* **Technical Hotspots**: Shading index is currently logged as ${lead.shading}, suggesting Enphase Microinverters are mandatory to keep output optimal.`
    });
  }
});
app.post("/api/leads/:id/schedule-survey", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { scheduledDate } = req.body;
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  lead.status = "Survey Scheduled";
  lead.survey = {
    scheduledDate,
    status: "Pending",
    notes: "Site visit confirmed via structural scheduler.",
    shadingPercent: 0,
    optimalPlacement: "",
    photos: []
  };
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("leads").update({ status: "Survey Scheduled" }).eq("id", id);
      await supabase.from("site_surveys").upsert({
        lead_id: id,
        scheduled_date: scheduledDate,
        status: "Pending",
        notes: "Site visit confirmed via structural scheduler."
      }, { onConflict: "lead_id" });
    } catch (err) {
      console.error("[Supabase Survey Scheduling Error]:", err.message);
    }
  }
  await appendActivityLog("system", "Sales System", "CRM", "Survey Scheduled", `Scheduled site visit for ${lead.name} on ${scheduledDate}`);
  const msgText = `\u2600\uFE0F Confirmation booked! A Sunchaser technician is dispatched to audit framing pitch/meter panels on ${new Date(scheduledDate).toLocaleDateString()} at ${new Date(scheduledDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Keep pets indoors!`;
  await triggerWhatsAppNotification(lead.name, lead.phone, "survey_confirmation", msgText);
  res.json(lead);
});
app.post("/api/leads/:id/whatsapp-reminder", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  const msgText = `\u2600\uFE0F Hi ${lead.name}! Sarah Connor here from Sunchaser Energy. Just checking in to see if you had any questions on your custom solar sizing layout. Let us know if you would like to proceed or schedule a site survey!`;
  await triggerWhatsAppNotification(lead.name, lead.phone, "followup_reminder", msgText);
  await appendActivityLog("sales", "Sarah Connor", "Sales Executive", "Follow-up Reminded", `Dispatched WhatsApp follow-up reminder to ${lead.name}`);
  res.json({ success: true, lead });
});
app.post("/api/inventory/procure", async (req, res) => {
  loadDb();
  const { vendor, itemId, quantity } = req.body;
  if (!vendor || !itemId || !quantity) {
    return res.status(400).json({ error: "Missing procurement inputs." });
  }
  if (!db.purchaseOrders) {
    db.purchaseOrders = [];
  }
  const item = db.inventory.find((i) => i.id === itemId);
  if (!item) {
    return res.status(404).json({ error: "Inventory product component item not found." });
  }
  const cost = item.cost * Number(quantity);
  const newPO = {
    id: `PO-${Date.now().toString().slice(-4)}`,
    vendor,
    itemId,
    itemName: item.name,
    quantity: Number(quantity),
    status: "Delivered",
    // Automated warehouse restock fulfillment upon creation
    date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    cost
  };
  db.purchaseOrders.unshift(newPO);
  item.stock = Number(item.stock) + Number(quantity);
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("products_inventory").update({ stock: item.stock }).eq("id", itemId);
    } catch (err) {
      console.error("[Supabase Inventory sync error]:", err.message);
    }
  }
  await appendActivityLog(
    "admin",
    "Alex Admin",
    "Super Admin",
    "PO Procured",
    `Issued Purchase Order ${newPO.id} to ${vendor} for ${quantity}x ${item.name} ($${cost.toLocaleString()})`
  );
  res.json({ success: true, purchaseOrder: newPO, inventory: db.inventory });
});
app.post("/api/leads/:id/survey-report", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const {
    shadingPercent,
    optimalPlacement,
    notes,
    photos,
    measurements,
    structureRecommendation,
    dbInverterLocation,
    panelPlacements
  } = req.body;
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  lead.survey = {
    scheduledDate: lead.survey?.scheduledDate || (/* @__PURE__ */ new Date()).toISOString(),
    status: "Completed",
    shadingPercent: Number(shadingPercent) || 5,
    optimalPlacement: optimalPlacement || "Southern facing roof lines",
    notes: notes || "CAD blueprint finalized",
    photos: photos || ["/assets/roof_sample_1.jpg"],
    measurements: measurements || {
      roofPitch: "25 degrees",
      rafterSpacing: "16 inches OC",
      dimensions: "35ft x 25ft unshaded",
      obstructions: "Vent stack"
    },
    structureRecommendation: structureRecommendation || "Asphalt shingle flashing mount rails",
    dbInverterLocation: dbInverterLocation || "Garage wall space",
    panelPlacements: panelPlacements || []
  };
  lead.status = "Quoted";
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("leads").update({ status: "Quoted" }).eq("id", id);
      await supabase.from("site_surveys").upsert({
        lead_id: id,
        status: "Completed",
        shading_percent: lead.survey.shadingPercent,
        optimal_placement: lead.survey.optimalPlacement,
        notes: lead.survey.notes,
        photos: lead.survey.photos,
        roof_pitch: lead.survey.measurements.roofPitch,
        rafter_spacing: lead.survey.measurements.rafterSpacing,
        dimensions: lead.survey.measurements.dimensions,
        obstructions: lead.survey.measurements.obstructions,
        structure_recommendation: lead.survey.structureRecommendation,
        db_inverter_location: lead.survey.dbInverterLocation,
        panel_placements: JSON.stringify(lead.survey.panelPlacements)
      }, { onConflict: "lead_id" });
    } catch (err) {
      console.error("[Supabase Survey Report Error]:", err.message);
    }
  }
  await appendActivityLog("surveyor", "Bob Surveyor", "Survey Engineer", "Survey Audited", `Submitted structural measurements & CAD panel positions for ${lead.name}`);
  res.json(lead);
});
app.post("/api/leads/:id/create-quote", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const {
    systemSizekW,
    panelCount,
    panelType,
    inverterType,
    batteryCapacity,
    totalCost,
    structureType,
    accessories,
    installationCharges,
    netMeteringCharges,
    paymentTerms,
    warrantyTerms,
    termsAndConditions,
    // Custom Lahore/Pakistan quotation fields
    clientName,
    clientPhone,
    clientEmail,
    clientAddress,
    cnic,
    cityArea,
    bdmName,
    quoteDate,
    systemType,
    panelBrand,
    panelWattage,
    inverterBrand,
    inverterCapacity,
    batteryOption,
    netMeteringRequired,
    discount,
    paymentSchedule,
    boqItems,
    // Redesigned Manual Builder fields
    lescoSettings,
    societyCharges,
    taxEnabled,
    taxRate,
    taxAmount,
    selectedStructure,
    customStructure,
    boqRows,
    customNotes,
    grandTotal,
    netTotal,
    idempotencyKey,
    quote_type
  } = req.body;
  console.log(`[API POST /api/leads/${id}/create-quote] Received request body:`, {
    systemSizekW,
    panelCount,
    totalCost,
    clientName,
    clientPhone,
    boqRowsCount: boqRows?.length || 0,
    boqItemsCount: boqItems?.length || 0,
    grandTotal,
    netTotal,
    idempotencyKey,
    quote_type
  });
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (quote_type === "auto_sizer" && !AUTO_SIZER_QUOTE_CREATION_ENABLED) {
    return res.status(403).json({ error: "Auto Sizer quote creation is temporarily disabled. Use Manual BOQ Builder." });
  }
  if (idempotencyKey && lead.quotes?.some((q) => q.idempotencyKey === idempotencyKey)) {
    console.log(`[API POST /api/leads/${id}/create-quote] Blocked duplicate request with idempotency key: ${idempotencyKey}`);
    return res.status(409).json({ error: "Duplicate request: Quote with this idempotency key already exists." });
  }
  const now = Date.now();
  const recentQuote = lead.quotes?.find((q) => {
    const createdAtTime = new Date(q.createdAt).getTime();
    return now - createdAtTime < 4e3;
  });
  if (recentQuote) {
    console.log(`[API POST /api/leads/${id}/create-quote] Blocked request due to 4s guard. Last quote created at: ${recentQuote.createdAt}`);
    return res.status(429).json({ error: "Rate limit: Please wait 4 seconds between generating quotes." });
  }
  const quoteId = `q-${(lead.quotes || []).length + 1}`;
  const cost = Number(totalCost) || Number(systemSizekW) * 19500 + (batteryCapacity ? 48e4 : 0);
  const disc = Number(discount) || 0;
  const netCost = cost - disc;
  if (clientName) lead.name = clientName;
  if (clientPhone) lead.phone = clientPhone;
  if (clientEmail) lead.email = clientEmail;
  if (clientAddress) lead.address = clientAddress;
  if (cityArea) lead.location = cityArea;
  if (bdmName) lead.assignedSalesperson = bdmName;
  const newQuote = {
    id: quoteId,
    idempotencyKey: idempotencyKey || "",
    systemSizekW: Number(systemSizekW) || 7.2,
    panelCount: Number(panelCount) || 18,
    panelType: panelType || "Longi 580W Panels",
    inverterType: inverterType || "Goodwe 20kW Inverter",
    batteryCapacity: batteryCapacity || "",
    totalCost: cost,
    federalTaxCredit: 0,
    netCost,
    estimatedAnnualSavings: Number((Number(systemSizekW) * 1400 * 35).toFixed(2)),
    // Rs 35 per unit
    paybackPeriodYears: Number((netCost / (Number(systemSizekW) * 1400 * 35)).toFixed(1)),
    status: "Pending",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    structureType: structureType || "Standard",
    accessories: accessories || "Dual DC cables, PVC ducting & safety switches",
    installationCharges: Number(installationCharges) || 75e3,
    netMeteringCharges: Number(netMeteringCharges) || 9e4,
    paymentTerms: paymentTerms || "50% Advance, 40% Delivery, 10% Commissioning",
    warrantyTerms: warrantyTerms || "25 year power degradation, 10 year inverter warranty",
    termsAndConditions: termsAndConditions || "Generation yield matches simulation rules.",
    // Extended parameters
    clientName: clientName || lead.name,
    clientPhone: clientPhone || lead.phone,
    clientEmail: clientEmail || lead.email,
    clientAddress: clientAddress || lead.address,
    cnic: cnic || "",
    cityArea: cityArea || lead.location || "Lahore",
    bdmName: bdmName || lead.assignedSalesperson || "Sarah Connor",
    quoteDate: quoteDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    systemType: systemType || "Hybrid",
    panelBrand: panelBrand || "Jinko",
    panelWattage: Number(panelWattage) || 580,
    inverterBrand: inverterBrand || "Knox",
    inverterCapacity: inverterCapacity || "10kW",
    batteryOption: batteryOption || "None",
    netMeteringRequired: netMeteringRequired || "Yes",
    discount: disc,
    paymentSchedule: paymentSchedule || paymentTerms || "50% Advance, 40% Delivery, 10% Commissioning",
    boqItems: boqItems || [],
    // Redesigned Manual Builder fields
    lescoSettings: lescoSettings || { meterNo: "", consumerNo: "", sanctionedLoad: "", phaseType: "Three Phase" },
    societyCharges: Number(societyCharges) || 0,
    taxEnabled: !!taxEnabled,
    taxRate: Number(taxRate) || 0,
    taxAmount: Number(taxAmount) || 0,
    selectedStructure: selectedStructure || (structureType ? String(structureType).toLowerCase() : "standard"),
    customStructure: customStructure || null,
    boqRows: boqRows || [],
    customNotes: customNotes || "",
    grandTotal: Number(grandTotal) || cost,
    netTotal: Number(netTotal) || netCost,
    quote_type: quote_type === "auto_sizer" ? "auto_sizer" : "manual_boq"
  };
  lead.quotes = [newQuote, ...lead.quotes || []];
  lead.status = "Quoted";
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      const customerId = `cust-${id.replace("lead-", "")}`;
      await supabase.from("leads").update({
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        location: lead.location,
        assigned_salesperson: lead.assignedSalesperson,
        status: "Quoted"
      }).eq("id", id);
      console.log(`[Supabase Create Quotation] Inserting quote ${newQuote.id} for lead ${id}. Payload diagnostics:`, {
        clientName: newQuote.clientName,
        clientPhone: newQuote.clientPhone,
        boqRowsCount: newQuote.boqRows?.length || 0,
        lescoMeterNo: newQuote.lescoSettings?.meterNo,
        grandTotal: newQuote.grandTotal,
        netTotal: newQuote.netTotal
      });
      const insertResult = await persistQuotationToSupabase(
        supabase,
        id,
        customerId,
        newQuote,
        "insert"
      );
      if (!insertResult.ok) {
        console.error("[Supabase Create Quotation Database Error]:", insertResult.error);
      } else {
        console.log(`[Supabase Create Quotation] Quote ${newQuote.id} inserted successfully.`);
      }
    } catch (err) {
      console.error("[Supabase Create Quotation Error]:", err.message);
    }
  }
  await appendActivityLog("sales", bdmName || "Sarah Connor", "Sales Executive", "Quotation Written", `Formulated quote ${quoteId} for ${lead.name}`);
  const msgText = `\u2600\uFE0F Hi ${lead.name}! Sunchaser has unlocked your custom solar proposal: ${newQuote.systemSizekW} kW with ${newQuote.inverterType}. Total final cost is Rs. ${newQuote.netCost.toLocaleString()}. Open file: http://sunchaser.co/portal`;
  await triggerWhatsAppNotification(lead.name, lead.phone, "quote_generation", msgText);
  res.json(lead);
});
app.post("/api/leads/:id/duplicate-quote", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { quoteId } = req.body;
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  const quoteToDup = lead.quotes?.find((q) => q.id === quoteId);
  if (!quoteToDup) return res.status(404).json({ error: "Quote not found" });
  const newQuoteId = `q-${(lead.quotes || []).length + 1}`;
  const duplicated = {
    ...quoteToDup,
    id: newQuoteId,
    status: "Pending",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    quoteDate: (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
  };
  lead.quotes = [duplicated, ...lead.quotes || []];
  saveDb();
  res.json(lead);
});
app.post("/api/leads/:id/update-quote", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { quoteId, quoteData, ...quotePayload } = req.body;
  const payload = quoteData && typeof quoteData === "object" ? quoteData : quotePayload;
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (payload.quote_type === "auto_sizer" && !AUTO_SIZER_QUOTE_CREATION_ENABLED) {
    return res.status(403).json({ error: "Auto Sizer quote updates are temporarily disabled." });
  }
  const quoteIndex = lead.quotes?.findIndex((q) => q.id === quoteId);
  if (quoteIndex === -1 || quoteIndex === void 0) {
    return res.status(404).json({ error: "Quote not found" });
  }
  const existingQuote = lead.quotes[quoteIndex];
  const updatedQuote = {
    ...existingQuote,
    ...payload,
    id: quoteId,
    quote_type: payload.quote_type === "auto_sizer" && AUTO_SIZER_QUOTE_CREATION_ENABLED ? "auto_sizer" : "manual_boq",
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  lead.quotes[quoteIndex] = updatedQuote;
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      const customerId = `cust-${id.replace("lead-", "")}`;
      const updateResult = await persistQuotationToSupabase(
        supabase,
        id,
        customerId,
        updatedQuote,
        "upsert"
      );
      if (!updateResult.ok) {
        console.error("[Supabase Update Quotation Database Error]:", updateResult.error);
      }
    } catch (err) {
      console.error("[Supabase Update Quotation Error]:", err.message);
    }
  }
  await appendActivityLog("sales", updatedQuote.bdmName || "Sarah Connor", "Sales Executive", "Quotation Updated", `Updated quote ${quoteId} for ${lead.name}`);
  res.json(lead);
});
app.post("/api/upload", async (req, res) => {
  try {
    const base64Input = req.body.base64Data || req.body.base64;
    const filenameInput = req.body.filename || req.body.fileName;
    if (!base64Input) {
      return res.status(400).json({ error: "base64Data or base64 field is required" });
    }
    const matches = base64Input.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let dataBuffer;
    let extension = "";
    if (matches && matches.length === 3) {
      extension = matches[1].split("/")[1];
      dataBuffer = Buffer.from(matches[2], "base64");
    } else {
      dataBuffer = Buffer.from(base64Input, "base64");
    }
    const cleanFilename = filenameInput ? filenameInput.replace(/[^a-zA-Z0-9.-]/g, "_") : `upload_${Date.now()}.${extension || "png"}`;
    const uploadsDir = import_path2.default.join(__dirname, "public", "uploads");
    if (!import_fs2.default.existsSync(uploadsDir)) {
      import_fs2.default.mkdirSync(uploadsDir, { recursive: true });
    }
    const filePath = import_path2.default.join(uploadsDir, cleanFilename);
    import_fs2.default.writeFileSync(filePath, dataBuffer);
    res.json({ url: `/uploads/${cleanFilename}`, dataUrl: base64Input });
  } catch (err) {
    res.status(500).json({ error: "Failed to upload file: " + err.message });
  }
});
app.post("/api/leads/:id/accept-quote", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { quoteId } = req.body;
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  lead.status = "Contracted";
  lead.quotes = lead.quotes.map((q) => {
    if (q.id === quoteId) q.status = "Accepted";
    else q.status = "Declined";
    return q;
  });
  const acceptedQuote = lead.quotes.find((q) => q.status === "Accepted");
  const sizeKw = acceptedQuote ? acceptedQuote.systemSizekW : 7.2;
  const costTotal = acceptedQuote ? acceptedQuote.totalCost : 17280;
  const projId = `project-${Date.now()}`;
  const newProject = {
    id: projId,
    leadId: lead.id,
    customerName: lead.name,
    address: lead.address,
    systemSizekW: sizeKw,
    stage: "Advance Received",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  db.projects.unshift(newProject);
  lead.installation = {
    status: "Scheduled",
    scheduledDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1e3).toISOString(),
    progress: 10,
    tasks: [
      { id: "t-1", name: "Structural Reinforcement & Rails", done: false },
      { id: "t-2", name: "Inverter & Core Battery Mounting", done: false },
      { id: "t-3", name: "Solar Panel Array Installation", done: false },
      { id: "t-4", name: "Electrical Connection & Conduit Routing", done: false },
      { id: "t-5", name: "Net Meter Setup & Interconnection Inspection", done: false }
    ],
    completionPhotos: [],
    report: ""
  };
  db.netMeteringTrackers[lead.id] = {
    leadId: lead.id,
    documentsCollected: true,
    applicationSubmitted: true,
    discoInspection: false,
    demandNotice: false,
    meterInstallation: false,
    greenMeterActive: false
  };
  const advanceAmt = Number((costTotal * 0.3).toFixed(2));
  db.paymentTracks[lead.id] = {
    leadId: lead.id,
    totalValue: costTotal,
    advanceReceived: advanceAmt,
    pendingAmount: costTotal - advanceAmt,
    reminderSent: false,
    invoiceStatus: "Pending",
    milestones: [
      { name: "30% Sign-up Advance", amount: advanceAmt, status: "Paid", dueDate: (/* @__PURE__ */ new Date()).toISOString().split("T")[0] },
      { name: "30% Structural Engineering Approval", amount: advanceAmt, status: "Pending", dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0] },
      { name: "30% Panel Arrays Completed", amount: advanceAmt, status: "Pending", dueDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0] },
      { name: "10% Utility Interconnection Active", amount: Number((costTotal * 0.1).toFixed(2)), status: "Pending", dueDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0] }
    ]
  };
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      const customerId = `cust-${id.replace("lead-", "")}`;
      await supabase.from("leads").update({ status: "Contracted" }).eq("id", id);
      await supabase.from("quotations").update({ status: "Accepted" }).eq("id", quoteId);
      await supabase.from("quotations").update({ status: "Declined" }).eq("lead_id", id).neq("id", quoteId);
      await supabase.from("projects").insert({
        id: newProject.id,
        lead_id: id,
        quotation_id: quoteId,
        customer_id: customerId,
        customer_name: newProject.customerName,
        address: newProject.address,
        system_size_kw: newProject.systemSizekW,
        stage: "Advance Received"
      });
      for (const t of lead.installation.tasks) {
        await supabase.from("installation_tasks").insert({
          id: `${id}-${t.id}`,
          lead_id: id,
          name: t.name,
          done: t.done
        });
      }
      await supabase.from("net_metering_trackers").insert({
        lead_id: id,
        customer_id: customerId,
        project_id: newProject.id,
        documents_collected: true,
        application_submitted: true
      });
      await supabase.from("payments").insert({
        lead_id: id,
        project_id: newProject.id,
        customer_id: customerId,
        total_value: costTotal,
        advance_received: advanceAmt,
        pending_amount: costTotal - advanceAmt,
        invoice_status: "Pending",
        milestones: JSON.stringify(db.paymentTracks[lead.id].milestones)
      });
    } catch (err) {
      console.error("[Supabase Quote Acceptance Error]:", err.message);
    }
  }
  await appendActivityLog(lead.id, lead.name, "Customer", "Contract Signed", `Signed blueprint quotation, paid 30% advance retainer of $${advanceAmt}`);
  const sText = `\u2600\uFE0F Contract signed! We have received your solar retainer advance core of $${advanceAmt}. Sunchaser structural designers are preparing engineering submittals for city review. Track: http://sunchaser.co/portal`;
  await triggerWhatsAppNotification(lead.name, lead.phone, "contract_signed", sText);
  res.json(lead);
});
app.post("/api/leads/:id/update-installation", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { progress, tasks, status, completionPhotos, report } = req.body;
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (lead.installation) {
    if (progress !== void 0) lead.installation.progress = Number(progress);
    if (tasks !== void 0) lead.installation.tasks = tasks;
    if (status !== void 0) lead.installation.status = status;
    if (completionPhotos !== void 0) lead.installation.completionPhotos = completionPhotos;
    if (report !== void 0) lead.installation.report = report;
    const proj = db.projects.find((p) => p.leadId === lead.id);
    if (proj) {
      if (lead.installation.progress === 100) {
        lead.installation.status = "Completed";
        lead.status = "Installed";
        proj.stage = "Completed";
        await appendActivityLog("installer", "Dave Installer", "Installation Team", "Project Commissioned", `Completed all panel mount tests at John Miller's home site.`);
      } else {
        lead.installation.status = "In Progress";
        if (lead.installation.progress > 80) proj.stage = "Testing & Commissioning";
        else if (lead.installation.progress > 60) proj.stage = "Inverter Installation";
        else if (lead.installation.progress > 40) proj.stage = "Panel Installation";
        else proj.stage = "Structure Installation";
      }
      proj.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
  }
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      if (lead.installation?.tasks) {
        for (const t of lead.installation.tasks) {
          await supabase.from("installation_tasks").update({ done: t.done }).eq("id", `${id}-${t.id}`);
        }
      }
      const proj = db.projects.find((p) => p.leadId === id);
      if (proj) {
        await supabase.from("projects").update({ stage: proj.stage, updated_at: proj.updatedAt }).eq("id", proj.id);
      }
      if (lead.installation?.progress === 100) {
        await supabase.from("leads").update({ status: "Installed" }).eq("id", id);
      }
    } catch (err) {
      console.error("[Supabase Installation Update Error]:", err.message);
    }
  }
  await appendActivityLog("installer", "Dave Installer", "Installation Team", "Installation Status Adjusted", `Adjusted progress to ${progress}%`);
  res.json(lead);
});
app.post("/api/tickets", async (req, res) => {
  loadDb();
  const { customerName, email, subject, description, priority } = req.body;
  const newTicket = {
    id: `ticket-${100 + db.tickets.length + 1}`,
    customerName: customerName || "Anonymous Customer",
    email: email || "john.miller@gmail.com",
    subject: subject || "Solar General Inquiry",
    description: description || "",
    status: "Open",
    priority: priority || "Medium",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    messages: [
      { sender: "Customer", text: description, time: (/* @__PURE__ */ new Date()).toISOString() }
    ]
  };
  db.tickets.unshift(newTicket);
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("support_tickets").insert({
        id: newTicket.id,
        customer_name: newTicket.customerName,
        email: newTicket.email,
        subject: newTicket.subject,
        description: newTicket.description,
        status: newTicket.status,
        priority: newTicket.priority,
        messages: JSON.stringify(newTicket.messages)
      });
    } catch (err) {
      console.error("[Supabase Create Ticket Error]:", err.message);
    }
  }
  await appendActivityLog("guest", newTicket.customerName, "Customer", "Support Ticket Raised", `Opened concern: "${newTicket.subject}"`);
  res.status(201).json(newTicket);
});
app.post("/api/tickets/:id/reply", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { text, sender } = req.body;
  const ticket = db.tickets.find((t) => t.id === id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  ticket.messages.push({
    sender: sender || "Agent",
    text,
    time: (/* @__PURE__ */ new Date()).toISOString()
  });
  if (sender === "Agent") {
    ticket.status = "In Progress";
  }
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("support_tickets").update({
        messages: JSON.stringify(ticket.messages),
        status: ticket.status
      }).eq("id", id);
    } catch (err) {
      console.error("[Supabase Message Post Error]:", err.message);
    }
  }
  if (sender === "Agent") {
    const lead = db.leads.find((l) => l.email.toLowerCase() === ticket.email.toLowerCase());
    if (lead) {
      const msgText = `\u2600\uFE0F Support Update! Sunchaser engineering has answered your tickets dashboard concern titled (${ticket.subject}): "${text.slice(0, 60)}..." View: http://sunchaser.co/portal`;
      await triggerWhatsAppNotification(lead.name, lead.phone, "ticket_update", msgText);
    }
  }
  await appendActivityLog("system", sender || "System", sender === "Agent" ? "Sales Executive" : "Customer", "Ticket Reply Added", `Registered response message within support thread ${ticket.id}`);
  res.json(ticket);
});
app.put("/api/tickets/:id/resolve", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const ticket = db.tickets.find((t) => t.id === id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  ticket.status = "Resolved";
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("support_tickets").update({ status: "Resolved" }).eq("id", id);
    } catch (err) {
      console.error("[Supabase Resolve Ticket Error]:", err.message);
    }
  }
  await appendActivityLog("admin", "Alex Admin", "Super Admin", "Support Ticket Solved", `Resolved ticket ${ticket.id}`);
  res.json(ticket);
});
app.post("/api/orders", async (req, res) => {
  loadDb();
  const { customerName, email, phone, address, orderType, status, items, totalCost, installationRequired } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Order items cannot be empty." });
  }
  const newOrder = {
    id: `ORD-${Date.now().toString().slice(-6)}`,
    customerName: customerName || "Anonymous Customer",
    email: email || "",
    phone: phone || "",
    address: address || "",
    orderType: orderType || "Product",
    status: status || "Pending",
    items,
    totalCost,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    installationRequired: !!installationRequired
  };
  db.orders.unshift(newOrder);
  const newNotif = {
    id: `NT-${Date.now().toString().slice(-6)}`,
    customerName: newOrder.customerName,
    message: `New multi-business order ${newOrder.id} placed for ${newOrder.items.map((i) => i.productName).join(", ")}.`,
    type: "new_order",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    read: false
  };
  db.notifications.unshift(newNotif);
  saveDb();
  await appendActivityLog("customer", newOrder.customerName, "Customer", "New Order Placed", `Created order ${newOrder.id} with total value of $${totalCost.toLocaleString()}`);
  res.status(201).json(newOrder);
});
app.post("/api/orders/:id/status", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { status, remarks } = req.body;
  const order = db.orders.find((o) => o.id === id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  order.status = status;
  if (status === "Delivered") {
    const defaultSerial = `SN-${(order.items[0]?.productId || "PROD").toUpperCase()}-${Math.floor(1e4 + Math.random() * 9e4)}`;
    const matchingProduct = db.products.find((p) => p.id === order.items[0]?.productId || p.sku === order.items[0]?.productId);
    const wPeriod = matchingProduct ? matchingProduct.warrantyPeriod : "2 Years";
    const years = parseInt(wPeriod) || 2;
    const end = /* @__PURE__ */ new Date();
    end.setFullYear(end.getFullYear() + years);
    const newWarranty = {
      id: `WAR-${Date.now().toString().slice(-6)}`,
      customerName: order.customerName,
      email: order.email,
      productName: order.items[0]?.productName || "Sunchaser Product",
      productSku: order.items[0]?.productId || "SC-PROD",
      serialNumber: defaultSerial,
      startDate: (/* @__PURE__ */ new Date()).toISOString(),
      endDate: end.toISOString(),
      installationDate: (/* @__PURE__ */ new Date()).toISOString(),
      status: "Active",
      claimHistory: []
    };
    db.warranties.unshift(newWarranty);
    const newNotif = {
      id: `NT-${Date.now().toString().slice(-6)}`,
      customerName: order.customerName,
      message: `Warranty coverage activated for ${newWarranty.productName}. Serial: ${newWarranty.serialNumber}`,
      type: "order_delivered",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      read: false
    };
    db.notifications.unshift(newNotif);
  }
  saveDb();
  await appendActivityLog("admin", "Alex Admin", "Super Admin", "Order Status Updated", `Adjusted order ${id} status to ${status}. Remarks: ${remarks || "None"}`);
  res.json(order);
});
app.post("/api/tickets/advanced", async (req, res) => {
  loadDb();
  const { customerName, email, subject, description, priority, productSelection, photos, videos, voiceNoteUrl, location, preferredVisitTime } = req.body;
  const newTicket = {
    id: `ticket-${100 + db.tickets.length + 1}`,
    customerName: customerName || "Anonymous Customer",
    email: email || "john.miller@gmail.com",
    subject: subject || "Device complaint",
    description: description || "",
    status: "New",
    priority: priority || "Medium",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    messages: [
      { sender: "Customer", text: `Raised Complaint for ${productSelection || "Product"}: ${description}`, time: (/* @__PURE__ */ new Date()).toISOString() }
    ],
    productSelection,
    photos: photos || [],
    videos: videos || [],
    voiceNoteUrl,
    location: location || "Customer Home Address",
    preferredVisitTime: preferredVisitTime || "Standard Work Hours",
    assignedTechnician: ""
  };
  db.tickets.unshift(newTicket);
  const newNotif = {
    id: `NT-${Date.now().toString().slice(-6)}`,
    customerName: newTicket.customerName,
    message: `New support ticket ${newTicket.id} created: "${newTicket.subject}"`,
    type: "new_complaint",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    read: false
  };
  db.notifications.unshift(newNotif);
  saveDb();
  await appendActivityLog("guest", newTicket.customerName, "Customer", "Advanced Complaint Ticket Raised", `Registered concern for ${productSelection}: ${newTicket.subject}`);
  res.status(201).json(newTicket);
});
app.post("/api/tickets/:id/tech-assign", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { technicianName, internalNotes } = req.body;
  const ticket = db.tickets.find((t) => t.id === id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });
  ticket.assignedTechnician = technicianName;
  ticket.status = "Technician Assigned";
  if (internalNotes) ticket.internalNotes = internalNotes;
  const newNotif = {
    id: `NT-${Date.now().toString().slice(-6)}`,
    customerName: ticket.customerName,
    message: `Technician assigned to concern ${ticket.id}: ${technicianName}`,
    type: "technician_assigned",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    read: false
  };
  db.notifications.unshift(newNotif);
  saveDb();
  await appendActivityLog("admin", "Sam Support", "Support Agent", "Technician Assigned", `Delegated technician "${technicianName}" to ticket ${id}`);
  res.json(ticket);
});
app.post("/api/tickets/:id/tech-resolve", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { resolutionText, resolutionProofUrl } = req.body;
  const ticket = db.tickets.find((t) => t.id === id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });
  ticket.status = "Resolved";
  ticket.resolutionProofUrl = resolutionProofUrl || "";
  ticket.messages.push({
    sender: "Agent",
    text: `Technician Job Resolution Dispatch: ${resolutionText}. Proof Photo: ${resolutionProofUrl || "None provided"}`,
    time: (/* @__PURE__ */ new Date()).toISOString()
  });
  saveDb();
  await appendActivityLog("technician", ticket.assignedTechnician || "Dave Installer", "Technician", "Complaint Resolved by Tech", `Dispatched final resolution of concern ${id}`);
  res.json(ticket);
});
app.post("/api/warranties/:id/claims", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { issueTitle, description } = req.body;
  const warranty = db.warranties.find((w) => w.id === id);
  if (!warranty) return res.status(404).json({ error: "Warranty record not found." });
  const newClaim = {
    claimId: `CLM-${Date.now().toString().slice(-4)}`,
    claimDate: (/* @__PURE__ */ new Date()).toISOString(),
    issueTitle,
    description,
    status: "Pending"
  };
  warranty.claimHistory.push(newClaim);
  const newNotif = {
    id: `NT-${Date.now().toString().slice(-6)}`,
    customerName: warranty.customerName,
    message: `Warranty claim ${newClaim.claimId} submitted for ${warranty.productName}.`,
    type: "new_complaint",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    read: false
  };
  db.notifications.unshift(newNotif);
  saveDb();
  await appendActivityLog("customer", warranty.customerName, "Customer", "Warranty Claim Raised", `Raised claim ${newClaim.claimId} for ${warranty.productName}`);
  res.status(201).json(warranty);
});
app.post("/api/warranties/:id/claims/:claimId/status", async (req, res) => {
  loadDb();
  const { id, claimId } = req.params;
  const { status, resolutionNotes } = req.body;
  const warranty = db.warranties.find((w) => w.id === id);
  if (!warranty) return res.status(404).json({ error: "Warranty record not found." });
  const claim = warranty.claimHistory.find((c) => c.claimId === claimId);
  if (!claim) return res.status(404).json({ error: "Claim not found." });
  claim.status = status;
  if (resolutionNotes) claim.resolutionNotes = resolutionNotes;
  saveDb();
  await appendActivityLog("admin", "Alice Admin", "Admin", "Warranty Claim Status Updated", `Setting claim ${claimId} status of ${warranty.productName} to ${status}`);
  res.json(warranty);
});
app.post("/api/notifications/:id/read", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const notif = db.notifications.find((n) => n.id === id);
  if (notif) {
    notif.read = true;
    saveDb();
  }
  res.json({ success: true });
});
app.post("/api/projects/:id/update-stage", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { stage } = req.body;
  const project = db.projects.find((p) => p.id === id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  project.stage = stage;
  project.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const payment = db.paymentTracks[project.leadId];
  if (payment) {
    if (stage === "Advance Received") {
      payment.milestones[0].status = "Paid";
    } else if (stage === "Material Procurement") {
      payment.advanceReceived = payment.totalValue * 0.6;
      payment.pendingAmount = payment.totalValue * 0.4;
      payment.milestones[0].status = "Paid";
      payment.milestones[1].status = "Paid";
    } else if (stage === "Completed" || stage === "Net Metering Approved") {
      payment.advanceReceived = payment.totalValue;
      payment.pendingAmount = 0;
      payment.invoiceStatus = "Paid";
      payment.milestones.forEach((m) => m.status = "Paid");
    }
  }
  const lead = db.leads.find((l) => l.id === project.leadId);
  if (lead) {
    if (stage === "Completed") {
      lead.status = "Installed";
      if (lead.installation) lead.installation.progress = 100;
    }
  }
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("projects").update({ stage, updated_at: project.updatedAt }).eq("id", id);
      if (payment) {
        await supabase.from("payments").update({
          advance_received: payment.advanceReceived,
          pending_amount: payment.pendingAmount,
          invoice_status: payment.invoiceStatus,
          milestones: JSON.stringify(payment.milestones)
        }).eq("lead_id", project.leadId);
      }
      if (lead && stage === "Completed") {
        await supabase.from("leads").update({ status: "Installed" }).eq("id", lead.id);
      }
    } catch (err) {
      console.error("[Supabase Stage Sync Error]:", err.message);
    }
  }
  await appendActivityLog("installer", "Installation Manager", "Installation Team", "Project Staged", `Adjourned project ${project.id} milestones to ${stage}`);
  res.json(project);
});
app.post("/api/projects/:leadId/net-metering/update", async (req, res) => {
  loadDb();
  const { leadId } = req.params;
  const tracker = db.netMeteringTrackers[leadId];
  if (!tracker) return res.status(404).json({ error: "Tracker not found" });
  db.netMeteringTrackers[leadId] = {
    ...tracker,
    ...req.body
  };
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      const updateData = req.body;
      const dbObj = {};
      if (updateData.documentsCollected !== void 0) dbObj.documents_collected = updateData.documentsCollected;
      if (updateData.applicationSubmitted !== void 0) dbObj.application_submitted = updateData.applicationSubmitted;
      if (updateData.discoInspection !== void 0) dbObj.disco_inspection = updateData.discoInspection;
      if (updateData.demandNotice !== void 0) dbObj.demand_notice = updateData.demandNotice;
      if (updateData.meterInstallation !== void 0) dbObj.meter_installation = updateData.meterInstallation;
      if (updateData.greenMeterActive !== void 0) dbObj.green_meter_active = updateData.greenMeterActive;
      await supabase.from("net_metering_trackers").update(dbObj).eq("lead_id", leadId);
    } catch (err) {
      console.error("[Supabase Net Meter Update Error]:", err.message);
    }
  }
  await appendActivityLog("installer", "Installation Manager", "Installation Team", "Grid Connected", `Adjusted interconnection progress checkpoints for customer ${leadId}`);
  res.json(db.netMeteringTrackers[leadId]);
});
app.post("/api/payments/:leadId/milestone", async (req, res) => {
  loadDb();
  const { leadId } = req.params;
  const { milestoneName, status } = req.body;
  const payTrack = db.paymentTracks[leadId];
  if (!payTrack) return res.status(404).json({ error: "Payments profile not found" });
  const milestone = payTrack.milestones.find((m) => m.name === milestoneName);
  if (milestone) {
    milestone.status = status;
    const paidSum = payTrack.milestones.filter((m) => m.status === "Paid").reduce((sum, m) => sum + m.amount, 0);
    payTrack.advanceReceived = paidSum;
    payTrack.pendingAmount = payTrack.totalValue - paidSum;
    if (payTrack.pendingAmount === 0) payTrack.invoiceStatus = "Paid";
    else if (paidSum > 0) payTrack.invoiceStatus = "Pending";
  }
  saveDb();
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      await supabase.from("payments").update({
        advance_received: payTrack.advanceReceived,
        pending_amount: payTrack.pendingAmount,
        invoice_status: payTrack.invoiceStatus,
        milestones: JSON.stringify(payTrack.milestones)
      }).eq("lead_id", leadId);
    } catch (err) {
      console.error("[Supabase Payments Milestone Sync Error]:", err.message);
    }
  }
  await appendActivityLog("manager", "Sarah Manager", "Sales Manager", "Milestones Paid", `Adjusted payments invoice milestone status of ${leadId}`);
  res.json(payTrack);
});
app.post("/api/db/update", async (req, res) => {
  loadDb();
  const { action, table, data, id } = req.body;
  if (table === "settings" || table === "websiteContent") {
    db[table] = data;
  } else {
    if (!db[table]) db[table] = [];
    if (action === "add") {
      db[table].unshift(data);
    } else if (action === "edit") {
      const idx = db[table].findIndex((item) => item.id === id);
      if (idx !== -1) {
        db[table][idx] = { ...db[table][idx], ...data };
      }
    } else if (action === "delete") {
      db[table] = db[table].filter((item) => item.id !== id);
    }
  }
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase();
      if (table === "settings" || table === "websiteContent") {
        const dbTable = table === "settings" ? "settings" : "website_content";
        const { error } = await supabase.from(dbTable).upsert({ key: "global", value: data }, { onConflict: "key" });
        if (error) console.error(`[Supabase manual ${table} sync error]:`, error.message);
      } else {
        let pgTable = "";
        let mappedData = null;
        if (table === "products") {
          pgTable = "products";
          mappedData = {
            id: data.id,
            name: data.name,
            category: data.category,
            brand: data.brand || "",
            model: data.model || "",
            sku: data.sku || "",
            price: Number(data.price || 0),
            discount: Number(data.discount || 0),
            stock: Number(data.stock || 0),
            images: data.images || [],
            warranty_period: data.warrantyPeriod || "2 Years",
            specifications: data.specifications || {}
          };
        } else if (table === "solarPackages") {
          pgTable = "solar_packages";
          mappedData = {
            id: data.id,
            name: data.name,
            panel_brand: data.panelBrand || "",
            inverter_brand: data.inverterBrand || "",
            battery_option: data.batteryOption || "None",
            price: Number(data.price || 0),
            structure_type: data.structureType || "Roof-mount",
            profit_margin: Number(data.profitMargin || 0),
            enabled: data.enabled !== false
          };
        } else if (table === "categories") {
          pgTable = "categories";
          mappedData = {
            id: data.id,
            name: data.name,
            description: data.description || "",
            icon: data.icon || "Solar"
          };
        } else if (table === "orders") {
          pgTable = "orders";
          mappedData = {
            id: data.id,
            customer_name: data.customerName,
            email: data.email,
            phone: data.phone || "",
            address: data.address || "",
            order_type: data.orderType || "Product",
            status: data.status || "Pending",
            items: data.items || [],
            total_cost: Number(data.totalCost || 0),
            installation_required: !!data.installationRequired
          };
        } else if (table === "warranties") {
          pgTable = "warranties";
          mappedData = {
            id: data.id,
            customer_name: data.customerName,
            email: data.email,
            product_name: data.productName,
            product_sku: data.productSku || "",
            serial_number: data.serialNumber || "",
            start_date: data.startDate,
            end_date: data.endDate,
            installation_date: data.installationDate,
            claim_history: data.claimHistory || [],
            status: data.status || "Active"
          };
        } else if (table === "notifications") {
          pgTable = "notifications";
          mappedData = {
            id: data.id,
            customer_name: data.customerName,
            message: data.message,
            type: data.type,
            read: !!data.read
          };
        } else if (table === "leads") {
          pgTable = "leads";
          mappedData = {
            id: data.id,
            name: data.name,
            email: data.email,
            phone: data.phone,
            address: data.address,
            status: data.status,
            monthly_bill: data.monthlyBill,
            monthly_units: data.monthlyUnits,
            sanctioned_load: data.sanctionedLoad,
            backup_requirement: data.backupRequirement,
            location: data.location,
            roof_type: data.roofType,
            roof_space: data.roofSpace,
            shading: data.shading,
            rating: data.rating,
            assigned_salesperson: data.assignedSalesperson,
            notes: data.notes,
            lead_source: data.leadSource,
            engagement_level: data.engagementLevel,
            conversion_probability: data.conversionProbability,
            conversion_score: data.conversionScore
          };
        } else if (table === "tickets") {
          pgTable = "support_tickets";
          mappedData = {
            id: data.id,
            customer_name: data.customerName,
            email: data.email,
            subject: data.subject,
            description: data.description,
            status: data.status,
            priority: data.priority,
            messages: data.messages,
            product_selection: data.productSelection,
            photos: data.photos,
            videos: data.videos,
            voice_note_url: data.voiceNoteUrl,
            location: data.location,
            preferred_visit_time: data.preferredVisitTime,
            assigned_technician: data.assignedTechnician,
            internal_notes: data.internalNotes,
            resolution_proof_url: data.resolutionProofUrl
          };
        } else if (table === "quotations") {
          pgTable = "quotations";
          mappedData = {
            id: data.id,
            lead_id: data.leadId,
            system_size_kw: data.systemSizekW,
            panel_count: data.panelCount,
            panel_type: data.panelType,
            inverter_type: data.inverterType,
            battery_capacity: data.batteryCapacity,
            total_cost: data.totalCost,
            federal_tax_credit: data.federalTaxCredit,
            net_cost: data.netCost,
            estimated_annual_savings: data.estimatedAnnualSavings,
            payback_period_years: data.paybackPeriodYears,
            status: data.status,
            structure_type: data.structureType,
            accessories: data.accessories,
            installation_charges: data.installationCharges,
            net_metering_charges: data.netMeteringCharges,
            payment_terms: data.paymentTerms,
            warranty_terms: data.warrantyTerms,
            terms_and_conditions: data.termsAndConditions
          };
        } else if (table === "purchaseOrders") {
          pgTable = "purchase_orders";
          mappedData = {
            id: data.id,
            supplier_name: data.supplierName || data.vendor || "Supplier",
            order_date: data.orderDate || data.date || (/* @__PURE__ */ new Date()).toISOString(),
            total_cost: Number(data.totalCost || data.cost || 0),
            status: data.status || "Pending",
            items: data.items || []
          };
        } else if (table === "quoteTemplates") {
          pgTable = "quote_templates";
          mappedData = {
            id: data.id,
            name: data.name,
            is_active: data.isActive !== void 0 ? data.isActive : true
          };
        } else if (table === "quoteTemplatePages") {
          pgTable = "quote_template_pages";
          mappedData = {
            id: data.id,
            template_id: data.template_id || data.templateId,
            page_type: data.page_type || data.pageType,
            title: data.title,
            body_text: data.body_text !== void 0 ? data.body_text : data.bodyText || "",
            image_url: data.image_url !== void 0 ? data.image_url : data.imageUrl || "",
            bg_image_url: data.bg_image_url !== void 0 ? data.bg_image_url : data.bgImageUrl || "",
            is_enabled: data.is_enabled !== void 0 ? data.is_enabled : data.isEnabled !== void 0 ? data.isEnabled : true,
            sort_order: Number(data.sort_order || data.sortOrder || 0)
          };
        } else if (table === "bankAccounts") {
          pgTable = "bank_accounts";
          mappedData = {
            id: data.id,
            bank_name: data.bankName || data.bank_name,
            account_title: data.accountTitle || data.account_title || data.title,
            account_number: data.accountNumber || data.account_number || data.accountNo,
            iban: data.iban || "",
            branch_code: data.branchCode || data.branch_code || "",
            is_active: data.isActive !== void 0 ? data.isActive : true,
            sort_order: Number(data.sortOrder || data.sort_order || 0)
          };
        } else if (table === "companyTerms") {
          pgTable = "company_terms";
          mappedData = {
            id: data.id,
            term_text: data.termText || data.term_text,
            sort_order: Number(data.sortOrder || data.sort_order || 0)
          };
        } else if (table === "ceoMessages") {
          pgTable = "ceo_messages";
          mappedData = {
            id: data.id,
            name: data.name,
            designation: data.designation,
            message: data.message,
            signature_url: data.signatureUrl || data.signature_url || "",
            photo_url: data.photoUrl || data.photo_url || ""
          };
        } else if (table === "socialLinks") {
          pgTable = "social_links";
          mappedData = {
            id: data.id,
            platform: data.platform,
            url: data.url,
            qr_code_url: data.qrCodeUrl || data.qr_code_url || ""
          };
        } else if (table === "structureDescriptions") {
          pgTable = "structure_descriptions";
          mappedData = {
            id: data.id,
            structure_type: data.structureType || data.structure_type,
            title: data.title,
            description_en: data.descriptionEn || data.description_en,
            description_ur: data.descriptionUr || data.description_ur,
            material_type: data.materialType || data.material_type || "",
            weight: data.weight || "",
            wind_rating: data.windRating || data.wind_rating || "",
            warranty: data.warranty || "",
            image_url: data.imageUrl || data.image_url || ""
          };
        } else if (table === "quotePdfSettings") {
          pgTable = "quote_pdf_settings";
          mappedData = {
            id: data.id,
            company_name: data.companyName || data.company_name,
            office_address: data.officeAddress || data.office_address,
            hotline_phones: data.hotlinePhones || data.hotline_phones,
            billing_email: data.billingEmail || data.billing_email,
            website_url: data.websiteUrl || data.website_url,
            logo_url: data.logoUrl || data.logo_url || ""
          };
        }
        if (pgTable) {
          if (action === "add" || action === "edit") {
            const { error } = await supabase.from(pgTable).upsert(mappedData, { onConflict: "id" });
            if (error) console.error(`[Supabase manual CRUD Sync error]: table=${pgTable}`, error.message);
          } else if (action === "delete") {
            const { error } = await supabase.from(pgTable).delete().eq("id", id);
            if (error) console.error(`[Supabase manual CRUD Delete error]: table=${pgTable}`, error.message);
          }
        }
      }
    } catch (err) {
      console.error(`[Supabase Generic Sync ${table} Error]:`, err.message);
    }
  }
  saveDb();
  await appendActivityLog("admin", "Alex Admin", "Super Admin", `Manual Database Modifier`, `Action: ${action} on table: ${table} with id: ${id || "Bulk Content"}`);
  res.json({ success: true, table, count: Array.isArray(db[table]) ? db[table].length : 1 });
});
app.get("/api/export/:table", async (req, res) => {
  let activeState = db;
  if (isSupabaseActive()) {
    try {
      activeState = await fetchAppStateFromSupabase();
    } catch (err) {
      console.error("Backup to local export due to Supabase retrieval crash:", err.message);
    }
  }
  const { table } = req.params;
  let headers = [];
  let rows = [];
  if (table === "leads") {
    headers = ["Lead ID", "Name", "Email", "Phone", "Status", "Contract Value", "Engagement", "AI Score", "Acquisition Source", "Sales Advisor", "Creation Date"];
    rows = activeState.leads.map((l) => {
      const acceptedQuote = l.quotes?.find((q) => q.status === "Accepted");
      const amtVal = acceptedQuote ? acceptedQuote.totalCost : l.quotes?.[0]?.totalCost || 0;
      return [
        l.id,
        `"${l.name.replace(/"/g, '""')}"`,
        l.email,
        l.phone,
        l.status,
        amtVal,
        l.engagementLevel || "Medium",
        l.conversionScore || 50,
        l.leadSource || "Website",
        l.assignedSalesperson || "Unassigned",
        l.createdAt
      ];
    });
  } else if (table === "payments") {
    headers = ["Customer Name", "Total Project Cost", "Paid Amount", "Pending Amount", "Invoice Status"];
    rows = activeState.leads.map((l) => {
      const pTrack = activeState.paymentTracks[l.id];
      if (pTrack) {
        return [
          `"${l.name.replace(/"/g, '""')}"`,
          pTrack.totalValue,
          pTrack.advanceReceived,
          pTrack.pendingAmount,
          pTrack.invoiceStatus
        ];
      }
      return [`"${l.name.replace(/"/g, '""')}"`, 0, 0, 0, "No Project"];
    });
  } else if (table === "projects") {
    headers = ["Project ID", "Customer Name", "Site Address", "System Size kW", "Project Staging Track", "Last Sync Timestamp"];
    rows = activeState.projects.map((p) => [
      p.id,
      `"${p.customerName.replace(/"/g, '""')}"`,
      `"${p.address?.replace(/"/g, '""') || "N/A"}"`,
      p.systemSizekW,
      p.stage,
      p.updatedAt
    ]);
  } else {
    return res.status(400).send("Requested system data sheet currently blocked.");
  }
  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  res.header("Content-Type", "text/csv");
  res.attachment(`sunchaser-${table}-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.csv`);
  res.send(csvContent);
});
app.get("/api/backup/export", async (req, res) => {
  try {
    let backupState = db;
    if (isSupabaseActive()) {
      backupState = await fetchAppStateFromSupabase();
    }
    res.json(backupState);
  } catch (err) {
    res.status(500).json({ error: "Failed to generate system backup", details: err.message });
  }
});
function parseExtendedSettings(bodyTextContent, pageType) {
  let bodyText = bodyTextContent || "";
  let layoutMode = "standard";
  let header = {
    mode: "inherit",
    enabled: true,
    text: "",
    logoUrl: "",
    logoSize: "25px",
    lineColor: "#f59e0b",
    alignment: "left"
  };
  let footer = {
    mode: "inherit",
    enabled: true,
    text: "Sunchaser Energy Systems Proposal",
    lineColor: "#cbd5e1",
    alignment: "left"
  };
  let bodyImages = [];
  if (typeof bodyText === "string" && bodyText.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(bodyText);
      bodyText = parsed.bodyText !== void 0 ? parsed.bodyText : "";
      layoutMode = parsed.layoutMode || "standard";
      if (parsed.header) header = { ...header, ...parsed.header };
      if (parsed.footer) footer = { ...footer, ...parsed.footer };
      if (Array.isArray(parsed.bodyImages)) bodyImages = parsed.bodyImages;
    } catch (e) {
    }
  }
  return {
    bodyText,
    layoutMode,
    header,
    footer,
    bodyImages
  };
}
function buildIncludedPagesFromTemplate(activeState, templateId) {
  const allDbPages = activeState.quoteTemplatePages || [];
  const dbPages = allDbPages.filter((p) => (p.templateId || p.template_id) === templateId);
  const types = /* @__PURE__ */ new Set();
  dbPages.forEach((p) => {
    if (p.isEnabled === false || p.is_enabled === false) return;
    const t = p.pageType || p.page_type || "";
    if (t === "terms1" || t === "terms2") types.add("terms");
    else if (t.startsWith("structure_")) types.add("structure");
    else types.add(t);
  });
  return Array.from(types);
}
function compileSunchaserPDFHtml(mode, quoteObj, leadObj, activeState, options = {}) {
  const settings = {
    companyName: "Sunchaser Energy Systems",
    officeAddress: "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore",
    phoneNumbers: "0309-0236666, 0330-7776444",
    billingEmail: "billing@sunchaser-energy.com",
    websiteUrl: "www.sunchaser-energy.com",
    ...activeState.settings || {}
  };
  const formatPKR = (val) => {
    if (val === void 0 || val === null || isNaN(val)) return "Rs. 0";
    return "Rs. " + Math.round(val).toLocaleString("en-US");
  };
  if (mode === "sizer") {
    const sizeKw = Number(quoteObj.systemSizekW) || 10;
    const count = Number(quoteObj.panelCount) || Math.round(sizeKw * 1.7);
    const estimatedSavings = Number(quoteObj.estimatedAnnualSavings) || Math.round(sizeKw * 1400 * 35);
    const payback = Number(quoteObj.paybackPeriodYears) || 3.5;
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sunchaser Technical Sizing Summary</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Inter', sans-serif;
            background-color: #ffffff;
            color: #1e293b;
            margin: 0;
            padding: 20px;
            font-size: 11px;
            line-height: 1.5;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .container {
            max-width: 210mm;
            margin: 0 auto;
            border: 1px solid #cbd5e1;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #f59e0b;
            padding-bottom: 12px;
            margin-bottom: 20px;
          }
          .title {
            font-size: 18px;
            font-weight: 800;
            color: #0f172a;
          }
          .subtitle {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #d97706;
            font-weight: 700;
          }
          .grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
          }
          .card {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 12px;
          }
          .section-title {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 4px;
            margin-bottom: 10px;
            color: #0f172a;
          }
          .table-summary {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
          }
          .table-summary th {
            background-color: #0f172a;
            color: #ffffff;
            font-size: 9px;
            padding: 6px;
            text-align: left;
          }
          .table-summary td {
            padding: 6px;
            border-bottom: 1px solid #e2e8f0;
          }
          .metric-badge {
            font-weight: 750;
            color: #0f172a;
            font-size: 12px;
          }
          .action-bar {
            background-color: #0f172a;
            color: #ffffff;
            padding: 12px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            border-radius: 8px;
          }
          .btn-print {
            background-color: #f59e0b;
            color: #0f172a;
            border: none;
            padding: 6px 14px;
            border-radius: 6px;
            font-weight: 700;
            cursor: pointer;
          }
          @media print {
            .action-bar { display: none !important; }
            body { padding: 0; }
            .container { border: none; box-shadow: none; padding: 10px; }
          }
        </style>
      </head>
      <body>
        <div class="action-bar">
          <div><strong>Sunchaser Technical Sizing Report</strong> - Client: ${leadObj.name}</div>
          <button class="btn-print" onclick="window.print()">Print Report</button>
        </div>
        <div class="container">
          <div class="header">
            <div>
              <div class="title">\u2600\uFE0F SUNCHASER ENERGY SYSTEMS</div>
              <div class="subtitle">Technical Capacity & Sizing Assessment Summary</div>
            </div>
            <div style="text-align: right; font-size: 10px;">
              <strong>Date:</strong> ${(/* @__PURE__ */ new Date()).toLocaleDateString()}<br/>
              <strong>Lead ID:</strong> ${leadObj.id}
            </div>
          </div>
          
          <div class="grid-2">
            <div class="card">
              <div class="section-title">Client Demographics & Details</div>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 2px 0;"><strong>Client Name:</strong></td><td>${leadObj.name}</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Phone:</strong></td><td>${leadObj.phone}</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Email:</strong></td><td>${leadObj.email || "N/A"}</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Address:</strong></td><td>${leadObj.address || "N/A"}</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Location:</strong></td><td>${leadObj.location || "Lahore"}</td></tr>
              </table>
            </div>
            
            <div class="card">
              <div class="section-title">AI Sizer Performance Estimates</div>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 2px 0;"><strong>System Size:</strong></td><td class="metric-badge">${sizeKw} kW DC</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Panel Count:</strong></td><td>${count} Panels</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Monthly Bill Context:</strong></td><td>${formatPKR(leadObj.monthlyBill || 0)}</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Est. Monthly Generation:</strong></td><td>${Math.round(sizeKw * 125).toLocaleString()} kWh</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Est. Annual Savings:</strong></td><td style="color: #047857; font-weight: 700;">${formatPKR(estimatedSavings)}</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Simple Payback Period:</strong></td><td>${payback} Years</td></tr>
              </table>
            </div>
          </div>
          
          <div class="card" style="margin-top: 15px;">
            <div class="section-title">Hardware Configuration & Specifications Recommendation</div>
            <table class="table-summary">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Description</th>
                  <th>Specs / Details</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Solar Panels</strong></td>
                  <td>${quoteObj.panelType || "Premium Monocrystalline Panels"}</td>
                  <td>Qty: ${count} (${quoteObj.panelWattage || 580}W modules)</td>
                </tr>
                <tr>
                  <td><strong>Inverter Unit</strong></td>
                  <td>${quoteObj.inverterType || "Grid-tied Cloud Sync Inverter"}</td>
                  <td>Dual MPPT phase synchronization technology</td>
                </tr>
                <tr>
                  <td><strong>Structure Type</strong></td>
                  <td>${quoteObj.structureType || "Standard Mount"}</td>
                  <td>Mughal Steel L3 wind-shear compliant framing</td>
                </tr>
                <tr>
                  <td><strong>Battery Option</strong></td>
                  <td>${quoteObj.batteryCapacity !== "None" && quoteObj.batteryCapacity ? quoteObj.batteryCapacity : "No storage option configured"}</td>
                  <td>LFP high-safety storage module</td>
                </tr>
                <tr>
                  <td><strong>Net Metering</strong></td>
                  <td>${quoteObj.netMeteringRequired === "Yes" || leadObj.backupRequirement === "None" ? "Yes (NEPRA standard bidirectional meter)" : "No"}</td>
                  <td>Application filing included</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="card" style="margin-top: 15px; border-left: 4px solid #f59e0b;">
            <div class="section-title" style="color: #b45309; border-bottom: none; margin-bottom: 4px;">Technical Feasibility Notes</div>
            <p style="margin: 0; font-size: 10px; color: #475569;">
              This sizing assessment is simulated based on local insolation statistics for ${leadObj.location || "Lahore"} (insolation index: 4.8 hr/day). Actual energy yield depends on panel clean routines, shade obstacles, tilt parameters, and LESCO grid uptime. Net-metering approval requires a valid three-phase connection and sanctioned load match.
            </p>
          </div>
          
          <div style="margin-top: 30px; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 15px; font-size: 9px; color: #64748b;">
            <strong>Sunchaser Energy Systems Staging Division</strong> | DHA Phase 6, Lahore | Hotlines: 0309-0236666, 0330-7776444
          </div>
        </div>
      </body>
      </html>
    `;
  }
  const globalHeader = activeState.settings && activeState.settings.globalPdfHeader || {
    enabled: true,
    text: "\u2600\uFE0F SUNCHASER ENERGY",
    logoUrl: "",
    logoSize: "25px",
    lineColor: "#f59e0b",
    alignment: "left"
  };
  const globalFooter = activeState.settings && activeState.settings.globalPdfFooter || {
    enabled: true,
    text: "Sunchaser Energy Systems Proposal",
    lineColor: "#cbd5e1",
    alignment: "left"
  };
  const templateId = options.templateId || "tmpl-1";
  const strictTemplateOnly = mode === "manual" || mode === "preview";
  const allDbPages = activeState.quoteTemplatePages || [];
  const dbPages = allDbPages.filter((p) => (p.templateId || p.template_id) === templateId);
  const useDefaultCompanyContent = false;
  const getPageConfig = (pageType, defaultTitle, defaultBody) => {
    const dbPage = dbPages.find((p) => p.pageType === pageType);
    if (dbPage) {
      const rawBody = dbPage.bodyText || dbPage.body_text || "";
      const ext = parseExtendedSettings(rawBody, pageType);
      return {
        enabled: dbPage.isEnabled !== false,
        title: dbPage.title !== void 0 && dbPage.title !== null ? dbPage.title : useDefaultCompanyContent ? defaultTitle : "",
        bodyText: ext.bodyText !== void 0 ? ext.bodyText : useDefaultCompanyContent ? defaultBody : "",
        imageUrl: dbPage.imageUrl || dbPage.image_url || "",
        bgImageUrl: dbPage.bgImageUrl || dbPage.bg_image_url || ""
      };
    }
    return {
      enabled: true,
      title: useDefaultCompanyContent ? defaultTitle : "",
      bodyText: useDefaultCompanyContent ? defaultBody : "",
      imageUrl: "",
      bgImageUrl: ""
    };
  };
  const getIncludedFlag = (pageType) => {
    if (options.includedPages && Array.isArray(options.includedPages)) {
      return options.includedPages.includes(pageType);
    }
    if (strictTemplateOnly) {
      return dbPages.some((p) => {
        if (p.isEnabled === false || p.is_enabled === false) return false;
        const t = p.pageType || p.page_type || "";
        if (pageType === "terms") return t === "terms1" || t === "terms2";
        if (pageType === "structure") return t.startsWith("structure_");
        return t === pageType;
      });
    }
    return true;
  };
  const pCover = getPageConfig("cover", "Sunchaser Energy Systems", "Generational Energy Independence\\nTechnical Feasibility & Engineering Quotation");
  const pProfile = getPageConfig("profile", "Sunchaser Group Profile", "Sunchaser Energy operates under a unified consortium of specialized engineering, supply chain, and logistics enterprises. Together, we bring a level of structural reliability and direct import authorization unmatched in the local solar industry.");
  const pQr = getPageConfig("qr", "Why Partner with Sunchaser?", "Tier-1 Direct Imported Hardware: All solar modules are sourced directly from Bloomberg Tier-1 rated manufacturers (Jinko, Longi, JA Solar) with complete customs trace certificates.");
  const pCeo = getPageConfig("ceo", "Executive Board Assurances", "");
  const pStructure = getPageConfig("structure", "Mounting Structure & Fabrication Details", "Premium Galvanized Mounting Structure, wind resistant up to 130 km/h.");
  const pTerms1 = getPageConfig("terms1", "Terms, Conditions & Regulations (1/2)", "");
  const pTerms2 = getPageConfig("terms2", "Terms, Conditions & Regulations (2/2)", "");
  const pSignoff = getPageConfig("signoff", "Client Verification & Sign-off", "");
  const pBank = getPageConfig("bank", "Official Payment Channels", "");
  const pFinal = getPageConfig("final", "Sunchaser Energy Systems", "Thank you for choosing Sunchaser Energy Systems! We are committed to delivering the highest caliber of electrical integration, structural safety, and long-term utility savings.");
  const qDate = quoteObj.quoteDate ? new Date(quoteObj.quoteDate) : /* @__PURE__ */ new Date();
  const validityDate = new Date(qDate.getTime() + 3 * 24 * 60 * 60 * 1e3);
  const expiryDateString = validityDate.toLocaleDateString("en-PK", { year: "numeric", month: "long", day: "numeric" });
  const quoteDateString = qDate.toLocaleDateString("en-PK", { year: "numeric", month: "long", day: "numeric" });
  const dbBankAccounts = activeState.bankAccounts || [];
  const bankAccountsList = dbBankAccounts.filter((b) => b.isActive !== false);
  let bankAccountsHtml = `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 15px;">`;
  bankAccountsList.forEach((acc, index) => {
    bankAccountsHtml += `
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; font-size: 11px; line-height: 1.4;">
        <div style="font-weight: 800; font-size: 11.5px; color: #0f172a; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
          <span>${index + 1}. ${acc.bankName || acc.bank_name}</span>
          <span style="font-size: 7.5px; font-weight: 700; color: #047857; background-color: #d1fae5; padding: 1px 6px; border-radius: 9999px; text-transform: uppercase;">Official Channel</span>
        </div>
        <div style="color: #475569;"><strong>Title:</strong> <span style="color: #0f172a; font-weight: 600;">${acc.accountTitle || acc.account_title || acc.title}</span></div>
        <div style="color: #475569;"><strong>A/C:</strong> <span style="color: #0f172a; font-weight: 600; font-family: monospace;">${acc.accountNumber || acc.account_number || acc.accountNo}</span></div>
        ${acc.iban ? `<div style="color: #475569; font-family: monospace; font-size: 9.5px; word-break: break-all; margin-top: 2px;"><strong>IBAN:</strong> ${acc.iban}</div>` : ""}
      </div>
    `;
  });
  bankAccountsHtml += `</div>`;
  const dbTerms = activeState.companyTerms || [];
  const termsList = dbTerms.map((t) => t.termText || t.term_text);
  let tcPage1Html = "";
  let tcPage2Html = "";
  termsList.forEach((clause, index) => {
    const formattedClause = `
      <div style="display: flex; margin-bottom: 10px; font-size: 11px; line-height: 1.5; align-items: flex-start;">
        <span style="font-weight: 800; color: #d97706; margin-right: 6px; min-width: 20px;">${index + 1}.</span>
        <span style="color: #334155; font-weight: 500;">${clause}</span>
      </div>
    `;
    if (index < 9) {
      tcPage1Html += formattedClause;
    } else {
      tcPage2Html += formattedClause;
    }
  });
  const selectedStructKey = String(quoteObj.selectedStructure || quoteObj.structureType || "standard").toLowerCase();
  const dbStructs = activeState.structureDescriptions || [];
  const customStruct = quoteObj.customStructure || {};
  const structDetails = dbStructs.find((s) => s.structureType === selectedStructKey) || {
    title: selectedStructKey === "custom" ? customStruct.name || "Custom Mounting Details" : selectedStructKey === "elevated" ? "Elevated Frame Mount" : selectedStructKey === "girder" ? "Heavy-Duty Mughal Girder Frame" : "Standard A-Frame Mount",
    descriptionEn: selectedStructKey === "custom" ? customStruct.descEn || "Custom structure specifications configured in BOQ." : selectedStructKey === "elevated" ? "10ft Roof clearance hot-dip galvanized elevated structure frame." : selectedStructKey === "girder" ? "Heavy-Duty Mughal Girder Frame supporting extreme wind shear." : "Premium Galvanized Mounting Structure, wind resistant up to 130 km/h.",
    descriptionUr: selectedStructKey === "custom" ? customStruct.descUr || "\u06A9\u0633\u0679\u0645 \u0688\u06CC\u0632\u0627\u0626\u0646 \u0645\u0627\u0648\u0646\u0679\u0646\u06AF \u0633\u0679\u0631\u06A9\u0686\u0631" : selectedStructKey === "elevated" ? "10 \u0641\u0679 \u0686\u06BE\u062A \u06A9\u06CC \u0627\u0648\u0646\u0686\u0627\u0626\u06CC \u06A9\u0627 \u06C1\u0627\u0679 \u0688\u0650\u067E \u06AF\u06CC\u0644\u0648\u0627\u0646\u0627\u0626\u0632\u0688 \u0627\u06CC\u0644\u06CC\u0648\u06CC\u0679\u0688 \u0633\u0679\u0631\u06A9\u0686\u0631 \u0641\u0631\u06CC\u0645\u06D4" : selectedStructKey === "girder" ? "\u06C1\u06CC\u0648\u06CC \u0688\u06CC\u0648\u0679\u06CC \u0645\u063A\u0644 \u06AF\u0627\u0631\u0688\u0631 \u0641\u0631\u06CC\u0645 \u062C\u0648 \u0634\u062F\u06CC\u062F \u06C1\u0648\u0627 \u06A9\u06D2 \u062F\u0628\u0627\u0624 \u06A9\u0648 \u0628\u0631\u062F\u0627\u0634\u062A \u06A9\u0631\u062A\u0627 \u06C1\u06D2\u06D4" : "\u067E\u0631\u06CC\u0645\u06CC\u0645 \u06AF\u06CC\u0644\u0648\u0627\u0646\u0627\u0626\u0632\u0688 \u0645\u0627\u0648\u0646\u0679\u0646\u06AF \u0633\u0679\u0631\u06A9\u0686\u0631\u060C 130 \u06A9\u0644\u0648\u0645\u06CC\u0679\u0631 \u0641\u06CC \u06AF\u06BE\u0646\u0679\u06C1 \u062A\u06A9 \u06C1\u0648\u0627 \u06A9\u06D2 \u062E\u0644\u0627\u0641 \u0645\u0632\u0627\u062D\u0645\u06D4",
    materialType: selectedStructKey === "custom" ? customStruct.materialType || "Custom structure material" : selectedStructKey === "elevated" ? "Hot-dip Galvanized Steel" : selectedStructKey === "girder" ? "Mughal Girder Steel" : "Galvanized L3 Steel",
    weight: selectedStructKey === "custom" ? customStruct.weight || "Custom Weight" : selectedStructKey === "girder" ? "1600g/ft Structural Load" : "Standard Weight",
    windRating: selectedStructKey === "custom" ? customStruct.windRating || "Custom wind shear certification" : selectedStructKey === "girder" ? "150 km/h" : "130 km/h",
    warranty: selectedStructKey === "custom" ? customStruct.warranty || "Custom Warranty" : selectedStructKey === "girder" ? "15 Years Warranty" : "10 Years Warranty"
  };
  let structureSvg = "";
  if (selectedStructKey === "elevated") {
    structureSvg = `
      <svg width="280" height="150" viewBox="0 0 280 150" style="display: block; margin: 15px auto;">
        <line x1="30" y1="120" x2="250" y2="120" stroke="#94a3b8" stroke-width="3" />
        <line x1="90" y1="120" x2="90" y2="55" stroke="#475569" stroke-width="5" />
        <line x1="190" y1="120" x2="190" y2="30" stroke="#475569" stroke-width="5" />
        <line x1="60" y1="62" x2="220" y2="22" stroke="#d97706" stroke-width="6" />
        <rect x="75" y="48" width="35" height="10" transform="rotate(-14, 90, 53)" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <rect x="125" y="36" width="35" height="10" transform="rotate(-14, 140, 41)" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <rect x="175" y="24" width="35" height="10" transform="rotate(-14, 190, 29)" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <rect x="80" y="115" width="20" height="8" fill="#64748b" />
        <rect x="180" y="115" width="20" height="8" fill="#64748b" />
        <text x="140" y="140" text-anchor="middle" font-size="10" fill="#64748b" font-weight="700">Elevated Frame (10ft Roof clearance hot-dip galvanized)</text>
      </svg>
    `;
  } else if (selectedStructKey === "girder") {
    structureSvg = `
      <svg width="280" height="150" viewBox="0 0 280 150" style="display: block; margin: 15px auto;">
        <line x1="30" y1="120" x2="250" y2="120" stroke="#94a3b8" stroke-width="3" />
        <rect x="85" y="45" width="12" height="75" fill="#334155" />
        <rect x="185" y="20" width="12" height="100" fill="#334155" />
        <line x1="50" y1="52" x2="220" y2="18" stroke="#b45309" stroke-width="9" />
        <rect x="65" y="38" width="40" height="12" transform="rotate(-11.5, 85, 44)" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <rect x="115" y="28" width="40" height="12" transform="rotate(-11.5, 135, 34)" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <rect x="165" y="18" width="40" height="12" transform="rotate(-11.5, 185, 24)" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <text x="140" y="140" text-anchor="middle" font-size="10" fill="#b45309" font-weight="800">Heavy-Duty Mughal Girder Frame (1600g/ft Structural Load)</text>
      </svg>
    `;
  } else if (selectedStructKey === "custom") {
    structureSvg = `
      <svg width="280" height="150" viewBox="0 0 280 150" style="display: block; margin: 15px auto;">
        <line x1="30" y1="120" x2="250" y2="120" stroke="#94a3b8" stroke-width="3" />
        <line x1="70" y1="120" x2="100" y2="60" stroke="#475569" stroke-width="4" />
        <line x1="140" y1="120" x2="140" y2="60" stroke="#475569" stroke-width="4" />
        <line x1="210" y1="120" x2="180" y2="60" stroke="#475569" stroke-width="4" />
        <line x1="50" y1="60" x2="230" y2="60" stroke="#d97706" stroke-width="5" stroke-dasharray="4,4" />
        <rect x="70" y="52" width="40" height="8" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <rect x="120" y="52" width="40" height="8" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <rect x="170" y="52" width="40" height="8" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <text x="140" y="140" text-anchor="middle" font-size="10" fill="#d97706" font-weight="700">Custom Engineering Layout Specifications</text>
      </svg>
    `;
  } else {
    structureSvg = `
      <svg width="280" height="150" viewBox="0 0 280 150" style="display: block; margin: 15px auto;">
        <line x1="30" y1="120" x2="250" y2="120" stroke="#94a3b8" stroke-width="3" />
        <line x1="100" y1="120" x2="100" y2="85" stroke="#475569" stroke-width="4" />
        <line x1="170" y1="120" x2="170" y2="55" stroke="#475569" stroke-width="4" />
        <line x1="70" y1="98" x2="200" y2="40" stroke="#0f172a" stroke-width="5" />
        <rect x="80" y="82" width="30" height="9" transform="rotate(-24, 95, 86)" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <rect x="120" y="64" width="30" height="9" transform="rotate(-24, 135, 68)" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <rect x="160" y="46" width="30" height="9" transform="rotate(-24, 175, 50)" fill="#1e3a8a" stroke="#ffffff" stroke-width="1" />
        <text x="140" y="140" text-anchor="middle" font-size="10" fill="#475569" font-weight="700">Standard A-Frame (Direct Roof Mount Layout)</text>
      </svg>
    `;
  }
  const dbCeos = activeState.ceoMessages || [];
  const ceoList = dbCeos;
  const lescoObj = quoteObj.lescoSettings || { meterNo: "", consumerNo: "", sanctionedLoad: "", phaseType: "Three Phase" };
  const netMeteringText = quoteObj.netMeteringRequired || "Yes";
  const getIncludedFlagForPageType = (pageType) => {
    if (pageType === "terms1" || pageType === "terms2") {
      return getIncludedFlag("terms");
    }
    if (pageType.startsWith("structure_")) {
      return getIncludedFlag("structure");
    }
    return getIncludedFlag(pageType);
  };
  const getStructurePageType = () => {
    if (selectedStructKey === "elevated") return "structure_elevated";
    if (selectedStructKey === "girder") return "structure_girder";
    if (selectedStructKey === "custom") return "structure_custom";
    return "structure_standard";
  };
  const activeStructurePageType = getStructurePageType();
  const enabledDbPages = dbPages.filter((p) => {
    if (p.isEnabled === false || p.is_enabled === false) return false;
    const type = p.pageType || p.page_type || "";
    if (!getIncludedFlagForPageType(type)) return false;
    if (type.startsWith("structure_") && type !== activeStructurePageType) return false;
    return true;
  });
  const pagesList = enabledDbPages.map((p) => ({
    type: p.pageType || p.page_type,
    sortOrder: Number(p.sortOrder || p.sort_order || 0),
    dbPage: p
  }));
  pagesList.sort((a, b) => a.sortOrder - b.sortOrder);
  const defaultAutoSizerIds = [
    "h-1",
    "panel_row",
    "inverter_row",
    "battery_row",
    "s-1",
    "h-2",
    "dc_cable_row",
    "ac_cable_row",
    "earth_wire_row",
    "s-2",
    "h-3",
    "db_box_row",
    "s-3",
    "h-4",
    "supplies_row",
    "s-4",
    "h-5",
    "earthing_bore_row",
    "s-5",
    "h-6",
    "structure_row",
    "civil_work_row",
    "install_service_row",
    "s-6",
    "h-7",
    "freight_row",
    "net_metering_row",
    "survey_design_row",
    "s-7"
  ];
  if (mode === "manual") {
    const allRowsForCheck = quoteObj.boqRows || quoteObj.boqItems || [];
    const manualRowCount = allRowsForCheck.filter(
      (r) => r && r.type === "item" && !defaultAutoSizerIds.includes(r.id)
    ).length;
    const hasBoqPage = pagesList.some((p) => p.type === "boq");
    if (manualRowCount > 0 && !hasBoqPage && getIncludedFlag("boq")) {
      pagesList.push({
        type: "boq",
        sortOrder: 6,
        dbPage: {
          pageType: "boq",
          title: "Bill of Quantities (BOQ)",
          bodyText: "",
          isEnabled: true
        }
      });
      pagesList.sort((a, b) => a.sortOrder - b.sortOrder);
    }
  }
  if (!strictTemplateOnly && pagesList.length === 0 && options.includedPages?.length) {
    options.includedPages.forEach((pageType, idx) => {
      if (!getIncludedFlagForPageType(pageType)) return;
      if (pageType.startsWith("structure_") && pageType !== activeStructurePageType) return;
      pagesList.push({
        type: pageType,
        sortOrder: idx + 1,
        dbPage: { pageType, title: "", bodyText: "", isEnabled: true }
      });
    });
  }
  console.log(`[PDF Rendering Diagnostics]
  - selected template id: ${templateId}
  - number of pages loaded: ${dbPages.length}
  - enabled page count: ${enabledDbPages.length}
  - rendered page count: ${pagesList.length}
  `);
  let pagesHtml = "";
  pagesList.forEach((pageItem, pageIndex) => {
    const pageType = pageItem.type;
    const dbPage = pageItem.dbPage;
    const rawBody = dbPage && (dbPage.bodyText || dbPage.body_text) || "";
    const ext = parseExtendedSettings(rawBody, pageType);
    const p = {
      title: dbPage && dbPage.title !== void 0 && dbPage.title !== null ? dbPage.title : "",
      bodyText: dbPage ? ext.bodyText !== void 0 ? ext.bodyText : "" : "",
      imageUrl: dbPage && (dbPage.imageUrl || dbPage.image_url) || "",
      bgImageUrl: dbPage && (dbPage.bgImageUrl || dbPage.bg_image_url) || ""
    };
    let hEnabled = globalHeader.enabled !== false;
    let hText = globalHeader.text || "\u2600\uFE0F SUNCHASER ENERGY";
    let hLogoUrl = globalHeader.logoUrl || "";
    let hLogoSize = globalHeader.logoSize || "25px";
    let hLineColor = globalHeader.lineColor || "#f59e0b";
    let hAlignment = globalHeader.alignment || "left";
    if (ext.header.mode === "custom") {
      hEnabled = ext.header.enabled !== false;
      hText = ext.header.text || "";
      hLogoUrl = ext.header.logoUrl || "";
      hLogoSize = ext.header.logoSize || "25px";
      hLineColor = ext.header.lineColor || "#cbd5e1";
      hAlignment = ext.header.alignment || "left";
    } else if (ext.header.mode === "disabled") {
      hEnabled = false;
    }
    let fEnabled = globalFooter.enabled !== false;
    let fText = globalFooter.text || "Sunchaser Energy Systems Proposal";
    let fLineColor = globalFooter.lineColor || "#cbd5e1";
    let fAlignment = globalFooter.alignment || "left";
    if (ext.footer.mode === "custom") {
      fEnabled = ext.footer.enabled !== false;
      fText = ext.footer.text || "";
      fLineColor = ext.footer.lineColor || "#cbd5e1";
      fAlignment = ext.footer.alignment || "left";
    } else if (ext.footer.mode === "disabled") {
      fEnabled = false;
    }
    if (strictTemplateOnly) {
      if (ext.header.mode !== "custom") {
        hEnabled = false;
        hText = "";
        hLogoUrl = "";
      }
      if (ext.footer.mode !== "custom") {
        fEnabled = false;
        fText = "";
      }
    }
    let headerHtml = "";
    if (hEnabled) {
      let justifyValue = "space-between";
      let alignValue = "center";
      let flexDir = "row";
      if (hAlignment === "center") {
        justifyValue = "center";
        flexDir = "column";
      } else if (hAlignment === "right") {
        justifyValue = "flex-end";
        flexDir = "row-reverse";
      }
      headerHtml = `
        <div class="page-header-logo" style="display: flex; flex-direction: ${flexDir}; justify-content: ${justifyValue}; align-items: ${alignValue}; border-bottom: 1.5px solid ${hLineColor}; padding-bottom: 6px; margin-bottom: 12px; width: 100%;">
          <span class="header-company-name" style="display: flex; align-items: center; gap: 8px;">
            ${hLogoUrl ? `<img src="${hLogoUrl}" style="max-height: ${hLogoSize}; object-fit: contain;" alt="Logo" />` : ""}
            ${hText ? `<span style="font-weight: 800; font-size: 13px; color: #0f172a; letter-spacing: 0.05em;">${hText}</span>` : ""}
          </span>
          <span style="font-size: 9px; font-weight: 600; color: #64748b;">Page ${pageIndex + 1}</span>
        </div>
      `;
    }
    let footerHtml = "";
    if (fEnabled) {
      let justifyValue = "space-between";
      if (fAlignment === "center") justifyValue = "center";
      else if (fAlignment === "right") justifyValue = "flex-end";
      footerHtml = `
        <div class="page-footer" style="display: flex; justify-content: ${justifyValue}; align-items: center; border-top: 1px solid ${fLineColor}; padding-top: 6px; font-size: 8.5px; color: #64748b; font-weight: 600; margin-top: auto; width: 100%;">
          <span>${fText}</span>
          ${fAlignment !== "center" ? `<span style="font-size: 8px; font-family: monospace;">Doc ID: SC-${leadObj.id.substring(0, 8).toUpperCase()}</span>` : ""}
        </div>
      `;
    }
    const pageStyleAttr = p.bgImageUrl ? `style="background: url('${p.bgImageUrl}') no-repeat center center / cover;"` : ``;
    let bodyImagesHtml = "";
    let absoluteImagesHtml = "";
    if (Array.isArray(ext.bodyImages) && ext.bodyImages.length > 0) {
      const sortedImages = [...ext.bodyImages].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      sortedImages.forEach((img) => {
        if (!img.url) return;
        const opacityStyle = img.opacity !== void 0 ? `opacity: ${img.opacity};` : "";
        const widthStyle = img.width ? `width: ${img.width};` : "width: 150px;";
        if (img.position === "absolute") {
          const coords = `
            top: ${img.top || "auto"};
            left: ${img.left || "auto"};
            right: ${img.right || "auto"};
            bottom: ${img.bottom || "auto"};
          `;
          absoluteImagesHtml += `
            <!-- bodyImages -->
            <img class="bodyImages" src="${img.url}" style="position: absolute; ${coords} ${widthStyle} ${opacityStyle} object-fit: contain; pointer-events: none; z-index: 5;" alt="Overlay Image" />
          `;
        } else {
          const alignStyle = img.alignment === "center" ? "margin: 10px auto; display: block;" : img.alignment === "right" ? "margin: 10px 0 10px auto; display: block;" : "margin: 10px auto 10px 0; display: block;";
          bodyImagesHtml += `
            <div style="width: 100%;">
              <!-- bodyImages -->
              <img class="bodyImages" src="${img.url}" style="${widthStyle} ${opacityStyle} ${alignStyle} object-fit: contain;" alt="Body Image" />
            </div>
          `;
        }
      });
    }
    if (strictTemplateOnly && pageType !== "boq") {
      if (ext.layoutMode === "full_page_image" || ext.layoutMode === "image_only") {
        let imageContent = "";
        if (p.imageUrl) {
          imageContent = `<img src="${p.imageUrl}" style="width: 100%; height: 100%; object-fit: contain; display: block; margin: auto;" alt="Full Page Asset" />`;
        } else if (p.bgImageUrl) {
          imageContent = `<div style="width: 100%; height: 100%; background: url('${p.bgImageUrl}') no-repeat center center / cover;"></div>`;
        } else if (bodyImagesHtml) {
          imageContent = bodyImagesHtml;
        }
        pagesHtml += `
          <div class="page full-page-image-only" style="border: none; padding: 0; margin: 0; display: block; position: relative; width: 210mm; height: 297mm; page-break-after: always; overflow: hidden;">
            ${imageContent}
          </div>
        `;
      } else {
        const coverLogoHtml = pageType === "cover" && p.imageUrl ? `<img src="${p.imageUrl}" style="max-height: 55px; max-width: 150px; object-fit: contain; margin-bottom: 12px;" alt="Logo" />` : "";
        pagesHtml += `
          <div class="page${pageType === "cover" ? " cover" : ""}" ${pageStyleAttr} style="display: flex; flex-direction: column; padding: 20mm; position: relative; min-height: 257mm; box-sizing: border-box;">
            ${absoluteImagesHtml}
            <div style="flex: 1; display: flex; flex-direction: column;">
              ${headerHtml}
              ${coverLogoHtml}
              ${p.title ? `<div class="page-title">${p.title}</div>` : ""}
              ${p.bodyText ? `<div style="font-size: 12px; line-height: 1.6; color: #475569; margin: 12px 0;">${p.bodyText.replace(/\\n/g, "<br/>")}</div>` : ""}
              ${bodyImagesHtml}
            </div>
            ${footerHtml}
          </div>
        `;
      }
      return;
    }
    if (ext.layoutMode === "full_page_image" || ext.layoutMode === "image_only") {
      let imageContent = "";
      if (p.imageUrl) {
        imageContent = `<img src="${p.imageUrl}" style="width: 100%; height: 100%; object-fit: contain; display: block; margin: auto;" alt="Full Page Asset" />`;
      } else if (p.bgImageUrl) {
        imageContent = `<div style="width: 100%; height: 100%; background: url('${p.bgImageUrl}') no-repeat center center / cover;"></div>`;
      } else if (bodyImagesHtml) {
        imageContent = bodyImagesHtml;
      }
      pagesHtml += `
        <div class="page full-page-image-only" style="border: none; padding: 0; margin: 0; display: block; position: relative; width: 210mm; height: 297mm; page-break-after: always; overflow: hidden;">
          ${imageContent}
        </div>
      `;
    } else {
      if (pageType === "cover") {
        pagesHtml += `
          <div class="page cover" style="background: ${p.bgImageUrl ? `url('${p.bgImageUrl}') no-repeat center center / cover` : "#ffffff"}; color: #0f172a; padding: 25mm 20mm; border: 2mm solid #f59e0b; display: flex; flex-direction: column; justify-content: space-between; position: relative;">
            ${absoluteImagesHtml}
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #f59e0b; padding-bottom: 15px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                ${p.imageUrl ? `
                  <img src="${p.imageUrl}" style="max-height: 55px; max-width: 150px; object-fit: contain;" alt="Logo" />
                ` : useDefaultCompanyContent ? `
                  <div style="background-color: #0f172a; width: 48px; height: 48px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 24px; color: #ffffff; font-weight: bold;">\u2600\uFE0F</div>
                  <div>
                    <div style="font-weight: 850; font-size: 20px; letter-spacing: -0.02em; color: #0f172a;">SUNCHASER ENERGY</div>
                    <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #d97706; font-weight: bold;">Generational Infrastructure</div>
                  </div>
                ` : ""}
              </div>
            </div>

            <div style="margin-top: 40px;">
              <div style="font-size: 32px; font-weight: 850; line-height: 1.2; color: #0f172a;">
                ${quoteObj.systemSizekW || 15}kW ${quoteObj.systemType || "Hybrid"}<br/>Solar Power Solution
              </div>
              ${p.title ? `
              <div style="font-size: 13px; color: #d97706; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 8px;">
                ${p.title}
              </div>
              ` : ""}
              ${p.bodyText ? `
              <p style="font-size: 12px; color: #475569; margin-top: 10px; line-height: 1.6; max-width: 500px;">
                ${p.bodyText.replace(/\\n/g, "<br/>")}
              </p>
              ` : ""}
              
              ${bodyImagesHtml}
              
              <div style="border-top: 1px solid #cbd5e1; padding-top: 20px; margin-top: 35px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 11px;">
                  <div>
                    <div style="color: #64748b; font-weight: 800; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Prepared For</div>
                    <div style="font-weight: 700; color: #0f172a; margin-top: 4px; font-size: 13px;">${quoteObj.clientName || leadObj.name}</div>
                  </div>
                  <div>
                    <div style="color: #64748b; font-weight: 800; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Proposal Validity</div>
                    <div style="font-weight: 700; color: #d97706; margin-top: 4px;">3-Day Validity (Exp: ${expiryDateString})</div>
                  </div>
                  <div>
                    <div style="color: #64748b; font-weight: 800; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Site Location</div>
                    <div style="font-weight: 600; color: #0f172a; margin-top: 4px;">${quoteObj.cityArea || leadObj.location || "Lahore"}</div>
                  </div>
                  <div>
                    <div style="color: #64748b; font-weight: 800; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Technical Advisor / BDM</div>
                    <div style="font-weight: 600; color: #0f172a; margin-top: 4px;">${quoteObj.bdmName || leadObj.assignedSalesperson || "Sarah Connor"}</div>
                  </div>
                </div>
              </div>
            </div>

            <div style="border-top: 1px solid #cbd5e1; padding-top: 15px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 9px; color: #475569; margin-top: auto;">
              <div>
                <div style="font-weight: 700; color: #0f172a; margin-bottom: 2px;">Sunchaser Energy Lahore Office</div>
                <div>${settings.officeAddress}</div>
                <div style="color: #d97706;">Hotlines: ${settings.phoneNumbers}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-weight: 700; color: #0f172a;">Doc ID: SC-${leadObj.id.substring(0, 8).toUpperCase()}-${(quoteObj.id || "DRAFT").toUpperCase()}</div>
                <div>Date: ${quoteDateString}</div>
              </div>
            </div>
          </div>
        `;
      } else if (pageType === "profile") {
        pagesHtml += `
          <div class="page" ${pageStyleAttr}>
            ${absoluteImagesHtml}
            <div>
              ${headerHtml}
              ${p.title ? `<div class="page-title">${p.title}</div>` : ""}
              
              ${p.bodyText ? `
              <div style="font-size: 12px; line-height: 1.6; color: #475569; margin: 20px 0; font-weight: 500;">
                ${p.bodyText.replace(/\\n/g, "<br/>")}
              </div>
              ` : ""}

              ${bodyImagesHtml}

              ${useDefaultCompanyContent ? `
              <div class="grid-2" style="margin-top: 25px;">
                <div class="card">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 4px; font-size: 12px;">\u2600\uFE0F Sunchaser Energy</div>
                  <div style="font-size: 10.5px; line-height: 1.5; color: #475569;">
                    The core installation and smart grid integration arm. Responsible for site surveys, detailed electrical engineering designs, high-tension terminations, and smart telemetry commissioning.
                  </div>
                </div>
                <div class="card">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 4px; font-size: 12px;">\u26A1 Helios Solar</div>
                  <div style="font-size: 10.5px; line-height: 1.5; color: #475569;">
                    The design consultancy branch. Creates 3D shadow analysis, panel positioning arrays using dynamic CAD, and utility net metering simulation projections.
                  </div>
                </div>
                <div class="card">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 4px; font-size: 12px;">\u{1F3D7}\uFE0F AL ADAM Steel</div>
                  <div style="font-size: 10.5px; line-height: 1.5; color: #475569;">
                    Heavy mechanical fabrication plant. Produces heavy hot-dip galvanized frame mounts, standard structures, elevated configurations, and legendary Mughal Girder designs.
                  </div>
                </div>
                <div class="card">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 4px; font-size: 12px;">\u{1F310} Signals Global</div>
                  <div style="font-size: 10.5px; line-height: 1.5; color: #475569;">
                    International procurement and shipping network. Authorizes direct clearance and imports of Tier-1 solar modules, Knox/Goodwe/Solis inverters, and battery packs.
                  </div>
                </div>
              </div>

              <div class="card" style="margin-top: 30px; text-align: center; border-left: 4px solid #f59e0b; background-color: #fafaf9;">
                <div style="font-size: 9px; text-transform: uppercase; color: #d97706; font-weight: 800; letter-spacing: 0.05em;">Our Group Vision</div>
                <div style="font-size: 13px; font-weight: 600; line-height: 1.5; margin-top: 6px; font-style: italic; color: #1c1917;">
                  "Empowering Pakistan with generational clean energy independence, combining premium imports with superior local engineering."
                </div>
              </div>
              ` : ""}
            </div>
            ${footerHtml}
          </div>
        `;
      } else if (pageType === "qr") {
        pagesHtml += `
          <div class="page" ${pageStyleAttr}>
            ${absoluteImagesHtml}
            <div>
              ${headerHtml}
              ${p.title ? `<div class="page-title">${p.title}</div>` : ""}

              ${p.bodyText ? `
              <div style="font-size: 11.5px; line-height: 1.5; color: #475569; margin: 15px 0;">
                ${p.bodyText.replace(/\\n/g, "<br/>")}
              </div>
              ` : ""}

              ${bodyImagesHtml}

              ${useDefaultCompanyContent ? `
              <div class="grid-2" style="row-gap: 15px; margin-top: 20px;">
                <div style="display: flex; gap: 10px; align-items: flex-start;">
                  <span style="font-size: 20px;">\u{1F3C6}</span>
                  <div>
                    <div style="font-weight: 800; font-size: 12px; color: #0f172a; margin-bottom: 2px;">Direct Imported Tier-1 Hardware</div>
                    <div style="font-size: 10px; color: #475569; line-height: 1.45;">Direct Clearance customs certificates for JA Solar, Jinko and Longi modules.</div>
                  </div>
                </div>
                <div style="display: flex; gap: 10px; align-items: flex-start;">
                  <span style="font-size: 20px;">\u{1F529}</span>
                  <div>
                    <div style="font-weight: 800; font-size: 12px; color: #0f172a; margin-bottom: 2px;">Galvanized mechanical structure</div>
                    <div style="font-size: 10px; color: #475569; line-height: 1.45;">Heavy hot-dip galvanized and girder frame designs engineered for 130 km/h wind shear.</div>
                  </div>
                </div>
                <div style="display: flex; gap: 10px; align-items: flex-start;">
                  <span style="font-size: 20px;">\u{1F4D1}</span>
                  <div>
                    <div style="font-weight: 800; font-size: 12px; color: #0f172a; margin-bottom: 2px;">Complete NEPRA / LESCO Handling</div>
                    <div style="font-size: 10px; color: #475569; line-height: 1.45;">Turnkey green meter licensing coordination directly managed by Sunchaser relations desk.</div>
                  </div>
                </div>
                <div style="display: flex; gap: 10px; align-items: flex-start;">
                  <span style="font-size: 20px;">\u{1F4F2}</span>
                  <div>
                    <div style="font-weight: 800; font-size: 12px; color: #0f172a; margin-bottom: 2px;">24/7 Smart Telemetry App</div>
                    <div style="font-size: 10px; color: #475569; line-height: 1.45;">Active monitoring for daily generation yield logs, export credits, and maintenance tickets.</div>
                  </div>
                </div>
              </div>

              <div class="card" style="margin-top: 30px; border: 1px dashed #cbd5e1; background-color: #fafaf9;">
                <div style="font-weight: 800; color: #0f172a; font-size: 11.5px; margin-bottom: 12px; text-align: center; text-transform: uppercase;">Official Digital Channels & Portals</div>
                <div style="display: flex; justify-content: space-around; align-items: center;">
                  <div style="text-align: center;">
                    <svg width="70" height="70" viewBox="0 0 100 100" style="background: #ffffff; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; display: block; margin: 0 auto;">
                      <rect x="0" y="0" width="30" height="30" fill="#0f172a" />
                      <rect x="5" y="5" width="20" height="20" fill="#ffffff" />
                      <rect x="10" y="10" width="10" height="10" fill="#0f172a" />
                      <rect x="70" y="0" width="30" height="30" fill="#0f172a" />
                      <rect x="75" y="5" width="20" height="20" fill="#ffffff" />
                      <rect x="80" y="10" width="10" height="10" fill="#0f172a" />
                      <rect x="0" y="70" width="30" height="30" fill="#0f172a" />
                      <rect x="5" y="75" width="20" height="20" fill="#ffffff" />
                      <rect x="10" y="80" width="10" height="10" fill="#0f172a" />
                      <rect x="35" y="45" width="15" height="15" fill="#f59e0b" />
                      <rect x="60" y="40" width="10" height="20" fill="#0f172a" />
                      <rect x="45" y="70" width="20" height="10" fill="#0f172a" />
                    </svg>
                    <div style="font-size: 9px; font-weight: 800; color: #475569; margin-top: 6px;">Customer Portal</div>
                  </div>
                  <div style="text-align: center;">
                    <svg width="70" height="70" viewBox="0 0 100 100" style="background: #ffffff; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; display: block; margin: 0 auto;">
                      <rect x="0" y="0" width="30" height="30" fill="#0f172a" />
                      <rect x="5" y="5" width="20" height="20" fill="#ffffff" />
                      <rect x="10" y="10" width="10" height="10" fill="#0f172a" />
                      <rect x="70" y="0" width="30" height="30" fill="#0f172a" />
                      <rect x="75" y="5" width="20" height="20" fill="#ffffff" />
                      <rect x="80" y="10" width="10" height="10" fill="#0f172a" />
                      <rect x="0" y="70" width="30" height="30" fill="#0f172a" />
                      <rect x="5" y="75" width="20" height="20" fill="#ffffff" />
                      <rect x="10" y="80" width="10" height="10" fill="#0f172a" />
                      <rect x="35" y="45" width="15" height="15" fill="#f59e0b" />
                      <rect x="40" y="60" width="20" height="10" fill="#0f172a" />
                      <rect x="70" y="45" width="10" height="20" fill="#0f172a" />
                    </svg>
                    <div style="font-size: 9px; font-weight: 800; color: #475569; margin-top: 6px;">Technician Dispatch</div>
                  </div>
                </div>
              </div>
              ` : ""}
            </div>
            ${footerHtml}
          </div>
        `;
      } else if (pageType === "ceo") {
        const hasBodyImage = ext.bodyImages && ext.bodyImages.length > 0;
        const cardHeight = hasBodyImage ? "130mm" : "155mm";
        pagesHtml += `
          <div class="page" ${pageStyleAttr}>
            ${absoluteImagesHtml}
            <div>
              ${headerHtml}
              ${p.title ? `<div class="page-title">${p.title}</div>` : ""}
              ${p.bodyText ? `<div style="font-size: 11px; margin-bottom: 12px; color: #475569;">${p.bodyText}</div>` : ""}

              ${bodyImagesHtml}

              ${useDefaultCompanyContent ? `
              <div class="grid-2" style="margin-top: 15px;">
                <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; height: ${cardHeight};">
                  <div>
                    <div style="font-size: 22px; margin-bottom: 6px;">\u{1F6E1}\uFE0F</div>
                    <div style="font-weight: 800; font-size: 12px; color: #0f172a; margin-bottom: 1px;">${ceoList[0].name}</div>
                    <div style="font-size: 8px; text-transform: uppercase; color: #d97706; font-weight: 800; margin-bottom: 10px; letter-spacing: 0.05em;">${ceoList[0].designation}</div>
                    <div style="font-size: 10.5px; line-height: 1.6; color: #475569; font-style: italic;">
                      "${ceoList[0].message}"
                    </div>
                  </div>
                  <div style="border-top: 1px dashed #cbd5e1; padding-top: 8px; margin-top: 10px; text-align: center;">
                    <div style="font-family: 'Georgia', serif; font-size: 13px; font-style: italic; color: #1e293b; font-weight: 700;">${ceoList[0].name}</div>
                    <div style="font-size: 8px; text-transform: uppercase; color: #94a3b8; margin-top: 2px; font-weight: bold;">Digital Seal Verification</div>
                  </div>
                </div>

                <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; height: ${cardHeight};">
                  <div>
                    <div style="font-size: 22px; margin-bottom: 6px;">\u2696\uFE0F</div>
                    <div style="font-weight: 800; font-size: 12px; color: #0f172a; margin-bottom: 1px;">${ceoList[1].name}</div>
                    <div style="font-size: 8px; text-transform: uppercase; color: #d97706; font-weight: 800; margin-bottom: 10px; letter-spacing: 0.05em;">${ceoList[1].designation}</div>
                    <div style="font-size: 10.5px; line-height: 1.6; color: #475569; font-style: italic;">
                      "${ceoList[1].message}"
                    </div>
                  </div>
                  <div style="border-top: 1px dashed #cbd5e1; padding-top: 8px; margin-top: 10px; text-align: center;">
                    <div style="font-family: 'Georgia', serif; font-size: 13px; font-style: italic; color: #1e293b; font-weight: 700;">${ceoList[1].name}</div>
                    <div style="font-size: 8px; text-transform: uppercase; color: #94a3b8; margin-top: 2px; font-weight: bold;">Digital Seal Verification</div>
                  </div>
                </div>
              </div>
              ` : ""}
            </div>
            ${footerHtml}
          </div>
        `;
      } else if (pageType.startsWith("structure_")) {
        pagesHtml += `
          <div class="page" ${pageStyleAttr}>
            ${absoluteImagesHtml}
            <div>
              ${headerHtml}
              ${p.title ? `<div class="page-title">${p.title}</div>` : ""}

              ${p.bodyText || useDefaultCompanyContent ? `
              <div class="card" style="margin: 15px 0 10px 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <span style="font-weight: 800; font-size: 12px; color: #0f172a;">Selected Structure Frame Type:</span>
                  <span class="badge" style="font-size: 8px; padding: 2.5px 8px;">${structDetails.title}</span>
                </div>
                <div style="font-size: 11px; line-height: 1.5; color: #475569;">
                  <strong>English Specification:</strong><br/>
                  ${p.bodyText || structDetails.descriptionEn}
                </div>
              </div>
              ` : ""}

              ${bodyImagesHtml}

              ${useDefaultCompanyContent ? `
              <div class="card" style="margin-bottom: 10px; border-left: 4px solid #f59e0b; padding: 10px 14px;">
                <div style="font-size: 9px; text-transform: uppercase; color: #d97706; font-weight: 800; margin-bottom: 4px; text-align: right;">\u0633\u0627\u062E\u062A\u06CC \u062A\u0641\u0635\u06CC\u0644\u0627\u062A (\u0627\u0631\u062F\u0648)</div>
                <div class="urdu-text" style="font-size: 11.5px; line-height: 2;">
                  ${structDetails.descriptionUr}
                </div>
              </div>

              <div class="grid-2" style="margin-bottom: 10px;">
                <div class="card" style="font-size: 10.5px; line-height: 1.45;">
                  <strong>Mechanical Design Specs:</strong>
                  <div style="margin-top: 4px; color: #475569;">
                    \u2022 Material: ${structDetails.materialType}<br/>
                    \u2022 Weight Category: ${structDetails.weight}<br/>
                    \u2022 Max Wind Shear: ${structDetails.windRating} wind certified
                  </div>
                </div>
                <div class="card" style="font-size: 10.5px; line-height: 1.45;">
                  <strong>Warranty Guidelines:</strong>
                  <div style="margin-top: 4px; color: #475569;">
                    \u2022 Structural Integrity: ${structDetails.warranty}<br/>
                    \u2022 Anchoring: Pure Rawl anchors<br/>
                    \u2022 Analysis Model: SAP 2000 Wind Load compliant
                  </div>
                </div>
              </div>

              <div class="card" style="padding: 6px; border: 1.5px solid #e2e8f0; background-color: #fafaf9;">
                <div style="font-weight: 800; font-size: 9.5px; color: #0f172a; text-align: center; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 2px;">Engineering Mounting Layout Blueprint</div>
                ${structureSvg}
              </div>
              ` : ""}
            </div>
            ${footerHtml}
          </div>
        `;
      } else if (pageType === "boq") {
        let boqHtml = "";
        let grossTotal = 0;
        let discountAmount = 0;
        let netTotal = 0;
        const allRows = quoteObj.boqRows || quoteObj.boqItems || [];
        const includeSizerItems = options.includeSizerItems === true;
        const autoSizerRows = allRows.filter((r) => defaultAutoSizerIds.includes(r.id));
        const manualBoqRows = allRows.filter((r) => r && r.type === "item" && !defaultAutoSizerIds.includes(r.id));
        const isPackageRow = (r) => r.id && (r.id.startsWith("row-heading") || r.id.startsWith("row-item") || r.id.startsWith("row-subtotal"));
        const sourceUsed = manualBoqRows.some(isPackageRow) ? "package_loaded" : includeSizerItems ? "auto_sizer" : "manual_only";
        const rows = includeSizerItems ? allRows.filter((r) => r && r.type === "item") : manualBoqRows;
        console.log(`[PDF Compilation Debug Log]
          - manualBoqRows count: ${manualBoqRows.length}
          - autoSizerRows count: ${autoSizerRows.length}
          - finalPdfBoqRows count: ${rows.length}
          - source used: ${sourceUsed}`);
        let calculatedGross = 0;
        rows.forEach((r) => {
          if (r.type === "heading") {
            boqHtml += `
              <tr style="background-color: #f1f5f9; font-weight: 700; color: #0f172a; border-bottom: 1.5px solid #cbd5e1;">
                <td colspan="7" style="padding: 5px 8px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; font-family: monospace;">${r.name}</td>
              </tr>
            `;
          } else if (r.type === "subtotal") {
            boqHtml += `
              <tr style="border-bottom: 1.5px solid #cbd5e1; font-weight: 700; background-color: #f8fafc; font-size: 9.5px;">
                <td colspan="6" style="padding: 5px 8px; text-align: right; color: #475569; text-transform: uppercase;">${r.name || "SUBTOTAL"}:</td>
                <td style="padding: 5px 8px; text-align: right; color: #0f172a;">${formatPKR(r.total)}</td>
              </tr>
            `;
          } else {
            calculatedGross += Number(r.total) || 0;
            boqHtml += `
              <tr style="border-bottom: 1px solid #cbd5e1; font-size: 9.5px;">
                <td style="padding: 5px 8px; text-align: center; color: #64748b;">${r.srNo || ""}</td>
                <td style="padding: 5px 8px; font-weight: 600; color: #0f172a;">${r.name}</td>
                <td style="padding: 5px 8px; color: #475569; font-size: 9px; line-height: 1.3;">${r.description || ""}</td>
                <td style="padding: 5px 8px; text-align: center; color: #475569;">${r.unit || "Nos"}</td>
                <td style="padding: 5px 8px; text-align: center; font-weight: 500;">${r.qty}</td>
                <td style="padding: 5px 8px; text-align: right; color: #475569;">${formatPKR(r.rate)}</td>
                <td style="padding: 5px 8px; text-align: right; font-weight: 600; color: #0f172a;">${formatPKR(r.total)}</td>
              </tr>
            `;
          }
        });
        if (!includeSizerItems) {
          grossTotal = calculatedGross;
        } else {
          grossTotal = quoteObj.grandTotal || calculatedGross;
        }
        discountAmount = Number(quoteObj.discount) || 0;
        const societyCharges = Number(quoteObj.societyCharges) || 0;
        const taxEnabled = !!quoteObj.taxEnabled;
        const taxRate = Number(quoteObj.taxRate) || 0;
        const taxAmount = taxEnabled ? Math.round(grossTotal * (taxRate / 100)) : 0;
        netTotal = grossTotal - discountAmount + societyCharges + taxAmount;
        pagesHtml += `
          <div class="page boq-page" style="padding: 12mm 15mm; ${p.bgImageUrl ? `background: url('${p.bgImageUrl}') no-repeat center center / cover;` : ""} position: relative;">
            ${absoluteImagesHtml}
            <div>
              ${headerHtml}
              <div class="page-title">${p.title || (mode === "sizer" ? "Sizing Specifications Estimate" : "Technical Bill of Quantities (BOQ)")}</div>
              
              <div style="border: 1.5px solid #cbd5e1; border-radius: 6px; margin-top: 15px;">
                <table class="boq-table">
                  <thead>
                    <tr style="height: 28px;">
                      <th style="width: 5%; text-align: center; border-bottom: 2px solid #0f172a;">Sr.</th>
                      <th style="width: 25%; border-bottom: 2px solid #0f172a;">Item Name</th>
                      <th style="width: 32%; border-bottom: 2px solid #0f172a;">Material Specifications</th>
                      <th style="width: 7%; text-align: center; border-bottom: 2px solid #0f172a;">Unit</th>
                      <th style="width: 7%; text-align: center; border-bottom: 2px solid #0f172a;">Qty</th>
                      <th style="width: 12%; text-align: right; border-bottom: 2px solid #0f172a;">Rate</th>
                      <th style="width: 12%; text-align: right; border-bottom: 2px solid #0f172a;">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${boqHtml}
                  </tbody>
                </table>
              </div>

              ${bodyImagesHtml}

              <div style="margin-top: 15px; display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="width: 48%; font-size: 9.5px; color: #64748b; line-height: 1.45;">
                  ${quoteObj.customNotes ? `
                    <div style="background-color: #fdf4ff; border: 1px solid #f3e8ff; border-radius: 6px; padding: 6px 10px; color: #6b21a8; font-weight: 500;">
                      <strong>Special Execution Notes:</strong><br/>
                      ${quoteObj.customNotes}
                    </div>
                  ` : strictTemplateOnly ? "" : "Note: Complete hardware clearances are direct clearance imported. Local mounts are AL ADAM galvanized Mughal steel."}
                </div>
                
                <div style="width: 46%;">
                  <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                    <span style="color: #64748b; font-weight: 500;">BOQ Gross Sum:</span>
                    <span style="font-weight: 600; color: #0f172a;">${formatPKR(grossTotal)}</span>
                  </div>
                  ${discountAmount > 0 ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">Special Discount:</span>
                      <span style="font-weight: 600; color: #dc2626;">-${formatPKR(discountAmount)}</span>
                    </div>
                  ` : ""}
                  ${taxEnabled ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">Sales Tax (${taxRate}%):</span>
                      <span style="font-weight: 600; color: #dc2626;">+${formatPKR(taxAmount)}</span>
                    </div>
                  ` : ""}
                  ${societyCharges > 0 ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">Society Approval / Dues:</span>
                      <span style="font-weight: 600; color: #0f172a;">+${formatPKR(societyCharges)}</span>
                    </div>
                  ` : ""}
                  <div style="display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 850; border-top: 1.5px solid #0f172a; padding-top: 4px; margin-top: 4px;">
                    <span style="color: #0f172a;">Turnkey Investment:</span>
                    <span style="color: #d97706; font-size: 13.5px;">${formatPKR(netTotal)}</span>
                  </div>
                  <div style="font-size: 8px; color: #94a3b8; text-align: right; margin-top: 4px; font-weight: bold;">
                    * Direct imports clearance trace.
                  </div>
                </div>
              </div>
            </div>
            ${footerHtml}
          </div>
        `;
      } else if (pageType === "terms1") {
        pagesHtml += `
          <div class="page" ${pageStyleAttr}>
            ${absoluteImagesHtml}
            <div>
              ${headerHtml}
              <div class="page-title">${p.title}</div>
              
              <div style="font-size: 11.5px; line-height: 1.5; color: #475569; margin: 15px 0;">
                All engineering activities, supply dispatch, and LESCO utility agreements are governed strictly by the Sunchaser covenants below:
              </div>

              ${bodyImagesHtml}

              <div style="margin-top: 10px;">
                ${tcPage1Html}
              </div>
            </div>
            ${footerHtml}
          </div>
        `;
      } else if (pageType === "terms2") {
        pagesHtml += `
          <div class="page" ${pageStyleAttr}>
            ${absoluteImagesHtml}
            <div>
              ${headerHtml}
              <div class="page-title">${p.title}</div>
              
              <div style="font-size: 11.5px; line-height: 1.5; color: #475569; margin: 15px 0;">
                Consortium hardware replacement and force majeure exclusions continue below:
              </div>

              ${bodyImagesHtml}

              <div style="margin-top: 10px;">
                ${tcPage2Html}
              </div>
            </div>
            ${footerHtml}
          </div>
        `;
      } else if (pageType === "signoff") {
        pagesHtml += `
          <div class="page" ${pageStyleAttr}>
            ${absoluteImagesHtml}
            <div>
              ${headerHtml}
              <div class="page-title">${p.title}</div>

              ${bodyImagesHtml}

              <div class="card" style="margin: 15px 0 10px 0;">
                <div style="font-weight: 800; color: #0f172a; font-size: 11.5px; margin-bottom: 8px; text-transform: uppercase; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 2px;">
                  1. Customer Billing Profile
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: #475569;">
                  <div><strong>Client Title:</strong> <span style="color: #0f172a; font-weight: 600;">${quoteObj.clientName || leadObj.name}</span></div>
                  <div><strong>CNIC Passport:</strong> <span style="color: #0f172a; font-weight: 600;">${quoteObj.cnic || "Pending Verification"}</span></div>
                  <div><strong>Active Line:</strong> <span style="color: #0f172a;">${quoteObj.clientPhone || leadObj.phone}</span></div>
                  <div><strong>Email Inbox:</strong> <span style="color: #0f172a;">${quoteObj.clientEmail || leadObj.email}</span></div>
                  <div style="grid-column: span 2;"><strong>Installation Address:</strong> <span style="color: #0f172a;">${quoteObj.clientAddress || leadObj.address}</span></div>
                </div>
              </div>

              <div class="card" style="margin-bottom: 15px; border-left: 4px solid #0284c7;">
                <div style="font-weight: 800; color: #0f172a; font-size: 11.5px; margin-bottom: 8px; text-transform: uppercase; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 2px;">
                  2. Utility Interconnect (LESCO Metering)
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: #475569;">
                  <div><strong>LESCO Meter ID:</strong> <span style="color: #0f172a; font-weight: 600; font-family: monospace;">${lescoObj.meterNo || "Not Scanned"}</span></div>
                  <div><strong>Consumer A/C Number:</strong> <span style="color: #0f172a; font-weight: 600; font-family: monospace;">${lescoObj.consumerNo || "Not Scanned"}</span></div>
                  <div><strong>Sanctioned Grid Load:</strong> <span style="color: #0f172a; font-weight: 600;">${lescoObj.sanctionedLoad ? lescoObj.sanctionedLoad + " kW" : "Not Scanned"}</span></div>
                  <div><strong>Terminations Phase:</strong> <span style="color: #0f172a;">${lescoObj.phaseType || "Three Phase"}</span></div>
                  <div style="grid-column: span 2;"><strong>Turnkey Net Metering Licensing:</strong> <span style="color: #0284c7; font-weight: 700;">${netMeteringText === "Yes" ? "REQUIRED &amp; SOW INCLUDED" : "NOT REQUIRED"}</span></div>
                </div>
              </div>

              <div class="card" style="margin-bottom: 20px; font-size: 10px; line-height: 1.5; color: #475569;">
                <strong>Contract Declaration:</strong> By signing below, the client confirms the technical parameters (Page 5), accepts the final turnkey financial quote (Page 6), accepts the terms &amp; exclusions (Page 7 &amp; 8), and formally authorizes Sunchaser Energy to proceed with hardware procurement, chemical bores, structural steel fabrication, and LESCO utility interconnect procedures.
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 25px;">
                <div style="text-align: center;">
                  <div style="height: 15mm; border-bottom: 1.5px solid #cbd5e1; display: flex; align-items: flex-end; justify-content: center; font-size: 12px; color: #94a3b8; font-style: italic;">
                    Signature / Thumb Stamp
                  </div>
                  <div style="font-weight: 850; color: #0f172a; font-size: 11.5px; margin-top: 6px;">Client Representative Sign-off</div>
                  <div style="font-size: 8px; color: #94a3b8;">Declaration Acceptance Authority</div>
                </div>
                <div style="text-align: center;">
                  <div style="height: 15mm; border-bottom: 1.5px solid #cbd5e1; display: flex; align-items: flex-end; justify-content: center; font-size: 12px; color: #94a3b8; font-style: italic;">
                    Sunchaser Central Staging
                  </div>
                  <div style="font-weight: 850; color: #0f172a; font-size: 11.5px; margin-top: 6px;">Sunchaser Central Operations</div>
                  <div style="font-size: 8px; color: #94a3b8;">Design Release Validation Authorization</div>
                </div>
              </div>
            </div>
            ${footerHtml}
          </div>
        `;
      } else if (pageType === "bank") {
        pagesHtml += `
          <div class="page" ${pageStyleAttr}>
            ${absoluteImagesHtml}
            <div>
              ${headerHtml}
              <div class="page-title">${p.title}</div>

              <div class="card" style="background-color: #fffbeb; border-color: #fde68a; margin-top: 15px; display: flex; gap: 10px; align-items: center; padding: 8px 12px;">
                <span style="font-size: 18px;">\u26A0\uFE0F</span>
                <span style="font-size: 10px; color: #b45309; line-height: 1.4; font-weight: 600;">
                  <strong>Payment Safety Guidelines:</strong> Sunchaser Energy Systems never requests cash handovers or deposits to personal employee accounts. Verify all drafts match the official channels.
                </span>
              </div>

              ${bodyImagesHtml}

              <div>
                ${bankAccountsHtml}
              </div>

              <div class="card" style="margin-top: 25px; font-size: 10px; color: #475569; line-height: 1.5; background-color: #fafaf9;">
                <strong>Verification SLA:</strong> Once a bank transfer, direct deposit, or pay order is dispatched, snap the transfer slip and email to <strong>${settings.billingEmail}</strong> or share with your advisor for warehouse component staging release.
              </div>
            </div>
            ${footerHtml}
          </div>
        `;
      } else if (pageType === "final") {
        pagesHtml += `
          <div class="page" style="justify-content: center; text-align: center; padding: 30mm 20mm; ${p.bgImageUrl ? `background: url('${p.bgImageUrl}') no-repeat center center / cover;` : ""} position: relative;">
            ${absoluteImagesHtml}
            <div>
              ${useDefaultCompanyContent ? `
              <div style="background-color: #0f172a; width: 64px; height: 64px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 32px; color: #ffffff; font-weight: bold; margin: 0 auto 20px auto; box-shadow: 0 4px 10px rgba(15,23,42,0.25);">\u2600\uFE0F</div>
              <h2 style="font-size: 24px; font-weight: 850; letter-spacing: -0.02em; color: #0f172a; margin-bottom: 2px;">SUNCHASER ENERGY SYSTEMS</h2>
              <div style="font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.15em; color: #d97706; font-weight: 700; margin-bottom: 25px;">Generational Infrastructure</div>
              ` : ""}
              
              ${p.bodyText ? `
              <div style="max-width: 440px; margin: 0 auto 40px auto; font-size: 12px; line-height: 1.6; color: #475569; font-weight: 500; font-style: italic;">
                "${p.bodyText}"
              </div>
              ` : ""}

              ${bodyImagesHtml}

              ${useDefaultCompanyContent ? `
              <div style="border-top: 1.5px solid #cbd5e1; padding-top: 25px; font-size: 10.5px; color: #475569; max-width: 360px; margin: 0 auto; line-height: 1.5;">
                <strong style="color: #0f172a; font-size: 11px;">Sunchaser Central Staging HQ</strong><br/>
                ${settings.officeAddress}<br/>
                Hotlines: ${settings.phoneNumbers}<br/>
                Email: ${settings.billingEmail || "billing@sunchaser-energy.com"} | Web: ${settings.websiteUrl || "www.sunchaser-energy.com"}
              </div>
              ` : ""}
            </div>
          </div>
        `;
      }
    }
  });
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Sunchaser Proposal Deck</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Noto+Nastaliq+Urdu:wght@400;700&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'Inter', system-ui, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #f1f5f9;
          color: #1e293b;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .action-bar {
          background-color: #0f172a;
          color: #ffffff;
          padding: 12px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: sticky;
          top: 0;
          z-index: 100;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
          font-size: 14px;
        }
        .btn-print {
          background-color: #f59e0b;
          color: #0f172a;
          border: none;
          padding: 8px 18px;
          border-radius: 8px;
          font-weight: 700;
          cursor: pointer;
          font-family: 'Inter', sans-serif;
        }
        .btn-print:hover {
          background-color: #d97706;
        }
        .pages-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          padding: 30px 0;
        }
        .page {
          width: 210mm;
          height: 297mm;
          background: #ffffff;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          box-sizing: border-box;
          padding: 15mm 15mm;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
          overflow: hidden;
          page-break-after: always;
        }
        .page.boq-page {
          height: auto !important;
          min-height: 297mm;
          overflow: visible !important;
        }
        .page.cover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .page.full-page-image-only {
          padding: 0 !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .page-header-logo {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1.5px solid #cbd5e1;
          padding-bottom: 6px;
          margin-bottom: 12px;
        }
        .header-company-name {
          font-weight: 800;
          font-size: 13px;
          color: #0f172a;
          letter-spacing: 0.05em;
        }
        .page-title {
          font-size: 16px;
          font-weight: 850;
          color: #0f172a;
          border-left: 4px solid #f59e0b;
          padding-left: 8px;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }
        .page-footer {
          border-top: 1px solid #cbd5e1;
          padding-top: 6px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 8.5px;
          color: #64748b;
          font-weight: 600;
        }
        .grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }
        .card {
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px;
        }
        .badge {
          font-size: 8.5px;
          font-weight: 800;
          text-transform: uppercase;
          padding: 2px 7px;
          border-radius: 4px;
          background-color: #fef3c7;
          color: #92400e;
        }
        .urdu-text {
          font-family: 'Noto Nastaliq Urdu', serif;
          direction: rtl;
          text-align: right;
          line-height: 2.2;
          font-size: 11px;
          color: #334155;
        }
        .boq-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9.5px;
        }
        .boq-table th {
          background-color: #0f172a;
          color: #ffffff;
          text-align: left;
          padding: 6px 8px;
          font-weight: 750;
          text-transform: uppercase;
          font-size: 8px;
          letter-spacing: 0.03em;
        }
        .boq-table td {
          padding: 5px 8px;
          border-bottom: 1px solid #e2e8f0;
        }
        @page {
          size: A4 portrait;
          margin: 0;
        }
        @media print {
          body {
            background-color: #ffffff !important;
          }
          .action-bar {
            display: none !important;
          }
          .pages-container {
            padding: 0 !important;
            gap: 0 !important;
          }
          .page {
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="action-bar">
        <div><strong>Sunchaser Proposal Deck</strong> - Client: ${quoteObj.clientName || leadObj.name}</div>
        <button class="btn-print" onclick="window.print()">Print / Save PDF</button>
      </div>

      <div class="pages-container">
        ${pagesHtml}
      </div>
    </body>
    </html>
  `;
}
app.get("/api/export/pdf/auto-sizer/:leadId", async (req, res) => {
  try {
    if (!AUTO_SIZER_QUOTE_CREATION_ENABLED) {
      return res.status(403).send("Auto Sizer PDF export is temporarily disabled. Use Manual BOQ PDF with quoteId.");
    }
    loadDb();
    let activeState = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }
    const lead = activeState.leads.find((l) => l.id === req.params.leadId);
    if (!lead) {
      return res.status(404).send("Lead not found.");
    }
    const quoteId = String(req.query.quoteId || "");
    if (!quoteId) {
      return res.status(400).send("quoteId is required for auto sizer PDF.");
    }
    const quote = lead.quotes && lead.quotes.find((q) => q.id === quoteId && q.quote_type === "auto_sizer");
    if (!quote) {
      return res.status(404).send("Auto sizer quote not found for this lead.");
    }
    const defaultAutoSizerIds = [
      "h-1",
      "panel_row",
      "inverter_row",
      "battery_row",
      "s-1",
      "h-2",
      "dc_cable_row",
      "ac_cable_row",
      "earth_wire_row",
      "s-2",
      "h-3",
      "db_box_row",
      "s-3",
      "h-4",
      "supplies_row",
      "s-4",
      "h-5",
      "earthing_bore_row",
      "s-5",
      "h-6",
      "structure_row",
      "civil_work_row",
      "install_service_row",
      "s-6",
      "h-7",
      "freight_row",
      "net_metering_row",
      "survey_design_row",
      "s-7"
    ];
    console.log(`[PDF BACKEND LOG] GET /api/export/pdf/auto-sizer/:leadId
      - quoteId: ${quote.id}
      - quote_type: ${quote.quote_type || "auto_sizer"}
      - includeSizerItems: true
      - manual rows count: 0
      - auto rows count: ${defaultAutoSizerIds.length}
      - final rows count: ${defaultAutoSizerIds.length}
    `);
    const pdfHtml = compileSunchaserPDFHtml("sizer", quote, lead, activeState);
    res.send(pdfHtml);
  } catch (err) {
    res.status(500).send("Error compiling PDF structure: " + err.message);
  }
});
app.post("/api/export/pdf/manual-quote", async (req, res) => {
  try {
    loadDb();
    let activeState = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }
    let payload = req.body;
    if (payload && typeof payload.payload === "string") {
      try {
        payload = JSON.parse(payload.payload);
      } catch (e) {
      }
    }
    let lead = null;
    if (payload.leadId) {
      lead = activeState.leads.find((l) => l.id === payload.leadId);
    }
    if (!lead) {
      lead = {
        id: payload.leadId || `lead-manual-${Date.now()}`,
        name: payload.clientName || payload.customerName || "Customer",
        email: payload.clientEmail || "customer@example.com",
        phone: payload.clientPhone || "0000-0000000",
        address: payload.clientAddress || "Lahore, Pakistan",
        location: payload.cityArea || "Lahore",
        monthlyBill: 0,
        roofSpace: 0,
        shading: "None",
        rating: 5,
        assignedSalesperson: payload.bdmName || "Sales Advisor",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        notes: ""
      };
    }
    if (lead && payload.quoteId) {
      const exactManualQuote = lead.quotes?.find((q) => q.id === payload.quoteId && q.quote_type === "manual_boq");
      if (!exactManualQuote) {
        return res.status(404).send("Manual BOQ quote not found for this lead.");
      }
      payload = exactManualQuote;
    }
    const options = {
      includedPages: payload.includedPages || ["cover", "profile", "qr", "ceo", "structure", "boq", "terms1", "terms2", "signoff", "bank", "final"],
      templateId: payload.templateId || "tmpl-1",
      includeSizerItems: payload.includeSizerItems === true
    };
    const defaultAutoSizerIds = [
      "h-1",
      "panel_row",
      "inverter_row",
      "battery_row",
      "s-1",
      "h-2",
      "dc_cable_row",
      "ac_cable_row",
      "earth_wire_row",
      "s-2",
      "h-3",
      "db_box_row",
      "s-3",
      "h-4",
      "supplies_row",
      "s-4",
      "h-5",
      "earthing_bore_row",
      "s-5",
      "h-6",
      "structure_row",
      "civil_work_row",
      "install_service_row",
      "s-6",
      "h-7",
      "freight_row",
      "net_metering_row",
      "survey_design_row",
      "s-7"
    ];
    const allRows = payload.boqRows || payload.boqItems || [];
    const autoSizerCount = allRows.filter((r) => defaultAutoSizerIds.includes(r.id)).length;
    const manualBoqCount = allRows.filter((r) => r && r.type === "item" && !defaultAutoSizerIds.includes(r.id)).length;
    const finalCount = options.includeSizerItems ? allRows.length : manualBoqCount;
    console.log(`[PDF BACKEND LOG] POST /api/export/pdf/manual-quote
      - quoteId: ${payload.id || "N/A"}
      - quote_type: ${payload.quote_type || "manual_boq"}
      - includeSizerItems: ${options.includeSizerItems}
      - manual rows count: ${manualBoqCount}
      - auto rows count: ${autoSizerCount}
      - final rows count: ${finalCount}
    `);
    const hasCompiledQuote = lead && lead.quotes && lead.quotes.some((q) => q.quote_type === "manual_boq");
    if (manualBoqCount === 0 || !hasCompiledQuote) {
      res.send(`
        <div style="padding: 40px; color: #d97706; font-family: system-ui, -apple-system, sans-serif; text-align: center; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; max-width: 500px; margin: 50px auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <h2 style="margin-top: 0; color: #92400e; font-size: 20px; font-weight: 700;">No BOQ items added yet.</h2>
          <p style="color: #b45309; font-size: 14px; font-weight: 500; line-height: 1.5; margin-bottom: 0;">Please add BOQ rows and compile quote first.</p>
        </div>
      `);
      return;
    }
    const pdfHtml = compileSunchaserPDFHtml("manual", payload, lead, activeState, options);
    res.send(pdfHtml);
  } catch (err) {
    res.status(500).send("Error compiling Manual PDF structure: " + err.message);
  }
});
app.get("/api/export/pdf/template-preview/:templateId", async (req, res) => {
  try {
    loadDb();
    let activeState = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }
    const templateId = req.params.templateId;
    const mockLead = {
      id: "lead-preview",
      name: "Muhammad Allauddin (Preview)",
      email: "allai1432009@gmail.com",
      phone: "0309-0236666",
      address: "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore",
      location: "Lahore",
      monthlyBill: 12e4,
      roofSpace: 1200,
      shading: "None",
      rating: 5,
      assignedSalesperson: "Sarah Connor",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      notes: "Preview of corporate proposal styling."
    };
    const mockQuote = {
      systemSizekW: 15,
      panelCount: 24,
      panelType: "JA Solar 550W Mono-PERC Panels",
      inverterType: "Growatt 15kW Hybrid Inverter",
      batteryCapacity: "10.24kWh Lithium Pack",
      totalCost: 185e4,
      structureType: "Elevated",
      accessories: "Standard accessories bundle",
      installationCharges: 8e4,
      netMeteringCharges: 9e4,
      paymentTerms: "50% Advance, 40% Delivery, 10% Commissioning",
      warrantyTerms: "Standard warranties apply",
      termsAndConditions: "Standard terms and conditions apply.",
      clientName: "Muhammad Allauddin",
      clientPhone: "0309-0236666",
      clientEmail: "allai1432009@gmail.com",
      clientAddress: "DHA Phase 6, Lahore",
      cityArea: "Lahore",
      systemType: "Hybrid"
    };
    const includedFromTemplate = buildIncludedPagesFromTemplate(activeState, templateId);
    const options = {
      templateId,
      includedPages: includedFromTemplate
    };
    const pdfHtml = compileSunchaserPDFHtml("preview", { ...mockQuote, boqRows: [], boqItems: [] }, mockLead, activeState, options);
    res.send(pdfHtml);
  } catch (err) {
    res.status(500).send("Error compiling PDF preview: " + err.message);
  }
});
app.get("/api/export/pdf/manual-quote/:leadId", async (req, res) => {
  try {
    loadDb();
    let activeState = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }
    const lead = activeState.leads.find((l) => l.id === req.params.leadId);
    if (!lead) {
      return res.status(404).send("Lead not found.");
    }
    const quoteId = req.query.quoteId;
    let quote = null;
    if (quoteId) {
      quote = lead.quotes && lead.quotes.find((q) => q.id === quoteId && q.quote_type === "manual_boq");
    }
    if (!quoteId) {
      return res.status(400).send("quoteId is required for manual BOQ PDF.");
    }
    if (!quote) {
      return res.status(404).send("Manual BOQ quote not found for this lead.");
    }
    const options = {
      includedPages: quote.includedPages || ["cover", "profile", "qr", "ceo", "structure", "boq", "terms1", "terms2", "signoff", "bank", "final"],
      templateId: quote.templateId || "tmpl-1",
      includeSizerItems: quote.includeSizerItems === true
    };
    const defaultAutoSizerIds = [
      "h-1",
      "panel_row",
      "inverter_row",
      "battery_row",
      "s-1",
      "h-2",
      "dc_cable_row",
      "ac_cable_row",
      "earth_wire_row",
      "s-2",
      "h-3",
      "db_box_row",
      "s-3",
      "h-4",
      "supplies_row",
      "s-4",
      "h-5",
      "earthing_bore_row",
      "s-5",
      "h-6",
      "structure_row",
      "civil_work_row",
      "install_service_row",
      "s-6",
      "h-7",
      "freight_row",
      "net_metering_row",
      "survey_design_row",
      "s-7"
    ];
    const allRows = quote.boqRows || quote.boqItems || [];
    const autoSizerCount = allRows.filter((r) => defaultAutoSizerIds.includes(r.id)).length;
    const manualBoqCount = allRows.filter((r) => r && r.type === "item" && !defaultAutoSizerIds.includes(r.id)).length;
    const finalCount = options.includeSizerItems ? allRows.length : manualBoqCount;
    console.log(`[PDF BACKEND LOG] GET /api/export/pdf/manual-quote/:leadId
      - quoteId: ${quote.id}
      - quote_type: ${quote.quote_type || "manual_boq"}
      - includeSizerItems: ${options.includeSizerItems}
      - manual rows count: ${manualBoqCount}
      - auto rows count: ${autoSizerCount}
      - final rows count: ${finalCount}
    `);
    if (manualBoqCount === 0) {
      res.send(`
        <div style="padding: 40px; color: #d97706; font-family: system-ui, -apple-system, sans-serif; text-align: center; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; max-width: 500px; margin: 50px auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <h2 style="margin-top: 0; color: #92400e; font-size: 20px; font-weight: 700;">No BOQ items added yet.</h2>
          <p style="color: #b45309; font-size: 14px; font-weight: 500; line-height: 1.5; margin-bottom: 0;">Please add BOQ rows and compile quote first.</p>
        </div>
      `);
      return;
    }
    const pdfHtml = compileSunchaserPDFHtml("manual", quote, lead, activeState, options);
    res.send(pdfHtml);
  } catch (err) {
    res.status(500).send("Error compiling manual quotation PDF: " + err.message);
  }
});
app.get("/api/export/pdf/:leadId", async (req, res) => {
  try {
    loadDb();
    let activeState = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }
    const lead = activeState.leads.find((l) => l.id === req.params.leadId);
    if (!lead) {
      return res.status(404).send("Lead not found.");
    }
    const quoteId = req.query.quoteId;
    if (!quoteId) {
      return res.status(400).send("quoteId is required.");
    }
    const quote = lead.quotes && lead.quotes.find((q) => q.id === quoteId);
    if (!quote) {
      return res.status(404).send("Quote not found for this lead.");
    }
    if (quote.quote_type === "auto_sizer" && AUTO_SIZER_QUOTE_CREATION_ENABLED) {
      res.redirect(`/api/export/pdf/auto-sizer/${req.params.leadId}?quoteId=${quoteId}`);
    } else {
      res.redirect(`/api/export/pdf/manual-quote/${req.params.leadId}?quoteId=${quoteId}`);
    }
  } catch (err) {
    res.status(500).send("Error compiling Legacy PDF wrapper: " + err.message);
  }
});
app.post("/api/gemini/chat", async (req, res) => {
  const { message, history } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }
  try {
    const systemPrompt = `You are "Sunchaser AI", an elite virtual solar assistant for Sunchaser Energy Systems. 
We provide premium residential and commercial solar panels, intelligent Enphase microinverters/Tesla central inverters, and high-performance stackable battery storage options like our proprietary "Sunchaser Core (13.5kWh)".
Your goal is to answer questions about:
1. Sunchaser solar systems, panel options, microinverters, battery sizing, and net metering tracker details.
2. Saving and cost math, payback estimations, solar state tax credits (e.g. 30% Federal ITC).
3. The booking and installation process with Sunchaser's team (on-site virtual audit, engineering calculations, and installation reports).
Your tone must be warm, professional, clean, highly informative, and concise. Formulate structured bullet points when providing tech specs. Always represent Sunchaser's values of absolute clean energy design and durability. Make polite customized answers, don't invent numbers outside general solar reality.`;
    const contents = [];
    if (history && Array.isArray(history)) {
      history.forEach((turn) => {
        contents.push({
          role: turn.sender === "Customer" ? "user" : "model",
          parts: [{ text: turn.text }]
        });
      });
    }
    contents.push({
      role: "user",
      parts: [{ text: message }]
    });
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7
      }
    });
    res.json({ text: response.text });
  } catch (error) {
    console.error("Gemini chatbot error:", error);
    res.json({ text: `Hello! Sunchaser Smart Systems is currently operating in local fallback mode. Sunchaser Core stackable batteries offer custom 13.5kWh arrays.` });
  }
});
app.post("/api/gemini/sizing-recommendations", async (req, res) => {
  const { monthlyBill, roofSpace, shading, stateLocation, notes } = req.body;
  const userPrompt = `A customer is seeking customized solar sizing recommendations based on Sunchaser's product stack.
Inputs:
- Average Monthly electricity cost: $${monthlyBill}
- Available unshaded Roof Space: ${roofSpace} sq ft
- Level of shading: ${shading}
- Geographic Location: ${stateLocation || "California, USA"}
- Additional customer requirements/notes: "${notes || "None"}"

Please produce a comprehensive, structured response with these specific sections formatted beautifully with Markdown:
1. **Sizing Recommendation**: Recommend the optimal Solar Array Sizing in kW, estimated number of panels (assume 400W premium cells), and annual generation prediction.
2. **Product Sizing selection**: Select the exact Sunchaser Panel, Inverter setup, and Sunchaser Core Battery count.
3. **Financial Math & Savings Analysis**: Project the average upfront cost (estimate logically in $2.20/W to $2.80/W range), applying the custom 30% Federal Investment Tax Credit (ITC) deduction to output the net investment, yearly savings, and estimated ROI and payback years.
4. **On-Site Preparation Instructions**: Outline the immediate requirements Sunchaser's survey crew will inspect on-site.
Keep it highly readable, clear, encouraging, and tailored to Sunchaser premium solar systems.`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction: "You are Sunchaser's Lead Solar Engineer, delivering customized sizing and technical component configurations.",
        temperature: 0.2
      }
    });
    res.json({ recommendations: response.text });
  } catch (error) {
    console.error("Gemini solar sizing error:", error);
    res.json({
      recommendations: `### Private Sunchaser Solar Sizing Optimization
Based on your parameters, Sunchaser recommends:
- **Optimal System Size**: 7.2 kW Solar Panel Array (18 panels)
- **Technical Inverted Setup**: Enphase IQ8 Microinverters
- **Storage options**: 1x Sunchaser Core Battery (13.5 kWh)
- **Net Investment (after 30% ITC)**: $12,096
- **Yearly Saving Projections**: $1,980/year (Payback payback period is approximately 6.1 years)`
    });
  }
});
app.post("/api/gemini/generate-proposal", async (req, res) => {
  const { customerName, address, systemSizekW, batteryUpgrade, totalCost, notes } = req.body;
  const prompt = `Draft a formalized, highly elegant, professional Sunchaser Energy Systems Proposal contract blueprint for Client: **${customerName}** located at **${address || "Springfield"}**.
System profile:
- Sunchaser Tier: Premium Residential Solar Power Grid
- System capacity size: ${systemSizekW || "8.5"} kW Prime
- Storage Storage: ${batteryUpgrade ? "1x Sunchaser Core (13.5 kWh Stackable Battery)" : "None"}
- Estimated investment: $${totalCost || "19,500"}
- Tailored notes: "${notes || "Standard setup southward exposure."}"

Synthesize an immersive, detailed proposal document. It must be split structure:
- **EXECUTIVE LETTER OF ASSURANCE**: Signed by Sunchaser Solar Lead Design Partner.
- **SYSTEM HARDWARE SPECIFICATIONS**: Detailing customized monocrystalline high efficiency cell layouts, grid backup and micro-converter technology specifications.
- **SAVINGS TIMELINE & ROI**: Proving estimated long-term solar equity accretion, including the active 30% Federal tax deduction math.
- **PHASED TIMELINE OF INSTALLATION**: Detailing site survey, city permits, engineering structure, active mounting, utility net meter configuration, and official commissioning.
Use a professional, trustworthy energy partner voice. Formulate inside premium styled markdown structure.`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are the Executive Vice President of Project Approvals at Sunchaser Energy Systems, drafting tailored clean power proposals.",
        temperature: 0.3
      }
    });
    res.json({ proposalMarkdown: response.text });
  } catch (error) {
    console.error("Gemini proposal error:", error);
    res.json({
      proposalMarkdown: `# SUNCHASER CUSTOM SOLARENERGY PROPOSAL
**PREPARED FOR**: ${customerName} | **ADDRESS**: ${address || "Springfield"}

### Technical Sizing Specs
- **Solar Modules**: Sunchaser Ultra 400W premium cells (22 counts)
- **Inverters**: Enphase IQ8 sunlight-backup micro-converters
- **Core Battery**: 1x Sunchaser Core 13.5kWh smart storage

### Sunchaser Return Optimization
- Gross Base Cost: $${totalCost || "19,500"}. 
- Federal 30% Tax Credit (ITC): -$${(Number(totalCost || 19500) * 0.3).toFixed(2)}. 
- Net Solar Investment: $${(Number(totalCost || 19500) * 0.7).toFixed(2)}.`
    });
  }
});
if (!import_fs2.default.existsSync(BACKUPS_DIR)) {
  import_fs2.default.mkdirSync(BACKUPS_DIR, { recursive: true });
}
setInterval(async () => {
  try {
    let backupState = db;
    if (isSupabaseActive()) {
      backupState = await fetchAppStateFromSupabase();
    }
    const stamp = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const file = import_path2.default.join(BACKUPS_DIR, `sunchaser-backup-${stamp}.json`);
    import_fs2.default.writeFileSync(file, JSON.stringify(backupState, null, 2), "utf8");
    const list = import_fs2.default.readdirSync(BACKUPS_DIR).filter((f) => f.startsWith("sunchaser-backup-"));
    if (list.length > 10) {
      list.sort();
      import_fs2.default.unlinkSync(import_path2.default.join(BACKUPS_DIR, list[0]));
    }
  } catch (err) {
    console.error("[Database Backup Error]:", err.message);
  }
}, 24 * 60 * 60 * 1e3);
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});
app.get("/", (req, res) => {
  res.send("Sunchaser CRM backend running");
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path2.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path2.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Sunchaser Energy ERP] backend active. Intress routing Port ${PORT}`);
  });
}
startServer();
