import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import {
  isSupabaseActive,
  getSupabase,
  fetchAppStateFromSupabase,
  initialSeed,
  getDashboardStats,
  calculateLeadScore,
  Database,
  runDatabaseMigration
} from "./dbManager.js";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}
dotenv.config();

// Initialize Gemini SDK with telemetry header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "MOCK_KEY_FOR_TESTING",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
});

const app = express();
const PORT = 3000;

app.use(express.json());

// Custom CORS middleware to allow the frontend domain to call the backend API securely
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

// Production database requirement check
if (process.env.NODE_ENV === "production") {
  if (!isSupabaseActive()) {
    console.error(
      "\x1b[31m%s\x1b[0m",
      "🚨 [CRITICAL WARNING] Running Sunchaser CRM in PRODUCTION mode but Supabase is NOT active/configured! Falling back to local database.json fallback as emergency measure only. Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set."
    );
  } else {
    console.log(
      "\x1b[32m%s\x1b[0m",
      "✨ [Production Mode] Supabase production database is active and set as the primary database."
    );
  }
}

/* --- PERSISTENT FALLBACK FILE ARCHITECTURE --- */
const DB_FILE = path.join(process.cwd(), "database.json");
const BACKUPS_DIR = path.join(process.cwd(), "backups");

let db: Database = initialSeed;

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, "utf8");
      try {
        db = JSON.parse(content);
        // Ensure all objects/fields exist
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
        
        // Manual control panel supplementary schemas
        if (!db.solarPackages) {
          db.solarPackages = [
            { id: "sp-5kw", name: "Sunchaser 5kW Premium Suite", panelBrand: "Canadian Solar 400W", inverterBrand: "Enphase IQ8", batteryOption: "Tesla Powerwall 2", price: 12000, structureType: "Roofs", profitMargin: 0.25, enabled: true },
            { id: "sp-10kw", name: "Sunchaser 10kW Premium Suite", panelBrand: "Canadian Solar 400W", inverterBrand: "Enphase IQ8", batteryOption: "Tesla Powerwall Plus", price: 21000, structureType: "Roofs", profitMargin: 0.30, enabled: true },
            { id: "sp-15kw", name: "Sunchaser 15kW Premium Suite", panelBrand: "Canadian Solar 400W", inverterBrand: "Enphase IQ8", batteryOption: "Tesla Powerwall 3", price: 30000, structureType: "Ground Mount", profitMargin: 0.32, enabled: true }
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
                "ur": "پریمیم گیلوانائزڈ سٹینڈرڈ ماونٹنگ سٹرکچر (ایل تھری 14 گیج)، 130 کلومیٹر فی گھنٹہ تک ہوا کے خلاف مزاحم۔",
                "rate": 4800,
                "weight": "25 kg per panel frame",
                "materialType": "Galvanized L3 Steel 14 Gauge",
                "warranty": "10 Years Structural Warranty",
                "windRating": "130 km/h wind shear certified"
              },
              "elevated": {
                "en": "Premium Elevated Mounting Structure: Columns 62x125x3mm H Beam, Rafter:3\"x1.5\" Channel, Purlin:62x125x3mm H Beam, wind resistant up to 130 km/h.",
                "ur": "پریمیم ایلیویٹڈ ماونٹنگ سٹرکچر: کالمز 62x125x3mm ایچ بیم، رافٹر 3\"x1.5\" چینل، پرلن 62x125x3mm ایچ بیم۔ 130 کلومیٹر فی گھنٹہ تک ہوا کے خلاف مزاحم۔",
                "rate": 147600,
                "weight": "850 kg total weight",
                "materialType": "Hot-Dip Galvanized H-Beam & C-Channel Mughal Steel",
                "warranty": "15 Years Structural Warranty",
                "windRating": "130 km/h wind shear certified"
              },
              "girder": {
                "en": "Premium Mughal Girder Structure, 1600 grams per foot for heavy load and long spans. Wind-certified up to 150 km/h.",
                "ur": "پریمیم مغل گارڈر سٹرکچر، 1600 گرام فی فٹ مضبوطی اور طویل لائف کے لیے۔ 150 کلومیٹر فی گھنٹہ تک ہوا کے خلاف مزاحم۔",
                "rate": 180000,
                "weight": "1200 kg total weight",
                "materialType": "Heavy Gauge Hot-Rolled Mughal Girder & Channel",
                "warranty": "20 Years Structural Warranty",
                "windRating": "150 km/h wind shear certified"
              }
            },
            "boqMasterLibrary": [
              { "id": "panel_longi", "category": "Solar Panels", "brand": "Longi", "model": "Hi-MO X10 645W", "wattageCapacity": "645W", "unit": "Pcs", "costPrice": 22000, "salePrice": 25215, "warranty": "30 Years Warranty", "description": "Longi Tier 1 A+ Grade Monocrystalline solar panels" },
              { "id": "panel_jinko", "category": "Solar Panels", "brand": "Jinko", "model": "Tiger Neo 580W", "wattageCapacity": "580W", "unit": "Pcs", "costPrice": 18000, "salePrice": 21000, "warranty": "25 Years Warranty", "description": "Jinko N-Type high efficiency monocrystalline solar panels" },
              { "id": "panel_ja", "category": "Solar Panels", "brand": "JA Solar", "model": "DeepBlue 550W", "wattageCapacity": "550W", "unit": "Pcs", "costPrice": 17000, "salePrice": 19500, "warranty": "25 Years Warranty", "description": "JA Solar Tier-1 A+ Grade Monocrystalline cells" },
              { "id": "panel_canadian", "category": "Solar Panels", "brand": "Canadian Solar", "model": "BiHiKu7 600W", "wattageCapacity": "600W", "unit": "Pcs", "costPrice": 20000, "salePrice": 23000, "warranty": "25 Years Warranty", "description": "Canadian Solar Bifacial Dual-Glass Tier-1 modules" },
              { "id": "inverter_goodwe_10kw", "category": "Inverter", "brand": "Goodwe", "model": "10kW Hybrid", "wattageCapacity": "10kW", "unit": "Pcs", "costPrice": 360000, "salePrice": 400000, "warranty": "5 Years Local Warranty", "description": "Goodwe 10kW Hybrid Inverter Pure Sinewave smart grid" },
              { "id": "inverter_solis_10kw", "category": "Inverter", "brand": "Solis", "model": "10kW Hybrid", "wattageCapacity": "10kW", "unit": "Pcs", "costPrice": 350000, "salePrice": 400000, "warranty": "5 Years Local Warranty", "description": "Solis 10kW Hybrid Inverter Pure Sinewave smart grid" },
              { "id": "inverter_growatt_5kw", "category": "Inverter", "brand": "Growatt", "model": "5kW Hybrid", "wattageCapacity": "5kW", "unit": "Pcs", "costPrice": 180000, "salePrice": 220000, "warranty": "5 Years Local Warranty", "description": "Growatt 5kW Hybrid Inverter Pure Sinewave" },
              { "id": "inverter_goodwe_20kw", "category": "Inverter", "brand": "Goodwe", "model": "20kW On-grid", "wattageCapacity": "20kW", "unit": "Pcs", "costPrice": 240000, "salePrice": 280000, "warranty": "5 Years Warranty", "description": "Goodwe 20kW On-grid Smart Sync Inverter" },
              { "id": "battery_soluna_5kwh", "category": "Battery", "brand": "Soluna", "model": "Soluna 51V 5kWh", "wattageCapacity": "5kWh", "unit": "Pcs", "costPrice": 200000, "salePrice": 235000, "warranty": "10 Years Warranty", "description": "Soluna LiFePO4 Lithium deep discharge storage battery pack" },
              { "id": "battery_goodwe_pro", "category": "Battery", "brand": "Goodwe", "model": "PRO Lithium 5.4kWh", "wattageCapacity": "5.4kWh", "unit": "Pcs", "costPrice": 230000, "salePrice": 270000, "warranty": "10 Years Warranty", "description": "Goodwe PRO Lithium storage battery pack" },
              { "id": "cable_dc_4mm", "category": "Cables & Conductors", "brand": "GM/FAST", "model": "4 sq.mm DC Cable", "wattageCapacity": "N/A", "unit": "Meter", "costPrice": 200, "salePrice": 250, "warranty": "1 Year Free Service", "description": "4 sq.mm, 1C s/c CU/XLPE/PVC Double Insulated Tin Coated DC Cable" },
              { "id": "cable_dc_6mm", "category": "Cables & Conductors", "brand": "GM/FAST", "model": "6 sq.mm DC Cable", "wattageCapacity": "N/A", "unit": "Meter", "costPrice": 220, "salePrice": 280, "warranty": "1 Year Free Service", "description": "6 sq.mm, 1C s/c CU/XLPE/PVC Double Insulated Tin Coated DC Cable" },
              { "id": "cable_ac_copper", "category": "Cables & Conductors", "brand": "GM/FAST", "model": "AC Copper Cable", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 8000, "salePrice": 10000, "warranty": "1 Year Free Service", "description": "AC Copper flexible connection cable job" },
              { "id": "supplies_pvc", "category": "Ducts / Pipes / Conduits", "brand": "Beta/Equivalent", "model": "PVC Materials Job", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 12000, "salePrice": 18000, "warranty": "1 Year Free Service", "description": "All type of PVC material including pipes, elbows, connectors, joints, bends, clumps, PVC trunks/ducts" },
              { "id": "db_equipped", "category": "DB Boxes", "brand": "GADA/Chint", "model": "Equipped DB Box", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 25000, "salePrice": 32000, "warranty": "1 Year Free Service", "description": "Fine Powder Coated DB, Miniature Circuit Breakers (4Pole 63A & 2Pole 1000V), SPDs (40KA)" },
              { "id": "structure_std", "category": "Structure / Fabrication", "brand": "Mughal", "model": "Standard GI Structure L3", "wattageCapacity": "N/A", "unit": "Pcs", "costPrice": 4000, "salePrice": 4800, "warranty": "10 Years Warranty", "description": "Galvanized Iron Frame with Rawal Bolts (L3) 14 Gauge" },
              { "id": "structure_elv", "category": "Structure / Fabrication", "brand": "Mughal", "model": "Elevated Structure Spec", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 120000, "salePrice": 147600, "warranty": "15 Years Warranty", "description": "Elevated Structure H-Beam/C-Channel Mughal Steel mechanical work" },
              { "id": "structure_gdr", "category": "Structure / Fabrication", "brand": "Mughal", "model": "Mughal Girder Custom", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 150000, "salePrice": 180000, "warranty": "20 Years Warranty", "description": "Heavy Gauge Hot-Rolled Mughal Girder & Channel Frame" },
              { "id": "civil_works", "category": "Civil Works", "brand": "Local", "model": "Concrete Pillars Foundations", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 10000, "salePrice": 16000, "warranty": "N/A", "description": "Foundation Work for Structure pillars with concrete filling" },
              { "id": "installation_complete", "category": "Installation & Commissioning", "brand": "Sunchaser", "model": "Complete Installation", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 60000, "salePrice": 80000, "warranty": "1 Year Free Service", "description": "Installation of solar panels, electrical wiring, testing, and equipment commissioning" },
              { "id": "transportation_job", "category": "Transportation", "brand": "Local", "model": "Transportation & Logistics", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 8000, "salePrice": 10000, "warranty": "N/A", "description": "Transportation, logistics freight and manual lifting" },
              { "id": "net_metering_lesco", "category": "Net Metering", "brand": "LESCO", "model": "Net Metering Process", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 75000, "salePrice": 90000, "warranty": "N/A", "description": "LESCO three-phase net-metering licensing & demand notices processing" },
              { "id": "designing_testing", "category": "Survey / Designing / Testing", "brand": "Helios", "model": "Survey & Design Suite", "wattageCapacity": "N/A", "unit": "Job", "costPrice": 3000, "salePrice": 5000, "warranty": "N/A", "description": "Survey, Designing, Testing, Commissioning, Execution Project management" }
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

    // Run Supabase auto-migration in background if active
    if (isSupabaseActive()) {
      runDatabaseMigration(db).catch((err) => {
        console.error("Error running auto-migration in background:", err);
      });
    }
  } catch (err) {
    console.error("FS Read error inside loadDb:", err);
    db = initialSeed;
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("FS Write error inside saveDb:", err);
  }
}

