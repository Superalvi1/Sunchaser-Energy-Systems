import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import WebSocket from "ws";

// Polyfill WebSocket globally for Node.js < 22 environments where Supabase Realtime requires it
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}

let clientInstance: SupabaseClient | null = null;
let isConfigured = false;

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
  if (!isConfigured) {
    getSupabase();
  }
  return isConfigured && clientInstance !== null;
}

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
}

export const initialSeed: Database = {
  users: [
    { id: "u-1", username: "admin", password: "123", name: "Alex Admin", email: "admin@sunchaser.com", role: "Super Admin" },
    { id: "u-2", username: "manager", password: "123", name: "Sarah Manager", email: "manager@sunchaser.com", role: "Sales Manager" },
    { id: "u-3", username: "sales", password: "123", name: "Sarah Connor", email: "sarah.connor@sunchaser.com", role: "Sales Executive" },
    { id: "u-4", username: "surveyor", password: "123", name: "Bob Surveyor", email: "bob@sunchaser.com", role: "Survey Engineer" },
    { id: "u-5", username: "installer", password: "123", name: "Dave Installer", email: "dave@sunchaser.com", role: "Installation Team" },
    { id: "u-6", username: "customer", password: "123", name: "John Miller", email: "john.miller@gmail.com", role: "Customer" },
    { id: "u-7", username: "admin2", password: "123", name: "Alice Admin", email: "alice.admin@sunchaser.com", role: "Admin" },
    { id: "u-8", username: "inventory", password: "123", name: "Ian Inventory", email: "ian@sunchaser.com", role: "Inventory Manager" },
    { id: "u-9", username: "support", password: "123", name: "Sam Support", email: "sam@sunchaser.com", role: "Support Agent" },
    { id: "u-10", username: "technician", password: "123", name: "Dave Installer", email: "dave.tech@sunchaser.com", role: "Technician" },
  ],
  leads: [
    {
      id: "lead-1",
      name: "John Miller",
      email: "john.miller@gmail.com",
      phone: "+1 (555) 349-2091",
      address: "742 Evergreen Terrace, Springfield",
      status: "Contracted",
      monthlyBill: 250,
      monthlyUnits: 820,
      sanctionedLoad: 10,
      backupRequirement: "Whole House Backup",
      location: "Springfield",
      roofType: "Asphalt Shingle",
      roofSpace: 1200,
      shading: "Low",
      rating: 5,
      assignedSalesperson: "Sarah Connor",
      createdAt: "2026-05-10T08:30:00Z",
      notes: "Highly interested in solar battery backup. Prefers Tesla Powerwall options.",
      leadSource: "Direct/Referral",
      engagementLevel: "High",
      conversionProbability: 95,
      conversionScore: 88,
      quotes: [
        {
          id: "q-1",
          systemSizekW: 8.5,
          panelCount: 22,
          panelType: "Sunchaser Ultra 400W",
          inverterType: "Enphase IQ8 Microinverter",
          batteryCapacity: "13.5 kWh Sunchaser Core",
          totalCost: 19500,
          federalTaxCredit: 5850,
          netCost: 13650,
          estimatedAnnualSavings: 2800,
          paybackPeriodYears: 5.2,
          status: "Accepted",
          createdAt: "2026-05-12T14:20:00Z"
        }
      ],
      survey: {
        scheduledDate: "2026-06-02T10:00:00Z",
        status: "Completed",
        notes: "Roof has a 30-degree pitch, southern exposure. No significant shading. Shingles are late-stage asphalt but sturdy enough for installation. Service panel is 200A, which is ideal.",
        shadingPercent: 8,
        optimalPlacement: "South-West Section",
        photos: ["/assets/roof_sample_1.jpg"],
        measurements: {
          roofPitch: "30 degrees",
          rafterSpacing: "24 inches OC",
          dimensions: "40ft x 30ft Southern Face",
          obstructions: "Chimney on East corner, plumbing vent pipe"
        },
        structureRecommendation: "Flush mount standard rail system",
        dbInverterLocation: "Utility Room near main electrical panel",
        panelPlacements: [
          { x: 120, y: 150, id: 1 },
          { x: 160, y: 150, id: 2 },
          { x: 200, y: 150, id: 3 },
          { x: 240, y: 150, id: 4 },
          { x: 120, y: 200, id: 5 },
          { x: 160, y: 200, id: 6 }
        ]
      },
      installation: {
        status: "Scheduled",
        scheduledDate: "2026-06-15T08:00:00Z",
        progress: 20,
        tasks: [
          { id: "t-1", name: "Structural Reinforcement & Rails", done: true },
          { id: "t-2", name: "Inverter & Core Battery Mounting", done: false },
          { id: "t-3", name: "Solar Panel Array Installation", done: false },
          { id: "t-4", name: "Electrical Connection & Conduit Routing", done: false },
          { id: "t-5", name: "Net Meter Setup & Interconnection Inspection", done: false }
        ],
        completionPhotos: [],
        report: ""
      }
    },
    {
      id: "lead-2",
      name: "Jessica Albright",
      email: "jessica.a@yahoo.com",
      phone: "+1 (555) 872-4411",
      address: "2418 Ridge Road, Fairview",
      status: "Survey Scheduled",
      monthlyBill: 180,
      monthlyUnits: 620,
      sanctionedLoad: 8,
      backupRequirement: "Essential Loads Only",
      location: "Fairview",
      roofType: "Standing Seam Metal",
      roofSpace: 950,
      shading: "Medium",
      rating: 3,
      assignedSalesperson: "Sarah Connor",
      createdAt: "2026-05-20T11:15:00Z",
      notes: "Worried about large oak tree on southeast side of roof. Wants a shading analysis.",
      leadSource: "Web Search",
      engagementLevel: "Medium",
      conversionProbability: 65,
      conversionScore: 58,
      quotes: [],
      survey: {
        scheduledDate: "2026-06-01T14:00:00Z",
        status: "Pending",
        notes: "",
        shadingPercent: 0,
        optimalPlacement: "",
        photos: []
      }
    },
    {
      id: "lead-3",
      name: "Robert Delgado",
      email: "r.delgado@outlook.com",
      phone: "+1 (555) 761-0022",
      address: "889 Bluebird Lane, Whispering Pines",
      status: "Installed",
      monthlyBill: 340,
      monthlyUnits: 1100,
      sanctionedLoad: 15,
      backupRequirement: "Whole House Backup",
      location: "Whispering Pines",
      roofType: "Concrete Tile",
      roofSpace: 1800,
      shading: "None",
      rating: 4,
      assignedSalesperson: "Michael Scott",
      createdAt: "2026-04-15T09:00:00Z",
      notes: "Wants premium high-efficiency components. Opted for commercial-grade panels.",
      leadSource: "Direct/Referral",
      engagementLevel: "High",
      conversionProbability: 100,
      conversionScore: 92,
      quotes: [
        {
          id: "q-3",
          systemSizekW: 12.0,
          panelCount: 30,
          panelType: "Sunchaser Pro High-Efficiency 400W",
          inverterType: "Tesla Inverter 7.6kW",
          batteryCapacity: "27.0 kWh Twin Storage",
          totalCost: 28400,
          federalTaxCredit: 8520,
          netCost: 19880,
          estimatedAnnualSavings: 4200,
          paybackPeriodYears: 4.8,
          status: "Accepted",
          createdAt: "2026-04-18T16:00:00Z"
        }
      ],
      survey: {
        scheduledDate: "2026-04-22T09:00:00Z",
        status: "Completed",
        notes: "Large flat roof portion combined with pitched southern face. Beautiful space, high potential.",
        shadingPercent: 3,
        optimalPlacement: "Southern Facing Pitch and South-East Flat Roof Area",
        photos: []
      },
      installation: {
        status: "Completed",
        scheduledDate: "2026-05-05T08:00:00Z",
        progress: 100,
        tasks: [
          { id: "t-1", name: "Structural Reinforcement & Rails", done: true },
          { id: "t-2", name: "Inverter & Core Battery Mounting", done: true },
          { id: "t-3", name: "Solar Panel Array Installation", done: true },
          { id: "t-4", name: "Electrical Connection & Conduit Routing", done: true },
          { id: "t-5", name: "Net Meter Setup & Interconnection Inspection", done: true }
        ],
        completionPhotos: ["https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=800&auto=format&fit=crop&q=60"],
        report: "Successful deployment. All electrical tests show peak performance. System outputting 11.8 kW max. Net metering fully approved by utility district and online."
      }
    },
    {
      id: "lead-4",
      name: "Catherine Vance",
      email: "cvance@gmail.com",
      phone: "+1 (555) 124-7788",
      address: "123 Maple Street, Oakville",
      status: "New",
      monthlyBill: 120,
      monthlyUnits: 400,
      sanctionedLoad: 6,
      backupRequirement: "None",
      location: "Oakville",
      roofType: "Asphalt Shingle",
      roofSpace: 700,
      shading: "High",
      rating: 2,
      assignedSalesperson: "Michael Scott",
      createdAt: "2026-05-28T15:45:00Z",
      notes: "Looking to save but roof has many trees. Looking for alternatives or ground mount info.",
      leadSource: "Facebook Ad",
      engagementLevel: "Low",
      conversionProbability: 25,
      conversionScore: 32,
      quotes: []
    }
  ],
  tickets: [
    {
      id: "ticket-101",
      customerName: "Robert Delgado",
      email: "r.delgado@outlook.com",
      subject: "Inverter Connectivity Issue",
      description: "My solar app dashboard is not updating real-time values. The WiFi indicator on the Enphase combiner box is blinking amber.",
      status: "Open",
      priority: "Medium",
      createdAt: "2026-05-28T09:00:00Z",
      messages: [
        { sender: "Customer", text: "The WiFi router was reset yesterday. Since then, the inverter shows offline.", time: "2026-05-28T09:00:00Z" }
      ]
    },
    {
      id: "ticket-102",
      customerName: "John Miller",
      email: "john.miller@gmail.com",
      subject: "HOA Approval Documentation",
      description: "Can you provide the solar CAD layout and structural schematic so I can submit them to my HOA for approval?",
      status: "In Progress",
      priority: "Low",
      createdAt: "2026-05-25T14:30:00Z",
      messages: [
        { sender: "Customer", text: "They usually take 10-14 days, so the sooner I get the documents, the better.", time: "2026-05-25T14:30:00Z" },
        { sender: "Agent", text: "Hello John, our design team is finalizing your layout schematics today. We will upload and email you the PDF layout by tomorrow morning.", time: "2026-05-26T10:15:00Z" }
      ]
    }
  ],
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
  projects: [
    {
      id: "project-1",
      leadId: "lead-1",
      customerName: "John Miller",
      address: "742 Evergreen Terrace, Springfield",
      systemSizekW: 8.5,
      stage: "Advance Received",
      createdAt: "2026-05-12T14:20:00Z",
      updatedAt: "2026-05-29T10:00:00Z"
    },
    {
      id: "project-3",
      leadId: "lead-3",
      customerName: "Robert Delgado",
      address: "889 Bluebird Lane, Whispering Pines",
      systemSizekW: 12.0,
      stage: "Completed",
      createdAt: "2026-04-18T16:00:00Z",
      updatedAt: "2026-05-15T09:00:00Z"
    }
  ],
  netMeteringTrackers: {
    "lead-1": {
      leadId: "lead-1",
      documentsCollected: true,
      applicationSubmitted: true,
      discoInspection: false,
      demandNotice: false,
      meterInstallation: false,
      greenMeterActive: false
    },
    "lead-3": {
      leadId: "lead-3",
      documentsCollected: true,
      applicationSubmitted: true,
      discoInspection: true,
      demandNotice: true,
      meterInstallation: true,
      greenMeterActive: true
    }
  },
  paymentTracks: {
    "lead-1": {
      leadId: "lead-1",
      totalValue: 19500,
      advanceReceived: 5850,
      pendingAmount: 13650,
      reminderSent: false,
      invoiceStatus: "Pending",
      milestones: [
        { name: "30% Sign-up Advance", amount: 5850, status: "Paid", dueDate: "2026-05-12" },
        { name: "30% Structural Engineering Approval", amount: 5850, status: "Pending", dueDate: "2026-06-05" },
        { name: "30% Panel Arrays Completed", amount: 5850, status: "Pending", dueDate: "2026-06-25" },
        { name: "10% Utility Interconnection Active", amount: 1950, status: "Pending", dueDate: "2026-07-15" }
      ]
    },
    "lead-3": {
      leadId: "lead-3",
      totalValue: 28400,
      advanceReceived: 28400,
      pendingAmount: 0,
      reminderSent: false,
      invoiceStatus: "Paid",
      milestones: [
        { name: "100% Retainer Pre-Purchase", amount: 28400, status: "Paid", dueDate: "2026-04-18" }
      ]
    }
  },
  activityLogs: [
    { id: "log-1", timestamp: "2026-05-10T08:30:00Z", userId: "guest", userName: "Website Request", role: "Customer", action: "Lead Created", details: "Candidate John Miller submitted interest on Sunchaser calculator" },
    { id: "log-2", timestamp: "2026-05-12T14:20:00Z", userId: "u-3", userName: "Sarah Connor", role: "Sales Executive", action: "Quotation Formulated", details: "Drafted 8.5 kW panel layout with 1x Sunchaser Core storage battery ($19,500 total)" },
    { id: "log-3", timestamp: "2026-05-15T11:00:00Z", userId: "u-6", userName: "John Miller", role: "Customer", action: "Proposal Accepted", details: "Electronically signed contract, scheduled installer dispatch" },
    { id: "log-4", timestamp: "2026-05-29T09:12:00Z", userId: "u-4", userName: "Bob Surveyor", role: "Survey Engineer", action: "Structural Audit Finished", details: "Audit completed for John Miller site survey, optimized placement array to South-West roof segment" }
  ],
  whatsAppLogs: [
    { id: "wa-1", timestamp: "2026-05-10T08:31:00Z", customerName: "John Miller", phone: "+1 (555) 349-2091", eventType: "survey_confirmation", messageText: "☀️ Hi John Miller! Welcome to Sunchaser. Your home solar assessment is under engineering review. Sunchaser sales team advisor Sarah Connor will follow up soon.", status: "Delivered" },
    { id: "wa-2", timestamp: "2026-05-12T14:22:00Z", customerName: "John Miller", phone: "+1 (555) 349-2091", eventType: "quote_generation", messageText: "☀️ Hi John! Sunchaser advisor Sarah Connor has unlocked your premium Solar Design Proposal: 8.5 kW Sunchaser Ultra array paired with 13.5kWh Sunchaser Core. Estimated payback is 5.2 years!", status: "Delivered" }
  ],
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
      id: "p-sol-10",
      name: "Sunchaser Sol-Max 10kW Array",
      category: "Solar Systems",
      brand: "Sunchaser Energy",
      model: "Sol-Max Premium 10",
      sku: "SC-SYS-10K",
      price: 14500,
      discount: 1500,
      stock: 45,
      images: ["https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "25 Years",
      specifications: { "Max Output": "10.2 kW", "Cell Type": "MonocrystallineMonocrystalline", "Inverter Pairing": "Ready" },
      installationRequired: true,
      serviceRequired: true
    },
    {
      id: "p-pan-400",
      name: "Sunchaser Ultra 400W Panel",
      category: "Solar Panels",
      brand: "Sunchaser Energy",
      model: "Ultra-400X",
      sku: "SC-PAN-400",
      price: 280,
      discount: 20,
      stock: 450,
      images: ["https://images.unsplash.com/photo-1509391366360-2e959784a276?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "25 Years",
      specifications: { "Efficiency": "21.8%", "Dimensions": "1722 x 1134 x 30 mm", "Weight": "21.5 kg" },
      installationRequired: true,
      serviceRequired: false
    },
    {
      id: "p-inv-en",
      name: "Enphase IQ8 Microinverter",
      category: "Inverters",
      brand: "Enphase Energy",
      model: "IQ8-Plus-72-2-US",
      sku: "EP-INV-IQ8",
      price: 180,
      discount: 0,
      stock: 1210,
      images: ["https://images.unsplash.com/photo-1620038896894-9165b2fa2c6e?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "25 Years",
      specifications: { "Max Output": "300 VA", "Frequency": "60 Hz", "Enclosure": "NEMA 250 Type 6" },
      installationRequired: true,
      serviceRequired: false
    },
    {
      id: "p-bat-13",
      name: "Sunchaser PowerCore 13.5kWh LFP",
      category: "Batteries",
      brand: "Sunchaser Energy",
      model: "PowerCore LFP-13",
      sku: "SC-BAT-13",
      price: 6200,
      discount: 400,
      stock: 80,
      images: ["https://images.unsplash.com/photo-1620714223084-8fcacc6dfd8d?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "10 Years",
      specifications: { "Energy Capacity": "13.5 kWh", "Cell Chemistry": "Lithium Iron Phosphate (LFP)", "Round-trip Efficiency": "92.5%" },
      installationRequired: true,
      serviceRequired: false
    },
    {
      id: "p-ev-c22",
      name: "Sunchaser EV ChargeMax Pro 22kW",
      category: "EV Chargers",
      brand: "Sunchaser Energy",
      model: "ChargeMax-22P",
      sku: "SC-EV-C22",
      price: 850,
      discount: 50,
      stock: 120,
      images: ["https://images.unsplash.com/photo-1563720223185-11003d516935?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "5 Years",
      specifications: { "Power output": "Up to 22 kW", "Current": "32 A", "Connector Type": "CCS Type 2 & J1772" },
      installationRequired: true,
      serviceRequired: true
    },
    {
      id: "p-mob-s25",
      name: "Sunchaser Phone S25 Ultra",
      category: "Mobile Phones",
      brand: "Sunchaser Mobile",
      model: "S25-Ultra-Chaser",
      sku: "SC-MOB-S25",
      price: 1199,
      discount: 100,
      stock: 150,
      images: ["https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "2 Years",
      specifications: { "Processor": "ChaserCore X3", "Memory": "16GB RAM / 512GB Storage", "Camera": "200 MP Quad Array" },
      installationRequired: false,
      serviceRequired: false
    },
    {
      id: "p-el-t12",
      name: "ChaserTab Pro 12\" Electronic Display",
      category: "Electronics",
      brand: "Sunchaser",
      model: "ChaserTab-12Pro",
      sku: "SC-EL-T12",
      price: 499,
      discount: 30,
      stock: 80,
      images: ["https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "1 Year",
      specifications: { "Screen size": "12.4 inches", "Resolution": "2800 x 1752", "Battery": "10,090 mAh" },
      installationRequired: false,
      serviceRequired: false
    },
    {
      id: "p-ap-rf",
      name: "Sunchaser EcoFridge Smart Cooler",
      category: "Appliances",
      brand: "Sunchaser Home",
      model: "EcoFridge-500",
      sku: "SC-AP-RF",
      price: 1899,
      discount: 150,
      stock: 35,
      images: ["https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=800&auto=format&fit=crop&q=60"],
      warrantyPeriod: "5 Years",
      specifications: { "Capacity": "520 Liters", "Energy Rating": "A+++ Multi-Flow", "IoT Mode": "WiFi Connected" },
      installationRequired: true,
      serviceRequired: true
    }
  ],
  orders: [
    {
      id: "ORD-1001",
      customerName: "John Miller",
      email: "john.miller@gmail.com",
      phone: "+1 (555) 349-2091",
      address: "742 Evergreen Terrace, Springfield",
      orderType: "Product",
      status: "Delivered",
      items: [
        { productId: "p-mob-s25", productName: "Sunchaser Phone S25 Ultra", quantity: 1, price: 1099 }
      ],
      totalCost: 1099,
      createdAt: "2026-05-15T11:30:00Z"
    },
    {
      id: "ORD-1002",
      customerName: "Jessica Albright",
      email: "jessica.a@yahoo.com",
      phone: "+1 (555) 872-4411",
      address: "2418 Ridge Road, Fairview",
      orderType: "Product",
      status: "Delivered",
      items: [
        { productId: "p-ev-c22", productName: "Sunchaser EV ChargeMax Pro 22kW", quantity: 1, price: 800 }
      ],
      totalCost: 800,
      createdAt: "2026-05-24T09:45:00Z",
      installationRequired: true
    },
    {
      id: "ORD-1003",
      customerName: "Robert Delgado",
      email: "r.delgado@outlook.com",
      phone: "+1 (555) 761-0022",
      address: "889 Bluebird Lane, Whispering Pines",
      orderType: "Solar Project",
      status: "Installed",
      items: [
        { productId: "p-sol-10", productName: "Sunchaser Sol-Max 10kW Array", quantity: 1, price: 13000 }
      ],
      totalCost: 13000,
      createdAt: "2026-05-02T10:00:00Z",
      installationRequired: true
    }
  ],
  warranties: [
    {
      id: "WAR-2001",
      customerName: "John Miller",
      email: "john.miller@gmail.com",
      productName: "Sunchaser Phone S25 Ultra",
      productSku: "SC-MOB-S25",
      serialNumber: "SN-MOB-S25-4421",
      startDate: "2026-05-15T12:00:00Z",
      endDate: "2028-05-15T12:00:00Z",
      installationDate: "2026-05-15T12:00:00Z",
      status: "Active",
      claimHistory: [
        {
          claimId: "CLM-301",
          claimDate: "2026-05-20T14:00:00Z",
          issueTitle: "Screen flickering",
          description: "Top left region of display shows micro-flickering under low brightness.",
          status: "Approved",
          resolutionNotes: "Replaced panel screen at Springfield customer support hub."
        }
      ]
    },
    {
      id: "WAR-2002",
      customerName: "John Miller",
      email: "john.miller@gmail.com",
      productName: "Sunchaser PowerCore 13.5kWh LFP",
      productSku: "SC-BAT-13",
      serialNumber: "SN-BAT-13-88120",
      startDate: "2026-05-15T08:00:00Z",
      endDate: "2036-05-15T08:00:00Z",
      installationDate: "2026-05-15T08:00:00Z",
      status: "Active",
      claimHistory: []
    },
    {
      id: "WAR-2003",
      customerName: "Jessica Albright",
      email: "jessica.a@yahoo.com",
      productName: "Sunchaser EV ChargeMax Pro 22kW",
      productSku: "SC-EV-C22",
      serialNumber: "SN-EV-C22-10923",
      startDate: "2026-05-24T12:00:00Z",
      endDate: "2031-05-24T12:00:00Z",
      installationDate: "2026-05-24T12:00:00Z",
      status: "Active",
      claimHistory: []
    }
  ],
  notifications: [
    {
      id: "NT-3001",
      customerName: "John Miller",
      message: "Warranty registered successfully for Sunchaser Phone S25 Ultra (SN-MOB-S25-4421).",
      type: "new_order",
      createdAt: "2026-05-15T12:05:00Z",
      read: true
    },
    {
      id: "NT-3002",
      customerName: "John Miller",
      message: "Complaint ticket ticket-102 has been assigned to Technician Dave Installer.",
      type: "technician_assigned",
      createdAt: "2026-05-25T14:40:00Z",
      read: false
    },
    {
      id: "NT-3003",
      customerName: "Jessica Albright",
      message: "Payment confirmed for Sunchaser EV Charger order ORD-1002.",
      type: "payment_pending",
      createdAt: "2026-05-24T09:50:00Z",
      read: false
    }
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

/* --- SUPABASE GETTER / JOINER --- */
export async function fetchAppStateFromSupabase(): Promise<Database> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
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
    purchaseOrdersData
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
    safeFetch("purchase_orders")
  ]);

  // Assemble leads with nested attributes
  const leadsMapped = (leadsData || []).map((lead: any) => {
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
        structureType: q.structure_type,
        accessories: q.accessories,
        installationCharges: Number(q.installation_charges || 0),
        netMeteringCharges: Number(q.net_metering_charges || 0),
        paymentTerms: q.payment_terms,
        warrantyTerms: q.warranty_terms,
        termsAndConditions: q.terms_and_conditions
      }));

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

  return {
    users: users || [],
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
    settings: settingsObj || undefined,
    websiteContent: websiteContentObj || undefined,
    purchaseOrders: purchaseOrdersMapped.length > 0 ? purchaseOrdersMapped : undefined
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

    console.log("🍀 [Sunchaser Migration] Migration successfully completed!");
    return true;
  } catch (err: any) {
    console.error("❌ Exception during Supabase data migration:", err);
    return false;
  }
}