loadDb();

/* --- AUDIT LOGGING & NOTIFICATION SYNC ACTIONS --- */
async function appendActivityLog(userId: string, userName: string, role: string, action: string, details: string) {
  const newLog = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
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
      const supabase = getSupabase()!;
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

async function triggerWhatsAppNotification(customerName: string, phone: string, eventType: string, messageText: string) {
  const newWa = {
    id: `wa-${Date.now()}`,
    timestamp: new Date().toISOString(),
    customerName,
    phone,
    eventType,
    messageText,
    status: "Delivered" as const
  };

  db.whatsAppLogs.unshift(newWa);
  saveDb();

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
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

/* --- REST SYSTEM API GATEWAYS --- */

// 1. Unified login endpoints
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
      const { data: users, error } = await supabase
        .from("users")
        .select("*")
        .eq("username", username.toLowerCase())
        .eq("password", password);

      if (error) throw error;

      if (users && users.length > 0) {
        const u = users[0];
        const userObj = { id: u.id, username: u.username, name: u.name, email: u.email, role: u.role };
        await appendActivityLog(u.id, u.name, u.role, "User Logged In", "Authorized access via Supabase PostgreSQL security clearance.");
        return res.json({ success: true, user: userObj });
      } else {
        return res.status(401).json({ error: "Invalid credentials. Sunchaser identity rejected." });
      }
    } catch (err: any) {
      console.error("[Supabase Login Error]:", err.message);
      return res.status(500).json({ error: `Supabase database error: ${err.message}` });
    }
  }

  // Fallback to local DB (runs only if Supabase is NOT active)
  const user = db.users.find(
    (u: any) => u.username.toLowerCase() === username.toLowerCase() && u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials. Sunchaser identity rejected." });
  }

  await appendActivityLog(user.id, user.name, user.role, "User Logged In", "Authorized access via local file persistence layout.");
  res.json({ success: true, user });
});

// 2. Fetch ERP system state
app.get("/api/state", async (req, res) => {
  if (isSupabaseActive()) {
    try {
      const stateObj = await fetchAppStateFromSupabase();
      return res.json({
        ...stateObj,
        stats: getDashboardStats(stateObj),
        currentUser: null
      });
    } catch (err: any) {
      console.error("[Supabase State Fetch Error]: Enforced primary db failure.", err.message);
      return res.status(500).json({ error: `Supabase database loading error: ${err.message}` });
    }
  }

  // Local fallback (runs only if Supabase is NOT active)
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
    quotations: db.quotations || []
  });
});

// 3. Create lead route with rating, scores and auto WhatsApp confirmation
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
  const newLead: any = {
    id: leadId,
    name: name || "Anonymous Lead",
    email: email || "no-email@example.com",
    phone: phone || "",
    address: address || "",
    status: "New",
    monthlyBill: Number(monthlyBill) || 150,
    monthlyUnits: Number(monthlyUnits) || Number(monthlyBill) * 4,
    sanctionedLoad: Number(sanctionedLoad) || 7,
    backupRequirement: backupRequirement || "None",
    location: location || "Springfield",
    roofType: roofType || "Asphalt Shingle",
    roofSpace: Number(roofSpace) || 800,
    shading: shading || "Medium",
    rating: 3,
    assignedSalesperson: "Sarah Connor",
    createdAt: new Date().toISOString(),
    notes: notes || "Submitted via Sunchaser Sizing Calculator.",
    leadSource: leadSource || "Self-registration Web Portal",
    engagementLevel: engagementLevel || "Medium",
    quotes: []
  };

  calculateLeadScore(newLead);

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
      const customerId = `cust-${leadId.replace("lead-", "")}`;

      // Insert Customer row
      await supabase.from("customers").insert({
        id: customerId,
        name: newLead.name,
        email: newLead.email,
        phone: newLead.phone,
        address: newLead.address
      });

      // Insert Lead row
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
    } catch (err: any) {
      console.error("[Supabase Lead Insertion Error]:", err.message);
    }
  }

  db.leads.push(newLead);
  saveDb();

  await appendActivityLog("guest", newLead.name, "Customer", "Lead Created", `Registered details profile for home assessment sizing.`);
  const msgText = `☀️ Hi ${newLead.name}! Sunchaser Energy has scheduled your structural solar survey. Our advisor Sarah Connor will coordinate framing loads and meter layout. Review options: http://sunchaser.co/portal`;
  await triggerWhatsAppNotification(newLead.name, newLead.phone, "survey_confirmation", msgText);

  res.status(201).json(newLead);
});

// 4. Update lead fields and re-compute score
app.put("/api/leads/:id", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const index = db.leads.findIndex((l: any) => l.id === id);
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
      const supabase = getSupabase()!;
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
    } catch (err: any) {
      console.error("[Supabase Lead Update Error]:", err.message);
    }
  }

  res.json(db.leads[index]);
});

// 5. Delegate salesperson assignment
app.put("/api/leads/:id/assign", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { salespersonName } = req.body;
  const lead = db.leads.find((l: any) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  lead.assignedSalesperson = salespersonName;
  saveDb();

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
      await supabase.from("leads").update({ assigned_salesperson: salespersonName }).eq("id", id);
    } catch (err: any) {
      console.error("[Supabase Reassign Error]:", err.message);
    }
  }

  await appendActivityLog("admin", "Super Admin", "Super Admin", "Lead Assigned", `Assigned lead ${lead.name} to salesperson ${salespersonName}`);
  res.json(lead);
});

// 6. Gemini AI Lead Scoring manual assessment
app.post("/api/leads/:id/ai-score", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const lead = db.leads.find((l: any) => l.id === id);
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
  } catch (err: any) {
    console.error("Gemini AI Lead Score error:", err);
    res.json({
      scoreAnalysis: `* **Closing Strategy**: Highlight the immediate 30% Federal Investment Tax Credit lowering total out-of-pocket costs on their sizing layout.
* **Technical Hotspots**: Shading index is currently logged as ${lead.shading}, suggesting Enphase Microinverters are mandatory to keep output optimal.`
    });
  }
});

// 7. Schedule site structural survey
app.post("/api/leads/:id/schedule-survey", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { scheduledDate } = req.body;
  const lead = db.leads.find((l: any) => l.id === id);
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
      const supabase = getSupabase()!;
      await supabase.from("leads").update({ status: "Survey Scheduled" }).eq("id", id);
      await supabase.from("site_surveys").upsert({
        lead_id: id,
        scheduled_date: scheduledDate,
        status: "Pending",
        notes: "Site visit confirmed via structural scheduler."
      }, { onConflict: "lead_id" });
    } catch (err: any) {
      console.error("[Supabase Survey Scheduling Error]:", err.message);
    }
  }

  await appendActivityLog("system", "Sales System", "CRM", "Survey Scheduled", `Scheduled site visit for ${lead.name} on ${scheduledDate}`);
  const msgText = `☀️ Confirmation booked! A Sunchaser technician is dispatched to audit framing pitch/meter panels on ${new Date(scheduledDate).toLocaleDateString()} at ${new Date(scheduledDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Keep pets indoors!`;
  await triggerWhatsAppNotification(lead.name, lead.phone, "survey_confirmation", msgText);

  res.json(lead);
});

// 7b. Send WhatsApp Follow-up Reminder
app.post("/api/leads/:id/whatsapp-reminder", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const lead = db.leads.find((l: any) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const msgText = `☀️ Hi ${lead.name}! Sarah Connor here from Sunchaser Energy. Just checking in to see if you had any questions on your custom solar sizing layout. Let us know if you would like to proceed or schedule a site survey!`;
  await triggerWhatsAppNotification(lead.name, lead.phone, "followup_reminder", msgText);

  await appendActivityLog("sales", "Sarah Connor", "Sales Executive", "Follow-up Reminded", `Dispatched WhatsApp follow-up reminder to ${lead.name}`);
  res.json({ success: true, lead });
});

// 7.5. Procure inventory stock (Purchase Order creation)
app.post("/api/inventory/procure", async (req, res) => {
  loadDb();
  const { vendor, itemId, quantity } = req.body;
  
  if (!vendor || !itemId || !quantity) {
    return res.status(400).json({ error: "Missing procurement inputs." });
  }

  // Initialize array if missing
  if (!db.purchaseOrders) {
    db.purchaseOrders = [];
  }

  // Find the SKU item in current database inventory list
  const item = db.inventory.find((i: any) => i.id === itemId);
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
    status: "Delivered", // Automated warehouse restock fulfillment upon creation
    date: new Date().toISOString().split("T")[0],
    cost
  };

  db.purchaseOrders.unshift(newPO);

  // Increase the stock of the actual item
  item.stock = Number(item.stock) + Number(quantity);
  saveDb();

  // If Supabase is active, synchronize the updated stock back to products_inventory table!
  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
      await supabase.from("products_inventory")
        .update({ stock: item.stock })
        .eq("id", itemId);
    } catch (err: any) {
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

// 8. Submit surveyor audit notes
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

  const lead = db.leads.find((l: any) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  lead.survey = {
    scheduledDate: lead.survey?.scheduledDate || new Date().toISOString(),
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
      const supabase = getSupabase()!;
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
    } catch (err: any) {
      console.error("[Supabase Survey Report Error]:", err.message);
    }
  }

  await appendActivityLog("surveyor", "Bob Surveyor", "Survey Engineer", "Survey Audited", `Submitted structural measurements & CAD panel positions for ${lead.name}`);
  res.json(lead);
});

// 9. Generate and write Quotation terms
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
    netTotal
  } = req.body;

  const lead = db.leads.find((l: any) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const quoteId = `q-${(lead.quotes || []).length + 1}`;
  const cost = Number(totalCost) || (Number(systemSizekW) * 19500 + (batteryCapacity ? 480000 : 0));
  const disc = Number(discount) || 0;
  const netCost = cost - disc;

  // Update lead demographics if they are modified
  if (clientName) lead.name = clientName;
  if (clientPhone) lead.phone = clientPhone;
  if (clientEmail) lead.email = clientEmail;
  if (clientAddress) lead.address = clientAddress;
  if (cityArea) lead.location = cityArea;
  if (bdmName) lead.assignedSalesperson = bdmName;

  const newQuote = {
    id: quoteId,
    systemSizekW: Number(systemSizekW) || 7.2,
    panelCount: Number(panelCount) || 18,
    panelType: panelType || "Longi 580W Panels",
    inverterType: inverterType || "Goodwe 20kW Inverter",
    batteryCapacity: batteryCapacity || "",
    totalCost: cost,
    federalTaxCredit: 0,
    netCost: netCost,
    estimatedAnnualSavings: Number((Number(systemSizekW) * 1400 * 35).toFixed(2)), // Rs 35 per unit
    paybackPeriodYears: Number((netCost / (Number(systemSizekW) * 1400 * 35)).toFixed(1)),
    status: "Pending" as const,
    createdAt: new Date().toISOString(),
    structureType: structureType || "Standard",
    accessories: accessories || "Dual DC cables, PVC ducting & safety switches",
    installationCharges: Number(installationCharges) || 75000,
    netMeteringCharges: Number(netMeteringCharges) || 90000,
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
    quoteDate: quoteDate || new Date().toISOString().split('T')[0],
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
    netTotal: Number(netTotal) || netCost
  };

  lead.quotes = [newQuote, ...(lead.quotes || [])];
  lead.status = "Quoted";
  saveDb();

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
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
      
      await supabase.from("quotations").insert({
        id: newQuote.id,
        lead_id: id,
        customer_id: customerId,
        system_size_kw: newQuote.systemSizekW,
        panel_count: newQuote.panelCount,
        panel_type: newQuote.panelType,
        inverter_type: newQuote.inverterType,
        battery_capacity: newQuote.batteryCapacity,
        total_cost: newQuote.totalCost,
        federal_tax_credit: 0,
        net_cost: newQuote.netCost,
        estimated_annual_savings: newQuote.estimatedAnnualSavings,
        payback_period_years: newQuote.paybackPeriodYears,
        status: newQuote.status,
        structure_type: newQuote.structureType,
        payment_terms: newQuote.paymentTerms,
        warranty_terms: newQuote.warrantyTerms,
        terms_and_conditions: newQuote.termsAndConditions
      });
    } catch (err: any) {
      console.error("[Supabase Create Quotation Error]:", err.message);
    }
  }

  await appendActivityLog("sales", bdmName || "Sarah Connor", "Sales Executive", "Quotation Written", `Formulated quote ${quoteId} for ${lead.name}`);
  const msgText = `☀️ Hi ${lead.name}! Sunchaser has unlocked your custom solar proposal: ${newQuote.systemSizekW} kW with ${newQuote.inverterType}. Total final cost is Rs. ${newQuote.netCost.toLocaleString()}. Open file: http://sunchaser.co/portal`;
  await triggerWhatsAppNotification(lead.name, lead.phone, "quote_generation", msgText);

  res.json(lead);
});

// 9b. Duplicate Quote endpoint
app.post("/api/leads/:id/duplicate-quote", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { quoteId } = req.body;
  const lead = db.leads.find((l: any) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const quoteToDup = lead.quotes?.find((q: any) => q.id === quoteId);
  if (!quoteToDup) return res.status(404).json({ error: "Quote not found" });

  const newQuoteId = `q-${(lead.quotes || []).length + 1}`;
  const duplicated = {
    ...quoteToDup,
    id: newQuoteId,
    status: "Pending",
    createdAt: new Date().toISOString(),
    quoteDate: new Date().toISOString().split('T')[0]
  };

  lead.quotes = [duplicated, ...(lead.quotes || [])];
  saveDb();
  res.json(lead);
});

// 10. Accept Quote & Auto-Provision trackers
app.post("/api/leads/:id/accept-quote", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { quoteId } = req.body;
  const lead = db.leads.find((l: any) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  lead.status = "Contracted";
  lead.quotes = lead.quotes.map((q: any) => {
    if (q.id === quoteId) q.status = "Accepted";
    else q.status = "Declined";
    return q;
  });

  const acceptedQuote = lead.quotes.find((q: any) => q.status === "Accepted");
  const sizeKw = acceptedQuote ? acceptedQuote.systemSizekW : 7.2;
  const costTotal = acceptedQuote ? acceptedQuote.totalCost : 17280;

  // 1. Project
  const projId = `project-${Date.now()}`;
  const newProject = {
    id: projId,
    leadId: lead.id,
    customerName: lead.name,
    address: lead.address,
    systemSizekW: sizeKw,
    stage: "Advance Received" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.projects.unshift(newProject);

  // 2. Installation Setup
  lead.installation = {
    status: "Scheduled",
    scheduledDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
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

  // 3. Net Meter
  db.netMeteringTrackers[lead.id] = {
    leadId: lead.id,
    documentsCollected: true,
    applicationSubmitted: true,
    discoInspection: false,
    demandNotice: false,
    meterInstallation: false,
    greenMeterActive: false
  };

  // 4. Payments
  const advanceAmt = Number((costTotal * 0.3).toFixed(2));
  db.paymentTracks[lead.id] = {
    leadId: lead.id,
    totalValue: costTotal,
    advanceReceived: advanceAmt,
    pendingAmount: costTotal - advanceAmt,
    reminderSent: false,
    invoiceStatus: "Pending",
    milestones: [
      { name: "30% Sign-up Advance", amount: advanceAmt, status: "Paid", dueDate: new Date().toISOString().split("T")[0] },
      { name: "30% Structural Engineering Approval", amount: advanceAmt, status: "Pending", dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] },
      { name: "30% Panel Arrays Completed", amount: advanceAmt, status: "Pending", dueDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] },
      { name: "10% Utility Interconnection Active", amount: Number((costTotal * 0.1).toFixed(2)), status: "Pending", dueDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] }
    ]
  };

  saveDb();

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
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
    } catch (err: any) {
      console.error("[Supabase Quote Acceptance Error]:", err.message);
    }
  }

  await appendActivityLog(lead.id, lead.name, "Customer", "Contract Signed", `Signed blueprint quotation, paid 30% advance retainer of $${advanceAmt}`);
  const sText = `☀️ Contract signed! We have received your solar retainer advance core of $${advanceAmt}. Sunchaser structural designers are preparing engineering submittals for city review. Track: http://sunchaser.co/portal`;
  await triggerWhatsAppNotification(lead.name, lead.phone, "contract_signed", sText);

  res.json(lead);
});

// 11. Update installer progress log tasks
app.post("/api/leads/:id/update-installation", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { progress, tasks, status, completionPhotos, report } = req.body;
  const lead = db.leads.find((l: any) => l.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  if (lead.installation) {
    if (progress !== undefined) lead.installation.progress = Number(progress);
    if (tasks !== undefined) lead.installation.tasks = tasks;
    if (status !== undefined) lead.installation.status = status;
    if (completionPhotos !== undefined) lead.installation.completionPhotos = completionPhotos;
    if (report !== undefined) lead.installation.report = report;

    const proj = db.projects.find((p: any) => p.leadId === lead.id);
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
      proj.updatedAt = new Date().toISOString();
    }
  }

  saveDb();

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
      if (lead.installation?.tasks) {
        for (const t of lead.installation.tasks) {
          await supabase.from("installation_tasks").update({ done: t.done }).eq("id", `${id}-${t.id}`);
        }
      }

      const proj = db.projects.find((p: any) => p.leadId === id);
      if (proj) {
        await supabase.from("projects").update({ stage: proj.stage, updated_at: proj.updatedAt }).eq("id", proj.id);
      }
      if (lead.installation?.progress === 100) {
        await supabase.from("leads").update({ status: "Installed" }).eq("id", id);
      }
    } catch (err: any) {
      console.error("[Supabase Installation Update Error]:", err.message);
    }
  }

  await appendActivityLog("installer", "Dave Installer", "Installation Team", "Installation Status Adjusted", `Adjusted progress to ${progress}%`);
  res.json(lead);
});

// 12. Support tickets management
app.post("/api/tickets", async (req, res) => {
  loadDb();
  const { customerName, email, subject, description, priority } = req.body;
  const newTicket = {
    id: `ticket-${100 + db.tickets.length + 1}`,
    customerName: customerName || "Anonymous Customer",
    email: email || "john.miller@gmail.com",
    subject: subject || "Solar General Inquiry",
    description: description || "",
    status: "Open" as const,
    priority: priority || ("Medium" as const),
    createdAt: new Date().toISOString(),
    messages: [
      { sender: "Customer" as const, text: description, time: new Date().toISOString() }
    ]
  };

  db.tickets.unshift(newTicket);
  saveDb();

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
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
    } catch (err: any) {
      console.error("[Supabase Create Ticket Error]:", err.message);
    }
  }

  await appendActivityLog("guest", newTicket.customerName, "Customer", "Support Ticket Raised", `Opened concern: "${newTicket.subject}"`);
  res.status(201).json(newTicket);
});

// WhatsApp reply integration within support ticket dialog
app.post("/api/tickets/:id/reply", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { text, sender } = req.body;
  const ticket = db.tickets.find((t: any) => t.id === id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  ticket.messages.push({
    sender: sender || "Agent",
    text,
    time: new Date().toISOString()
  });

  if (sender === "Agent") {
    ticket.status = "In Progress";
  }
  saveDb();

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
      await supabase.from("support_tickets").update({
        messages: JSON.stringify(ticket.messages),
        status: ticket.status
      }).eq("id", id);
    } catch (err: any) {
      console.error("[Supabase Message Post Error]:", err.message);
    }
  }

  if (sender === "Agent") {
    const lead = db.leads.find((l: any) => l.email.toLowerCase() === ticket.email.toLowerCase());
    if (lead) {
      const msgText = `☀️ Support Update! Sunchaser engineering has answered your tickets dashboard concern titled (${ticket.subject}): "${text.slice(0, 60)}..." View: http://sunchaser.co/portal`;
      await triggerWhatsAppNotification(lead.name, lead.phone, "ticket_update", msgText);
    }
  }

  await appendActivityLog("system", sender || "System", sender === "Agent" ? "Sales Executive" : "Customer", "Ticket Reply Added", `Registered response message within support thread ${ticket.id}`);
  res.json(ticket);
});

app.put("/api/tickets/:id/resolve", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const ticket = db.tickets.find((t: any) => t.id === id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  ticket.status = "Resolved";
  saveDb();

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
      await supabase.from("support_tickets").update({ status: "Resolved" }).eq("id", id);
    } catch (err: any) {
      console.error("[Supabase Resolve Ticket Error]:", err.message);
    }
  }

  await appendActivityLog("admin", "Alex Admin", "Super Admin", "Support Ticket Solved", `Resolved ticket ${ticket.id}`);
  res.json(ticket);
});

/* --- MULTI-BUSINESS NEW SERVICES ENDPOINTS --- */

// A. Placed orders
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
    createdAt: new Date().toISOString(),
    installationRequired: !!installationRequired
  };

  db.orders.unshift(newOrder);

  // If order is successful, let's create a notification and audit log
  const newNotif = {
    id: `NT-${Date.now().toString().slice(-6)}`,
    customerName: newOrder.customerName,
    message: `New multi-business order ${newOrder.id} placed for ${newOrder.items.map((i: any) => i.productName).join(", ")}.`,
    type: "new_order" as const,
    createdAt: new Date().toISOString(),
    read: false
  };
  db.notifications.unshift(newNotif);
  saveDb();

  await appendActivityLog("customer", newOrder.customerName, "Customer", "New Order Placed", `Created order ${newOrder.id} with total value of $${totalCost.toLocaleString()}`);
  res.status(201).json(newOrder);
});

// B. Update order status
app.post("/api/orders/:id/status", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { status, remarks } = req.body;
  const order = db.orders.find((o: any) => o.id === id);
  if (!order) return res.status(404).json({ error: "Order not found." });

  order.status = status;
  
  // If order status is marked "Delivered" and installation is required, we can automatically register a warranty!
  if (status === 'Delivered') {
    const defaultSerial = `SN-${(order.items[0]?.productId || "PROD").toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`;
    
    const matchingProduct = db.products.find((p: any) => p.id === order.items[0]?.productId || p.sku === order.items[0]?.productId);
    const wPeriod = matchingProduct ? matchingProduct.warrantyPeriod : "2 Years";
    const years = parseInt(wPeriod) || 2;
    const end = new Date();
    end.setFullYear(end.getFullYear() + years);

    const newWarranty = {
      id: `WAR-${Date.now().toString().slice(-6)}`,
      customerName: order.customerName,
      email: order.email,
      productName: order.items[0]?.productName || "Sunchaser Product",
      productSku: order.items[0]?.productId || "SC-PROD",
      serialNumber: defaultSerial,
      startDate: new Date().toISOString(),
      endDate: end.toISOString(),
      installationDate: new Date().toISOString(),
      status: "Active" as const,
      claimHistory: []
    };
    db.warranties.unshift(newWarranty);

    const newNotif = {
      id: `NT-${Date.now().toString().slice(-6)}`,
      customerName: order.customerName,
      message: `Warranty coverage activated for ${newWarranty.productName}. Serial: ${newWarranty.serialNumber}`,
      type: "order_delivered" as const,
      createdAt: new Date().toISOString(),
      read: false
    };
    db.notifications.unshift(newNotif);
  }

  saveDb();
  await appendActivityLog("admin", "Alex Admin", "Super Admin", "Order Status Updated", `Adjusted order ${id} status to ${status}. Remarks: ${remarks || "None"}`);
  res.json(order);
});

// C. Register advanced complaint ticket
app.post("/api/tickets/advanced", async (req, res) => {
  loadDb();
  const { customerName, email, subject, description, priority, productSelection, photos, videos, voiceNoteUrl, location, preferredVisitTime } = req.body;
  
  const newTicket = {
    id: `ticket-${100 + db.tickets.length + 1}`,
    customerName: customerName || "Anonymous Customer",
    email: email || "john.miller@gmail.com",
    subject: subject || "Device complaint",
    description: description || "",
    status: "New" as const,
    priority: priority || "Medium" as const,
    createdAt: new Date().toISOString(),
    messages: [
      { sender: "Customer", text: `Raised Complaint for ${productSelection || "Product"}: ${description}`, time: new Date().toISOString() }
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
    type: "new_complaint" as const,
    createdAt: new Date().toISOString(),
    read: false
  };
  db.notifications.unshift(newNotif);

  saveDb();
  await appendActivityLog("guest", newTicket.customerName, "Customer", "Advanced Complaint Ticket Raised", `Registered concern for ${productSelection}: ${newTicket.subject}`);
  res.status(201).json(newTicket);
});

// D. Assign technician to ticket
app.post("/api/tickets/:id/tech-assign", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { technicianName, internalNotes } = req.body;
  const ticket = db.tickets.find((t: any) => t.id === id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });

  ticket.assignedTechnician = technicianName;
  ticket.status = "Technician Assigned";
  if (internalNotes) ticket.internalNotes = internalNotes;

  const newNotif = {
    id: `NT-${Date.now().toString().slice(-6)}`,
    customerName: ticket.customerName,
    message: `Technician assigned to concern ${ticket.id}: ${technicianName}`,
    type: "technician_assigned" as const,
    createdAt: new Date().toISOString(),
    read: false
  };
  db.notifications.unshift(newNotif);

  saveDb();
  await appendActivityLog("admin", "Sam Support", "Support Agent", "Technician Assigned", `Delegated technician "${technicianName}" to ticket ${id}`);
  res.json(ticket);
});

// E. Technician resolution mark
app.post("/api/tickets/:id/tech-resolve", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { resolutionText, resolutionProofUrl } = req.body;
  const ticket = db.tickets.find((t: any) => t.id === id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });

  ticket.status = "Resolved";
  ticket.resolutionProofUrl = resolutionProofUrl || "";
  ticket.messages.push({
    sender: "Agent",
    text: `Technician Job Resolution Dispatch: ${resolutionText}. Proof Photo: ${resolutionProofUrl || "None provided"}`,
    time: new Date().toISOString()
  });

  saveDb();
  await appendActivityLog("technician", ticket.assignedTechnician || "Dave Installer", "Technician", "Complaint Resolved by Tech", `Dispatched final resolution of concern ${id}`);
  res.json(ticket);
});

// F. Claim warranty coverage
app.post("/api/warranties/:id/claims", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { issueTitle, description } = req.body;
  const warranty = db.warranties.find((w: any) => w.id === id);
  if (!warranty) return res.status(404).json({ error: "Warranty record not found." });

  const newClaim = {
    claimId: `CLM-${Date.now().toString().slice(-4)}`,
    claimDate: new Date().toISOString(),
    issueTitle,
    description,
    status: "Pending" as const
  };

  warranty.claimHistory.push(newClaim);

  const newNotif = {
    id: `NT-${Date.now().toString().slice(-6)}`,
    customerName: warranty.customerName,
    message: `Warranty claim ${newClaim.claimId} submitted for ${warranty.productName}.`,
    type: "new_complaint" as const,
    createdAt: new Date().toISOString(),
    read: false
  };
  db.notifications.unshift(newNotif);

  saveDb();
  await appendActivityLog("customer", warranty.customerName, "Customer", "Warranty Claim Raised", `Raised claim ${newClaim.claimId} for ${warranty.productName}`);
  res.status(201).json(warranty);
});

// G. Accept/reject claims
app.post("/api/warranties/:id/claims/:claimId/status", async (req, res) => {
  loadDb();
  const { id, claimId } = req.params;
  const { status, resolutionNotes } = req.body;
  const warranty = db.warranties.find((w: any) => w.id === id);
  if (!warranty) return res.status(404).json({ error: "Warranty record not found." });

  const claim = warranty.claimHistory.find((c: any) => c.claimId === claimId);
  if (!claim) return res.status(404).json({ error: "Claim not found." });

  claim.status = status;
  if (resolutionNotes) claim.resolutionNotes = resolutionNotes;

  saveDb();
  await appendActivityLog("admin", "Alice Admin", "Admin", "Warranty Claim Status Updated", `Setting claim ${claimId} status of ${warranty.productName} to ${status}`);
  res.json(warranty);
});

// H. Read notifications
app.post("/api/notifications/:id/read", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const notif = db.notifications.find((n: any) => n.id === id);
  if (notif) {
    notif.read = true;
    saveDb();
  }
  res.json({ success: true });
});

// 13. Update manual Project stages
app.post("/api/projects/:id/update-stage", async (req, res) => {
  loadDb();
  const { id } = req.params;
  const { stage } = req.body;
  const project = db.projects.find((p: any) => p.id === id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  project.stage = stage;
  project.updatedAt = new Date().toISOString();

  // Sync payments milestones
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
      payment.milestones.forEach((m: any) => (m.status = "Paid"));
    }
  }

  const lead = db.leads.find((l: any) => l.id === project.leadId);
  if (lead) {
    if (stage === "Completed") {
      lead.status = "Installed";
      if (lead.installation) lead.installation.progress = 100;
    }
  }

  saveDb();

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
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
    } catch (err: any) {
      console.error("[Supabase Stage Sync Error]:", err.message);
    }
  }

  await appendActivityLog("installer", "Installation Manager", "Installation Team", "Project Staged", `Adjourned project ${project.id} milestones to ${stage}`);
  res.json(project);
});

// 14. Update Net Metering Tracker checklist
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
      const supabase = getSupabase()!;
      const updateData = req.body;
      const dbObj: any = {};
      if (updateData.documentsCollected !== undefined) dbObj.documents_collected = updateData.documentsCollected;
      if (updateData.applicationSubmitted !== undefined) dbObj.application_submitted = updateData.applicationSubmitted;
      if (updateData.discoInspection !== undefined) dbObj.disco_inspection = updateData.discoInspection;
      if (updateData.demandNotice !== undefined) dbObj.demand_notice = updateData.demandNotice;
      if (updateData.meterInstallation !== undefined) dbObj.meter_installation = updateData.meterInstallation;
      if (updateData.greenMeterActive !== undefined) dbObj.green_meter_active = updateData.greenMeterActive;

      await supabase.from("net_metering_trackers").update(dbObj).eq("lead_id", leadId);
    } catch (err: any) {
      console.error("[Supabase Net Meter Update Error]:", err.message);
    }
  }

  await appendActivityLog("installer", "Installation Manager", "Installation Team", "Grid Connected", `Adjusted interconnection progress checkpoints for customer ${leadId}`);
  res.json(db.netMeteringTrackers[leadId]);
});

// 15. Push individual Paid Milestones payments
app.post("/api/payments/:leadId/milestone", async (req, res) => {
  loadDb();
  const { leadId } = req.params;
  const { milestoneName, status } = req.body;
  const payTrack = db.paymentTracks[leadId];
  if (!payTrack) return res.status(404).json({ error: "Payments profile not found" });

  const milestone = payTrack.milestones.find((m: any) => m.name === milestoneName);
  if (milestone) {
    milestone.status = status;

    const paidSum = payTrack.milestones
      .filter((m: any) => m.status === "Paid")
      .reduce((sum: number, m: any) => sum + m.amount, 0);

    payTrack.advanceReceived = paidSum;
    payTrack.pendingAmount = payTrack.totalValue - paidSum;

    if (payTrack.pendingAmount === 0) payTrack.invoiceStatus = "Paid";
    else if (paidSum > 0) payTrack.invoiceStatus = "Pending";
  }

  saveDb();

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
      await supabase.from("payments").update({
        advance_received: payTrack.advanceReceived,
        pending_amount: payTrack.pendingAmount,
        invoice_status: payTrack.invoiceStatus,
        milestones: JSON.stringify(payTrack.milestones)
      }).eq("lead_id", leadId);
    } catch (err: any) {
      console.error("[Supabase Payments Milestone Sync Error]:", err.message);
    }
  }

  await appendActivityLog("manager", "Sarah Manager", "Sales Manager", "Milestones Paid", `Adjusted payments invoice milestone status of ${leadId}`);
  res.json(payTrack);
});

// Generic Manual Admin CRUD Database manager endpoint
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
      const idx = db[table].findIndex((item: any) => item.id === id);
      if (idx !== -1) {
        db[table][idx] = { ...db[table][idx], ...data };
      }
    } else if (action === "delete") {
      db[table] = db[table].filter((item: any) => item.id !== id);
    }
  }

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
      if (table === "settings" || table === "websiteContent") {
        const dbTable = table === "settings" ? "settings" : "website_content";
        const { error } = await supabase.from(dbTable).upsert({ key: "global", value: data }, { onConflict: "key" });
        if (error) console.error(`[Supabase manual ${table} sync error]:`, error.message);
      } else {
        let pgTable = "";
        let mappedData: any = null;

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
            order_date: data.orderDate || data.date || new Date().toISOString(),
            total_cost: Number(data.totalCost || data.cost || 0),
            status: data.status || "Pending",
            items: data.items || []
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
    } catch (err: any) {
      console.error(`[Supabase Generic Sync ${table} Error]:`, err.message);
    }
  }

  saveDb();
  await appendActivityLog("admin", "Alex Admin", "Super Admin", `Manual Database Modifier`, `Action: ${action} on table: ${table} with id: ${id || "Bulk Content"}`);
  res.json({ success: true, table, count: Array.isArray(db[table]) ? db[table].length : 1 });
});

// 16. EXCEL / CSV Export endpoint
app.get("/api/export/:table", async (req, res) => {
  let activeState: Database = db;

  if (isSupabaseActive()) {
    try {
      activeState = await fetchAppStateFromSupabase();
    } catch (err: any) {
      console.error("Backup to local export due to Supabase retrieval crash:", err.message);
    }
  }

  const { table } = req.params;
  let headers: string[] = [];
  let rows: any[] = [];

  if (table === "leads") {
    headers = ["Lead ID", "Name", "Email", "Phone", "Status", "Contract Value", "Engagement", "AI Score", "Acquisition Source", "Sales Advisor", "Creation Date"];
    rows = activeState.leads.map((l: any) => {
      const acceptedQuote = l.quotes?.find((q: any) => q.status === "Accepted");
      const amtVal = acceptedQuote ? acceptedQuote.totalCost : (l.quotes?.[0]?.totalCost || 0);
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
    rows = activeState.leads.map((l: any) => {
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
    rows = activeState.projects.map((p: any) => [
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
  res.attachment(`sunchaser-${table}-${new Date().toISOString().split("T")[0]}.csv`);
  res.send(csvContent);
});

// 17. BACKUP & ARCHIVING EXPORT (Daily and Manual triggers)
app.get("/api/backup/export", async (req, res) => {
  try {
    let backupState: Database = db;
    if (isSupabaseActive()) {
      backupState = await fetchAppStateFromSupabase();
    }
    res.json(backupState);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate system backup", details: err.message });
  }
});

// 18. PDF Export Renderer
app.get("/api/export/pdf/:leadId", async (req, res) => {
  try {
    let activeState: Database = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }

    const lead = activeState.leads.find((l: any) => l.id === req.params.leadId);
    if (!lead) return res.status(404).send("Document lead not found.");

    // Retrieve active quote by query param, fallback to first quote
    const quoteId = req.query.quoteId;
    let quoteObj = null;
    if (quoteId) {
      quoteObj = lead.quotes?.find((q: any) => q.id === quoteId);
    }
    if (!quoteObj) {
      quoteObj = lead.quotes?.[0];
    }

    // Default quote fallback if lead has no quotes
    if (!quoteObj) {
      quoteObj = {
        id: "q-default",
        systemSizekW: 10,
        panelCount: 18,
        panelType: "Jinko 580W Panels",
        inverterType: "Knox 10kW Inverter",
        batteryCapacity: "",
        totalCost: 1500000,
        netCost: 1500000,
        estimatedAnnualSavings: 350000,
        paybackPeriodYears: 4.2,
        status: "Pending",
        createdAt: new Date().toISOString(),
        structureType: "Standard",
        clientName: lead.name,
        clientPhone: lead.phone,
        clientEmail: lead.email,
        clientAddress: lead.address,
        cnic: "",
        cityArea: lead.location || "Lahore",
        bdmName: lead.assignedSalesperson || "Sarah Connor",
        quoteDate: new Date().toISOString().split('T')[0],
        systemType: "Hybrid",
        panelBrand: "Jinko",
        panelWattage: 580,
        inverterBrand: "Knox",
        inverterCapacity: "10kW",
        batteryOption: "None",
        netMeteringRequired: "Yes",
        discount: 0,
        paymentSchedule: "50% Advance, 40% Delivery, 10% Commissioning",
        boqItems: [],
        lescoSettings: { meterNo: "", consumerNo: "", sanctionedLoad: "", phaseType: "Three Phase" },
        societyCharges: 0,
        taxEnabled: false,
        taxRate: 17,
        taxAmount: 0,
        selectedStructure: "standard",
        boqRows: [],
        customNotes: "",
        grandTotal: 1500000,
        netTotal: 1500000
      };
    }

    const settings = activeState.settings || {
      companyName: "Sunchaser Energy",
      phoneNumber: "0309-0236666",
      whatsAppNumber: "0330-7776444",
      officeAddress: "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore",
      phoneNumbers: "0309-0236666, 0330-7776444",
      termsAndConditionsList: [
        "Quotation validity: 3 days from date of issuance.",
        "Rates are based on current fiscal/DISCO tariffs and duties. Any change will affect the net final price.",
        "Standard Payment schedule: 50% Advance, 40% on delivery of equipment, 10% post-commissioning.",
        "Accepted Payment methods: Bank transfer, pay order, or direct bank deposit.",
        "Work will commence within 3 days after receipt of the advance payment.",
        "Product substitution: In case of hardware supply limitations, Sunchaser may substitute components with equivalent grade models.",
        "Installation standards: All electrical and mechanical works follow Sunchaser's ISO quality controls.",
        "Client interference: Any on-site construction delays caused by the client will affect the completion timeline.",
        "Grid connection: Net metering facilitation requires valid property documents and sanctioned load compliance.",
        "System earthing: Dedicated chemical earthing bores will be created for DC, AC, and frame grounding safety.",
        "Smart online monitoring: Active monitoring requires stable client Wi-Fi connection at the inverter site.",
        "Wi-Fi requirement: Customer must provide stable continuous Wi-Fi access for monitoring data synch.",
        "Client scope of work: Providing masonry work access, temporary electricity & water during construction.",
        "Civil work exclusions: Cutting of structural concrete slabs or custom aesthetic tiles is excluded unless quoted.",
        "Net metering clearance remains the client's responsibility if document verification faults occur.",
        "Panel washing advisory: Clean arrays bi-weekly for optimal generation yield performance.",
        "Force majeure: Sunchaser is not liable for delays caused by national strikes, weather anomalies, or utility board freezes."
      ]
    };

    // Load BOQ rows from quoteObj
    const boq = quoteObj.boqRows || quoteObj.boqItems || [];

    // Date Calculations
    const qDate = quoteObj.quoteDate ? new Date(quoteObj.quoteDate) : new Date();
    const validityDate = new Date(qDate.getTime() + 3 * 24 * 60 * 60 * 1000);
    const expiryDateString = validityDate.toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' });
    const quoteDateString = qDate.toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' });

    // PKR Formatting helper
    const formatPKR = (val: number) => {
      if (val === undefined || val === null || isNaN(val)) return "Rs. 0";
      return "Rs. " + Math.round(val).toLocaleString("en-US");
    };

    // Sequential manual BOQ HTML compilation (Page 6)
    let boqHtml = "";
    let localGrossCalculated = 0;

    if (boq.length > 0) {
      boq.forEach((row: any) => {
        if (row.type === 'heading') {
          boqHtml += `
            <tr style="background-color: #f1f5f9; font-weight: 700; color: #0f172a; border-bottom: 2px solid #cbd5e1;">
              <td colspan="7" style="padding: 6px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; font-family: 'Inter', sans-serif;">${row.name}</td>
            </tr>
          `;
        } else if (row.type === 'subtotal') {
          boqHtml += `
            <tr style="border-bottom: 2px solid #e2e8f0; font-weight: 750; background-color: #f8fafc; font-size: 10px;">
              <td colspan="6" style="padding: 6px 10px; text-align: right; color: #475569; text-transform: uppercase;">${row.name || 'SUBTOTAL'}:</td>
              <td style="padding: 6px 10px; text-align: right; color: #0f172a; font-weight: 800;">${formatPKR(row.total)}</td>
            </tr>
          `;
        } else {
          localGrossCalculated += Number(row.total) || 0;
          boqHtml += `
            <tr style="border-bottom: 1px solid #e2e8f0; font-size: 9.5px;">
              <td style="padding: 5px 10px; text-align: center; color: #64748b;">${row.srNo || ''}</td>
              <td style="padding: 5px 10px; font-weight: 600; color: #0f172a;">${row.name}</td>
              <td style="padding: 5px 10px; color: #475569; font-size: 9px; line-height: 1.3;">${row.description || ''}</td>
              <td style="padding: 5px 10px; text-align: center; color: #475569;">${row.unit || 'Nos'}</td>
              <td style="padding: 5px 10px; text-align: center; font-weight: 500;">${row.qty}</td>
              <td style="padding: 5px 10px; text-align: right; color: #475569;">${formatPKR(row.rate)}</td>
              <td style="padding: 5px 10px; text-align: right; font-weight: 600; color: #0f172a;">${formatPKR(row.total)}</td>
            </tr>
          `;
        }
      });
    } else {
      boqHtml += `
        <tr>
          <td colspan="7" style="padding: 20px; text-align: center; color: #94a3b8;">No BOQ items loaded. Please configure quote builder.</td>
        </tr>
      `;
    }

    const grossTotal = quoteObj.grandTotal || localGrossCalculated;
    const discountAmount = Number(quoteObj.discount) || 0;
    const societyCharges = Number(quoteObj.societyCharges) || 0;
    const taxEnabled = !!quoteObj.taxEnabled;
    const taxRate = Number(quoteObj.taxRate) || 0;
    const taxAmount = Number(quoteObj.taxAmount) || 0;
    const finalNetPrice = quoteObj.netTotal || (grossTotal - discountAmount + societyCharges + taxAmount);

    // Terms split across Page 7 & Page 8
    const tcList = settings.termsAndConditionsList || [];
    let tcPage1Html = "";
    let tcPage2Html = "";
    tcList.forEach((clause: string, index: number) => {
      const formattedClause = `
        <div style="display: flex; margin-bottom: 12px; font-size: 11px; line-height: 1.5; align-items: flex-start;">
          <span style="font-weight: 800; color: #d97706; margin-right: 8px; min-width: 22px;">${index + 1}.</span>
          <span style="color: #334155; font-weight: 500;">${clause}</span>
        </div>
      `;
      if (index < 9) {
        tcPage1Html += formattedClause;
      } else {
        tcPage2Html += formattedClause;
      }
    });

    // Structure model mapping & graphics for Page 5
    const selectedStructKey = String(quoteObj.selectedStructure || quoteObj.structureType || "standard").toLowerCase();
    
    // Retrieve structure details from settings seeds
    const structDetails = (activeState.settings?.structureDescriptions?.[selectedStructKey]) || {
      en: "Premium Galvanized Mounting Structure, wind resistant up to 130 km/h.",
      ur: "پریمیم گیلوانائزڈ ماونٹنگ سٹرکچر، 130 کلومیٹر فی گھنٹہ تک ہوا کے خلاف مزاحم۔",
      weight: "Standard Frame",
      materialType: "Galvanized L3 Steel",
      warranty: "10 Years Warranty",
      windRating: "130 km/h"
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

    // 8 Bank Accounts (Page 10)
    const official8BankAccounts = [
      { "title": "SUNCHASER ENERGY", "bankName": "Allied Bank Limited", "accountNo": "04190010112276940012", "iban": "PK81ABPA0010112276940012", "isAlternate": false },
      { "title": "AL ADAM", "bankName": "Bank Alfalah Limited", "accountNo": "55265001858603", "iban": "PK12ALFH5526005001858603", "isAlternate": false },
      { "title": "SIGNALS GLOBAL", "bankName": "Allied Bank Limited", "accountNo": "09090010112284650035", "iban": "N/A", "isAlternate": false },
      { "title": "HELIOS SOLAR ENERGY", "bankName": "Meezan Bank Limited", "accountNo": "02490109527492", "iban": "PK49MEZN0002490109527492", "isAlternate": false },
      { "title": "HELIOS SOLAR ENERGY", "bankName": "Standard Chartered Bank", "accountNo": "1702559001", "iban": "PK91SCBL0000001702559001", "isAlternate": false },
      { "title": "HELIOS SOLAR ENERGY", "bankName": "United Bank Limited", "accountNo": "1305307203838", "iban": "PK93UNIL0109000307203838", "isAlternate": false },
      { "title": "HELIOS SOLAR ENERGY", "bankName": "Habib Metropolitan Bank", "accountNo": "6121020301714129916", "iban": "PK42MPBL1210067140129916", "isAlternate": false },
      { "title": "HELIOS SOLAR ENERGY", "bankName": "Bank Al Habib Limited", "accountNo": "03440981001290017", "iban": "PK62BAHL0344098100129001", "isAlternate": false }
    ];

    const activeBankAccounts = activeState.settings?.bankAccounts && activeState.settings.bankAccounts.length >= 8 
      ? activeState.settings.bankAccounts 
      : official8BankAccounts;

    let bankAccountsHtml = `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px;">`;
    activeBankAccounts.forEach((acc: any, index: number) => {
      bankAccountsHtml += `
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; font-size: 11px; line-height: 1.45;">
          <div style="font-weight: 800; font-size: 12px; color: #0f172a; border-bottom: 2px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span>${index + 1}. ${acc.bankName}</span>
            <span style="font-size: 7.5px; font-weight: 700; color: #047857; background-color: #d1fae5; padding: 1px 6px; border-radius: 9999px; text-transform: uppercase;">Verify Direct</span>
          </div>
          <div style="color: #475569;"><strong>Account Title:</strong> <span style="color: #0f172a; font-weight: 600;">${acc.title}</span></div>
          <div style="color: #475569;"><strong>Account Number:</strong> <span style="color: #0f172a; font-weight: 600; font-family: monospace; font-size: 12px;">${acc.accountNo}</span></div>
          <div style="color: #475569; font-family: monospace; font-size: 10px; word-break: break-all; margin-top: 2px;"><strong>IBAN:</strong> ${acc.iban || 'N/A'}</div>
        </div>
      `;
    });
    bankAccountsHtml += `</div>`;

    // Retrieve LESCO fields (Page 9)
    const lescoObj = quoteObj.lescoSettings || { meterNo: "", consumerNo: "", sanctionedLoad: "", phaseType: "Three Phase" };
    const netMeteringText = quoteObj.netMeteringRequired || "Yes";

    const pdfHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sunchaser Proposal Deck - ${quoteObj.clientName || lead.name}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Noto+Nastaliq+Urdu:wght@400;700&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #0b1329;
            color: #1e293b;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .action-bar {
            background-color: #1e293b;
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
            transition: background-color 0.2s;
            font-family: 'Inter', sans-serif;
          }
          .btn-print:hover {
            background-color: #d97706;
          }
          .pages-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 24px;
            padding: 40px 0;
          }
          .page {
            width: 210mm;
            height: 297mm;
            background: #ffffff;
            box-shadow: 0 10px 30px -5px rgba(0,0,0,0.45);
            box-sizing: border-box;
            padding: 18mm 20mm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            position: relative;
            overflow: hidden;
            page-break-after: always;
          }
          .page.cover {
            background: linear-gradient(145deg, #020617 0%, #0f172a 100%);
            color: #ffffff;
            padding: 30mm 20mm 20mm 20mm;
          }
          .page-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 8px;
            margin-bottom: 15px;
          }
          .page-title-row {
            font-size: 15px;
            font-weight: 800;
            color: #0f172a;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-left: 4px solid #f59e0b;
            padding-left: 10px;
            font-family: 'Inter', sans-serif;
          }
          .page-footer {
            border-top: 1px solid #e2e8f0;
            padding-top: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 9px;
            color: #94a3b8;
            font-weight: 600;
          }
          .grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
          }
          .card {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 14px;
          }
          .card.dark {
            background-color: #0f172a;
            border-color: #1e293b;
            color: #ffffff;
          }
          .badge {
            font-size: 9px;
            font-weight: 800;
            text-transform: uppercase;
            padding: 2.5px 8px;
            border-radius: 6px;
            background-color: #f59e0b;
            color: #0f172a;
            letter-spacing: 0.03em;
          }
          .cover-brand {
            display: flex;
            align-items: center;
            gap: 14px;
          }
          .cover-logo {
            background-color: #f59e0b;
            width: 54px;
            height: 54px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.45);
          }
          .cover-title {
            font-size: 34px;
            font-weight: 800;
            line-height: 1.25;
            letter-spacing: -0.025em;
            margin-top: 40px;
            background: linear-gradient(to right, #ffffff 60%, #94a3b8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .cover-subtitle {
            font-size: 15px;
            color: #f59e0b;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-top: 10px;
          }
          .cover-meta {
            border-top: 1px solid #1e293b;
            padding-top: 24px;
            margin-top: 35px;
          }
          .cover-meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 18px;
            font-size: 12px;
          }
          .cover-meta-label {
            color: #64748b;
            text-transform: uppercase;
            font-weight: 800;
            font-size: 9px;
            letter-spacing: 0.05em;
          }
          .cover-meta-val {
            font-weight: 600;
            color: #ffffff;
            margin-top: 4px;
          }
          .cover-footer {
            border-top: 1px solid #1e293b;
            padding-top: 18px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            font-size: 10px;
            color: #94a3b8;
          }
          .urdu-text {
            font-family: 'Noto Nastaliq Urdu', serif;
            direction: rtl;
            text-align: right;
            line-height: 2.2;
            font-size: 12px;
            color: #334155;
          }
          .boq-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10.5px;
          }
          .boq-table th {
            background-color: #0f172a;
            color: #ffffff;
            text-align: left;
            padding: 7px 10px;
            font-weight: 750;
            text-transform: uppercase;
            font-size: 8.5px;
            letter-spacing: 0.05em;
          }
          .boq-table td {
            padding: 6px 10px;
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
              page-break-after: always !important;
              page-break-inside: avoid !important;
              float: none;
              padding: 15mm 20mm !important;
              width: 210mm !important;
              height: 297mm !important;
              box-sizing: border-box !important;
            }
            .page.cover {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              background: linear-gradient(145deg, #020617 0%, #0f172a 100%) !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="action-bar">
          <span>☀️ <strong>Sunchaser Proposal Deck:</strong> Multi-Quote Version (${quoteObj.id})</span>
          <button class="btn-print" onclick="window.print()">Print / Download PDF</button>
        </div>

        <div class="pages-container">

          <!-- PAGE 1: COVER PAGE -->
          <div class="page cover">
            <div class="cover-brand">
              <div class="cover-logo">☀️</div>
              <div>
                <div style="font-weight: 800; font-size: 22px; letter-spacing: -0.025em; color: #ffffff;">SUNCHASER ENERGY</div>
                <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #f59e0b;">Generational Infrastructure</div>
              </div>
            </div>

            <div>
              <div class="cover-title">
                ${quoteObj.systemSizekW}kW ${quoteObj.systemType || 'Hybrid'}<br/>Solar Power Solution
              </div>
              <div class="cover-subtitle">Technical Feasibility & Engineering Quotation</div>
              
              <div class="cover-meta">
                <div class="cover-meta-grid">
                  <div>
                    <div class="cover-meta-label">Prepared For</div>
                    <div class="cover-meta-val" style="font-size: 15px;">${quoteObj.clientName || lead.name}</div>
                  </div>
                  <div>
                    <div class="cover-meta-label">Proposal Expiry</div>
                    <div class="cover-meta-val" style="color: #f59e0b;">3-Day Validity (Exp: ${expiryDateString})</div>
                  </div>
                  <div>
                    <div class="cover-meta-label">Site Area</div>
                    <div class="cover-meta-val">${quoteObj.cityArea || lead.location || 'Lahore'}</div>
                  </div>
                  <div>
                    <div class="cover-meta-label">Technical Advisor / BDM</div>
                    <div class="cover-meta-val">${quoteObj.bdmName || lead.assignedSalesperson || 'Sarah Connor'}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="cover-footer">
              <div>
                <div style="font-weight: 700; color: #ffffff; margin-bottom: 2px;">Sunchaser Energy Lahore Office</div>
                <div style="font-size: 9px; line-height: 1.4;">${settings.officeAddress || 'Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore'}</div>
                <div style="font-size: 9px; line-height: 1.4; color: #f59e0b;">Hotlines: ${settings.phoneNumbers || '0309-0236666, 0330-7776444'}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-weight: 700; color: #ffffff;">Doc ID: SC-${lead.id.substring(0, 8).toUpperCase()}-${quoteObj.id.toUpperCase()}</div>
                <div>Date of Issuance: ${quoteDateString}</div>
              </div>
            </div>
          </div>

          <!-- PAGE 2: GROUP Intro -->
          <div class="page">
            <div>
              <div class="page-header">
                <div class="page-title-row">Sunchaser Group Profile</div>
                <div style="font-size: 10px; font-weight: bold; color: #64748b;">Page 2 of 11</div>
              </div>

              <div style="font-size: 12.5px; line-height: 1.6; color: #475569; margin-bottom: 20px; font-weight: 500;">
                Sunchaser Energy operates under a unified consortium of specialized engineering, supply chain, and logistics enterprises. Together, we bring a level of structural reliability and direct import authorization unmatched in the local solar industry.
              </div>

              <div class="grid-2">
                <div class="card">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 6px; font-size: 13px;">☀️ Sunchaser Energy</div>
                  <div style="font-size: 11px; line-height: 1.5; color: #475569;">
                    The core installation and smart grid integration arm. Responsible for site surveys, detailed electrical engineering designs, high-tension terminations, and smart telemetry commissioning.
                  </div>
                </div>
                <div class="card">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 6px; font-size: 13px;">⚡ Helios Solar</div>
                  <div style="font-size: 11px; line-height: 1.5; color: #475569;">
                    The design consultancy branch. Creates 3D shadow analysis, panel positioning arrays using dynamic CAD, and utility net metering simulation projections.
                  </div>
                </div>
                <div class="card" style="margin-top: 10px;">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 6px; font-size: 13px;">🏗️ AL ADAM Steel</div>
                  <div style="font-size: 11px; line-height: 1.5; color: #475569;">
                    Heavy mechanical fabrication plant. Produces heavy hot-dip galvanized frame mounts, standard structures, elevated configurations, and legendary Mughal Girder designs.
                  </div>
                </div>
                <div class="card" style="margin-top: 10px;">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 6px; font-size: 13px;">🌐 Signals Global</div>
                  <div style="font-size: 11px; line-height: 1.5; color: #475569;">
                    International procurement and shipping network. Authorizes direct clearance and imports of Tier-1 solar modules, Knox/Goodwe/Solis inverters, and battery packs.
                  </div>
                </div>
              </div>

              <div class="card dark" style="margin-top: 25px; text-align: center; padding: 18px;">
                <div style="font-size: 10px; text-transform: uppercase; color: #f59e0b; font-weight: 800; letter-spacing: 0.05em;">Our Group Vision</div>
                <div style="font-size: 13.5px; font-weight: 600; line-height: 1.5; margin-top: 8px; font-style: italic; color: #f8fafc;">
                  "Empowering Pakistan with generational clean energy independence, combining premium imports with superior local engineering."
                </div>
              </div>
            </div>

            <div class="page-footer">
              <span>Sunchaser Energy Systems Proposal</span>
              <span>Doc ID: SC-${lead.id.substring(0, 8).toUpperCase()}</span>
            </div>
          </div>

          <!-- PAGE 3: PARTNER BENEFITS -->
          <div class="page">
            <div>
              <div class="page-header">
                <div class="page-title-row">Why Partner with Sunchaser?</div>
                <div style="font-size: 10px; font-weight: bold; color: #64748b;">Page 3 of 11</div>
              </div>

              <div class="grid-2" style="margin-bottom: 24px; row-gap: 20px;">
                <div style="display: flex; gap: 12px; align-items: flex-start;">
                  <span style="font-size: 24px;">🏆</span>
                  <div>
                    <div style="font-weight: 800; font-size: 13px; color: #0f172a; margin-bottom: 4px;">Tier-1 Direct Imported Hardware</div>
                    <div style="font-size: 11px; color: #475569; line-height: 1.5;">
                      All solar modules are sourced directly from Bloomberg Tier-1 rated manufacturers (Jinko, Longi, JA Solar) with complete customs trace certificates.
                    </div>
                  </div>
                </div>
                <div style="display: flex; gap: 12px; align-items: flex-start;">
                  <span style="font-size: 24px;">🔩</span>
                  <div>
                    <div style="font-weight: 800; font-size: 13px; color: #0f172a; margin-bottom: 4px;">Indestructible Fabrication Mounts</div>
                    <div style="font-size: 11px; color: #475569; line-height: 1.5;">
                      We install heavy galvanized and girder frames designed to withstand 130 km/h wind shear. Standard, Elevated, or heavy custom structural spans.
                    </div>
                  </div>
                </div>
                <div style="display: flex; gap: 12px; align-items: flex-start;">
                  <span style="font-size: 24px;">📑</span>
                  <div>
                    <div style="font-weight: 800; font-size: 13px; color: #0f172a; margin-bottom: 4px;">Turnkey NEPRA & LESCO Net Metering</div>
                    <div style="font-size: 11px; color: #475569; line-height: 1.5;">
                      Our in-house corporate relations team manages all documentation, inspections, demand notices, green meter procurement, and LESCO commissioning.
                    </div>
                  </div>
                </div>
                <div style="display: flex; gap: 12px; align-items: flex-start;">
                  <span style="font-size: 24px;">📲</span>
                  <div>
                    <div style="font-weight: 800; font-size: 13px; color: #0f172a; margin-bottom: 4px;">24/7 Smart Telemetry Portal</div>
                    <div style="font-size: 11px; color: #475569; line-height: 1.5;">
                      Track daily generation stats, battery health logs, grid export credits, and service tickets directly through the Sunchaser Customer app.
                    </div>
                  </div>
                </div>
              </div>

              <div class="card" style="margin-top: 30px; border: 1.5px dashed #cbd5e1; background-color: #f8fafc;">
                <div style="font-weight: 800; color: #0f172a; font-size: 13px; margin-bottom: 12px; text-align: center;">Official Digital Channels & Portals</div>
                <div style="display: flex; justify-content: space-around; align-items: center; padding: 10px 0;">
                  <div style="text-align: center;">
                    <svg width="85" height="85" viewBox="0 0 100 100" style="background: #ffffff; padding: 4px; border: 1px dashed #cbd5e1; border-radius: 6px; display: block; margin: 0 auto;">
                      <rect x="0" y="0" width="30" height="30" fill="#0f172a" />
                      <rect x="5" y="5" width="20" height="20" fill="#ffffff" />
                      <rect x="10" y="10" width="10" height="10" fill="#0f172a" />
                      <rect x="70" y="0" width="30" height="30" fill="#0f172a" />
                      <rect x="75" y="5" width="20" height="20" fill="#ffffff" />
                      <rect x="80" y="10" width="10" height="10" fill="#0f172a" />
                      <rect x="0" y="70" width="30" height="30" fill="#0f172a" />
                      <rect x="5" y="75" width="20" height="20" fill="#ffffff" />
                      <rect x="10" y="80" width="10" height="10" fill="#0f172a" />
                      <rect x="40" y="10" width="10" height="10" fill="#0f172a" />
                      <rect x="50" y="20" width="10" height="10" fill="#0f172a" />
                      <rect x="35" y="45" width="15" height="15" fill="#f59e0b" />
                      <rect x="60" y="40" width="10" height="20" fill="#0f172a" />
                      <rect x="80" y="45" width="10" height="10" fill="#0f172a" />
                      <rect x="45" y="70" width="20" height="10" fill="#0f172a" />
                      <rect x="75" y="85" width="15" height="10" fill="#0f172a" />
                    </svg>
                    <div style="font-size: 9.5px; font-weight: 800; color: #475569; margin-top: 8px;">Customer Portal</div>
                  </div>

                  <div style="text-align: center;">
                    <svg width="85" height="85" viewBox="0 0 100 100" style="background: #ffffff; padding: 4px; border: 1px dashed #cbd5e1; border-radius: 6px; display: block; margin: 0 auto;">
                      <rect x="0" y="0" width="30" height="30" fill="#0f172a" />
                      <rect x="5" y="5" width="20" height="20" fill="#ffffff" />
                      <rect x="10" y="10" width="10" height="10" fill="#0f172a" />
                      <rect x="70" y="0" width="30" height="30" fill="#0f172a" />
                      <rect x="75" y="5" width="20" height="20" fill="#ffffff" />
                      <rect x="80" y="10" width="10" height="10" fill="#0f172a" />
                      <rect x="0" y="70" width="30" height="30" fill="#0f172a" />
                      <rect x="5" y="75" width="20" height="20" fill="#ffffff" />
                      <rect x="10" y="80" width="10" height="10" fill="#0f172a" />
                      <rect x="40" y="20" width="10" height="10" fill="#0f172a" />
                      <rect x="50" y="40" width="10" height="10" fill="#0f172a" />
                      <rect x="35" y="45" width="15" height="15" fill="#f59e0b" />
                      <rect x="60" y="70" width="10" height="20" fill="#0f172a" />
                      <rect x="80" y="75" width="10" height="10" fill="#0f172a" />
                    </svg>
                    <div style="font-size: 9.5px; font-weight: 800; color: #475569; margin-top: 8px;">Corporate Registry</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="page-footer">
              <span>Sunchaser Energy Systems Proposal</span>
              <span>Doc ID: SC-${lead.id.substring(0, 8).toUpperCase()}</span>
            </div>
          </div>

          <!-- PAGE 4: CEO MESSAGE -->
          <div class="page">
            <div>
              <div class="page-header">
                <div class="page-title-row">Executive Board Assurances</div>
                <div style="font-size: 10px; font-weight: bold; color: #64748b;">Page 4 of 11</div>
              </div>

              <div class="grid-2" style="margin-top: 10px;">
                <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; height: 185mm;">
                  <div>
                    <div style="font-size: 26px; margin-bottom: 8px;">🛡️</div>
                    <div style="font-weight: 800; font-size: 13px; color: #0f172a; margin-bottom: 2px;">Muhammad Allauddin</div>
                    <div style="font-size: 8.5px; text-transform: uppercase; color: #d97706; font-weight: 800; margin-bottom: 12px; letter-spacing: 0.05em;">CEO, Engineering & Operations</div>
                    <div style="font-size: 11px; line-height: 1.65; color: #475569; font-style: italic;">
                      "At Sunchaser, our engineering philosophy is simple: we build systems that outlast a generation. We refuse to cut corners on material gauges, hot-dip zinc coating parameters, wire thicknesses, or chemical earthing bores. Every layout is physically verified, and every termination complies with ISO standards. Sunchaser means ultimate power security."
                    </div>
                  </div>
                  <div style="border-top: 1px dashed #cbd5e1; padding-top: 12px; margin-top: 15px; text-align: center;">
                    <div style="font-family: 'Georgia', serif; font-size: 16px; font-style: italic; color: #1e293b; font-weight: 700;">Muhammad Allauddin</div>
                    <div style="font-size: 8.5px; text-transform: uppercase; color: #94a3b8; margin-top: 4px; font-weight: bold;">Digital Signature Record</div>
                  </div>
                </div>

                <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; height: 185mm;">
                  <div>
                    <div style="font-size: 26px; margin-bottom: 8px;">⚖️</div>
                    <div style="font-weight: 800; font-size: 13px; color: #0f172a; margin-bottom: 2px;">Barrister Raza Khan Niazi</div>
                    <div style="font-size: 8.5px; text-transform: uppercase; color: #d97706; font-weight: 800; margin-bottom: 12px; letter-spacing: 0.05em;">CEO Strategy &amp; Innovation / Compliance</div>
                    <div style="font-size: 11px; line-height: 1.65; color: #475569; font-style: italic;">
                      "Liaison with utility boards and regulatory licensing can be daunting for clients. Sunchaser handles the entire paperwork and NEPRA filing process transparently. We promise that all governmental files are processed legally, demand notices are audited, and net metering activations are completed with maximal efficiency."
                    </div>
                  </div>
                  <div style="border-top: 1px dashed #cbd5e1; padding-top: 12px; margin-top: 15px; text-align: center;">
                    <div style="font-family: 'Georgia', serif; font-size: 16px; font-style: italic; color: #1e293b; font-weight: 700;">Barrister Raza Khan Niazi</div>
                    <div style="font-size: 8.5px; text-transform: uppercase; color: #94a3b8; margin-top: 4px; font-weight: bold;">Digital Signature Record</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="page-footer">
              <span>Sunchaser Energy Systems Proposal</span>
              <span>Doc ID: SC-${lead.id.substring(0, 8).toUpperCase()}</span>
            </div>
          </div>

          <!-- PAGE 5: STRUCTURE DESCRIPTION -->
          <div class="page">
            <div>
              <div class="page-header">
                <div class="page-title-row">Mounting Structure & Fabrication Details</div>
                <div style="font-size: 10px; font-weight: bold; color: #64748b;">Page 5 of 11</div>
              </div>

              <div class="card" style="margin-bottom: 15px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                  <span style="font-weight: 800; font-size: 14px; color: #0f172a;">Selected Mounting Structure:</span>
                  <span class="badge" style="font-size: 9.5px; padding: 4px 12px;">${quoteObj.selectedStructure || quoteObj.structureType || 'Standard'}</span>
                </div>
                <div style="font-size: 11.5px; line-height: 1.55; color: #475569;">
                  <strong>English Specification:</strong><br/>
                  ${structDetails.en}
                </div>
              </div>

              <div class="card" style="margin-bottom: 15px; border-left: 4px solid #f59e0b; padding: 12px 16px;">
                <div style="font-size: 10px; text-transform: uppercase; color: #d97706; font-weight: 800; margin-bottom: 6px; text-align: right; letter-spacing: 0.05em;">ساختی تفصیلات (اردو)</div>
                <div class="urdu-text">
                  ${structDetails.ur}
                </div>
              </div>

              <div class="grid-2" style="margin-bottom: 15px;">
                <div class="card" style="font-size: 11px; line-height: 1.5;">
                  <strong>Mechanical Design Parameters:</strong>
                  <div style="margin-top: 6px; color: #475569;">
                    • Material: ${structDetails.materialType || 'Galvanized L3 Steel'}<br/>
                    • Calculated Weight: ${structDetails.weight || 'Standard Weight'}<br/>
                    • Wind Shear Rating: ${structDetails.windRating || '130 km/h wind certified'}
                  </div>
                </div>
                <div class="card" style="font-size: 11px; line-height: 1.5;">
                  <strong>Structural Warranties:</strong>
                  <div style="margin-top: 6px; color: #475569;">
                    • Structure Warranty: ${structDetails.warranty || '10 Years Limited Warranty'}<br/>
                    • Certification: SAP 2000 Wind Load Compliance<br/>
                    • Mechanical Bolts: Pure High-tensile Rawal anchors
                  </div>
                </div>
              </div>

              <div class="card dark" style="padding: 8px 16px;">
                <div style="font-weight: 800; font-size: 11px; color: #f59e0b; margin-bottom: 5px; text-align: center; text-transform: uppercase; letter-spacing: 0.05em;">Structure Engineering Schematics</div>
                ${structureSvg}
              </div>
            </div>

            <div class="page-footer">
              <span>Sunchaser Energy Systems Proposal</span>
              <span>Doc ID: SC-${lead.id.substring(0, 8).toUpperCase()}</span>
            </div>
          </div>

          <!-- PAGE 6: BOQ PRICE TABLE -->
          <div class="page" style="padding: 12mm 15mm;">
            <div>
              <div class="page-header" style="margin-bottom: 10px;">
                <div class="page-title-row">Bill of Quantities (BOQ)</div>
                <div style="font-size: 10px; font-weight: bold; color: #64748b;">Page 6 of 11</div>
              </div>

              <div style="max-height: 195mm; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 8px;">
                <table class="boq-table">
                  <thead>
                    <tr style="height: 28px;">
                      <th style="width: 5%; text-align: center;">Sr.</th>
                      <th style="width: 25%;">Item Description</th>
                      <th style="width: 30%;">Specifications</th>
                      <th style="width: 8%; text-align: center;">Unit</th>
                      <th style="width: 8%; text-align: center;">Qty</th>
                      <th style="width: 12%; text-align: right;">Rate</th>
                      <th style="width: 12%; text-align: right;">Total Dues</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${boqHtml}
                  </tbody>
                </table>
              </div>

              <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="width: 50%; font-size: 9px; color: #64748b; line-height: 1.45;">
                  ${quoteObj.customNotes ? `
                    <div style="background-color: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 8px; color: #6b21a8; font-weight: 500;">
                      <strong>Special Operations Notes:</strong><br/>
                      ${quoteObj.customNotes}
                    </div>
                  ` : 'Note: Sunchaser solar systems are configured with Tier-1 solar arrays & high-grade chemical ground anchors.'}
                </div>
                <div style="width: 45%;">
                  <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                    <span style="color: #64748b; font-weight: 500;">BOQ Gross Value:</span>
                    <span style="font-weight: 600; color: #0f172a;">${formatPKR(grossTotal)}</span>
                  </div>
                  ${discountAmount > 0 ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">Partner Discount:</span>
                      <span style="font-weight: 600; color: #dc2626;">-${formatPKR(discountAmount)}</span>
                    </div>
                  ` : ''}
                  ${taxEnabled ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">Sales Tax (${taxRate}%):</span>
                      <span style="font-weight: 600; color: #d97706;">+${formatPKR(taxAmount)}</span>
                    </div>
                  ` : ''}
                  ${societyCharges > 0 ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">DHA/Society Dues:</span>
                      <span style="font-weight: 600; color: #0f172a;">+${formatPKR(societyCharges)}</span>
                    </div>
                  ` : ''}
                  <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 800; border-top: 2px solid #0f172a; padding-top: 4px; margin-top: 4px;">
                    <span style="color: #0f172a;">Turnkey Net Investment:</span>
                    <span style="color: #d97706; font-size: 14px;">${formatPKR(finalNetPrice)}</span>
                  </div>
                  <div style="font-size: 7.5px; color: #94a3b8; text-align: right; margin-top: 2px;">
                    * All pricing conforms to Pakistan fiscal/duty structures.
                  </div>
                </div>
              </div>
            </div>

            <div class="page-footer">
              <span>Sunchaser Energy Systems Proposal</span>
              <span>Doc ID: SC-${lead.id.substring(0, 8).toUpperCase()}</span>
            </div>
          </div>

          <!-- PAGE 7: TERMS & CONDITIONS (PART 1) -->
          <div class="page">
            <div>
              <div class="page-header">
                <div class="page-title-row">Terms, Conditions &amp; Regulations (1/2)</div>
                <div style="font-size: 10px; font-weight: bold; color: #64748b;">Page 7 of 11</div>
              </div>

              <div style="font-size: 12px; line-height: 1.5; color: #475569; margin-bottom: 18px; font-weight: 500;">
                All contractual relationships, hardware execution plans, and regulatory billing policies are governed strictly by the following mutually-agreed terms:
              </div>

              <div style="padding: 5px;">
                ${tcPage1Html}
              </div>
            </div>

            <div class="page-footer">
              <span>Sunchaser Energy Systems Proposal</span>
              <span>Doc ID: SC-${lead.id.substring(0, 8).toUpperCase()}</span>
            </div>
          </div>

          <!-- PAGE 8: TERMS & CONDITIONS (PART 2) -->
          <div class="page">
            <div>
              <div class="page-header">
                <div class="page-title-row">Terms, Conditions &amp; Regulations (2/2)</div>
                <div style="font-size: 10px; font-weight: bold; color: #64748b;">Page 8 of 11</div>
              </div>

              <div style="font-size: 12px; line-height: 1.5; color: #475569; margin-bottom: 18px; font-weight: 500;">
                Execution guidelines, structural warranties, exclusions, and safety operations policies are continued below:
              </div>

              <div style="padding: 5px;">
                ${tcPage2Html}
              </div>
            </div>

            <div class="page-footer">
              <span>Sunchaser Energy Systems Proposal</span>
              <span>Doc ID: SC-${lead.id.substring(0, 8).toUpperCase()}</span>
            </div>
          </div>

          <!-- PAGE 9: CUSTOMER SIGN-OFF -->
          <div class="page">
            <div>
              <div class="page-header">
                <div class="page-title-row">Client Verification &amp; Sign-off</div>
                <div style="font-size: 10px; font-weight: bold; color: #64748b;">Page 9 of 11</div>
              </div>

              <div class="card" style="margin-bottom: 15px;">
                <div style="font-weight: 800; color: #0f172a; font-size: 12.5px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px;">
                  1. Contractual Customer Demographics
                </div>
                <div class="cover-meta-grid" style="font-size: 11.5px; color: #475569; row-gap: 8px;">
                  <div><strong>Client Name:</strong> <span style="color: #0f172a; font-weight: 600;">${quoteObj.clientName || lead.name}</span></div>
                  <div><strong>CNIC / Identity Card:</strong> <span style="color: #0f172a; font-weight: 600;">${quoteObj.cnic || 'Pending Verification'}</span></div>
                  <div><strong>Contact Number:</strong> <span style="color: #0f172a;">${quoteObj.clientPhone || lead.phone}</span></div>
                  <div><strong>Email Address:</strong> <span style="color: #0f172a;">${quoteObj.clientEmail || lead.email}</span></div>
                  <div><strong>Site Address:</strong> <span style="color: #0f172a;">${quoteObj.clientAddress || lead.address}</span></div>
                  <div><strong>City / Sector:</strong> <span style="color: #0f172a;">${quoteObj.cityArea || lead.location || 'Lahore'}</span></div>
                </div>
              </div>

              <div class="card" style="margin-bottom: 15px; border-left: 4px solid #0284c7;">
                <div style="font-weight: 800; color: #0f172a; font-size: 12.5px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px;">
                  2. LESCO Billing &amp; Net Metering Parameters
                </div>
                <div class="cover-meta-grid" style="font-size: 11.5px; color: #475569; row-gap: 8px;">
                  <div><strong>LESCO Meter Number:</strong> <span style="color: #0f172a; font-weight: 600; font-family: monospace;">${lescoObj.meterNo || 'Not Provided'}</span></div>
                  <div><strong>Consumer Account Number:</strong> <span style="color: #0f172a; font-weight: 600; font-family: monospace;">${lescoObj.consumerNo || 'Not Provided'}</span></div>
                  <div><strong>Sanctioned Grid Load:</strong> <span style="color: #0f172a; font-weight: 600;">${lescoObj.sanctionedLoad ? lescoObj.sanctionedLoad + ' kW' : 'Not Scanned'}</span></div>
                  <div><strong>Connection Phase:</strong> <span style="color: #0f172a;">${lescoObj.phaseType || 'Three Phase'}</span></div>
                  <div class="col-span-2"><strong>Turnkey Net Metering NEPRA Licensing:</strong> <span style="color: #0369a1; font-weight: 700;">${netMeteringText === 'Yes' ? 'REQUIRED &amp; INCLUDED IN SOW' : 'NOT REQUIRED'}</span></div>
                </div>
              </div>

              <div class="card" style="margin-bottom: 20px; padding: 12px;">
                <div style="font-size: 10.5px; line-height: 1.5; color: #475569;">
                  <strong>Contract Declaration:</strong> By signing below, the client confirms the technical parameters (Page 5), accepts the final turnkey financial quote (Page 6), accepts the terms &amp; exclusions (Page 7 &amp; 8), and formally authorizes Sunchaser Energy to proceed with hardware procurement, chemical bores, structural steel fabrication, and LESCO utility interconnect procedures.
                </div>
              </div>

              <div class="grid-2" style="margin-top: 20px;">
                <div style="text-align: center;">
                  <div style="height: 20mm; border-bottom: 1.5px solid #94a3b8; display: flex; align-items: flex-end; justify-content: center; font-family: 'Georgia', serif; font-size: 14px; color: #cbd5e1; font-style: italic;">
                    Signature / Thumb Stamp
                  </div>
                  <div style="font-weight: 800; color: #0f172a; font-size: 12px; margin-top: 6px;">Client Representative Signature</div>
                  <div style="font-size: 9px; color: #94a3b8;">Acceptance of Specifications &amp; Terms</div>
                </div>

                <div style="text-align: center;">
                  <div style="height: 20mm; border-bottom: 1.5px solid #d97706; display: flex; align-items: flex-end; justify-content: center; font-family: 'Georgia', serif; font-size: 14px; color: #fde68a; font-style: italic;">
                    Sunchaser Central Operations
                  </div>
                  <div style="font-weight: 800; color: #0f172a; font-size: 12px; margin-top: 6px;">Sunchaser Authorized Signatory</div>
                  <div style="font-size: 9px; color: #94a3b8;">Central Operations Release &amp; Allocation</div>
                </div>
              </div>
            </div>

            <div class="page-footer">
              <span>Sunchaser Energy Systems Proposal</span>
              <span>Doc ID: SC-${lead.id.substring(0, 8).toUpperCase()}</span>
            </div>
          </div>

          <!-- PAGE 10: BANK DETAILS -->
          <div class="page">
            <div>
              <div class="page-header">
                <div class="page-title-row">Official Payment Channels</div>
                <div style="font-size: 10px; font-weight: bold; color: #64748b;">Page 10 of 11</div>
              </div>

              <div class="card" style="background-color: #fffbeb; border-color: #fde68a; margin-bottom: 12px; display: flex; gap: 12px; align-items: center; padding: 10px 14px;">
                <span style="font-size: 22px;">⚠️</span>
                <span style="font-size: 11px; color: #b45309; line-height: 1.45; font-weight: 600;">
                  <strong>Financial Safety Warning:</strong> Sunchaser Energy never requests cash collections or transfers to personal employee accounts. Please ensure all wire transfers, bank deposits, or pay orders match the official corporate accounts listed below.
                </span>
              </div>

              <div>
                ${bankAccountsHtml}
              </div>

              <div style="margin-top: 20px; font-size: 10px; color: #64748b; line-height: 1.5; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px;">
                <strong>Payment Verification Workflow:</strong><br/>
                Once a wire transfer, bank draft, or pay order is completed, please scan or photograph the payment receipt and share it with your assigned sales representative or email it directly to <strong>billing@sunchaser-energy.com</strong> for swift operational clearance and logistics dispatch.
              </div>
            </div>

            <div class="page-footer">
              <span>Sunchaser Energy Systems Proposal</span>
              <span>Doc ID: SC-${lead.id.substring(0, 8).toUpperCase()}</span>
            </div>
          </div>

          <!-- PAGE 11: CLOSING PAGE -->
          <div class="page cover" style="justify-content: center; text-align: center; padding: 40mm 20mm;">
            <div style="margin-bottom: 40px;">
              <div class="cover-logo" style="margin: 0 auto; width: 80px; height: 80px; font-size: 40px; border-radius: 20px;">☀️</div>
              <h2 style="font-size: 28px; font-weight: 800; letter-spacing: -0.02em; color: #ffffff; margin-top: 24px; margin-bottom: 4px;">SUNCHASER ENERGY SYSTEMS</h2>
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: #f59e0b; font-weight: 700;">Generational Energy Independence</div>
            </div>

            <div style="max-width: 480px; margin: 0 auto 50px auto; font-size: 13.5px; line-height: 1.6; color: #94a3b8; font-weight: 500;">
              "Thank you for choosing Sunchaser Energy Systems! We are committed to delivering the highest caliber of electrical integration, structural safety, and long-term utility savings."
            </div>

            <div style="border-top: 1px solid #1e293b; padding-top: 30px; font-size: 11px; color: #64748b; max-width: 380px; margin: 0 auto;">
              <strong style="color: #ffffff;">Sunchaser Central Head Office</strong><br/>
              Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore<br/>
              Hotlines: 0309-0236666, 0330-7776444<br/>
              Email: info@sunchaser-energy.com | Web: www.sunchaser-energy.com
            </div>
          </div>

        </div>
      </body>
      </html>
    `;
    res.send(pdfHtml);
  } catch (err: any) {
    res.status(500).send("Error compiling PDF structure: " + err.message);
  }
});

/* --- GEMINI CHATBOT INTEGRATION --- */
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

    const contents: any[] = [];
    if (history && Array.isArray(history)) {
      history.forEach((turn: any) => {
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
      contents: contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7
      }
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("Gemini chatbot error:", error);
    res.json({ text: `Hello! Sunchaser Smart Systems is currently operating in local fallback mode. Sunchaser Core stackable batteries offer custom 13.5kWh arrays.` });
  }
});

// Sizing recommendations endpoint
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
  } catch (error: any) {
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

// Proposal drafting contract generator
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
  } catch (error: any) {
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

/* --- DAILY ARCHIVAL DATABASE BACKUP SYSTEM --- */
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

setInterval(async () => {
  try {
    let backupState: Database = db;
    if (isSupabaseActive()) {
      backupState = await fetchAppStateFromSupabase();
    }
    const stamp = new Date().toISOString().split("T")[0];
    const file = path.join(BACKUPS_DIR, `sunchaser-backup-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(backupState, null, 2), "utf8");

    // Clean up older than 10 backups
    const list = fs.readdirSync(BACKUPS_DIR).filter((f) => f.startsWith("sunchaser-backup-"));
    if (list.length > 10) {
      list.sort();
      fs.unlinkSync(path.join(BACKUPS_DIR, list[0]));
    }
  } catch (err: any) {
    console.error("[Database Backup Error]:", err.message);
  }
}, 24 * 60 * 60 * 1000); // 24-hour cycle schedule

// Simple health check and status endpoints for separated deployments
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (req, res) => {
  res.send("Sunchaser CRM backend running");
});

/* --- VITE SERVICE INITIALIZATION --- */
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Sunchaser Energy ERP] backend active. Intress routing Port ${PORT}`);
  });
}

startServer();
