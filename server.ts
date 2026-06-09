import express from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import {
  CLEANUP_CONFIRM_TOKEN,
  fetchProductionCleanupCounts,
  runProductionBackup20260606,
  runProductionBackupDryRun20260606,
  runProductionCleanup20260606,
} from "./productionCleanupDb.ts";
import { billToMonthlyUnits, resolveMonthlyUnits } from "./src/lib/energyUnits.ts";
import {
  buildQuotePdfSettingsSupabasePayload,
  applyGlobalWatermarkToPdfSettingsRow,
  QUOTE_PDF_GLOBAL_WATERMARK_KEY,
  withResolvedGlobalWatermark,
} from "./src/lib/quotePdfSettingsStore.ts";
import {
  deleteQuoteWatermarkAsset,
  parseQuoteAssetBase64Upload,
  uploadQuoteWatermarkAsset,
} from "./src/lib/quoteAssetsStorage.ts";
import {
  buildWatermarkLayer,
  buildCeoSignatureBlockHtml,
  formatSiteLocation,
  mergeQuoteWithLead,
  parseQuotePageExtendedSettings,
  quotePdfPrintCss,
  quotePdfShellCss,
  renderRichTextBlock,
  resolveTypography,
  typographyStyleAttr,
} from "./src/lib/quotePdfLayout.ts";
import {
  DEFAULT_AUTO_SIZER_BOQ_IDS,
  boqPdfSectionCss,
  filterBoqRowsForPdf,
  renderBoqTableBodyHtml,
} from "./src/lib/quoteBoqPdf.ts";
import { resolveQuoteDiscountAmount, computeNetProposalValue } from "./src/lib/quoteDiscount.ts";
import {
  buildQuotationPdfFilename,
  quotePdfDeckActionBarCss,
  quotePdfDeckPreviewScripts,
  renderQuotationHtmlToPdf,
} from "./src/lib/quotePdfRender.ts";
import {
  buildDefaultPackageCatalog,
  isLegacySolarPackage,
} from "./src/lib/boqPackageLibrary.ts";
import { sanitizeLeadAdvisorInput } from "./src/lib/leadDisplay.ts";
import {
  renderPageBodyHtml,
  quoteAuthoringPrintCss,
  renderEnhancedSignatureBlockHtml,
  type PdfQualityMode,
} from "./src/lib/quoteAuthoring.ts";
import { filterActiveLeads, isActiveLead } from "./src/lib/leadSoftDelete.ts";
import {
  isSupabaseActive,
  getSupabase,
  fetchAppStateFromSupabase,
  fetchLeadsFromSupabase,
  resolveActiveLead,
  fetchActiveLeadRowFromSupabase,
  fetchLeadQuotesFromSupabase,
  findActiveLeadInDb,
  mapSupabaseLeadRowToAppLead,
  buildSupabaseLeadUpdateRow,
  initialSeed,
  getDashboardStats,
  calculateLeadScore,
  Database,
  persistQuotationToSupabase,
  generateQuotationId,
  REQUIRE_EXPLICIT_QUOTE_SAVE,
  resolveAppUserRole,
  fetchCustomerPortalData,
  CustomerPortalAuthError,
  StaffPortalAuthError,
  fetchCustomerPortalDocuments,
  fetchCustomerPortalWarranties,
  createCustomerWarrantyClaim,
  createAdminCustomerDocument,
  upsertAdminCustomerWarranty,
  listAdminWarrantyClaims,
  patchAdminWarrantyClaim,
  fetchCustomerSupportTickets,
  fetchCustomerSupportTicketById,
  createCustomerSupportTicket,
  listAdminSupportTickets,
  updateAdminSupportTicket,
  deleteAdminSupportTicket,
  fetchCustomerServicePortal,
  createCustomerServiceRequest,
  fetchCustomerServiceRequestById,
  listAdminServiceRequests,
  updateAdminServiceRequest,
  fetchCustomerSavings,
  fetchAdminCustomerSavings,
  upsertAdminCustomerSavings,
  fetchCustomerCarePortal,
  subscribeCustomerToCarePlan,
  createCarePortalServiceRequest,
  listAdminCareSubscriptions,
  fetchAdminCareRevenueSummary,
  upsertAdminServiceVisitReport,
  fetchCustomerEquipment,
  fetchCustomerInstallationPhotos,
  fetchCustomerServiceHistory,
  upsertAdminCustomerPortalProfile,
  createAdminCustomerEquipment,
  patchAdminCustomerEquipment,
  createAdminInstallationPhoto,
  createAdminAfterSalesServiceLog,
  listAdminAfterSalesServiceLogs,
  createAdminMaintenanceRecord,
  fetchCustomerEnergyMonitor,
  upsertAdminEnergyDevice,
  fetchAdminEnergyMonitoring,
  TechnicalStaffAuthError,
  listTechnicalJobsForUser,
  getTechnicalJobById,
  patchTechnicalJobStatus,
  postTechnicalJobUpdate,
  postTechnicalEquipment,
  fetchOnboardingMe,
  completeOnboarding,
  resetOnboarding,
} from "./dbManager.js";
import {
  listAdminProjectDeliveries,
  createAdminProjectDelivery,
  patchAdminProjectDelivery,
  addAdminProjectDeliveryItems,
  listTechnicalProjectDeliveriesForUser,
  getTechnicalProjectDeliveryById,
  postTechnicalInstalledEquipment,
  postTechnicalProjectDeliveryPhotos,
  patchTechnicalProjectDeliveryStatus,
  fetchCustomerProjectDeliveryMe,
  ProjectDeliveryDbError,
} from "./projectDeliveryDb.js";
import {
  getCompletionStatusBundle,
  postTechnicalCompletionMedia,
  patchTechnicalCompletionStage,
  listAdminCompletionGaps,
  compileWarrantyHandoverHtmlForDelivery,
  fetchCustomerWarrantyHandoverMe,
  ProjectCompletionDbError,
} from "./projectCompletionDb.js";
import {
  fetchAdminWarrantyCertificateHtml,
  fetchPortalWarrantyCertificateHtml,
  maybeSyncWarrantyCertificateDocument,
  WarrantyCertificateDbError,
} from "./warrantyCertificateDb.js";
import {
  listAdminInventoryFoundationItems,
  listAdminLowStockItems,
  createAdminInventoryFoundationItem,
  stockInAdminInventoryItem,
  stockOutAdminInventoryItem,
  adjustAdminInventoryItem,
  reserveAdminInventoryForProject,
  releaseAdminInventoryReservation,
  listAdminInventoryMovements,
  listAdminInventoryReservations,
  InventoryFoundationDbError,
} from "./inventoryFoundationDb.js";
import {
  fetchAdminFinanceSummary,
  listAdminFinanceProjects,
  getAdminFinanceProjectById,
  createAdminFinanceProject,
  patchAdminFinanceProject,
  getStaffProjectPayments,
  fetchCustomerPortalPaymentsMe,
  logWhatsAppMessageOpened,
  listAdminWhatsAppLogs,
  ProjectFinanceDbError,
} from "./projectFinanceDb.js";
import {
  authenticateUser,
  registerUser,
  verifyEmailToken,
  requestPasswordReset,
  resetPasswordWithToken,
  listUsersForAdmin,
  listPendingUsers,
  approveUser,
  rejectUser,
  createUserByAdmin,
  updateUserByAdmin,
  deleteUserByAdmin,
  listDemoSeedUsersForCleanup,
  deleteDemoSeedUsersByAdmin,
  UserAuthError,
} from "./userAuthDb.js";
import {
  listManagedRoles,
  createManagedRole,
  updateManagedRole,
  deleteManagedRole,
  cloneManagedRole,
  getRolesMatrixFromDb,
  RoleManagementError,
} from "./roleManagementDb.js";
import {
  listCustomerPortalAccounts,
  getCustomerSystemProfile,
  upsertCustomerSystemProfile,
  listAdminCustomerDocuments,
  assignCustomerDocument,
  uploadFileToCustomerStorage,
  fetchCustomerPortalSystemMe,
  CustomerProfileError,
} from "./customerProfileDb.js";
import {
  searchCustomersForLinking,
  searchPortalUsersForLinking,
  detectDuplicateCustomers,
  linkCustomerPortalAccounts,
  resolveCustomerForLeadContact,
  CustomerLinkingError,
} from "./customerLinkingDb.js";
import { ALL_PERMISSION_KEYS, PERMISSION_LABELS } from "./src/lib/roles.js";
import {
  listAdminInvoices,
  getAdminInvoiceById,
  createAdminInvoice,
  updateAdminInvoice,
  recordInvoicePayment,
  fetchCustomerPortalInvoicesMe,
  setInvoicePdfUrl,
  syncInvoiceToCustomerDocuments,
  listContractedLeadsReadyForInvoice,
  createInvoiceFromContractedLead,
  archiveAdminInvoice,
  bulkDeleteAdminInvoices,
  deleteAdminInvoice,
  InvoiceDbError,
} from "./invoiceDb.js";
import { provisionContractToInvoiceWorkflow } from "./contractToInvoiceDb.js";
import { compileInvoicePDFHtml } from "./invoicePdf.js";
import { buildInvoicePdfPayload } from "./invoicePdfResolve.js";
import {
  listPartyLedgers,
  getPartyLedgerDetail,
  archivePartyLedger,
  restorePartyLedger,
  hardDeletePartyLedger,
} from "./partyLedgerDb.js";
import { findExistingCustomerIdForLinking } from "./invoiceCustomerLink.js";
import { generateCustomerCode } from "./customerCode.js";
import { syncQuotationDocumentVault } from "./customerDocumentSync.js";
import { fetchFinanceDashboard } from "./financeDashboardDb.js";
import {
  fetchProjectOperationsDashboard,
  fetchProjectOperationsDetail,
} from "./projectOperationsDb.js";
import { getCompanyBranding, saveCompanyBranding } from "./brandingDb.js";
import { mergeBranding } from "./src/lib/branding.js";
import {
  countQuoteItemRows,
  getLatestSavedQuote,
  getQuoteSortTime,
} from "./src/lib/quoteSelection.ts";

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

async function syncQuotationVaultForLead(
  lead: { name?: string; phone?: string; email?: string },
  leadId: string,
  quoteId: string,
  customerIdHint: string | null | undefined,
  localDb?: Database
) {
  if (!quoteId || !leadId) return;
  const customerId =
    (await findExistingCustomerIdForLinking({ phone: lead.phone, email: lead.email }, localDb)) ||
    customerIdHint ||
    null;
  if (!customerId) return;
  try {
    await syncQuotationDocumentVault(
      {
        customerId,
        leadId,
        quoteId,
        title: `Quotation for ${lead.name || "Customer"}`,
      },
      localDb
    );
  } catch (err: any) {
    console.warn("[QuotationDocumentSync]", err?.message || err);
  }
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));

// Custom CORS middleware to allow the frontend domain to call the backend API securely
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept, Origin, X-Requested-With, X-Sunchaser-User-Id, X-Sunchaser-Username, X-Sunchaser-Role"
  );
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
        if (!db.quoteTemplates) db.quoteTemplates = initialSeed.quoteTemplates;
        if (!db.quoteTemplatePages) db.quoteTemplatePages = initialSeed.quoteTemplatePages;
        if (!db.bankAccounts) db.bankAccounts = initialSeed.bankAccounts;
        if (!db.companyTerms) db.companyTerms = initialSeed.companyTerms;
        if (!db.ceoMessages) db.ceoMessages = initialSeed.ceoMessages;
        if (!db.socialLinks) db.socialLinks = initialSeed.socialLinks;
        if (!db.structureDescriptions) db.structureDescriptions = initialSeed.structureDescriptions;
        if (!db.quotePdfSettings) db.quotePdfSettings = initialSeed.quotePdfSettings;
        
        // BOQ package library (structure × tier matrix per system size)
        const packageLibraryVersion = Number(db.settings?.packageLibraryVersion || 0);
        let migratedPackageLibrary = false;
        if (
          !db.solarPackages?.length ||
          packageLibraryVersion < 2 ||
          db.solarPackages.some(isLegacySolarPackage)
        ) {
          db.solarPackages = buildDefaultPackageCatalog();
          db.settings = { ...(db.settings || {}), packageLibraryVersion: 2 };
          migratedPackageLibrary = true;
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
        if (migratedPackageLibrary) {
          saveDb();
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
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("FS Write error inside saveDb:", err);
  }
}

async function getLeadsForInvoiceOps() {
  if (isSupabaseActive()) {
    const state = await fetchAppStateFromSupabase();
    return filterActiveLeads(state?.leads || []);
  }
  return filterActiveLeads(db.leads || []);
}

function resolveDeletedBy(req: { headers: Record<string, string | string[] | undefined> }): string {
  const userId = String(req.headers["x-sunchaser-user-id"] || "").trim();
  const username = String(req.headers["x-sunchaser-username"] || "").trim();
  const role = String(req.headers["x-sunchaser-role"] || "").trim();
  if (username && userId) return `${username} (${userId})`;
  if (username) return username;
  if (role) return role;
  return "system";
}

function toAppLead(leadId: string, resolved: any, supabase?: ReturnType<typeof getSupabase>): any {
  const mapped =
    resolved != null && typeof resolved.monthly_bill !== "undefined"
      ? mapSupabaseLeadRowToAppLead(resolved)
      : { ...resolved, quotes: resolved?.quotes || [] };
  if (supabase) return { ...mapped, quotes: mapped.quotes || [] };
  let lead = findActiveLeadInDb(leadId, db.leads);
  if (lead) return lead;
  db.leads.push({ ...mapped, quotes: mapped.quotes || [] });
  return db.leads[db.leads.length - 1];
}

async function resolveLeadForMutation(
  leadId: string,
  options: { includeQuotes?: boolean } = {}
): Promise<{ lead: any; resolved: any; supabase: ReturnType<typeof getSupabase> | undefined } | null> {
  loadDb();
  const supabase = isSupabaseActive() ? getSupabase()! : undefined;
  const resolved = await resolveActiveLead(leadId, supabase, db.leads);
  if (!resolved) return null;
  const lead = toAppLead(leadId, resolved, supabase);
  if (supabase && options.includeQuotes) {
    lead.quotes = await fetchLeadQuotesFromSupabase(supabase, leadId);
  }
  return { lead, resolved, supabase };
}

function persistLeadLocally(leadId: string, lead: any, supabase?: ReturnType<typeof getSupabase>): void {
  if (supabase) return;
  const localIndex = db.leads.findIndex((l: any) => l.id === leadId);
  if (localIndex >= 0) db.leads[localIndex] = lead;
  saveDb();
}

function softDeleteLeadInLocalStore(leadId: string, deletedBy: string): boolean {
  loadDb();
  const index = (db.leads || []).findIndex((l: any) => l.id === leadId);
  if (index === -1) return false;
  const deletedAt = new Date().toISOString();
  db.leads[index] = {
    ...db.leads[index],
    deletedAt,
    deletedBy,
    deleted_at: deletedAt,
    deleted_by: deletedBy,
  };
  saveDb();
  return true;
}

async function softDeleteLeadInSupabase(leadId: string, deletedBy: string): Promise<void> {
  const supabase = getSupabase()!;
  const deletedAt = new Date().toISOString();
  const { data: existing, error: fetchErr } = await supabase
    .from("leads")
    .select("id, deleted_at")
    .eq("id", leadId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) throw new Error(`Lead ${leadId} not found in Supabase.`);

  const { error: updateErr } = await supabase
    .from("leads")
    .update({ deleted_at: deletedAt, deleted_by: deletedBy })
    .eq("id", leadId);
  if (updateErr) throw updateErr;

  const { data: verify, error: verifyErr } = await supabase
    .from("leads")
    .select("id, deleted_at")
    .eq("id", leadId)
    .maybeSingle();
  if (verifyErr) throw verifyErr;
  if (!verify?.deleted_at) {
    throw new Error(`Lead ${leadId} soft delete did not persist (deleted_at still null).`);
  }
}

async function restoreLeadInSupabase(leadId: string): Promise<void> {
  const supabase = getSupabase()!;
  const { error } = await supabase
    .from("leads")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", leadId);
  if (error) throw error;
}

function restoreLeadInLocalStore(leadId: string): boolean {
  loadDb();
  const index = (db.leads || []).findIndex((l: any) => l.id === leadId);
  if (index === -1) return false;
  const { deletedAt: _d, deletedBy: _b, deleted_at: _da, deleted_by: _db, ...rest } = db.leads[index];
  db.leads[index] = rest;
  saveDb();
  return true;
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

// 1. Auth — login, register, verify, reset, admin user management
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedPassword = String(password ?? "");

  if (!normalizedUsername || !normalizedPassword) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  try {
    loadDb();
    const user = await authenticateUser(normalizedUsername, normalizedPassword, db);
    await appendActivityLog(
      user.id,
      user.name,
      user.role,
      "User Logged In",
      `Role ${user.role} · status ${user.accountStatus}`
    );
    return res.json({ success: true, user });
  } catch (err: any) {
    if (err instanceof UserAuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("[Login Error]:", err);
    return res.status(500).json({ error: err.message || "Login failed." });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    loadDb();
    const result = await registerUser(req.body || {}, db);
    saveDb();
    return res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/verify-email", async (req, res) => {
  try {
    loadDb();
    const result = await verifyEmailToken(req.body?.token || req.query?.token, db);
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/verify-email", async (req, res) => {
  try {
    loadDb();
    const result = await verifyEmailToken(String(req.query?.token || ""), db);
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    loadDb();
    const result = await requestPasswordReset(String(req.body?.email || ""), db);
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    loadDb();
    const result = await resetPasswordWithToken(
      String(req.body?.token || ""),
      String(req.body?.password || ""),
      db
    );
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

function readStaffAuth(req: express.Request) {
  return {
    userId: String(req.headers["x-sunchaser-user-id"] || req.body?.userId || "").trim(),
    username: String(req.headers["x-sunchaser-username"] || req.body?.username || "").trim(),
    role: String(req.headers["x-sunchaser-role"] || req.body?.role || "").trim(),
  };
}

/** Staff auth for user-management writes: never treat new-user fields in body as actor identity. */
function readStaffAuthHeadersOnly(req: express.Request) {
  return {
    userId: String(req.headers["x-sunchaser-user-id"] || "").trim(),
    username: String(req.headers["x-sunchaser-username"] || "").trim(),
    role: String(req.headers["x-sunchaser-role"] || "").trim(),
  };
}

function activityActorFromStaff(req: express.Request, fallback = "Staff") {
  const { username } = readStaffAuth(req);
  return username || fallback;
}

function leadAdvisorLabel(advisor?: string | null) {
  return sanitizeLeadAdvisorInput(advisor) || "Sales Team";
}

app.get("/api/admin/users", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  try {
    loadDb();
    const users = await listUsersForAdmin(userId, username, db);
    return res.json({ users });
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/users/pending", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  try {
    loadDb();
    const users = await listPendingUsers(userId, username, db);
    return res.json({ users });
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/users", async (req, res) => {
  const { userId, username } = readStaffAuthHeadersOnly(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const user = await createUserByAdmin(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json({ user });
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/users/:id", async (req, res) => {
  const { userId, username } = readStaffAuthHeadersOnly(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const user = await updateUserByAdmin(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json({ user });
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/users/:id", async (req, res) => {
  const { userId, username } = readStaffAuthHeadersOnly(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const result = await deleteUserByAdmin(
      userId,
      username,
      req.params.id,
      {
        confirmText: String(req.body?.confirmText || req.query?.confirmText || ""),
        unlinkCustomer: req.body?.unlinkCustomer !== false,
      },
      db
    );
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/users/demo-seeds", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  try {
    loadDb();
    const users = await listDemoSeedUsersForCleanup(userId, username, db);
    return res.json({ users });
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/users/demo-seeds/delete", async (req, res) => {
  const { userId, username } = readStaffAuthHeadersOnly(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const result = await deleteDemoSeedUsersByAdmin(userId, username, req.body || {}, db);
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/users/:id/approve", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  try {
    loadDb();
    const result = await approveUser(userId, username, req.params.id, db);
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/users/:id/reject", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  try {
    loadDb();
    const result = await rejectUser(
      userId,
      username,
      req.params.id,
      String(req.body?.reason || ""),
      db
    );
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/roles-matrix", async (req, res) => {
  const userId = String(req.headers["x-sunchaser-user-id"] || "").trim();
  const username = String(req.headers["x-sunchaser-username"] || "").trim();
  try {
    loadDb();
    const payload = await getRolesMatrixFromDb(userId || null, username || null, db);
    return res.json({
      ...payload,
      permissionKeys: payload.permissionKeys || [...ALL_PERMISSION_KEYS],
      permissionLabels: payload.permissionLabels || PERMISSION_LABELS,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/roles", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  try {
    loadDb();
    const roles = await listManagedRoles(userId, username, db);
    return res.json({ roles });
  } catch (err: any) {
    if (err instanceof RoleManagementError || err instanceof UserAuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/roles", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  try {
    loadDb();
    const role = await createManagedRole(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json({ role });
  } catch (err: any) {
    if (err instanceof RoleManagementError || err instanceof UserAuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/roles/:id", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  try {
    loadDb();
    const role = await updateManagedRole(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json({ role });
  } catch (err: any) {
    if (err instanceof RoleManagementError || err instanceof UserAuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/roles/:id/clone", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  try {
    loadDb();
    const role = await cloneManagedRole(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.status(201).json({ role });
  } catch (err: any) {
    if (err instanceof RoleManagementError || err instanceof UserAuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/roles/:id", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  try {
    loadDb();
    const result = await deleteManagedRole(userId, username, req.params.id, db);
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof RoleManagementError || err instanceof UserAuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/customer-accounts", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  try {
    loadDb();
    const accounts = await listCustomerPortalAccounts(userId, username, role, db);
    return res.json({ accounts });
  } catch (err: any) {
    if (err instanceof CustomerProfileError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/customer-linking/customers", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  try {
    loadDb();
    const customers = await searchCustomersForLinking(
      userId,
      username,
      role,
      String(req.query.q || ""),
      db
    );
    return res.json({ customers });
  } catch (err: any) {
    if (err instanceof CustomerLinkingError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/customer-linking/users", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  try {
    loadDb();
    const users = await searchPortalUsersForLinking(
      userId,
      username,
      role,
      String(req.query.q || ""),
      db
    );
    return res.json({ users });
  } catch (err: any) {
    if (err instanceof CustomerLinkingError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/customer-linking/duplicates", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  try {
    loadDb();
    const duplicates = await detectDuplicateCustomers(userId, username, role, db);
    return res.json({ duplicates });
  } catch (err: any) {
    if (err instanceof CustomerLinkingError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/customer-linking/resolve", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  try {
    loadDb();
    const customer = await resolveCustomerForLeadContact(
      userId,
      username,
      role,
      {
        email: String(req.query.email || ""),
        phone: String(req.query.phone || ""),
        customerId: String(req.query.customerId || ""),
      },
      db
    );
    return res.json({ customer });
  } catch (err: any) {
    if (err instanceof CustomerLinkingError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/customer-linking/link", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  try {
    loadDb();
    const result = await linkCustomerPortalAccounts(
      userId,
      username,
      role,
      String(req.body?.customerId || ""),
      String(req.body?.userId || ""),
      !!req.body?.confirmOverride,
      db
    );
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof CustomerLinkingError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/customer-systems/:customerId", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  try {
    loadDb();
    const system = await getCustomerSystemProfile(userId, username, role, req.params.customerId, db);
    return res.json({ system });
  } catch (err: any) {
    if (err instanceof CustomerProfileError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/customer-systems", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  try {
    loadDb();
    const system = await upsertCustomerSystemProfile(userId, username, role, req.body || {}, db);
    saveDb();
    return res.json({ system });
  } catch (err: any) {
    if (err instanceof CustomerProfileError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/customer-documents/:customerId", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  try {
    loadDb();
    const documents = await listAdminCustomerDocuments(
      userId,
      username,
      role,
      req.params.customerId,
      db
    );
    return res.json({ documents });
  } catch (err: any) {
    if (err instanceof CustomerProfileError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/customer-documents/assign", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  try {
    loadDb();
    const doc = await assignCustomerDocument(userId, username, role, req.body || {}, db);
    saveDb();
    return res.status(201).json(doc);
  } catch (err: any) {
    if (err instanceof CustomerProfileError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/customer-documents/upload", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  const { customerId, base64Data, fileName, mimeType, documentType, title, visibleToCustomer, internalOnly, notes } =
    req.body || {};
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const { url, storagePath } = await uploadFileToCustomerStorage(
      String(customerId),
      String(base64Data),
      String(fileName || "document"),
      mimeType
    );
    const role = String(req.body?.role || "");
    const doc = await assignCustomerDocument(userId, username, role, {
      customerId: String(customerId),
      documentType: documentType || "other",
      title: title || fileName,
      fileUrl: url,
      fileName,
      mimeType,
      storagePath,
      visibleToCustomer: visibleToCustomer !== false,
      internalOnly: !!internalOnly,
      notes,
      uploadedBy: username,
    }, db);
    saveDb();
    return res.status(201).json(doc);
  } catch (err: any) {
    if (err instanceof CustomerProfileError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/customer-portal/system/me", async (req, res) => {
  const userId = String(req.query.userId || "").trim();
  const username = String(req.query.username || "").trim();
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await fetchCustomerPortalSystemMe(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerProfileError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

async function handleCustomerPortalMe(req: any, res: any) {
  const userId = String(
    req.headers["x-sunchaser-user-id"] || req.body?.userId || req.query?.userId || ""
  ).trim();
  const username = String(
    req.headers["x-sunchaser-username"] || req.body?.username || req.query?.username || ""
  ).trim();

  if (!userId || !username) {
    return res.status(400).json({ error: "userId and username are required." });
  }

  try {
    loadDb();
    const data = await fetchCustomerPortalData(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) {
      return res.status(403).json({ error: err.message });
    }
    console.error("[Customer Portal Error]:", err.message);
    return res.status(500).json({ error: err.message || "Failed to load customer portal." });
  }
}

app.get("/api/customer-portal/me", handleCustomerPortalMe);
app.post("/api/customer-portal/me", handleCustomerPortalMe);

function readPortalAuth(req: any) {
  return {
    userId: String(req.headers["x-sunchaser-user-id"] || req.body?.userId || req.query?.userId || "").trim(),
    username: String(req.headers["x-sunchaser-username"] || req.body?.username || req.query?.username || "").trim(),
  };
}

/** Customer portal service routes: identity must come from headers only (no body/query override). */
function readCustomerPortalAuth(req: any) {
  return {
    userId: String(req.headers["x-sunchaser-user-id"] || "").trim(),
    username: String(req.headers["x-sunchaser-username"] || "").trim(),
  };
}

function formatPortalApiError(err: any, context: { endpoint: string; query: string }) {
  console.error(`[Customer Portal Phase2] ${context.endpoint}`, {
    message: err?.message,
    code: err?.code,
    details: err?.details,
    hint: err?.hint,
    stack: err?.stack,
    query: context.query,
  });
  return {
    error: err?.message || "Request failed.",
    code: err?.code,
    details: err?.details,
    hint: err?.hint,
    endpoint: context.endpoint,
    query: context.query,
    supabaseUrl: process.env.SUPABASE_URL || null,
  };
}

app.get("/api/customer-portal/documents/me", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username are required." });
  const query =
    'supabase.from("customer_documents").select("*").eq("customer_id", <resolvedCustomerId>).order("uploaded_at", { ascending: false })';
  try {
    loadDb();
    const data = await fetchCustomerPortalDocuments(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/documents/me", query }));
  }
});

app.get("/api/customer-portal/warranties/me", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username are required." });
  const query =
    'supabase.from("customer_warranties").select("*").eq("customer_id", <resolvedCustomerId>)';
  try {
    loadDb();
    const data = await fetchCustomerPortalWarranties(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/warranties/me", query }));
  }
});

app.post("/api/customer-portal/warranty-claim", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username are required." });
  const query =
    'supabase.from("support_tickets").insert(...); supabase.from("warranty_claims").insert(...)';
  try {
    loadDb();
    const claim = await createCustomerWarrantyClaim(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(claim);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "POST /api/customer-portal/warranty-claim", query }));
  }
});

app.get("/api/customer-portal/savings/me", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) {
    return res.status(400).json({ error: "X-Sunchaser-User-Id and X-Sunchaser-Username headers are required." });
  }
  try {
    loadDb();
    const data = await fetchCustomerSavings(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/savings/me", query: "customer_savings_profiles" }));
  }
});

app.get("/api/admin/customer-savings/:customerId", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const data = await fetchAdminCustomerSavings(userId, username, req.params.customerId, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/customer-savings", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const result = await upsertAdminCustomerSavings(userId, username, req.body || {}, db);
    saveDb();
    return res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/customer-portal/care/me", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) {
    return res.status(400).json({ error: "X-Sunchaser-User-Id and X-Sunchaser-Username headers are required." });
  }
  try {
    loadDb();
    const data = await fetchCustomerCarePortal(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/care/me", query: "subscription_plans, customer_subscriptions" }));
  }
});

app.post("/api/customer-portal/care/subscribe", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) {
    return res.status(400).json({ error: "X-Sunchaser-User-Id and X-Sunchaser-Username headers are required." });
  }
  try {
    loadDb();
    const subscription = await subscribeCustomerToCarePlan(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(subscription);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "POST /api/customer-portal/care/subscribe", query: "insert customer_subscriptions" }));
  }
});

app.post("/api/customer-portal/care/service-request", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) {
    return res.status(400).json({ error: "X-Sunchaser-User-Id and X-Sunchaser-Username headers are required." });
  }
  try {
    loadDb();
    const result = await createCarePortalServiceRequest(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "POST /api/customer-portal/care/service-request", query: "service_requests + credits" }));
  }
});

app.get("/api/admin/care/subscriptions", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const data = await listAdminCareSubscriptions(userId, username, { segment: String(req.query.segment || "active") }, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/care/revenue-summary", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const data = await fetchAdminCareRevenueSummary(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/care/visit-reports", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const report = await upsertAdminServiceVisitReport(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(report);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/customer-portal-profile", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const profile = await upsertAdminCustomerPortalProfile(userId, username, req.body || {}, db);
    saveDb();
    return res.status(200).json(profile);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/customer-equipment", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const row = await createAdminCustomerEquipment(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(row);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/customer-equipment/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const row = await patchAdminCustomerEquipment(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json(row);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/installation-photos", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const photo = await createAdminInstallationPhoto(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(photo);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/after-sales-service-log", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const log = await createAdminAfterSalesServiceLog(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(log);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/maintenance-records", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const record = await createAdminMaintenanceRecord(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(record);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/customer-portal/energy/me", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) {
    return res.status(400).json({ error: "X-Sunchaser-User-Id and X-Sunchaser-Username headers are required." });
  }
  try {
    loadDb();
    const data = await fetchCustomerEnergyMonitor(userId, username, db);
    saveDb();
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/energy/me", query: "customer_energy_devices" }));
  }
});

app.post("/api/admin/energy/devices", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const device = await upsertAdminEnergyDevice(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(device);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/energy/monitoring", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const data = await fetchAdminEnergyMonitoring(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/after-sales-service-logs", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const data = await listAdminAfterSalesServiceLogs(userId, username, {
      customerId: req.query.customerId as string,
    }, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/customer-portal/equipment/me", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) {
    return res.status(400).json({ error: "X-Sunchaser-User-Id and X-Sunchaser-Username headers are required." });
  }
  try {
    loadDb();
    const data = await fetchCustomerEquipment(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/equipment/me", query: "customer_equipment" }));
  }
});

app.get("/api/customer-portal/installation-photos/me", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) {
    return res.status(400).json({ error: "X-Sunchaser-User-Id and X-Sunchaser-Username headers are required." });
  }
  try {
    loadDb();
    const data = await fetchCustomerInstallationPhotos(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/installation-photos/me", query: "installation_photos" }));
  }
});

app.get("/api/customer-portal/service-history/me", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) {
    return res.status(400).json({ error: "X-Sunchaser-User-Id and X-Sunchaser-Username headers are required." });
  }
  try {
    loadDb();
    const data = await fetchCustomerServiceHistory(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/service-history/me", query: "after_sales_service_logs" }));
  }
});

app.get("/api/customer-portal/service/me", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) {
    return res.status(400).json({ error: "X-Sunchaser-User-Id and X-Sunchaser-Username headers are required." });
  }
  try {
    loadDb();
    const data = await fetchCustomerServicePortal(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/service/me", query: "service_requests by customer_id" }));
  }
});

app.post("/api/customer-portal/service-requests", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) {
    return res.status(400).json({ error: "X-Sunchaser-User-Id and X-Sunchaser-Username headers are required." });
  }
  const { serviceType, preferredDate, preferredTime, notes } = req.body || {};
  try {
    loadDb();
    const request = await createCustomerServiceRequest(
      userId,
      username,
      { serviceType, preferredDate, preferredTime, notes },
      db
    );
    saveDb();
    return res.status(201).json(request);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "POST /api/customer-portal/service-requests", query: "insert service_requests" }));
  }
});

app.get("/api/customer-portal/service-requests/:id", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) {
    return res.status(400).json({ error: "X-Sunchaser-User-Id and X-Sunchaser-Username headers are required." });
  }
  try {
    loadDb();
    const data = await fetchCustomerServiceRequestById(userId, username, req.params.id, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/service-requests/:id", query: "service_requests single" }));
  }
});

app.get("/api/admin/service-requests", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const requests = await listAdminServiceRequests(userId, username, {
      status: req.query.status as string,
    }, db);
    return res.json({ requests });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/service-requests/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const request = await updateAdminServiceRequest(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json(request);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/service-requests/:id/update", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const request = await updateAdminServiceRequest(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json(request);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/customer-portal/support-tickets/me", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username are required." });
  try {
    loadDb();
    const data = await fetchCustomerSupportTickets(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/support-tickets/me", query: "support_tickets by customer_id" }));
  }
});

app.post("/api/customer-portal/support-tickets", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username are required." });
  try {
    loadDb();
    const ticket = await createCustomerSupportTicket(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(ticket);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "POST /api/customer-portal/support-tickets", query: "insert support_tickets" }));
  }
});

app.get("/api/customer-portal/support-tickets/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username are required." });
  try {
    loadDb();
    const data = await fetchCustomerSupportTicketById(userId, username, req.params.id, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json(formatPortalApiError(err, { endpoint: "GET /api/customer-portal/support-tickets/:id", query: "support_tickets single" }));
  }
});

app.get("/api/admin/support-tickets", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const tickets = await listAdminSupportTickets(
      userId,
      username,
      {
        status: req.query.status as string,
        category: req.query.category as string,
        priority: req.query.priority as string,
      },
      db
    );
    return res.json({ tickets });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/support-tickets/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const ticket = await updateAdminSupportTicket(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json(ticket);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/support-tickets/:id/update", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const ticket = await updateAdminSupportTicket(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json(ticket);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/support-tickets/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff credentials required." });
  try {
    loadDb();
    const result = await deleteAdminSupportTicket(userId, username, req.params.id, db);
    saveDb();
    return res.json({ success: true, ...result });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) {
      const status = err.message === "Ticket not found." ? 404 : err.statusCode;
      return res.status(status).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/technical/jobs/me", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await listTechnicalJobsForUser(userId, username, db);
    saveDb();
    return res.json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/technical/jobs/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await getTechnicalJobById(userId, username, req.params.id, db);
    saveDb();
    return res.json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/technical/jobs/:id/status", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  const status = String(req.body?.status || "").trim();
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  if (!status) return res.status(400).json({ error: "status is required." });
  try {
    loadDb();
    const data = await patchTechnicalJobStatus(userId, username, req.params.id, status, db);
    saveDb();
    return res.json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/technical/jobs/:id/update", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await postTechnicalJobUpdate(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/technical/equipment", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await postTechnicalEquipment(userId, username, req.body || {}, db);
    saveDb();
    return res.json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/onboarding/me", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await fetchOnboardingMe(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/onboarding/complete", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await completeOnboarding(userId, username, db);
    saveDb();
    return res.json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/onboarding/reset", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await resetOnboarding(userId, username, db);
    saveDb();
    return res.json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/project-deliveries", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const list = await listAdminProjectDeliveries(userId, username, db);
    return res.json(list);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/project-deliveries", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const row = await createAdminProjectDelivery(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(row);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/project-deliveries/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const row = await patchAdminProjectDelivery(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json(row);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/project-deliveries/:id/items", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const items = await addAdminProjectDeliveryItems(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.status(201).json(items);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/technical/project-deliveries/me", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const list = await listTechnicalProjectDeliveriesForUser(userId, username, db);
    return res.json({ deliveries: list });
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/technical/project-deliveries/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await getTechnicalProjectDeliveryById(userId, username, req.params.id, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/technical/project-deliveries/:id/installed-equipment", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await postTechnicalInstalledEquipment(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.status(201).json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/technical/project-deliveries/:id/photos", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await postTechnicalProjectDeliveryPhotos(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.status(201).json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/technical/project-deliveries/:id/status", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await patchTechnicalProjectDeliveryStatus(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json(data);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/customer-portal/project-delivery/me", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await fetchCustomerProjectDeliveryMe(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/technical/project-deliveries/:id/completion-status", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Auth required." });
  try {
    loadDb();
    const status = await getCompletionStatusBundle(req.params.id, db);
    return res.json(status);
  } catch (err: any) {
    if (err instanceof ProjectCompletionDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/technical/project-deliveries/:id/completion-media", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Auth required." });
  try {
    loadDb();
    const media = await postTechnicalCompletionMedia(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.status(201).json({ media });
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof ProjectCompletionDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/technical/project-deliveries/:id/completion-stage", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Auth required." });
  try {
    loadDb();
    const result = await patchTechnicalCompletionStage(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof TechnicalStaffAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof ProjectCompletionDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/project-completion/gaps", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await listAdminCompletionGaps(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/export/pdf/warranty-handover/:deliveryId", async (req, res) => {
  const staffId = String(req.headers["x-sunchaser-user-id"] || req.query.userId || "").trim();
  const staffUsername = String(req.headers["x-sunchaser-username"] || req.query.username || "").trim();
  const portalUserId = String(req.query.portalUserId || "").trim();
  const portalUsername = String(req.query.portalUsername || "").trim();
  try {
    loadDb();
    if (portalUserId && portalUsername) {
      const portal = await fetchCustomerWarrantyHandoverMe(portalUserId, portalUsername, db);
      if (!portal.deliveryId || portal.deliveryId !== req.params.deliveryId) {
        return res.status(403).json({ error: "Access denied." });
      }
    }
    const html = await compileWarrantyHandoverHtmlForDelivery(req.params.deliveryId, db);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof ProjectCompletionDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/customer-portal/warranty-handover/me", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Auth required." });
  try {
    loadDb();
    const data = await fetchCustomerWarrantyHandoverMe(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

function readCustomerPortalAuthForDownload(req: any) {
  const fromHeaders = readCustomerPortalAuth(req);
  if (fromHeaders.userId && fromHeaders.username) return fromHeaders;
  return {
    userId: String(req.query.portalUserId || "").trim(),
    username: String(req.query.portalUsername || "").trim(),
  };
}

app.get("/api/admin/customers/:customerId/warranty-certificate", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff userId and username are required." });
  try {
    loadDb();
    const html = await fetchAdminWarrantyCertificateHtml(userId, username, req.params.customerId, db);
    if (!isSupabaseActive()) saveDb();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof WarrantyCertificateDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/customer-portal/warranty-certificate/me", async (req, res) => {
  const { userId, username } = readCustomerPortalAuthForDownload(req);
  if (!userId || !username) return res.status(400).json({ error: "Auth required." });
  try {
    loadDb();
    const html = await fetchPortalWarrantyCertificateHtml(userId, username, db);
    if (!isSupabaseActive()) saveDb();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof WarrantyCertificateDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/finance/summary", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await fetchAdminFinanceSummary(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof ProjectFinanceDbError) return res.status(400).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/finance/projects", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const list = await listAdminFinanceProjects(userId, username, db);
    return res.json(list);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof ProjectFinanceDbError) return res.status(400).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/finance/projects/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const row = await getAdminFinanceProjectById(userId, username, req.params.id, db);
    return res.json(row);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof ProjectFinanceDbError) return res.status(404).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/finance/projects", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const row = await createAdminFinanceProject(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(row);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof ProjectFinanceDbError) return res.status(400).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/finance/projects/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const row = await patchAdminFinanceProject(userId, username, req.params.id, req.body || {}, db);
    saveDb();
    return res.json(row);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof ProjectFinanceDbError) return res.status(404).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/branding", async (_req, res) => {
  try {
    loadDb();
    const branding = await getCompanyBranding(db);
    return res.json({ branding });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/branding", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  try {
    loadDb();
    const branding = await getCompanyBranding(db);
    return res.json({ branding });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/branding", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const branding = await saveCompanyBranding(userId, username, req.body || {}, db);
    saveDb();
    return res.json({ branding });
  } catch (err: any) {
    if (err instanceof UserAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

function handleInventoryDbError(err: any, res: express.Response) {
  if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
  if (err instanceof InventoryFoundationDbError) return res.status(err.statusCode).json({ error: err.message });
  return res.status(500).json({ error: err.message });
}

app.get("/api/admin/inventory/items", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await listAdminInventoryFoundationItems(userId, username, role, db);
    return res.json(data);
  } catch (err: any) {
    return handleInventoryDbError(err, res);
  }
});

app.get("/api/admin/inventory/low-stock", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await listAdminLowStockItems(userId, username, role, db);
    return res.json(data);
  } catch (err: any) {
    return handleInventoryDbError(err, res);
  }
});

app.post("/api/admin/inventory/items", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const item = await createAdminInventoryFoundationItem(userId, username, req.body || {}, db);
    if (!isSupabaseActive()) saveDb();
    return res.status(201).json(item);
  } catch (err: any) {
    return handleInventoryDbError(err, res);
  }
});

app.post("/api/admin/inventory/items/:id/stock-in", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await stockInAdminInventoryItem(userId, username, req.params.id, req.body || {}, db);
    if (!isSupabaseActive()) saveDb();
    return res.json(data);
  } catch (err: any) {
    return handleInventoryDbError(err, res);
  }
});

app.post("/api/admin/inventory/items/:id/stock-out", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await stockOutAdminInventoryItem(userId, username, req.params.id, req.body || {}, db);
    if (!isSupabaseActive()) saveDb();
    return res.json(data);
  } catch (err: any) {
    return handleInventoryDbError(err, res);
  }
});

app.post("/api/admin/inventory/items/:id/adjust", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await adjustAdminInventoryItem(userId, username, req.params.id, req.body || {}, db);
    if (!isSupabaseActive()) saveDb();
    return res.json(data);
  } catch (err: any) {
    return handleInventoryDbError(err, res);
  }
});

app.post("/api/admin/inventory/reservations", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await reserveAdminInventoryForProject(userId, username, req.body || {}, db);
    if (!isSupabaseActive()) saveDb();
    return res.status(201).json(data);
  } catch (err: any) {
    return handleInventoryDbError(err, res);
  }
});

app.post("/api/admin/inventory/reservations/:id/release", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await releaseAdminInventoryReservation(userId, username, req.params.id, req.body || {}, db);
    if (!isSupabaseActive()) saveDb();
    return res.json(data);
  } catch (err: any) {
    return handleInventoryDbError(err, res);
  }
});

app.get("/api/admin/inventory/movements", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await listAdminInventoryMovements(userId, username, {
      inventoryItemId: String(req.query.inventoryItemId || "").trim() || undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }, db);
    return res.json(data);
  } catch (err: any) {
    return handleInventoryDbError(err, res);
  }
});

app.get("/api/admin/inventory/reservations", async (req, res) => {
  const { userId, username } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await listAdminInventoryReservations(userId, username, {
      status: String(req.query.status || "").trim() || undefined,
      inventoryItemId: String(req.query.inventoryItemId || "").trim() || undefined,
    }, db);
    return res.json(data);
  } catch (err: any) {
    return handleInventoryDbError(err, res);
  }
});

app.get("/api/admin/parties", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const visibilityRaw = String(req.query.visibility || "active").toLowerCase();
    const visibility =
      visibilityRaw === "archived" || visibilityRaw === "all" ? visibilityRaw : "active";
    const parties = await listPartyLedgers(userId, username, role, db, { visibility });
    return res.json({ parties });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/parties/:partyKey/archive", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const archived = await archivePartyLedger(
      userId,
      username,
      role,
      decodeURIComponent(req.params.partyKey),
      db
    );
    if (!isSupabaseActive()) saveDb();
    return res.json({ archived });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) {
      return res.status(err.statusCode || 403).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/parties/:partyKey/restore", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const result = await restorePartyLedger(
      userId,
      username,
      role,
      decodeURIComponent(req.params.partyKey),
      db
    );
    if (!isSupabaseActive()) saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) {
      return res.status(err.statusCode || 403).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/parties/:partyKey", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const result = await hardDeletePartyLedger(
      userId,
      username,
      role,
      decodeURIComponent(req.params.partyKey),
      db
    );
    if (!isSupabaseActive()) saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) {
      return res.status(err.statusCode || 403).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/parties/:partyKey", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await getPartyLedgerDetail(
      userId,
      username,
      role,
      decodeURIComponent(req.params.partyKey),
      db
    );
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(err.statusCode || 403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/finance/dashboard", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await fetchFinanceDashboard(userId, username, role, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/operations/dashboard", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await fetchProjectOperationsDashboard(userId, username, role, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status((err as any).statusCode || 403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/operations/projects/:id", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const data = await fetchProjectOperationsDetail(userId, username, role, req.params.id, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status((err as any).statusCode || 403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/invoices", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const includeArchived = String(req.query.includeArchived || "") === "true";
    const invoices = await listAdminInvoices(userId, username, role, db, { includeArchived });
    return res.json({ invoices });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof InvoiceDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/invoices/contracted-ready", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const leads = await getLeadsForInvoiceOps();
    const rows = await listContractedLeadsReadyForInvoice(userId, username, role, leads, db);
    return res.json({ leads: rows });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof InvoiceDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/invoices/from-lead", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const leads = await getLeadsForInvoiceOps();
    const result = await createInvoiceFromContractedLead(
      userId,
      username,
      role,
      req.body || {},
      leads,
      db
    );
    saveDb();
    return res.status(result.existing ? 200 : 201).json(result);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof InvoiceDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/invoices/:id", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const invoice = await getAdminInvoiceById(userId, username, role, req.params.id, db);
    return res.json({ invoice });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof InvoiceDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/invoices", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const invoice = await createAdminInvoice(userId, username, role, req.body || {}, db);
    saveDb();
    return res.status(201).json({ invoice });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof InvoiceDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/invoices/:id", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const invoice = await updateAdminInvoice(userId, username, role, req.params.id, req.body || {}, db);
    saveDb();
    return res.json({ invoice });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof InvoiceDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/invoices/:id/payments", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const result = await recordInvoicePayment(userId, username, role, req.params.id, req.body || {}, db);
    saveDb();
    return res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof InvoiceDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/invoices/:id/archive", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const invoice = await archiveAdminInvoice(userId, username, role, req.params.id, db);
    saveDb();
    return res.json({ invoice, ok: true, message: "Invoice archived." });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof InvoiceDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/invoices/:id", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const result = await deleteAdminInvoice(
      userId,
      username,
      role,
      req.params.id,
      req.body || {},
      db
    );
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof InvoiceDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/invoices/bulk-delete", async (req, res) => {
  const { userId, username, role } = readStaffAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff auth required." });
  try {
    loadDb();
    const result = await bulkDeleteAdminInvoices(userId, username, role, req.body || {}, db);
    saveDb();
    return res.json(result);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof InvoiceDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/export/pdf/invoice/:id", async (req, res) => {
  const staffId = String(req.headers["x-sunchaser-user-id"] || req.query.userId || "").trim();
  const staffUsername = String(req.headers["x-sunchaser-username"] || req.query.username || "").trim();
  const role = String(req.headers["x-sunchaser-role"] || req.query.role || "").trim();
  const customerUserId = String(req.query.portalUserId || "").trim();
  const customerUsername = String(req.query.portalUsername || "").trim();
  try {
    loadDb();
    let invoice;
    if (staffId && staffUsername && !customerUserId) {
      invoice = await getAdminInvoiceById(staffId, staffUsername, role, req.params.id, db);
    } else if (customerUserId && customerUsername) {
      const portal = await fetchCustomerPortalInvoicesMe(customerUserId, customerUsername, db);
      invoice = portal.invoices.find((i) => i.id === req.params.id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found." });
    } else {
      return res.status(400).json({ error: "Auth required." });
    }
    const { invoice: inv, branding, options } = await buildInvoicePdfPayload(invoice, db);
    const html = compileInvoicePDFHtml(inv, branding, options);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError || err instanceof CustomerPortalAuthError) {
      return res.status(403).json({ error: err.message });
    }
    if (err instanceof InvoiceDbError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/customer-portal/invoices/me", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await fetchCustomerPortalInvoicesMe(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/staff/payments/projects/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await getStaffProjectPayments(userId, username, req.params.id, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/customer-portal/payments/me", async (req, res) => {
  const { userId, username } = readCustomerPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const data = await fetchCustomerPortalPaymentsMe(userId, username, db);
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/whatsapp/log-opened", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const log = await logWhatsAppMessageOpened(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(log);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    if (err instanceof ProjectFinanceDbError) return res.status(400).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/whatsapp/logs", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "userId and username required." });
  try {
    loadDb();
    const logs = await listAdminWhatsAppLogs(userId, username, db);
    return res.json({ logs });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/diagnostics/phase11-tables", async (_req, res) => {
  const supabase = getSupabase();
  const active = isSupabaseActive();
  const tables = ["project_finance_records", "whatsapp_message_logs"];
  const probes: Record<string, any> = {};
  if (!active || !supabase) {
    return res.json({ supabaseActive: false, probes, schemaScript: "scripts/client-portal-phase11-schema.sql" });
  }
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("id").limit(1);
    probes[table] = error
      ? { ok: false, message: error.message }
      : { ok: true, sampleCount: data?.length ?? 0 };
  }
  const phase11Ready = tables.every((t) => probes[t]?.ok === true);
  return res.json({
    supabaseActive: true,
    schemaScript: "scripts/client-portal-phase11-schema.sql",
    phase11Ready,
    probes,
  });
});

app.get("/api/diagnostics/phase10-tables", async (_req, res) => {
  const supabase = getSupabase();
  const active = isSupabaseActive();
  const tables = [
    "project_deliveries",
    "project_delivery_items",
    "project_installed_equipment",
    "project_installation_photos",
    "project_delivery_updates",
  ];
  const probes: Record<string, any> = {};
  if (!active || !supabase) {
    return res.json({ supabaseActive: false, probes, schemaScript: "scripts/client-portal-phase10-schema.sql" });
  }
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("id").limit(1);
    probes[table] = error
      ? { ok: false, message: error.message }
      : { ok: true, sampleCount: data?.length ?? 0 };
  }
  const phase10Ready = tables.every((t) => probes[t]?.ok === true);
  return res.json({
    supabaseActive: true,
    schemaScript: "scripts/client-portal-phase10-schema.sql",
    phase10Ready,
    probes,
  });
});

app.get("/api/diagnostics/phase9-tables", async (_req, res) => {
  const supabase = getSupabase();
  const active = isSupabaseActive();
  let supabaseHost = null;
  if (process.env.SUPABASE_URL) {
    try {
      supabaseHost = new URL(process.env.SUPABASE_URL).host;
    } catch {
      supabaseHost = process.env.SUPABASE_URL;
    }
  }
  const probes: Record<string, any> = {};
  const schemaScript = "scripts/client-portal-phase9-schema.sql";
  if (!active || !supabase) {
    return res.json({ supabaseActive: false, supabaseHost, schemaScript, probes });
  }
  const { data: tju, error: tjuErr } = await supabase.from("technical_job_updates").select("id").limit(1);
  probes.technical_job_updates = tjuErr
    ? { ok: false, message: tjuErr.message, hint: `Run ${schemaScript} in Supabase` }
    : { ok: true, sampleCount: tju?.length ?? 0 };

  const { data: userRow, error: usersErr } = await supabase
    .from("users")
    .select("id, onboarding_completed, onboarding_completed_at")
    .limit(1)
    .maybeSingle();
  const hasCompletedCol =
    !usersErr && userRow != null && Object.prototype.hasOwnProperty.call(userRow, "onboarding_completed");
  const hasCompletedAtCol =
    !usersErr && userRow != null && Object.prototype.hasOwnProperty.call(userRow, "onboarding_completed_at");
  probes.users_onboarding_completed = {
    ok: hasCompletedCol,
    message: usersErr?.message,
    hint: hasCompletedCol ? undefined : `Run ${schemaScript} — add users.onboarding_completed`,
  };
  probes.users_onboarding_completed_at = {
    ok: hasCompletedAtCol,
    message: usersErr?.message,
    hint: hasCompletedAtCol ? undefined : `Run ${schemaScript} — add users.onboarding_completed_at`,
  };
  probes.users_onboarding_columns = {
    ok: hasCompletedCol && hasCompletedAtCol,
    columns: ["onboarding_completed", "onboarding_completed_at"],
    hint: `Run ${schemaScript} in Supabase SQL Editor`,
  };
  probes.phase9_schema_ready =
    probes.technical_job_updates.ok === true && probes.users_onboarding_columns.ok === true;
  return res.json({ supabaseActive: true, supabaseHost, schemaScript, probes });
});

app.get("/api/diagnostics/phase8-tables", async (_req, res) => {
  const supabase = getSupabase();
  const active = isSupabaseActive();
  let supabaseHost = null;
  if (process.env.SUPABASE_URL) {
    try {
      supabaseHost = new URL(process.env.SUPABASE_URL).host;
    } catch {
      supabaseHost = process.env.SUPABASE_URL;
    }
  }
  const tables = ["customer_energy_devices", "energy_alerts"];
  const probes: Record<string, any> = {};
  if (!active || !supabase) {
    return res.json({ supabaseActive: false, supabaseHost, probes });
  }
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("id").limit(1);
    probes[table] = error
      ? { ok: false, code: error.code, message: error.message }
      : { ok: true, sampleCount: data?.length ?? 0 };
  }
  return res.json({ supabaseActive: true, supabaseHost, probes });
});

app.get("/api/diagnostics/phase7-columns", async (_req, res) => {
  const supabase = getSupabase();
  if (!isSupabaseActive() || !supabase) {
    return res.json({ supabaseActive: false, probes: {} });
  }
  const { data, error } = await supabase
    .from("after_sales_service_logs")
    .select("warranty_covered, performance_improvement_pct, labor_cost")
    .limit(1);
  const ok = !error;
  return res.json({
    supabaseActive: true,
    probes: {
      phase7_columns: ok
        ? { ok: true }
        : { ok: false, message: error?.message, hint: "Run scripts/client-portal-phase7-schema.sql" },
    },
  });
});

app.get("/api/diagnostics/pakistan-aftersales-tables", async (_req, res) => {
  const supabase = getSupabase();
  const active = isSupabaseActive();
  let supabaseHost = null;
  if (process.env.SUPABASE_URL) {
    try {
      supabaseHost = new URL(process.env.SUPABASE_URL).host;
    } catch {
      supabaseHost = process.env.SUPABASE_URL;
    }
  }
  const tables = [
    "customer_portal_profiles",
    "customer_equipment",
    "installation_photos",
    "after_sales_service_logs",
  ];
  const probes: Record<string, any> = {};
  if (!active || !supabase) {
    return res.json({ supabaseActive: false, supabaseHost, probes });
  }
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("id").limit(1);
    probes[table] = error
      ? { ok: false, code: error.code, message: error.message }
      : { ok: true, sampleCount: data?.length ?? 0 };
  }
  return res.json({ supabaseActive: true, supabaseHost, probes });
});

app.get("/api/diagnostics/phase6-tables", async (_req, res) => {
  const supabase = getSupabase();
  const active = isSupabaseActive();
  let supabaseHost = null;
  if (process.env.SUPABASE_URL) {
    try {
      supabaseHost = new URL(process.env.SUPABASE_URL).host;
    } catch {
      supabaseHost = process.env.SUPABASE_URL;
    }
  }
  const tables = [
    "subscription_plans",
    "customer_subscriptions",
    "subscription_payments",
    "service_visit_reports",
    "service_visit_photos",
  ];
  const probes: Record<string, any> = {};
  if (!active || !supabase) {
    return res.json({ supabaseActive: false, supabaseHost, probes });
  }
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("id").limit(1);
    probes[table] = error
      ? { ok: false, code: error.code, message: error.message, details: error.details, hint: error.hint }
      : { ok: true, sampleCount: data?.length ?? 0 };
  }
  return res.json({ supabaseActive: true, supabaseHost, probes });
});

app.get("/api/diagnostics/phase5-tables", async (_req, res) => {
  const supabase = getSupabase();
  const active = isSupabaseActive();
  let supabaseHost = null;
  if (process.env.SUPABASE_URL) {
    try {
      supabaseHost = new URL(process.env.SUPABASE_URL).host;
    } catch {
      supabaseHost = process.env.SUPABASE_URL;
    }
  }
  const tables = ["customer_savings_profiles"];
  const probes: Record<string, any> = {};
  if (!active || !supabase) {
    return res.json({ supabaseActive: false, supabaseHost, probes });
  }
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("id").limit(1);
    probes[table] = error
      ? { ok: false, code: error.code, message: error.message, details: error.details, hint: error.hint }
      : { ok: true, sampleCount: data?.length ?? 0 };
  }
  return res.json({ supabaseActive: true, supabaseHost, probes });
});

app.get("/api/diagnostics/phase4-tables", async (_req, res) => {
  const supabase = getSupabase();
  const active = isSupabaseActive();
  let supabaseHost = null;
  if (process.env.SUPABASE_URL) {
    try {
      supabaseHost = new URL(process.env.SUPABASE_URL).host;
    } catch {
      supabaseHost = process.env.SUPABASE_URL;
    }
  }
  const tables = ["service_requests"];
  const probes: Record<string, any> = {};
  if (!active || !supabase) {
    return res.json({ supabaseActive: false, supabaseHost, probes });
  }
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("id").limit(1);
    probes[table] = error
      ? { ok: false, code: error.code, message: error.message, details: error.details, hint: error.hint }
      : { ok: true, sampleCount: data?.length ?? 0 };
  }
  return res.json({ supabaseActive: true, supabaseHost, probes });
});

app.get("/api/diagnostics/phase2-tables", async (_req, res) => {
  const supabase = getSupabase();
  const active = isSupabaseActive();
  let supabaseHost = null;
  if (process.env.SUPABASE_URL) {
    try {
      supabaseHost = new URL(process.env.SUPABASE_URL).host;
    } catch {
      supabaseHost = process.env.SUPABASE_URL;
    }
  }
  const tables = ["customer_documents", "customer_warranties", "warranty_claims"];
  const probes: Record<string, any> = {};
  if (!active || !supabase) {
    return res.json({ supabaseActive: false, supabaseHost, probes });
  }
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("id").limit(1);
    probes[table] = error
      ? { ok: false, code: error.code, message: error.message, details: error.details, hint: error.hint }
      : { ok: true, sampleCount: data?.length ?? 0 };
  }
  return res.json({ supabaseActive: true, supabaseHost, probes });
});

app.get("/api/customer-portal/:customerId", async (req, res) => {
  const userId = String(req.headers["x-sunchaser-user-id"] || req.query?.userId || "").trim();
  const username = String(req.headers["x-sunchaser-username"] || req.query?.username || "").trim();
  const requestedCustomerId = String(req.params.customerId || "").trim();

  if (["service", "documents", "warranties", "support-tickets", "savings", "care", "equipment", "installation-photos", "service-history"].includes(requestedCustomerId)) {
    return res.status(404).json({ error: "Not found." });
  }

  if (!userId || !username) {
    return res.status(400).json({ error: "userId and username are required." });
  }

  try {
    loadDb();
    const data = await fetchCustomerPortalData(userId, username, db);
    if (requestedCustomerId && data.customer?.id && data.customer.id !== requestedCustomerId) {
      return res.status(403).json({ error: "You cannot access another customer's data." });
    }
    return res.json(data);
  } catch (err: any) {
    if (err instanceof CustomerPortalAuthError) {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message || "Failed to load customer portal." });
  }
});

app.post("/api/admin/customer-documents", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff userId and username are required." });
  try {
    loadDb();
    const doc = await createAdminCustomerDocument(userId, username, req.body || {}, db);
    saveDb();
    return res.status(201).json(doc);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message || "Failed to save document." });
  }
});

app.post("/api/admin/customer-warranties", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff userId and username are required." });
  try {
    loadDb();
    const row = await upsertAdminCustomerWarranty(userId, username, req.body || {}, db);
    await maybeSyncWarrantyCertificateDocument(row.customerId, db);
    saveDb();
    return res.status(201).json(row);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message || "Failed to save warranty." });
  }
});

app.get("/api/admin/warranty-claims", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  if (!userId || !username) return res.status(400).json({ error: "Staff userId and username are required." });
  try {
    loadDb();
    const claims = await listAdminWarrantyClaims(userId, username, db);
    return res.json({ claims });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message || "Failed to load warranty claims." });
  }
});

app.patch("/api/admin/warranty-claims/:id", async (req, res) => {
  const { userId, username } = readPortalAuth(req);
  const { status } = req.body || {};
  if (!userId || !username) return res.status(400).json({ error: "Staff userId and username are required." });
  try {
    loadDb();
    const claim = await patchAdminWarrantyClaim(userId, username, req.params.id, status, db);
    saveDb();
    return res.json(claim);
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(403).json({ error: err.message });
    return res.status(500).json({ error: err.message || "Failed to update warranty claim." });
  }
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
    leads: filterActiveLeads(db.leads),
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

// Diagnostic endpoint to check backend configuration and Supabase connection
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

  const envKeysFound = Object.keys(process.env).filter(key => 
    key.includes("SUPABASE") || key.includes("JWT") || key.includes("GEMINI")
  );

  let supabaseUsersCount = 0;
  let supabaseError = null;

  if (active && supabase) {
    try {
      const { count, error } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true });
      if (error) {
        supabaseError = error.message;
      } else {
        supabaseUsersCount = count || 0;
      }
    } catch (err: any) {
      supabaseError = err.message;
    }
  }

  let quotationsUpdatedAtColumn: string | null = null;
  if (active && supabase) {
    const { error: updatedAtProbeError } = await supabase
      .from("quotations")
      .select("updated_at")
      .limit(1);
    quotationsUpdatedAtColumn = updatedAtProbeError ? updatedAtProbeError.message : "present";
  }

  res.json({
    supabaseActive: active,
    supabaseUrl: supabaseUrlMasked,
    envKeysFound,
    supabaseUsersCount,
    supabaseError,
    quotationsUpdatedAtColumn,
    localDbExists: fs.existsSync(DB_FILE),
    localUsersCount: db.users?.length || 0,
    localLeadsCount: (() => {
      try {
        if (!fs.existsSync(DB_FILE)) return 0;
        const local = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        return (local.leads || []).length;
      } catch {
        return -1;
      }
    })(),
    nodeEnv: process.env.NODE_ENV,
  });
});

function assertSuperAdminCleanup(req: express.Request) {
  const role = String(req.headers["x-sunchaser-role"] || "").trim();
  const username = String(req.headers["x-sunchaser-username"] || "").trim();
  if (role !== "Super Admin" && username.toLowerCase() !== "allauddin") {
    throw new StaffPortalAuthError("Super Admin access required.", 403);
  }
}

app.post("/api/admin/maintenance/production-backup-20260606", async (req, res) => {
  try {
    assertSuperAdminCleanup(req);
    const confirm = String(req.body?.confirm || "");
    if (confirm !== CLEANUP_CONFIRM_TOKEN) {
      return res.status(400).json({ error: `confirm must be ${CLEANUP_CONFIRM_TOKEN}` });
    }
    const dryRun = req.body?.dryRun === true;
    const result = dryRun
      ? await runProductionBackupDryRun20260606()
      : await runProductionBackup20260606();
    return res.json({ success: true, ...result });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message || "Backup failed." });
  }
});

app.post("/api/admin/maintenance/production-cleanup-20260606", async (req, res) => {
  try {
    assertSuperAdminCleanup(req);
    const confirm = String(req.body?.confirm || "");
    if (confirm !== CLEANUP_CONFIRM_TOKEN) {
      return res.status(400).json({ error: `confirm must be ${CLEANUP_CONFIRM_TOKEN}` });
    }
    const deleted = await runProductionCleanup20260606();
    const counts = await fetchProductionCleanupCounts();
    return res.json({ success: true, deleted, counts });
  } catch (err: any) {
    if (err instanceof StaffPortalAuthError) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: err.message || "Cleanup failed." });
  }
});

app.get("/api/diagnostics/quotation-settings", async (req, res) => {
  const QUOTATION_TABLES = [
    "quote_templates",
    "quote_template_pages",
    "bank_accounts",
    "company_terms",
    "ceo_messages",
    "structure_descriptions",
    "quote_pdf_settings",
    "social_links",
  ];
  const active = isSupabaseActive();
  if (!active) {
    return res.json({ supabaseActive: false, tables: {}, source: "local" });
  }
  const supabase = getSupabase()!;
  const tables: Record<string, { ok: boolean; count?: number; error?: string }> = {};
  for (const table of QUOTATION_TABLES) {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    tables[table] = error ? { ok: false, error: error.message } : { ok: true, count: count ?? 0 };
  }
  let stateSample: any = {};
  try {
    const state = await fetchAppStateFromSupabase();
    stateSample = {
      quoteTemplates: (state.quoteTemplates || []).length,
      quoteTemplatePages: (state.quoteTemplatePages || []).length,
      bankAccounts: (state.bankAccounts || []).length,
      companyTerms: (state.companyTerms || []).length,
      ceoMessages: (state.ceoMessages || []).length,
      structureDescriptions: (state.structureDescriptions || []).length,
      quotePdfSettings: (state.quotePdfSettings || []).length,
      socialLinks: (state.socialLinks || []).length,
      pdfCompanyName: state.quotePdfSettings?.[0]?.companyName || null,
    };
  } catch (err: any) {
    stateSample = { error: err.message };
  }
  res.json({ supabaseActive: true, tables, stateSample, primarySource: "supabase" });
});

app.get("/api/diagnostics/auth-users", async (req, res) => {
  const supabase = getSupabase();
  const active = isSupabaseActive();

  let supabaseUrlMasked = "NONE";
  if (process.env.SUPABASE_URL) {
    try {
      supabaseUrlMasked = new URL(process.env.SUPABASE_URL).hostname;
    } catch {
      supabaseUrlMasked = "INVALID_URL_FORMAT";
    }
  }

  if (!active || !supabase) {
    return res.json({
      supabaseActive: false,
      supabaseHostname: supabaseUrlMasked,
      users: [],
      error: "Supabase is not active on this server.",
    });
  }

  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, username, name, email, role")
      .order("username", { ascending: true });

    if (error) throw error;

    const users = (data || []).map((u: any) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      email: u.email,
      role: resolveAppUserRole(u.username, u.role),
      dbRole: u.role,
    }));

    res.json({
      supabaseActive: true,
      supabaseHostname: supabaseUrlMasked,
      userCount: users.length,
      users,
    });
  } catch (err: any) {
    res.status(500).json({
      supabaseActive: true,
      supabaseHostname: supabaseUrlMasked,
      users: [],
      error: err.message,
    });
  }
});

app.get("/api/diagnostics/api-config", (req, res) => {
  let supabaseHostname = "NONE";
  if (process.env.SUPABASE_URL) {
    try {
      supabaseHostname = new URL(process.env.SUPABASE_URL).hostname;
    } catch {
      supabaseHostname = "INVALID_URL_FORMAT";
    }
  }

  const renderApiBase = `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");

  res.json({
    productionRenderApiBaseUrl: "https://sunchaser-energy-systems.onrender.com",
    currentServerApiBaseUrl: renderApiBase,
    loginEndpoint: `${renderApiBase}/api/auth/login`,
    recommendedVercelEnv: {
      VITE_API_BASE_URL: "https://sunchaser-energy-systems.onrender.com",
    },
    supabaseHostname,
    supabaseActive: isSupabaseActive(),
  });
});

function leadInsertHttpStatus(err: { code?: string; message?: string }): number {
  const code = String(err?.code || "");
  const msg = String(err?.message || "").toLowerCase();
  if (code === "23505" || msg.includes("duplicate key")) return 409;
  if (
    code === "23502" ||
    code === "23514" ||
    code === "22P02" ||
    code === "23503" ||
    msg.includes("violates") ||
    msg.includes("invalid input")
  ) {
    return 422;
  }
  return 500;
}

// 3. Create lead route with rating, scores and auto WhatsApp confirmation
app.post("/api/leads", async (req, res) => {
  try {
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
      engagementLevel,
      assignedSalesperson,
    } = req.body;

    const leadId = `lead-${randomUUID()}`;
    const newLead: any = {
      id: leadId,
      name: name || "Anonymous Lead",
      email: email || "no-email@example.com",
      phone: phone || "",
      address: address || "",
      status: "New",
      monthlyBill: (monthlyBill === undefined || monthlyBill === null || monthlyBill === '') ? 0 : Number(monthlyBill),
      monthlyUnits: (() => {
        const bill = (monthlyBill === undefined || monthlyBill === null || monthlyBill === '') ? 0 : Number(monthlyBill);
        const units = (monthlyUnits === undefined || monthlyUnits === null || monthlyUnits === '') ? 0 : Number(monthlyUnits);
        return resolveMonthlyUnits(bill, units);
      })(),
      sanctionedLoad: Number(sanctionedLoad) || 7,
      backupRequirement: backupRequirement || "None",
      location: String(location || "").trim(),
      roofType: roofType || "Asphalt Shingle",
      roofSpace: Number(roofSpace) || 800,
      shading: shading || "Medium",
      rating: 3,
      assignedSalesperson: String(assignedSalesperson || "").trim(),
      createdAt: new Date().toISOString(),
      notes: notes || "Submitted via Sunchaser Sizing Calculator.",
      leadSource: leadSource || "Self-registration Web Portal",
      engagementLevel: engagementLevel || "Medium",
      quotes: [],
    };

    calculateLeadScore(newLead);

    if (isSupabaseActive()) {
      const supabase = getSupabase()!;
      const customerId = `cust-${randomUUID()}`;
      const customerCode = await generateCustomerCode(db);

      const { error: custErr } = await supabase.from("customers").insert({
        id: customerId,
        name: newLead.name,
        email: newLead.email,
        phone: newLead.phone,
        address: newLead.address,
        customer_code: customerCode,
      });
      if (custErr) {
        console.error("[Supabase Customer Insert Error]:", custErr.message);
        return res.status(leadInsertHttpStatus(custErr)).json({ error: custErr.message });
      }

      const { error: leadErr } = await supabase.from("leads").insert({
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
        created_at: newLead.createdAt,
      });
      if (leadErr) {
        console.error("[Supabase Lead Insert Error]:", leadErr.message);
        const { error: cleanupErr } = await supabase.from("customers").delete().eq("id", customerId);
        if (cleanupErr) {
          console.warn(
            `[Supabase Orphan Customer] Failed to delete ${customerId} after lead insert failed:`,
            cleanupErr.message
          );
        }
        return res.status(leadInsertHttpStatus(leadErr)).json({ error: leadErr.message });
      }
    } else {
      db.leads.push(newLead);
      saveDb();
    }

    await appendActivityLog("guest", newLead.name, "Customer", "Lead Created", `Registered details profile for home assessment sizing.`);
    const msgText = `☀️ Hi ${newLead.name}! Sunchaser Energy has scheduled your structural solar survey. Our team will coordinate framing loads and meter layout. Review options: http://sunchaser.co/portal`;
    await triggerWhatsAppNotification(newLead.name, newLead.phone, "survey_confirmation", msgText);

    return res.status(201).json(newLead);
  } catch (err: any) {
    console.error("[Lead Create Error]:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Failed to create lead." });
  }
});

// 4. Update lead fields and re-compute score
app.put("/api/leads/:id", async (req, res) => {
  const { id } = req.params;
  const { quotes: _ignoredQuotes, ...leadPatch } = req.body || {};
  const becomingContracted = leadPatch.status === "Contracted";

  try {
    const ctx = await resolveLeadForMutation(id, { includeQuotes: becomingContracted });
    if (!ctx) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const priorStatus = ctx.lead.status;
    const updatedLead = {
      ...ctx.lead,
      ...leadPatch,
      quotes: ctx.lead.quotes || [],
    };
    calculateLeadScore(updatedLead);

    let contractProvision: Awaited<ReturnType<typeof provisionContractToInvoiceWorkflow>> | null = null;
    if (becomingContracted && priorStatus !== "Contracted") {
      const staff = readStaffAuth(req);
      contractProvision = await provisionContractToInvoiceWorkflow(updatedLead, db, {
        supabase: ctx.supabase,
        actor: staff.userId && staff.username
          ? { userId: staff.userId, username: staff.username, role: staff.role || "Super Admin" }
          : undefined,
      });
      if (contractProvision.customerId) {
        updatedLead.customerId = contractProvision.customerId;
        updatedLead.customer_id = contractProvision.customerId;
      }
      await appendActivityLog(
        "system",
        "Contract Automation",
        "Finance",
        "Contract-to-Invoice",
        `Lead ${id} contracted — invoice ${contractProvision.invoiceId || "pending"}${contractProvision.invoiceExisting ? " (existing)" : ""}`
      );
    }

    persistLeadLocally(id, updatedLead, ctx.supabase);

    if (ctx.supabase) {
      const { error: updateErr } = await ctx.supabase
        .from("leads")
        .update(buildSupabaseLeadUpdateRow(updatedLead))
        .eq("id", id);
      if (updateErr) {
        console.error("[Supabase Lead Update Error]:", updateErr.message);
        return res.status(500).json({ error: updateErr.message });
      }

      const customerId = updatedLead.customerId || updatedLead.customer_id || ctx.resolved.customer_id;
      const contactPatch: Record<string, string> = {};
      if (leadPatch.name !== undefined) contactPatch.name = updatedLead.name;
      if (leadPatch.email !== undefined) contactPatch.email = updatedLead.email;
      if (leadPatch.phone !== undefined) contactPatch.phone = updatedLead.phone;
      if (leadPatch.address !== undefined) contactPatch.address = updatedLead.address;
      if (customerId && Object.keys(contactPatch).length > 0) {
        const { error: customerErr } = await ctx.supabase
          .from("customers")
          .update(contactPatch)
          .eq("id", customerId);
        if (customerErr) {
          console.error("[Supabase Customer Update Error]:", customerErr.message);
          return res.status(500).json({ error: customerErr.message });
        }
      }
    } else if (becomingContracted && priorStatus !== "Contracted") {
      saveDb();
    }

    res.json({
      ...updatedLead,
      contractProvision: contractProvision || undefined,
    });
  } catch (err: any) {
    console.error("[Lead Update Error]:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Failed to update lead." });
  }
});

// Soft-delete lead (sets deleted_at; row retained for recovery)
app.delete("/api/leads/:id", async (req, res) => {
  const { id } = req.params;
  const deletedBy = resolveDeletedBy(req);
  console.log(`[DELETE TRACE] before soft delete lead=${id} deletedBy=${deletedBy}`);

  if (isSupabaseActive()) {
    try {
      await softDeleteLeadInSupabase(id, deletedBy);
      console.log(`[DELETE TRACE] after Supabase soft delete lead=${id}`);
    } catch (err: any) {
      console.error("[Supabase Lead Soft Delete Error]:", err.message);
      const status = String(err.message || "").includes("not found") ? 404 : 500;
      return res.status(status).json({ error: `Failed to soft delete lead: ${err.message}` });
    }
  } else {
    loadDb();
    const resolved = await resolveActiveLead(id, undefined, db.leads);
    if (!resolved) return res.status(404).json({ error: "Lead not found or already deleted." });
    softDeleteLeadInLocalStore(id, deletedBy);
  }

  if (!isSupabaseActive()) {
    console.log(`[DELETE TRACE] after saveDb lead=${id}`);
  }

  await appendActivityLog("admin", "Admin", "Super Admin", "Lead Soft Deleted", `Soft deleted lead ${id}`);
  res.json({
    success: true,
    message: `Lead ${id} soft deleted successfully.`,
    softDeleted: true,
    deletedBy,
  });
});

// Super Admin: list soft-deleted leads
app.get("/api/leads/deleted", async (req, res) => {
  const role = String(req.headers["x-sunchaser-role"] || req.query.role || "").trim();
  const username = String(req.headers["x-sunchaser-username"] || "").trim();
  if (role !== "Super Admin" && username.toLowerCase() !== "allauddin") {
    return res.status(403).json({ error: "Super Admin access required." });
  }

  if (isSupabaseActive()) {
    try {
      const supabase = getSupabase()!;
      const rows = await fetchLeadsFromSupabase(supabase, { activeOnly: false, deletedOnly: true });
      return res.json({
        leads: rows.map((l: any) => ({
          id: l.id,
          name: l.name,
          email: l.email,
          phone: l.phone,
          status: l.status,
          deletedAt: l.deleted_at,
          deletedBy: l.deleted_by,
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  loadDb();
  res.json({
    leads: (db.leads || [])
      .filter((l: any) => !isActiveLead(l))
      .map((l: any) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        phone: l.phone,
        status: l.status,
        deletedAt: l.deletedAt || l.deleted_at,
        deletedBy: l.deletedBy || l.deleted_by,
      })),
  });
});

// Super Admin: restore soft-deleted lead
app.post("/api/leads/:id/restore", async (req, res) => {
  const { id } = req.params;
  const role = String(req.headers["x-sunchaser-role"] || req.body?.role || "").trim();
  const username = String(req.headers["x-sunchaser-username"] || "").trim();
  if (role !== "Super Admin" && username.toLowerCase() !== "allauddin") {
    return res.status(403).json({ error: "Super Admin access required." });
  }

  if (isSupabaseActive()) {
    try {
      await restoreLeadInSupabase(id);
    } catch (err: any) {
      return res.status(500).json({ error: `Failed to restore lead: ${err.message}` });
    }
  } else {
    const restored = restoreLeadInLocalStore(id);
    if (!restored) return res.status(404).json({ error: "Lead not found or not deleted." });
  }
  await appendActivityLog("admin", "Admin", "Super Admin", "Lead Restored", `Restored lead ${id}`);
  res.json({ success: true, message: `Lead ${id} restored.` });
});

// Delete specific quote for a lead
app.delete("/api/leads/:leadId/quotes/:quoteId", async (req, res) => {
  const { leadId, quoteId } = req.params;
  const ctx = await resolveLeadForMutation(leadId, { includeQuotes: true });
  if (!ctx) {
    return res.status(404).json({ error: "Lead not found" });
  }
  const { lead, supabase } = ctx;

  if (!lead.quotes) lead.quotes = [];
  const quoteIndex = lead.quotes.findIndex((q: any) => q.id === quoteId);
  if (quoteIndex === -1) {
    if (supabase) {
      const { data: quoteRow } = await supabase.from("quotations").select("id").eq("id", quoteId).eq("lead_id", leadId).maybeSingle();
      if (!quoteRow) return res.status(404).json({ error: "Quote not found" });
      await supabase.from("quotations").delete().eq("id", quoteId).eq("lead_id", leadId);
      await appendActivityLog("admin", "Admin", "Super Admin", "Quote Deleted", `Deleted quote ${quoteId} for lead ${leadId}`);
      return res.json({ success: true, message: `Quote ${quoteId} deleted successfully.` });
    }
    return res.status(404).json({ error: "Quote not found" });
  }

  lead.quotes.splice(quoteIndex, 1);
  persistLeadLocally(leadId, lead, supabase);

  if (supabase) {
    try {
      await supabase.from("quotations").delete().eq("id", quoteId).eq("lead_id", leadId);
    } catch (err: any) {
      console.error("[Supabase Quote Deletion Error]:", err.message);
    }
  }

  await appendActivityLog("admin", "Admin", "Super Admin", "Quote Deleted", `Deleted quote ${quoteId} for lead ${leadId}`);
  res.json({ success: true, message: `Quote ${quoteId} deleted successfully.` });
});

// 5. Delegate salesperson assignment
app.put("/api/leads/:id/assign", async (req, res) => {
  const { id } = req.params;
  const { salespersonName } = req.body;
  const ctx = await resolveLeadForMutation(id);
  if (!ctx) return res.status(404).json({ error: "Lead not found" });
  const { lead, supabase } = ctx;

  lead.assignedSalesperson = salespersonName;
  persistLeadLocally(id, lead, supabase);

  if (supabase) {
    try {
      await supabase.from("leads").update({ assigned_salesperson: salespersonName }).eq("id", id);
    } catch (err: any) {
      console.error("[Supabase Reassign Error]:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  await appendActivityLog("admin", "Super Admin", "Super Admin", "Lead Assigned", `Assigned lead ${lead.name} to salesperson ${salespersonName}`);
  res.json(lead);
});

// 6. Gemini AI Lead Scoring manual assessment
app.post("/api/leads/:id/ai-score", async (req, res) => {
  const { id } = req.params;
  const ctx = await resolveLeadForMutation(id);
  if (!ctx) return res.status(404).json({ error: "Lead not found" });
  const { lead } = ctx;

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
  const { id } = req.params;
  const { scheduledDate } = req.body;
  const ctx = await resolveLeadForMutation(id);
  if (!ctx) return res.status(404).json({ error: "Lead not found" });
  const { lead, supabase } = ctx;

  lead.status = "Survey Scheduled";
  lead.survey = {
    scheduledDate,
    status: "Pending",
    notes: "Site visit confirmed via structural scheduler.",
    shadingPercent: 0,
    optimalPlacement: "",
    photos: []
  };

  persistLeadLocally(id, lead, supabase);

  if (supabase) {
    try {
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
  const { id } = req.params;
  const ctx = await resolveLeadForMutation(id);
  if (!ctx) return res.status(404).json({ error: "Lead not found" });
  const { lead } = ctx;

  const advisor = leadAdvisorLabel(lead.assignedSalesperson);
  const msgText = `☀️ Hi ${lead.name}! ${advisor} from Sunchaser Energy checking in — any questions on your custom solar sizing layout? Let us know if you would like to proceed or schedule a site survey!`;
  await triggerWhatsAppNotification(lead.name, lead.phone, "followup_reminder", msgText);

  await appendActivityLog("sales", advisor, "Sales Executive", "Follow-up Reminded", `Dispatched WhatsApp follow-up reminder to ${lead.name}`);
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

  const ctx = await resolveLeadForMutation(id);
  if (!ctx) return res.status(404).json({ error: "Lead not found" });
  const { lead, supabase } = ctx;

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
  persistLeadLocally(id, lead, supabase);

  if (supabase) {
    try {
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

  const surveyActor = activityActorFromStaff(req, "Survey Engineer");
  await appendActivityLog("surveyor", surveyActor, "Survey Engineer", "Survey Audited", `Submitted structural measurements & CAD panel positions for ${lead.name}`);
  res.json(lead);
});

// 9. Generate and write Quotation terms
app.post("/api/leads/:id/create-quote", async (req, res) => {
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
    discountType,
    discountValue,
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

  const ctx = await resolveLeadForMutation(id, { includeQuotes: true });
  if (!ctx) return res.status(404).json({ error: "Lead not found" });
  const { lead, resolved, supabase } = ctx;

  const resolvedQuoteType = quote_type === "auto_sizer" ? "auto_sizer" : "manual_boq";
  if (resolvedQuoteType === "auto_sizer" && !REQUIRE_EXPLICIT_QUOTE_SAVE) {
    return res.status(403).json({ error: "Auto Sizer quote creation is temporarily disabled. Use Manual BOQ Builder." });
  }

  const incomingRows = boqRows || boqItems || [];
  const itemCount = incomingRows.filter((r: any) => r && r.type === "item").length;
  if (itemCount === 0) {
    return res.status(400).json({ error: "Save a quote with at least one BOQ item before persisting." });
  }

  // 1. Idempotency Key check to block duplicate submits
  if (idempotencyKey && lead.quotes?.some((q: any) => q.idempotencyKey === idempotencyKey)) {
    console.log(`[API POST /api/leads/${id}/create-quote] Blocked duplicate request with idempotency key: ${idempotencyKey}`);
    return res.status(409).json({ error: "Duplicate request: Quote with this idempotency key already exists." });
  }

  // 2. 4-second rate limit guard
  const now = Date.now();
  const recentQuote = lead.quotes?.find((q: any) => {
    const createdAtTime = new Date(q.createdAt).getTime();
    return (now - createdAtTime) < 4000;
  });
  if (recentQuote) {
    console.log(`[API POST /api/leads/${id}/create-quote] Blocked request due to 4s guard. Last quote created at: ${recentQuote.createdAt}`);
    return res.status(429).json({ error: "Rate limit: Please wait 4 seconds between generating quotes." });
  }

  const quoteId = generateQuotationId();
  const cost = Number(totalCost) || (Number(systemSizekW) * 19500 + (batteryCapacity ? 480000 : 0));
  const subtotalForDiscount = Number(grandTotal) || cost;
  const resolvedDiscount = resolveQuoteDiscountAmount(subtotalForDiscount, {
    discountType,
    discountValue,
    discount,
  });
  const disc = resolvedDiscount.discountAmount;
  const netCost = computeNetProposalValue(subtotalForDiscount, disc, {
    taxAmount: taxEnabled ? Math.round(subtotalForDiscount * (Number(taxRate) || 0) / 100) : 0,
    societyCharges: Number(societyCharges) || 0,
  });

  // Update lead demographics if they are modified
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
    bdmName: bdmName || sanitizeLeadAdvisorInput(lead.assignedSalesperson) || "",
    quoteDate: quoteDate || new Date().toISOString().split('T')[0],
    systemType: systemType || "Hybrid",
    panelBrand: panelBrand || "Jinko",
    panelWattage: Number(panelWattage) || 580,
    inverterBrand: inverterBrand || "Knox",
    inverterCapacity: inverterCapacity || "10kW",
    batteryOption: batteryOption || "None",
    netMeteringRequired: netMeteringRequired || "Yes",
    discount: disc,
    discountType: resolvedDiscount.discountType,
    discountValue: resolvedDiscount.discountValue,
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
    quote_type: resolvedQuoteType,
    source: resolvedQuoteType === "auto_sizer" ? "autosizer" : "manual",
    updatedAt: new Date().toISOString(),
  };

  lead.quotes = [newQuote, ...(lead.quotes || [])];
  lead.status = "Quoted";
  persistLeadLocally(id, lead, supabase);

  if (supabase) {
    try {
      const customerId = resolved.customer_id || `cust-${id.replace("lead-", "")}`;
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
        netTotal: newQuote.netTotal,
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
        if (insertResult.quoteId && insertResult.quoteId !== quoteId) {
          newQuote.id = insertResult.quoteId;
          if (lead.quotes?.[0]?.id === quoteId) {
            lead.quotes[0].id = insertResult.quoteId;
          }
        }
        console.log(`[Supabase Create Quotation] Quote ${newQuote.id} inserted successfully.`);
      }
    } catch (err: any) {
      console.error("[Supabase Create Quotation Error]:", err.message);
    }
  }

  const quoteActor = bdmName || leadAdvisorLabel(lead.assignedSalesperson);
  await appendActivityLog("sales", quoteActor, "Sales Executive", "Quotation Written", `Formulated quote ${newQuote.id} for ${lead.name}`);
  const msgText = `☀️ Hi ${lead.name}! Sunchaser has unlocked your custom solar proposal: ${newQuote.systemSizekW} kW with ${newQuote.inverterType}. Total final cost is Rs. ${newQuote.netCost.toLocaleString()}. Open file: http://sunchaser.co/portal`;
  await triggerWhatsAppNotification(lead.name, lead.phone, "quote_generation", msgText);

  const leadCustomerId = resolved?.customer_id || `cust-${id.replace("lead-", "")}`;
  await syncQuotationVaultForLead(lead, id, newQuote.id, leadCustomerId, db);

  res.json(lead);
});

// 9b. Duplicate Quote endpoint
app.post("/api/leads/:id/duplicate-quote", async (req, res) => {
  const { id } = req.params;
  const { quoteId } = req.body;
  const ctx = await resolveLeadForMutation(id, { includeQuotes: true });
  if (!ctx) return res.status(404).json({ error: "Lead not found" });
  const { lead, resolved, supabase } = ctx;

  const quoteToDup = lead.quotes?.find((q: any) => q.id === quoteId);
  if (!quoteToDup) return res.status(404).json({ error: "Quote not found" });

  const newQuoteId = generateQuotationId();
  const duplicated = {
    ...quoteToDup,
    id: newQuoteId,
    status: "Pending",
    createdAt: new Date().toISOString(),
    quoteDate: new Date().toISOString().split('T')[0]
  };

  lead.quotes = [duplicated, ...(lead.quotes || [])];
  persistLeadLocally(id, lead, supabase);

  if (supabase) {
    try {
      const customerId = resolved.customer_id || `cust-${id.replace("lead-", "")}`;
      await persistQuotationToSupabase(supabase, id, customerId, duplicated, "insert");
    } catch (err: any) {
      console.error("[Supabase Duplicate Quotation Error]:", err.message);
    }
  }

  res.json(lead);
});

// 9c. Update/Overwrite Quote endpoint
app.post("/api/leads/:id/update-quote", async (req, res) => {
  const { id } = req.params;
  const { quoteId, quoteData, ...quotePayload } = req.body;
  const payload = quoteData && typeof quoteData === "object" ? quoteData : quotePayload;
  const ctx = await resolveLeadForMutation(id, { includeQuotes: true });
  if (!ctx) return res.status(404).json({ error: "Lead not found" });
  const { lead, resolved, supabase } = ctx;

  if (payload.quote_type === "auto_sizer" && !REQUIRE_EXPLICIT_QUOTE_SAVE) {
    return res.status(403).json({ error: "Auto Sizer quote updates are temporarily disabled." });
  }

  const quoteIndex = lead.quotes?.findIndex((q: any) => q.id === quoteId);
  if (quoteIndex === -1 || quoteIndex === undefined) {
    return res.status(404).json({ error: "Quote not found" });
  }

  const existingQuote = lead.quotes[quoteIndex];
  const mergedRows = payload.boqRows || payload.boqItems || existingQuote.boqRows || existingQuote.boqItems || [];
  const mergedItemCount = mergedRows.filter((r: any) => r && r.type === "item").length;
  if (mergedItemCount === 0) {
    return res.status(400).json({ error: "Cannot save quote with zero BOQ items." });
  }

  const resolvedUpdateType =
    payload.quote_type === "auto_sizer" && REQUIRE_EXPLICIT_QUOTE_SAVE
      ? "auto_sizer"
      : "manual_boq";

  const updatedQuote = {
    ...existingQuote,
    ...payload,
    id: quoteId,
    quote_type: resolvedUpdateType,
    source: resolvedUpdateType === "auto_sizer" ? "autosizer" : "manual",
    updatedAt: new Date().toISOString(),
  };

  lead.quotes[quoteIndex] = updatedQuote;
  persistLeadLocally(id, lead, supabase);

  if (supabase) {
    try {
      const customerId = resolved.customer_id || `cust-${id.replace("lead-", "")}`;
      
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
    } catch (err: any) {
      console.error("[Supabase Update Quotation Error]:", err.message);
    }
  }

  await appendActivityLog(
    "sales",
    updatedQuote.bdmName || leadAdvisorLabel(lead.assignedSalesperson),
    "Sales Executive",
    "Quotation Updated",
    `Updated quote ${quoteId} for ${lead.name}`
  );
  res.json(lead);
});

// 9d. Base64 Upload endpoint
app.post("/api/upload", async (req, res) => {
  try {
    // Accept both field name formats: {base64Data, filename} and {base64, fileName}
    const base64Input = req.body.base64Data || req.body.base64;
    const filenameInput = req.body.filename || req.body.fileName;
    
    if (!base64Input) {
      return res.status(400).json({ error: "base64Data or base64 field is required" });
    }
    
    const matches = base64Input.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let dataBuffer;
    let extension = "";
    if (matches && matches.length === 3) {
      extension = matches[1].split('/')[1];
      dataBuffer = Buffer.from(matches[2], 'base64');
    } else {
      dataBuffer = Buffer.from(base64Input, 'base64');
    }

    const cleanFilename = filenameInput 
      ? filenameInput.replace(/[^a-zA-Z0-9.-]/g, "_")
      : `upload_${Date.now()}.${extension || 'png'}`;

    const uploadsDir = path.join(__dirname, "public", "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filePath = path.join(uploadsDir, cleanFilename);
    fs.writeFileSync(filePath, dataBuffer);

    // Return both the file path URL and the original base64 data URL for direct storage
    res.json({ url: `/uploads/${cleanFilename}`, dataUrl: base64Input });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to upload file: " + err.message });
  }
});

app.post("/api/quote-assets/watermark", async (req, res) => {
  try {
    const base64Input = req.body.base64Data || req.body.base64;
    const settingsId = req.body.settingsId || req.body.id || "settings-1";
    const parsed = parseQuoteAssetBase64Upload(base64Input);
    const uploaded = await uploadQuoteWatermarkAsset(
      parsed.buffer,
      parsed.contentType,
      parsed.extension,
      settingsId
    );
    res.json(uploaded);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Watermark upload failed." });
  }
});

app.delete("/api/quote-assets/watermark", async (req, res) => {
  try {
    const storagePath = req.body.globalWatermarkFile || req.body.storagePath;
    if (!storagePath) {
      return res.status(400).json({ error: "globalWatermarkFile is required." });
    }
    await deleteQuoteWatermarkAsset(String(storagePath));
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Watermark delete failed." });
  }
});

// 10. Accept Quote & Auto-Provision trackers
app.post("/api/leads/:id/accept-quote", async (req, res) => {
  const { id } = req.params;
  const { quoteId } = req.body;
  const ctx = await resolveLeadForMutation(id, { includeQuotes: true });
  if (!ctx) return res.status(404).json({ error: "Lead not found" });
  const { lead, resolved, supabase } = ctx;

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

  const advanceAmt = Number((costTotal * 0.3).toFixed(2));
  const paymentTrack = {
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

  if (!supabase) {
    db.projects.unshift(newProject);
    db.netMeteringTrackers[lead.id] = {
      leadId: lead.id,
      documentsCollected: true,
      applicationSubmitted: true,
      discoInspection: false,
      demandNotice: false,
      meterInstallation: false,
      greenMeterActive: false
    };
    db.paymentTracks[lead.id] = paymentTrack;
    persistLeadLocally(id, lead, supabase);
  }

  if (supabase) {
    try {
      const customerId = resolved.customer_id || `cust-${id.replace("lead-", "")}`;

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
        milestones: JSON.stringify(paymentTrack.milestones)
      });
    } catch (err: any) {
      console.error("[Supabase Quote Acceptance Error]:", err.message);
    }
  }

  const staff = readStaffAuth(req);
  const contractProvision = await provisionContractToInvoiceWorkflow(lead, db, {
    quotationId: quoteId,
    supabase,
    actor: staff.userId && staff.username
      ? { userId: staff.userId, username: staff.username, role: staff.role || "Super Admin" }
      : undefined,
  });
  if (!supabase) saveDb();

  await appendActivityLog(lead.id, lead.name, "Customer", "Contract Signed", `Signed blueprint quotation, paid 30% advance retainer of $${advanceAmt}`);
  const sText = `☀️ Contract signed! We have received your solar retainer advance core of $${advanceAmt}. Sunchaser structural designers are preparing engineering submittals for city review. Track: http://sunchaser.co/portal`;
  await triggerWhatsAppNotification(lead.name, lead.phone, "contract_signed", sText);

  res.json({ ...lead, contractProvision });
});

// 11. Update installer progress log tasks
app.post("/api/leads/:id/update-installation", async (req, res) => {
  const { id } = req.params;
  const { progress, tasks, status, completionPhotos, report } = req.body;
  const ctx = await resolveLeadForMutation(id);
  if (!ctx) return res.status(404).json({ error: "Lead not found" });
  const { lead, supabase } = ctx;

  if (lead.installation) {
    if (progress !== undefined) lead.installation.progress = Number(progress);
    if (tasks !== undefined) lead.installation.tasks = tasks;
    if (status !== undefined) lead.installation.status = status;
    if (completionPhotos !== undefined) lead.installation.completionPhotos = completionPhotos;
    if (report !== undefined) lead.installation.report = report;

    const proj = supabase
      ? null
      : db.projects.find((p: any) => p.leadId === lead.id);
    if (proj) {
      if (lead.installation.progress === 100) {
        lead.installation.status = "Completed";
        lead.status = "Installed";
        proj.stage = "Completed";
        await appendActivityLog("installer", activityActorFromStaff(req, "Installation Team"), "Installation Team", "Project Commissioned", `Completed all panel mount tests at ${lead.name}'s site.`);
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

  persistLeadLocally(id, lead, supabase);

  if (supabase) {
    try {
      if (lead.installation?.tasks) {
        for (const t of lead.installation.tasks) {
          await supabase.from("installation_tasks").update({ done: t.done }).eq("id", `${id}-${t.id}`);
        }
      }

      const { data: projRow } = await supabase.from("projects").select("id, stage").eq("lead_id", id).maybeSingle();
      if (projRow) {
        let stage = projRow.stage;
        if (lead.installation?.progress === 100) stage = "Completed";
        else if (lead.installation && lead.installation.progress > 80) stage = "Testing & Commissioning";
        else if (lead.installation && lead.installation.progress > 60) stage = "Inverter Installation";
        else if (lead.installation && lead.installation.progress > 40) stage = "Panel Installation";
        else if (lead.installation) stage = "Structure Installation";
        await supabase.from("projects").update({ stage, updated_at: new Date().toISOString() }).eq("id", projRow.id);
      }
      if (lead.installation?.progress === 100) {
        await supabase.from("leads").update({ status: "Installed" }).eq("id", id);
      }
    } catch (err: any) {
      console.error("[Supabase Installation Update Error]:", err.message);
    }
  }

  await appendActivityLog("installer", activityActorFromStaff(req, "Installation Team"), "Installation Team", "Installation Status Adjusted", `Adjusted progress to ${progress}%`);
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
    const lead = filterActiveLeads(db.leads).find((l: any) => l.email.toLowerCase() === ticket.email.toLowerCase());
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
  await appendActivityLog("technician", ticket.assignedTechnician || activityActorFromStaff(req, "Technician"), "Technician", "Complaint Resolved by Tech", `Dispatched final resolution of concern ${id}`);
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

  const leadCtx = await resolveLeadForMutation(project.leadId);
  const lead = leadCtx?.lead ?? null;
  if (lead) {
    if (stage === "Completed") {
      lead.status = "Installed";
      if (lead.installation) lead.installation.progress = 100;
    }
    persistLeadLocally(project.leadId, lead, leadCtx?.supabase);
  }

  if (!leadCtx?.supabase) {
    saveDb();
  }

  if (isSupabaseActive()) {
    try {
      const supabaseClient = getSupabase()!;
      await supabaseClient.from("projects").update({ stage, updated_at: project.updatedAt }).eq("id", id);
      if (payment) {
        await supabaseClient.from("payments").update({
          advance_received: payment.advanceReceived,
          pending_amount: payment.pendingAmount,
          invoice_status: payment.invoiceStatus,
          milestones: JSON.stringify(payment.milestones)
        }).eq("lead_id", project.leadId);
      }
      if (lead && stage === "Completed") {
        await supabaseClient.from("leads").update({ status: "Installed" }).eq("id", lead.id);
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

function mapProductRowForSupabase(data: any, fallbackId?: string) {
  return {
    id: data.id || fallbackId,
    name: data.name,
    category: data.category,
    brand: data.brand || "",
    model: data.model || "",
    sku: data.sku || "",
    price: Number(data.price || 0),
    discount: Number(data.discount || 0),
    stock: Number(data.stock || 0),
    images: data.images || [],
    warranty_period: data.warrantyPeriod || data.warranty_period || "2 Years",
    specifications: data.specifications || {},
  };
}

function mapSupabaseProductRowToApp(row: any) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    brand: row.brand,
    model: row.model,
    sku: row.sku,
    price: Number(row.price || 0),
    discount: Number(row.discount || 0),
    stock: Number(row.stock || 0),
    images: row.images || [],
    warrantyPeriod: row.warranty_period,
    specifications:
      typeof row.specifications === "string"
        ? JSON.parse(row.specifications)
        : row.specifications || {},
  };
}

async function resolveCatalogProduct(
  id: string
): Promise<{ product: any; localIndex: number } | null> {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (data) {
      loadDb();
      if (!db.products) db.products = [];
      const localIndex = db.products.findIndex((item: any) => item.id === id);
      return { product: mapSupabaseProductRowToApp(data), localIndex };
    }
  }
  loadDb();
  if (!db.products) db.products = [];
  const localIndex = db.products.findIndex((item: any) => item.id === id);
  if (localIndex === -1) return null;
  return { product: db.products[localIndex], localIndex };
}

function persistCatalogProductLocally(id: string, product: any, localIndex: number): void {
  if (localIndex < 0) return;
  if (!db.products) db.products = [];
  db.products[localIndex] = product;
  saveDb();
}

function removeCatalogProductLocally(id: string, localIndex: number): void {
  if (localIndex < 0) return;
  if (!db.products) db.products = [];
  db.products = db.products.filter((item: any) => item.id !== id);
  saveDb();
}

app.patch("/api/admin/products/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "Product id is required." });

  try {
    const ctx = await resolveCatalogProduct(id);
    if (!ctx) return res.status(404).json({ error: "Product not found." });

    const updated = { ...ctx.product, ...req.body, id };

    if (isSupabaseActive()) {
      const supabase = getSupabase()!;
      const { error } = await supabase
        .from("products")
        .upsert(mapProductRowForSupabase(updated, id), { onConflict: "id" });
      if (error) return res.status(500).json({ error: error.message });
      persistCatalogProductLocally(id, updated, ctx.localIndex);
    } else {
      persistCatalogProductLocally(id, updated, ctx.localIndex);
    }

    await appendActivityLog(
      "admin",
      "Alex Admin",
      "Super Admin",
      "Product Updated",
      `Updated catalog product ${id}`
    );
    return res.json({ success: true, product: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Product update failed." });
  }
});

app.delete("/api/admin/products/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "Product id is required." });

  try {
    const ctx = await resolveCatalogProduct(id);
    if (!ctx) return res.status(404).json({ error: "Product not found." });

    if (isSupabaseActive()) {
      const supabase = getSupabase()!;
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
    } else {
      removeCatalogProductLocally(id, ctx.localIndex);
    }

    removeCatalogProductLocally(id, ctx.localIndex);

    await appendActivityLog(
      "admin",
      "Alex Admin",
      "Super Admin",
      "Product Deleted",
      `Deleted catalog product ${id}`
    );
    return res.json({ success: true, id, deleted: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Product delete failed." });
  }
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
      const editId = id || data?.id;
      const idx = db[table].findIndex((item: any) => item.id === editId);
      if (idx !== -1) {
        db[table][idx] = { ...db[table][idx], ...data };
        if (table === "quotePdfSettings") {
          const { watermarkPayload } = buildQuotePdfSettingsSupabasePayload(data);
          db[table][idx] = applyGlobalWatermarkToPdfSettingsRow(
            db[table][idx],
            watermarkPayload
          );
        }
      } else if (editId) {
        db[table].push({ ...data, id: editId });
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
          if (action !== "delete" && data) {
            mappedData = mapProductRowForSupabase(data, id);
          }
        } else if (table === "solarPackages") {
          pgTable = "solar_packages";
          mappedData = {
            id: data.id,
            name: data.name,
            panel_brand: data.panelBrand || "",
            inverter_brand: data.inverterBrand || "",
            battery_option: data.batteryOption || "None",
            price: Number(data.price || 0),
            structure_type: data.structureType || "standard",
            profit_margin: Number(data.profitMargin || 0),
            enabled: data.enabled !== false,
            system_size_kw: Number(data.systemSizeKw || 0),
            equipment_tier: data.equipmentTier || "budgeted",
            boq_rows: data.boqRows || [],
            archived: !!data.archived,
            discount_type: data.discountType || "fixed",
            discount_value: Number(data.discountValue || 0),
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
            monthly_units: resolveMonthlyUnits(
              Number(data.monthlyBill) || 0,
              Number(data.monthlyUnits) || 0
            ),
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
        } else if (table === "quoteTemplates") {
          pgTable = "quote_templates";
          mappedData = {
            id: data.id,
            name: data.name,
            is_active: data.isActive !== undefined ? data.isActive : true
          };
        } else if (table === "quoteTemplatePages") {
          pgTable = "quote_template_pages";
          mappedData = {
            id: data.id,
            template_id: data.template_id || data.templateId,
            page_type: data.page_type || data.pageType,
            title: data.title,
            body_text: data.body_text !== undefined ? data.body_text : (data.bodyText || ""),
            image_url: data.image_url !== undefined ? data.image_url : (data.imageUrl || ""),
            bg_image_url: data.bg_image_url !== undefined ? data.bg_image_url : (data.bgImageUrl || ""),
            is_enabled: data.is_enabled !== undefined ? data.is_enabled : (data.isEnabled !== undefined ? data.isEnabled : true),
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
            is_active: data.isActive !== undefined ? data.isActive : true,
            show_on_invoice: !!(data.showOnInvoice ?? data.show_on_invoice),
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
          const { scalarRow, jsonbRow, watermarkPayload } =
            buildQuotePdfSettingsSupabasePayload(data);

          const { error: wmSettingsError } = await supabase.from("settings").upsert(
            {
              key: QUOTE_PDF_GLOBAL_WATERMARK_KEY,
              value: watermarkPayload || {},
            },
            { onConflict: "key" }
          );
          if (wmSettingsError) {
            console.error(
              `[Supabase quotePdfSettings watermark settings sync error]:`,
              wmSettingsError.message
            );
            return res.status(500).json({
              error: `Global watermark save failed: ${wmSettingsError.message}`,
            });
          }

          const { error: scalarError } = await supabase
            .from(pgTable)
            .upsert(scalarRow, { onConflict: "id" });
          if (scalarError) {
            console.error(`[Supabase quotePdfSettings scalar sync error]:`, scalarError.message);
            return res.status(500).json({
              error: `Quote PDF settings save failed: ${scalarError.message}`,
            });
          }

          const { error: jsonbError } = await supabase
            .from(pgTable)
            .upsert(jsonbRow, { onConflict: "id" });
          if (jsonbError) {
            console.warn(
              `[Supabase quotePdfSettings jsonb sync warning]: ${jsonbError.message} — using settings fallback`
            );
          }

          mappedData = null;
        }

        if (pgTable && mappedData) {
          if (action === "add" || action === "edit") {
            const { error } = await supabase.from(pgTable).upsert(mappedData, { onConflict: "id" });
            if (error) {
              console.error(`[Supabase manual CRUD Sync error]: table=${pgTable}`, error.message);
              if (table === "products") {
                return res.status(500).json({ error: `Product save failed: ${error.message}` });
              }
            }
          } else if (action === "delete") {
            const { error } = await supabase.from(pgTable).delete().eq("id", id);
            if (error) {
              console.error(`[Supabase manual CRUD Delete error]: table=${pgTable}`, error.message);
              if (table === "products") {
                return res.status(500).json({ error: `Product delete failed: ${error.message}` });
              }
            }
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

// Helper function to compile printable Sunchaser PDF HTML (White/Light Theme)

function parseExtendedSettings(bodyTextContent: string, _pageType?: string) {
  return parseQuotePageExtendedSettings(bodyTextContent);
}

function buildIncludedPagesFromTemplate(activeState: Database, templateId: string): string[] {
  const allDbPages = activeState.quoteTemplatePages || [];
  const dbPages = allDbPages.filter((p: any) => (p.templateId || p.template_id) === templateId);
  const types = new Set<string>();
  dbPages.forEach((p: any) => {
    if (p.isEnabled === false || p.is_enabled === false) return;
    const t = p.pageType || p.page_type || "";
    if (t === "terms1" || t === "terms2") types.add("terms");
    else if (t.startsWith("structure_")) types.add("structure");
    else types.add(t);
  });
  return Array.from(types);
}

const OFFICIAL_QUOTE_LOGO = "/assets/sunchaser-logo.png";

function resolveQuotePdfLogoUrl(raw?: string | null): string {
  const trimmed = String(raw || "").trim();
  return trimmed || OFFICIAL_QUOTE_LOGO;
}

function resolveQuotePdfBranding(activeState: Database) {
  const pdf = (activeState.quotePdfSettings || [])[0] || {};
  const companyName =
    pdf.companyName ||
    pdf.company_name ||
    "Sunchaser Energy Systems";
  const logoUrl = resolveQuotePdfLogoUrl(pdf.logoUrl || pdf.logo_url);
  const savedHeader = pdf.globalPdfHeader || pdf.global_pdf_header || null;
  const savedFooter = pdf.globalPdfFooter || pdf.global_pdf_footer || null;
  const savedWatermark = withResolvedGlobalWatermark(
    (pdf.globalWatermark ||
      pdf.global_watermark ||
      savedHeader?.watermark ||
      null) as any
  );
  return {
    companyName,
    officeAddress:
      pdf.officeAddress ||
      pdf.office_address ||
      "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore",
    phoneNumbers:
      pdf.hotlinePhones ||
      pdf.hotline_phones ||
      "0309-0236666, 0330-7776444",
    billingEmail:
      pdf.billingEmail ||
      pdf.billing_email ||
      "billing@sunchaser-energy.com",
    websiteUrl:
      pdf.websiteUrl ||
      pdf.website_url ||
      "www.sunchaser-energy.com",
    logoUrl,
    useDefaultCompanyContent: !!(pdf.useDefaultCompanyContent ?? pdf.use_default_company_content),
    globalPdfHeader: savedHeader,
    globalPdfFooter: savedFooter,
    globalWatermark: savedWatermark || {},
    globalTypography: pdf.globalTypography || pdf.global_typography || pdf.globalAuthoring?.typography || {},
    pdfQuality: pdf.pdfQuality || pdf.globalAuthoring?.pdfQuality || "print",
    globalAuthoring: pdf.globalAuthoring || pdf.global_authoring || {},
  };
}

// Helper function to compile printable Sunchaser PDF HTML (White/Light Theme)
function compileSunchaserPDFHtml(
  mode: 'sizer' | 'manual' | 'preview',
  quoteObj: any,
  leadObj: any,
  activeState: Database,
  options: {
    includedPages?: string[];
    templateId?: string;
    includeSizerItems?: boolean;
    pdfQuality?: PdfQualityMode;
  } = {}
): string {
  const settings = resolveQuotePdfBranding(activeState);
  const proposal = mergeQuoteWithLead(quoteObj, leadObj);
  const siteLocationLabel = formatSiteLocation(proposal);

  // PKR Formatting helper
  const formatPKR = (val: number) => {
    if (val === undefined || val === null || isNaN(val)) return "Rs. 0";
    return "Rs. " + Math.round(val).toLocaleString("en-US");
  };

  if (mode === 'sizer') {
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
            <div style="display:flex;align-items:center;gap:12px;">
              <img src="${settings.logoUrl}" style="max-height:48px;object-fit:contain;" alt="${settings.companyName}" />
              <div>
              <div class="title">${settings.companyName.toUpperCase()}</div>
              <div class="subtitle">Technical Capacity & Sizing Assessment Summary</div>
              </div>
            </div>
            <div style="text-align: right; font-size: 10px;">
              <strong>Date:</strong> ${new Date().toLocaleDateString()}<br/>
              <strong>Lead ID:</strong> ${leadObj.id}
            </div>
          </div>
          
          <div class="grid-2">
            <div class="card">
              <div class="section-title">Client Demographics & Details</div>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 2px 0;"><strong>Client Name:</strong></td><td>${leadObj.name}</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Phone:</strong></td><td>${leadObj.phone}</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Email:</strong></td><td>${leadObj.email || 'N/A'}</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Address:</strong></td><td>${leadObj.address || 'N/A'}</td></tr>
                <tr><td style="padding: 2px 0;"><strong>Location:</strong></td><td>${leadObj.location || 'Lahore'}</td></tr>
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
                  <td>${quoteObj.panelType || 'Premium Monocrystalline Panels'}</td>
                  <td>Qty: ${count} (${quoteObj.panelWattage || 580}W modules)</td>
                </tr>
                <tr>
                  <td><strong>Inverter Unit</strong></td>
                  <td>${quoteObj.inverterType || 'Grid-tied Cloud Sync Inverter'}</td>
                  <td>Dual MPPT phase synchronization technology</td>
                </tr>
                <tr>
                  <td><strong>Structure Type</strong></td>
                  <td>${quoteObj.structureType || 'Standard Mount'}</td>
                  <td>Mughal Steel L3 wind-shear compliant framing</td>
                </tr>
                <tr>
                  <td><strong>Battery Option</strong></td>
                  <td>${quoteObj.batteryCapacity !== 'None' && quoteObj.batteryCapacity ? quoteObj.batteryCapacity : 'No storage option configured'}</td>
                  <td>LFP high-safety storage module</td>
                </tr>
                <tr>
                  <td><strong>Net Metering</strong></td>
                  <td>${quoteObj.netMeteringRequired === 'Yes' || leadObj.backupRequirement === 'None' ? 'Yes (NEPRA standard bidirectional meter)' : 'No'}</td>
                  <td>Application filing included</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="card" style="margin-top: 15px; border-left: 4px solid #f59e0b;">
            <div class="section-title" style="color: #b45309; border-bottom: none; margin-bottom: 4px;">Technical Feasibility Notes</div>
            <p style="margin: 0; font-size: 10px; color: #475569;">
              This sizing assessment is simulated based on local insolation statistics for ${leadObj.location || 'Lahore'} (insolation index: 4.8 hr/day). Actual energy yield depends on panel clean routines, shade obstacles, tilt parameters, and LESCO grid uptime. Net-metering approval requires a valid three-phase connection and sanctioned load match.
            </p>
          </div>
          
          <div style="margin-top: 30px; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 15px; font-size: 9px; color: #64748b;">
            <strong>${settings.companyName}</strong> | ${settings.officeAddress} | Hotlines: ${settings.phoneNumbers}
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Global Header & Footer configs — primary source: quote_pdf_settings (Supabase)
  const savedHeader = settings.globalPdfHeader;
  const savedFooter = settings.globalPdfFooter;
  const useDefaultCompanyContent = settings.useDefaultCompanyContent === true;
  const globalHeader = {
    enabled: savedHeader?.enabled !== false,
    text: savedHeader?.text || `☀️ ${settings.companyName.toUpperCase()}`,
    logoUrl: savedHeader?.logoUrl || settings.logoUrl,
    logoSize: savedHeader?.logoSize || "25px",
    lineColor: savedHeader?.lineColor || "#f59e0b",
    alignment: savedHeader?.alignment || "left",
  };

  const globalFooter = {
    enabled: savedFooter?.enabled !== false,
    text: savedFooter?.text || `${settings.companyName} | ${settings.officeAddress}`,
    lineColor: savedFooter?.lineColor || "#cbd5e1",
    alignment: savedFooter?.alignment || "left",
    fontSize: savedFooter?.fontSize || "8.5px",
    showPageNumber: savedFooter?.showPageNumber === true,
  };

  const globalWatermark = settings.globalWatermark || {};
  const globalTypography = settings.globalTypography || settings.globalAuthoring?.typography || {};
  const pdfQuality: PdfQualityMode =
    options.pdfQuality ||
    settings.pdfQuality ||
    settings.globalAuthoring?.pdfQuality ||
    "print";

  // Resolve template pages from database if available
  const templateId = options.templateId || "tmpl-1";
  const strictTemplateOnly = mode === 'manual' || mode === 'preview';
  const allDbPages = activeState.quoteTemplatePages || [];
  const dbPages = allDbPages.filter((p: any) => (p.templateId || p.template_id) === templateId);

  const getPageConfig = (pageType: string, defaultTitle: string, defaultBody: string) => {
    const dbPage = dbPages.find((p: any) => p.pageType === pageType);
    if (dbPage) {
      const rawBody = dbPage.bodyText || dbPage.body_text || "";
      const ext = parseExtendedSettings(rawBody, pageType);
      return {
        enabled: dbPage.isEnabled !== false,
        title: dbPage.title !== undefined && dbPage.title !== null ? dbPage.title : (useDefaultCompanyContent ? defaultTitle : ""),
        bodyText: ext.bodyText !== undefined ? ext.bodyText : (useDefaultCompanyContent ? defaultBody : ""),
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

  const getIncludedFlag = (pageType: string) => {
    if (options.includedPages && Array.isArray(options.includedPages)) {
      return options.includedPages.includes(pageType);
    }
    if (strictTemplateOnly) {
      return dbPages.some((p: any) => {
        if (p.isEnabled === false || p.is_enabled === false) return false;
        const t = p.pageType || p.page_type || "";
        if (pageType === "terms") return t === "terms1" || t === "terms2";
        if (pageType === "structure") return t.startsWith("structure_");
        return t === pageType;
      });
    }
    return true;
  };

  // 1. Cover Page Config
  const pCover = getPageConfig("cover", "Sunchaser Energy Systems", "Generational Energy Independence\\nTechnical Feasibility & Engineering Quotation");
  // 2. Profile Page Config
  const pProfile = getPageConfig("profile", "Sunchaser Group Profile", "Sunchaser Energy operates under a unified consortium of specialized engineering, supply chain, and logistics enterprises. Together, we bring a level of structural reliability and direct import authorization unmatched in the local solar industry.");
  // 3. Social QR Page Config
  const pQr = getPageConfig("qr", "Why Partner with Sunchaser?", "Tier-1 Direct Imported Hardware: All solar modules are sourced directly from Bloomberg Tier-1 rated manufacturers (Jinko, Longi, JA Solar) with complete customs trace certificates.");
  // 4. CEO Page Config
  const pCeo = getPageConfig("ceo", "Executive Board Assurances", "");
  // 5. Structure Page Config
  const pStructure = getPageConfig("structure", "Mounting Structure & Fabrication Details", "Premium Galvanized Mounting Structure, wind resistant up to 130 km/h.");
  // 6. Terms Page Configs
  const pTerms1 = getPageConfig("terms1", "Terms, Conditions & Regulations (1/2)", "");
  const pTerms2 = getPageConfig("terms2", "Terms, Conditions & Regulations (2/2)", "");
  // 7. Signoff Config
  const pSignoff = getPageConfig("signoff", "Client Verification & Sign-off", "");
  // 8. Bank Config
  const pBank = getPageConfig("bank", "Official Payment Channels", "");
  // 9. Final Page Config
  const pFinal = getPageConfig("final", "Sunchaser Energy Systems", "Thank you for choosing Sunchaser Energy Systems! We are committed to delivering the highest caliber of electrical integration, structural safety, and long-term utility savings.");

  // Date Calculations
  const qDate = quoteObj.quoteDate ? new Date(quoteObj.quoteDate) : new Date();
  const validityDate = new Date(qDate.getTime() + 3 * 24 * 60 * 60 * 1000);
  const expiryDateString = validityDate.toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' });
  const quoteDateString = qDate.toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' });

  // Bank accounts mapping (Page 10)
  const dbBankAccounts = activeState.bankAccounts || [];
  const bankAccountsList = dbBankAccounts.filter((b: any) => b.isActive !== false);

  let bankAccountsHtml = `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 15px;">`;
  bankAccountsList.forEach((acc: any, index: number) => {
    bankAccountsHtml += `
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; font-size: 11px; line-height: 1.4;">
        <div style="font-weight: 800; font-size: 11.5px; color: #0f172a; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
          <span>${index + 1}. ${acc.bankName || acc.bank_name}</span>
          <span style="font-size: 7.5px; font-weight: 700; color: #047857; background-color: #d1fae5; padding: 1px 6px; border-radius: 9999px; text-transform: uppercase;">Official Channel</span>
        </div>
        <div style="color: #475569;"><strong>Title:</strong> <span style="color: #0f172a; font-weight: 600;">${acc.accountTitle || acc.account_title || acc.title}</span></div>
        <div style="color: #475569;"><strong>A/C:</strong> <span style="color: #0f172a; font-weight: 600; font-family: monospace;">${acc.accountNumber || acc.account_number || acc.accountNo}</span></div>
        ${acc.iban ? `<div style="color: #475569; font-family: monospace; font-size: 9.5px; word-break: break-all; margin-top: 2px;"><strong>IBAN:</strong> ${acc.iban}</div>` : ''}
      </div>
    `;
  });
  bankAccountsHtml += `</div>`;

  // Company Terms (Page 7 & Page 8)
  const dbTerms = activeState.companyTerms || [];
  const termsList = dbTerms.map((t: any) => t.termText || t.term_text);

  let tcPage1Html = "";
  let tcPage2Html = "";
  termsList.forEach((clause: string, index: number) => {
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

  // Structure Graphic SVGs
  const selectedStructKey = String(quoteObj.selectedStructure || quoteObj.structureType || "standard").toLowerCase();
  const dbStructs = activeState.structureDescriptions || [];
  const customStruct = quoteObj.customStructure || {};
  const structDetails = dbStructs.find((s: any) => s.structureType === selectedStructKey) || {
    title: selectedStructKey === "custom" ? (customStruct.name || "Custom Mounting Details") : (selectedStructKey === "elevated" ? "Elevated Frame Mount" : (selectedStructKey === "girder" ? "Heavy-Duty Mughal Girder Frame" : "Standard A-Frame Mount")),
    descriptionEn: selectedStructKey === "custom" ? (customStruct.descEn || "Custom structure specifications configured in BOQ.") : (selectedStructKey === "elevated" ? "10ft Roof clearance hot-dip galvanized elevated structure frame." : (selectedStructKey === "girder" ? "Heavy-Duty Mughal Girder Frame supporting extreme wind shear." : "Premium Galvanized Mounting Structure, wind resistant up to 130 km/h.")),
    descriptionUr: selectedStructKey === "custom" ? (customStruct.descUr || "کسٹم ڈیزائن ماونٹنگ سٹرکچر") : (selectedStructKey === "elevated" ? "10 فٹ چھت کی اونچائی کا ہاٹ ڈِپ گیلوانائزڈ ایلیویٹڈ سٹرکچر فریم۔" : (selectedStructKey === "girder" ? "ہیوی ڈیوٹی مغل گارڈر فریم جو شدید ہوا کے دباؤ کو برداشت کرتا ہے۔" : "پریمیم گیلوانائزڈ ماونٹنگ سٹرکچر، 130 کلومیٹر فی گھنٹہ تک ہوا کے خلاف مزاحم۔")),
    materialType: selectedStructKey === "custom" ? (customStruct.materialType || "Custom structure material") : (selectedStructKey === "elevated" ? "Hot-dip Galvanized Steel" : (selectedStructKey === "girder" ? "Mughal Girder Steel" : "Galvanized L3 Steel")),
    weight: selectedStructKey === "custom" ? (customStruct.weight || "Custom Weight") : (selectedStructKey === "girder" ? "1600g/ft Structural Load" : "Standard Weight"),
    windRating: selectedStructKey === "custom" ? (customStruct.windRating || "Custom wind shear certification") : (selectedStructKey === "girder" ? "150 km/h" : "130 km/h"),
    warranty: selectedStructKey === "custom" ? (customStruct.warranty || "Custom Warranty") : (selectedStructKey === "girder" ? "15 Years Warranty" : "10 Years Warranty")
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

  // 17 CEO messages
  const dbCeos = activeState.ceoMessages || [];
  const ceoList = dbCeos;

  // LESCO / Net Metering Settings (Page 9)
  const lescoObj = quoteObj.lescoSettings || { meterNo: "", consumerNo: "", sanctionedLoad: "", phaseType: "Three Phase" };
  const netMeteringText = quoteObj.netMeteringRequired || "Yes";

  // ----------------------------------------------------
  // Dynamic Template Page Assembly & Sort Order Logic
  // ----------------------------------------------------
  const getIncludedFlagForPageType = (pageType: string) => {
    if (pageType === 'terms1' || pageType === 'terms2') {
      return getIncludedFlag('terms');
    }
    if (pageType.startsWith('structure_')) {
      return getIncludedFlag('structure');
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

  // Load all enabled quote template pages for this template from Supabase / DB
  const enabledDbPages = dbPages.filter((p: any) => {
    if (p.isEnabled === false || p.is_enabled === false) return false;
    const type = p.pageType || p.page_type || "";
    if (!getIncludedFlagForPageType(type)) return false;
    if (type.startsWith('structure_') && type !== activeStructurePageType) return false;
    return true;
  });

  const pagesList: any[] = enabledDbPages.map((p: any) => ({
    type: p.pageType || p.page_type,
    sortOrder: Number(p.sortOrder || p.sort_order || 0),
    dbPage: p
  }));

  // Sort by sortOrder
  pagesList.sort((a, b) => a.sortOrder - b.sortOrder);

  const defaultAutoSizerIds = [
    'h-1', 'panel_row', 'inverter_row', 'battery_row', 's-1',
    'h-2', 'dc_cable_row', 'ac_cable_row', 'earth_wire_row', 's-2',
    'h-3', 'db_box_row', 's-3',
    'h-4', 'supplies_row', 's-4',
    'h-5', 'earthing_bore_row', 's-5',
    'h-6', 'structure_row', 'civil_work_row', 'install_service_row', 's-6',
    'h-7', 'freight_row', 'net_metering_row', 'survey_design_row', 's-7'
  ];

  // Ensure BOQ page exists for manual quotes when template editor has no boq page configured
  if (mode === "manual") {
    const allRowsForCheck = quoteObj.boqRows || quoteObj.boqItems || [];
    const manualRowCount = allRowsForCheck.filter(
      (r: any) => r && r.type === "item" && !defaultAutoSizerIds.includes(r.id)
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
          isEnabled: true,
        },
      });
      pagesList.sort((a, b) => a.sortOrder - b.sortOrder);
    }
  }

  // If template pages are missing in remote DB, synthesize from includedPages so PDF is not blank (not for strict manual/preview)
  if (!strictTemplateOnly && pagesList.length === 0 && options.includedPages?.length) {
    options.includedPages.forEach((pageType: string, idx: number) => {
      if (!getIncludedFlagForPageType(pageType)) return;
      if (pageType.startsWith("structure_") && pageType !== activeStructurePageType) return;
      pagesList.push({
        type: pageType,
        sortOrder: idx + 1,
        dbPage: { pageType, title: "", bodyText: "", isEnabled: true },
      });
    });
  }

  // Diagnostic Logs
  console.log(`[PDF Rendering Diagnostics]
  - selected template id: ${templateId}
  - number of pages loaded: ${dbPages.length}
  - enabled page count: ${enabledDbPages.length}
  - rendered page count: ${pagesList.length}
  `);

  let pagesHtml = "";
  pagesList.forEach((pageItem, pageIndex) => {
    const pageType = pageItem.type;
    // Resolve page title and body strictly from template editor content
    const dbPage = pageItem.dbPage;
    const rawBody = (dbPage && (dbPage.bodyText || dbPage.body_text)) || "";
    const ext = parseExtendedSettings(rawBody, pageType);

    const p = {
      title: (dbPage && dbPage.title !== undefined && dbPage.title !== null) ? dbPage.title : "",
      bodyText: dbPage ? (ext.bodyText !== undefined ? ext.bodyText : "") : "",
      imageUrl: (dbPage && (dbPage.imageUrl || dbPage.image_url)) || "",
      bgImageUrl: (dbPage && (dbPage.bgImageUrl || dbPage.bg_image_url)) || ""
    };

    const typo = resolveTypography(ext, globalTypography);
    const typoStyle = typographyStyleAttr(typo);
    const wmSource = String(
      ext.watermark?.imageUrl || p.bgImageUrl || globalWatermark?.imageUrl || ""
    ).trim();
    const wmSettings =
      ext.watermark?.imageUrl
        ? ext.watermark
        : { ...(globalWatermark || {}), ...(ext.watermark || {}) };
    const watermarkHtml = buildWatermarkLayer(wmSource, wmSettings);
    const mergedTypography = { ...globalTypography, ...ext.typography };
    const pageBody = (contentExt: typeof ext) =>
      renderPageBodyHtml(contentExt, {
        align: typo.textAlign,
        typography: mergedTypography,
      });
    const renderBody = (text?: string) => {
      const payload = { ...ext, bodyText: text ?? ext.bodyText ?? "" };
      const html = pageBody(payload);
      if (html) return html;
      const plain = payload.bodyText;
      if (plain) return renderRichTextBlock(plain, { align: typo.textAlign });
      return "";
    };
    const rich = renderBody;

    // Resolve header settings
    let hEnabled = globalHeader.enabled !== false;
    let hText = globalHeader.text || "☀️ SUNCHASER ENERGY";
    let hLogoUrl = globalHeader.logoUrl || "";
    let hLogoSize = globalHeader.logoSize || "25px";
    let hLineColor = globalHeader.lineColor || "#f59e0b";
    let hAlignment = globalHeader.alignment || "left";
    let hShowPageNumber = ext.header.showPageNumber !== false;

    if (ext.header.mode === 'custom') {
      hEnabled = ext.header.enabled !== false;
      hText = ext.header.text || "";
      hLogoUrl = ext.header.logoUrl || "";
      hLogoSize = ext.header.logoSize || "25px";
      hLineColor = ext.header.lineColor || "#cbd5e1";
      hAlignment = ext.header.alignment || "left";
      if (ext.header.showPageNumber !== undefined) {
        hShowPageNumber = ext.header.showPageNumber !== false;
      }
    } else if (ext.header.mode === 'disabled') {
      hEnabled = false;
    }

    // Resolve footer settings
    let fEnabled = globalFooter.enabled !== false;
    let fText = globalFooter.text || `${settings.companyName} | ${settings.officeAddress}`;
    let fLineColor = globalFooter.lineColor || "#cbd5e1";
    let fAlignment = globalFooter.alignment || "left";
    let fFontSize = globalFooter.fontSize || "8.5px";
    let fShowPageNumber = globalFooter.showPageNumber === true;

    if (ext.footer.mode === 'custom') {
      fEnabled = ext.footer.enabled !== false;
      fText = ext.footer.text || "";
      fLineColor = ext.footer.lineColor || "#cbd5e1";
      fAlignment = ext.footer.alignment || "left";
      if (ext.footer.fontSize) fFontSize = String(ext.footer.fontSize);
      if (ext.footer.showPageNumber !== undefined) {
        fShowPageNumber = ext.footer.showPageNumber === true;
      }
    } else if (ext.footer.mode === 'disabled') {
      fEnabled = false;
    }

    const defaultFooterText = `${settings.companyName} | ${settings.officeAddress} | Hotlines: ${settings.phoneNumbers}`;
    const resolvedFooterText = fText && fText.trim() ? fText : defaultFooterText;

    let headerHtml = "";
    if (hEnabled) {
      hLogoUrl = resolveQuotePdfLogoUrl(hLogoUrl);
      let justifyValue = "space-between";
      let alignValue = "center";
      let flexDir = "row";
      if (hAlignment === 'center') {
        justifyValue = "center";
        flexDir = "column";
      } else if (hAlignment === 'right') {
        justifyValue = "flex-end";
        flexDir = "row-reverse";
      }

      headerHtml = `
        <div class="page-header-logo" style="display: flex; flex-direction: ${flexDir}; justify-content: ${justifyValue}; align-items: ${alignValue}; border-bottom: 1.5px solid ${hLineColor}; padding-bottom: 6px; margin-bottom: 12px; width: 100%;">
          <span class="header-company-name" style="display: flex; align-items: center; gap: 8px;">
            ${hLogoUrl ? `<img src="${hLogoUrl}" style="max-height: ${hLogoSize}; object-fit: contain;" alt="Logo" />` : ''}
            ${hText ? `<span style="font-weight: 800; font-size: 13px; color: #0f172a; letter-spacing: 0.05em;">${hText}</span>` : ''}
          </span>
          ${hShowPageNumber ? `<span style="font-size: 9px; font-weight: 600; color: #64748b;">Page ${pageIndex + 1}</span>` : ''}
        </div>
      `;
    }

    let footerHtml = "";
    if (fEnabled) {
      let justifyValue = "space-between";
      if (fAlignment === 'center') justifyValue = "center";
      else if (fAlignment === 'right') justifyValue = "flex-end";

      footerHtml = `
        <div class="page-footer" style="justify-content: ${justifyValue}; border-top-color: ${fLineColor}; font-size: ${fFontSize};">
          <span style="flex: 1;">${resolvedFooterText}</span>
          ${fAlignment !== 'center' ? `<span style="font-size: 7.5px; font-family: monospace; white-space: nowrap;">Doc ID: SC-${String(leadObj.id || "DRAFT").substring(0, 8).toUpperCase()}${fShowPageNumber ? ` | Pg ${pageIndex + 1}` : ""}</span>` : (fShowPageNumber ? `<span style="font-size: 7.5px;">Page ${pageIndex + 1}</span>` : "")}
        </div>
      `;
    }

    const pageStyleAttr =
      p.bgImageUrl && !wmSource
        ? `style="background: url('${p.bgImageUrl}') no-repeat center center / cover;"`
        : `style="${typoStyle}"`;

    const pageShellOpen = `<div class="quote-page-shell" style="${typoStyle}">`;
    const pageShellClose = `</div>`;

    // Compile dynamic body images
    let bodyImagesHtml = "";
    let absoluteImagesHtml = "";
    
    if (Array.isArray(ext.bodyImages) && ext.bodyImages.length > 0) {
      const sortedImages = [...ext.bodyImages].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      sortedImages.forEach((img: any) => {
        if (!img.url) return;
        const opacityStyle = img.opacity !== undefined ? `opacity: ${img.opacity};` : "";
        const widthStyle = img.width ? `width: ${img.width};` : "width: 150px;";
        
        if (img.position === 'absolute') {
          const coords = `
            top: ${img.top || 'auto'};
            left: ${img.left || 'auto'};
            right: ${img.right || 'auto'};
            bottom: ${img.bottom || 'auto'};
          `;
          absoluteImagesHtml += `
            <!-- bodyImages -->
            <img class="bodyImages" src="${img.url}" style="position: absolute; ${coords} ${widthStyle} ${opacityStyle} object-fit: contain; pointer-events: none; z-index: 5;" alt="Overlay Image" />
          `;
        } else {
          // Block positioning
          const alignStyle = img.alignment === 'center' ? 'margin: 10px auto; display: block;' : (img.alignment === 'right' ? 'margin: 10px 0 10px auto; display: block;' : 'margin: 10px auto 10px 0; display: block;');
          bodyImagesHtml += `
            <div style="width: 100%;">
              <!-- bodyImages -->
              <img class="bodyImages" src="${img.url}" style="${widthStyle} ${opacityStyle} ${alignStyle} object-fit: contain;" alt="Body Image" />
              ${img.title ? `<div style="font-size: 9px; color: #64748b; text-align: center; margin-top: 4px;">${img.title}</div>` : ""}
            </div>
          `;
        }
      });
    }

    // Manual/preview: simplified layout for static template pages only.
    // Cover, bank, CEO, terms, structure, signoff, and final need Supabase-driven branding/content.
    const needsDynamicQuoteContent =
      pageType === "cover" ||
      pageType === "bank" ||
      pageType === "final" ||
      pageType === "ceo" ||
      pageType === "signoff" ||
      pageType === "terms1" ||
      pageType === "terms2" ||
      pageType === "structure" ||
      pageType.startsWith("structure_") ||
      pageType === "qr";

    if (strictTemplateOnly && pageType !== "boq" && !needsDynamicQuoteContent) {
      if (ext.layoutMode === 'full_page_image' || ext.layoutMode === 'image_only') {
        let imageContent = "";
        if (p.imageUrl) {
          imageContent = `<img src="${p.imageUrl}" style="width: 100%; height: 100%; object-fit: contain; display: block; margin: auto;" alt="Full Page Asset" />`;
        } else if (p.bgImageUrl) {
          imageContent = `<div style="width: 100%; height: 100%; background: url('${p.bgImageUrl}') no-repeat center center / cover;"></div>`;
        } else if (bodyImagesHtml) {
          imageContent = bodyImagesHtml;
        }
        pagesHtml += `
          <div class="page full-page-image-only">
            ${imageContent}
          </div>
        `;
      } else if (ext.layoutMode === "ceo_signature_block" || ext.layoutMode === "signature_block") {
        const signatureHtml = renderEnhancedSignatureBlockHtml(ext.signatureBlock, ceoList);
        pagesHtml += `
          <div class="page authoring-page" style="${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${headerHtml}
              <div style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
                ${p.title ? `<div class="page-title">${p.title}</div>` : ""}
                ${p.bodyText ? rich(p.bodyText) : ""}
                ${bodyImagesHtml}
                <div style="margin-top: auto;">${signatureHtml}</div>
              </div>
            ${pageShellClose}
            ${footerHtml}
          </div>
        `;
      } else {
        const coverLogoHtml = (pageType === 'cover' && p.imageUrl)
          ? `<img src="${p.imageUrl}" style="max-height: 55px; max-width: 150px; object-fit: contain; margin-bottom: 12px;" alt="Logo" />`
          : '';
        pagesHtml += `
          <div class="page${pageType === 'cover' ? ' cover' : ''}" style="${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${headerHtml}
              ${coverLogoHtml}
              ${p.title ? `<div class="page-title">${p.title}</div>` : ''}
              ${p.bodyText ? rich(p.bodyText) : ''}
              ${bodyImagesHtml}
            ${pageShellClose}
            ${footerHtml}
          </div>
        `;
      }
      return;
    }

    // Render full page image only if enabled
    if (ext.layoutMode === 'full_page_image' || ext.layoutMode === 'image_only') {
      let imageContent = "";
      if (p.imageUrl) {
        imageContent = `<img src="${p.imageUrl}" style="width: 100%; height: 100%; object-fit: contain; display: block; margin: auto;" alt="Full Page Asset" />`;
      } else if (p.bgImageUrl) {
        imageContent = `<div style="width: 100%; height: 100%; background: url('${p.bgImageUrl}') no-repeat center center / cover;"></div>`;
      } else if (bodyImagesHtml) {
        imageContent = bodyImagesHtml;
      }
      pagesHtml += `
        <div class="page full-page-image-only">
          ${imageContent}
        </div>
      `;
    } else if (ext.layoutMode === "ceo_signature_block" || ext.layoutMode === "signature_block") {
      const signatureHtml = renderEnhancedSignatureBlockHtml(ext.signatureBlock, ceoList);
      pagesHtml += `
        <div class="page authoring-page" style="${typoStyle}">
          ${watermarkHtml}
          ${absoluteImagesHtml}
          ${pageShellOpen}
            ${headerHtml}
            <div style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
              ${p.title ? `<div class="page-title">${p.title}</div>` : ""}
              ${p.bodyText ? rich(p.bodyText) : ""}
              ${bodyImagesHtml}
              <div style="margin-top: auto;">${signatureHtml}</div>
            </div>
          ${pageShellClose}
          ${footerHtml}
        </div>
      `;
    } else {
      if (pageType === 'cover') {
        const coverClassic = ext.coverLayoutMode !== 'modern';
        const coverLogoCenter = coverClassic
          ? `<div style="text-align: center; margin-bottom: 24px;">
              ${p.imageUrl || settings.logoUrl ? `<img src="${p.imageUrl || settings.logoUrl}" style="max-height: 72px; max-width: 180px; object-fit: contain; margin: 0 auto 12px auto; display: block;" alt="Logo" />` : (useDefaultCompanyContent ? `<div style="background-color: #0f172a; width: 64px; height: 64px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 32px; color: #ffffff; font-weight: bold; margin: 0 auto 12px auto;">☀️</div>` : '')}
              ${useDefaultCompanyContent ? `<div style="font-weight: 850; font-size: 18px; letter-spacing: -0.02em; color: #0f172a;">${settings.companyName.toUpperCase()}</div>
              <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: #d97706; font-weight: bold; margin-top: 4px;">Generational Infrastructure</div>` : ''}
            </div>`
          : '';
        pagesHtml += `
          <div class="page cover${coverClassic ? ' classic-layout' : ''}" style="background: #ffffff; color: #0f172a; ${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${coverClassic ? coverLogoCenter : `
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #f59e0b; padding-bottom: 15px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                ${p.imageUrl || settings.logoUrl ? `
                  <img src="${p.imageUrl || settings.logoUrl}" style="max-height: 55px; max-width: 150px; object-fit: contain;" alt="Logo" />
                ` : (useDefaultCompanyContent ? `
                  <div style="background-color: #0f172a; width: 48px; height: 48px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 24px; color: #ffffff; font-weight: bold;">☀️</div>
                  <div>
                    <div style="font-weight: 850; font-size: 20px; letter-spacing: -0.02em; color: #0f172a;">${settings.companyName.toUpperCase()}</div>
                    <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #d97706; font-weight: bold;">Generational Infrastructure</div>
                  </div>
                ` : '')}
              </div>
            </div>`}

            <div class="cover-main section" style="margin-top: ${coverClassic ? '10px' : '16px'}; position: relative; z-index: 1;">
              <div style="font-size: 32px; font-weight: 850; line-height: 1.2; color: #0f172a; ${coverClassic ? 'text-align: center;' : ''}">
                ${proposal.systemSizekW || quoteObj.systemSizekW || "Not specified"}kW ${proposal.systemType || quoteObj.systemType || 'Hybrid'}<br/>Solar Power Solution
              </div>
              ${p.title ? `
              <div style="font-size: 13px; color: #d97706; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 8px; ${coverClassic ? 'text-align: center;' : ''}">
                ${p.title}
              </div>
              ` : ''}
              ${p.bodyText ? `<div style="margin-top: 10px; ${coverClassic ? 'max-width: 520px; margin-left: auto; margin-right: auto;' : 'max-width: 500px;'}">${rich(p.bodyText)}</div>` : ''}
              
              ${bodyImagesHtml}
              
              <div class="cover-meta-grid section" style="border-top: 1px solid #cbd5e1; padding-top: 16px; margin-top: 20px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 11px;">
                  <div>
                    <div style="color: #64748b; font-weight: 800; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Prepared For</div>
                    <div style="font-weight: 700; color: #0f172a; margin-top: 4px; font-size: 13px;">${proposal.clientName}</div>
                    ${proposal.clientPhone !== "Not specified" ? `<div style="font-size: 10px; color: #475569; margin-top: 2px;">${proposal.clientPhone}</div>` : ""}
                  </div>
                  <div>
                    <div style="color: #64748b; font-weight: 800; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Proposal Validity</div>
                    <div style="font-weight: 700; color: #d97706; margin-top: 4px;">3-Day Validity (Exp: ${expiryDateString})</div>
                  </div>
                  <div>
                    <div style="color: #64748b; font-weight: 800; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Site Location</div>
                    <div style="font-weight: 600; color: #0f172a; margin-top: 4px;">${siteLocationLabel}</div>
                  </div>
                  <div>
                    <div style="color: #64748b; font-weight: 800; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Technical Advisor / BDM</div>
                    <div style="font-weight: 600; color: #0f172a; margin-top: 4px;">${proposal.bdmName}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="cover-footer-block section" style="border-top: 1px solid #cbd5e1; display: flex; justify-content: space-between; align-items: flex-end; font-size: 9px; color: #475569; position: relative; z-index: 1;">
              <div>
                <div style="font-weight: 700; color: #0f172a; margin-bottom: 2px;">${settings.companyName}</div>
                <div>${settings.officeAddress}</div>
                <div style="color: #d97706;">Hotlines: ${settings.phoneNumbers}</div>
                ${settings.websiteUrl ? `<div>${settings.websiteUrl}</div>` : ""}
              </div>
              <div style="text-align: right;">
                <div style="font-weight: 700; color: #0f172a;">Doc ID: SC-${String(leadObj.id || "DRAFT").substring(0, 8).toUpperCase()}-${String(proposal.id || quoteObj.id || 'DRAFT').toUpperCase()}</div>
                <div>Date: ${quoteDateString}</div>
              </div>
            </div>
          </div>
        `;
      }

      else if (pageType === 'profile') {
        pagesHtml += `
          <div class="page" style="position: relative; ${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${headerHtml}
              ${p.title ? `<div class="page-title">${p.title}</div>` : ''}
              
              ${p.bodyText ? rich(p.bodyText) : ''}

              ${bodyImagesHtml}

              ${useDefaultCompanyContent ? `
              <div class="grid-2" style="margin-top: 25px;">
                <div class="card">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 4px; font-size: 12px;">☀️ Sunchaser Energy</div>
                  <div style="font-size: 10.5px; line-height: 1.5; color: #475569;">
                    The core installation and smart grid integration arm. Responsible for site surveys, detailed electrical engineering designs, high-tension terminations, and smart telemetry commissioning.
                  </div>
                </div>
                <div class="card">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 4px; font-size: 12px;">⚡ Helios Solar</div>
                  <div style="font-size: 10.5px; line-height: 1.5; color: #475569;">
                    The design consultancy branch. Creates 3D shadow analysis, panel positioning arrays using dynamic CAD, and utility net metering simulation projections.
                  </div>
                </div>
                <div class="card">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 4px; font-size: 12px;">🏗️ AL ADAM Steel</div>
                  <div style="font-size: 10.5px; line-height: 1.5; color: #475569;">
                    Heavy mechanical fabrication plant. Produces heavy hot-dip galvanized frame mounts, standard structures, elevated configurations, and legendary Mughal Girder designs.
                  </div>
                </div>
                <div class="card">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 4px; font-size: 12px;">🌐 Signals Global</div>
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
              ` : ''}
            ${pageShellClose}
            ${footerHtml}
          </div>
        `;
      }

      else if (pageType === 'qr') {
        pagesHtml += `
          <div class="page" style="position: relative; ${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${headerHtml}
              ${p.title ? `<div class="page-title">${p.title}</div>` : ''}

              ${p.bodyText ? rich(p.bodyText) : ''}

              ${bodyImagesHtml}

              ${useDefaultCompanyContent ? `
              <div class="grid-2" style="row-gap: 15px; margin-top: 20px;">
                <div style="display: flex; gap: 10px; align-items: flex-start;">
                  <span style="font-size: 20px;">🏆</span>
                  <div>
                    <div style="font-weight: 800; font-size: 12px; color: #0f172a; margin-bottom: 2px;">Direct Imported Tier-1 Hardware</div>
                    <div style="font-size: 10px; color: #475569; line-height: 1.45;">Direct Clearance customs certificates for JA Solar, Jinko and Longi modules.</div>
                  </div>
                </div>
                <div style="display: flex; gap: 10px; align-items: flex-start;">
                  <span style="font-size: 20px;">🔩</span>
                  <div>
                    <div style="font-weight: 800; font-size: 12px; color: #0f172a; margin-bottom: 2px;">Galvanized mechanical structure</div>
                    <div style="font-size: 10px; color: #475569; line-height: 1.45;">Heavy hot-dip galvanized and girder frame designs engineered for 130 km/h wind shear.</div>
                  </div>
                </div>
                <div style="display: flex; gap: 10px; align-items: flex-start;">
                  <span style="font-size: 20px;">📑</span>
                  <div>
                    <div style="font-weight: 800; font-size: 12px; color: #0f172a; margin-bottom: 2px;">Complete NEPRA / LESCO Handling</div>
                    <div style="font-size: 10px; color: #475569; line-height: 1.45;">Turnkey green meter licensing coordination directly managed by Sunchaser relations desk.</div>
                  </div>
                </div>
                <div style="display: flex; gap: 10px; align-items: flex-start;">
                  <span style="font-size: 20px;">📲</span>
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
                    <svg width="90" height="90" viewBox="0 0 100 100" style="background: #ffffff; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; display: block; margin: 0 auto;">
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
                    <svg width="90" height="90" viewBox="0 0 100 100" style="background: #ffffff; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; display: block; margin: 0 auto;">
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
              ` : ''}
            ${pageShellClose}
            ${footerHtml}
          </div>
        `;
      }

      else if (pageType === 'ceo') {
        const hasBodyImage = ext.bodyImages && ext.bodyImages.length > 0;
        const cardHeight = hasBodyImage ? "130mm" : "155mm";
        pagesHtml += `
          <div class="page" style="position: relative; ${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${headerHtml}
              ${p.title ? `<div class="page-title">${p.title}</div>` : ''}
              ${p.bodyText ? rich(p.bodyText) : ''}

              ${bodyImagesHtml}

              ${useDefaultCompanyContent ? `
              <div class="grid-2" style="margin-top: 15px;">
                <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; height: ${cardHeight};">
                  <div>
                    <div style="font-size: 22px; margin-bottom: 6px;">🛡️</div>
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
                    <div style="font-size: 22px; margin-bottom: 6px;">⚖️</div>
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
              ` : ''}
            ${pageShellClose}
            ${footerHtml}
          </div>
        `;
      }

      else if (pageType.startsWith('structure_')) {
        pagesHtml += `
          <div class="page" style="position: relative; ${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${headerHtml}
              ${p.title ? `<div class="page-title">${p.title}</div>` : ''}

              ${(p.bodyText || useDefaultCompanyContent) ? `
              <div class="card" style="margin: 15px 0 10px 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <span style="font-weight: 800; font-size: 12px; color: #0f172a;">Selected Structure Frame Type:</span>
                  <span class="badge" style="font-size: 8px; padding: 2.5px 8px;">${structDetails.title}</span>
                </div>
                <div style="font-size: 11px; line-height: 1.5; color: #475569;">
                  <strong>English Specification:</strong><br/>
                  ${p.bodyText ? rich(p.bodyText) : renderRichTextBlock(structDetails.descriptionEn)}
                </div>
              </div>
              ` : ''}

              ${bodyImagesHtml}

              ${useDefaultCompanyContent ? `
              <div class="card" style="margin-bottom: 10px; border-left: 4px solid #f59e0b; padding: 10px 14px;">
                <div style="font-size: 9px; text-transform: uppercase; color: #d97706; font-weight: 800; margin-bottom: 4px; text-align: right;">ساختی تفصیلات (اردو)</div>
                <div class="urdu-text" style="font-size: 11.5px; line-height: 2;">
                  ${structDetails.descriptionUr}
                </div>
              </div>

              <div class="grid-2" style="margin-bottom: 10px;">
                <div class="card" style="font-size: 10.5px; line-height: 1.45;">
                  <strong>Mechanical Design Specs:</strong>
                  <div style="margin-top: 4px; color: #475569;">
                    • Material: ${structDetails.materialType}<br/>
                    • Weight Category: ${structDetails.weight}<br/>
                    • Max Wind Shear: ${structDetails.windRating} wind certified
                  </div>
                </div>
                <div class="card" style="font-size: 10.5px; line-height: 1.45;">
                  <strong>Warranty Guidelines:</strong>
                  <div style="margin-top: 4px; color: #475569;">
                    • Structural Integrity: ${structDetails.warranty}<br/>
                    • Anchoring: Pure Rawl anchors<br/>
                    • Analysis Model: SAP 2000 Wind Load compliant
                  </div>
                </div>
              </div>

              <div class="card" style="padding: 6px; border: 1.5px solid #e2e8f0; background-color: #fafaf9;">
                <div style="font-weight: 800; font-size: 9.5px; color: #0f172a; text-align: center; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 2px;">Engineering Mounting Layout Blueprint</div>
                ${structureSvg}
              </div>
              ` : ''}
            ${pageShellClose}
            ${footerHtml}
          </div>
        `;
      }

      else if (pageType === 'boq') {
        let grossTotal = 0;
        let discountAmount = 0;
        let netTotal = 0;

        const allRows = quoteObj.boqRows || quoteObj.boqItems || [];
        const includeSizerItems = options.includeSizerItems === true;
        
        // Count manual rows and auto sizer rows
        const autoSizerRows = allRows.filter((r: any) => defaultAutoSizerIds.includes(r.id));
        const manualBoqRows = allRows.filter((r: any) => r && r.type === "item" && !defaultAutoSizerIds.includes(r.id));

        const isPackageRow = (r: any) => r.id && (r.id.startsWith("row-heading") || r.id.startsWith("row-item") || r.id.startsWith("row-subtotal"));
        const sourceUsed = manualBoqRows.some(isPackageRow) ? "package_loaded" : includeSizerItems ? "auto_sizer" : "manual_only";
        const rows = filterBoqRowsForPdf(allRows, { includeSizerItems, defaultAutoSizerIds });

        console.log(`[PDF Compilation Debug Log]
          - manualBoqRows count: ${manualBoqRows.length}
          - autoSizerRows count: ${autoSizerRows.length}
          - finalPdfBoqRows count: ${rows.length} (${rows.filter((r) => r.type === "heading").length} headings)
          - source used: ${sourceUsed}`);

        const { html: boqHtml, calculatedGross } = renderBoqTableBodyHtml(rows, formatPKR);

        // Recalculate totals if not including auto sizer items
        if (!includeSizerItems) {
          grossTotal = calculatedGross;
        } else {
          grossTotal = quoteObj.grandTotal || calculatedGross;
        }
        const resolvedDiscount = resolveQuoteDiscountAmount(grossTotal, {
          discountType: quoteObj.discountType,
          discountValue: quoteObj.discountValue,
          discount: quoteObj.discount,
        });
        discountAmount = resolvedDiscount.discountAmount;
        
        const societyCharges = Number(quoteObj.societyCharges) || 0;
        const taxEnabled = !!quoteObj.taxEnabled;
        const taxRate = Number(quoteObj.taxRate) || 0;
        const taxAmount = taxEnabled ? Math.round(grossTotal * (taxRate / 100)) : 0;
        
        netTotal = computeNetProposalValue(grossTotal, discountAmount, { taxAmount, societyCharges });
        const discountLabel = resolvedDiscount.discountLabel;

        pagesHtml += `
          <div class="page boq-page section" style="${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${headerHtml}
              <div class="page-title">${p.title || (mode === 'sizer' ? 'Sizing Specifications Estimate' : 'Technical Bill of Quantities (BOQ)')}</div>
              
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
                  ` : (strictTemplateOnly ? '' : 'Note: Complete hardware clearances are direct clearance imported. Local mounts are AL ADAM galvanized Mughal steel.')}
                </div>
                
                <div style="width: 46%;">
                  <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                    <span style="color: #64748b; font-weight: 500;">Subtotal:</span>
                    <span style="font-weight: 600; color: #0f172a;">${formatPKR(grossTotal)}</span>
                  </div>
                  ${discountAmount > 0 ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">${discountLabel}:</span>
                      <span style="font-weight: 600; color: #dc2626;">-${formatPKR(discountAmount)}</span>
                    </div>
                  ` : ''}
                  ${taxEnabled ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">Sales Tax (${taxRate}%):</span>
                      <span style="font-weight: 600; color: #dc2626;">+${formatPKR(taxAmount)}</span>
                    </div>
                  ` : ''}
                  ${societyCharges > 0 ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">Society Approval / Dues:</span>
                      <span style="font-weight: 600; color: #0f172a;">+${formatPKR(societyCharges)}</span>
                    </div>
                  ` : ''}
                  <div style="display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 850; border-top: 1.5px solid #0f172a; padding-top: 4px; margin-top: 4px;">
                    <span style="color: #0f172a;">Final Price:</span>
                    <span style="color: #d97706; font-size: 13.5px;">${formatPKR(netTotal)}</span>
                  </div>
                  <div style="font-size: 8px; color: #94a3b8; text-align: right; margin-top: 4px; font-weight: bold;">
                    * Direct imports clearance trace.
                  </div>
                </div>
              </div>
            ${pageShellClose}
            ${footerHtml}
          </div>
        `;
      }

      else if (pageType === 'terms1') {
        pagesHtml += `
          <div class="page" style="position: relative; ${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${headerHtml}
              <div class="page-title">${p.title}</div>
              
              ${p.bodyText ? rich(p.bodyText) : `<div style="font-size: 11.5px; line-height: 1.5; color: #475569; margin: 15px 0;">
                All engineering activities, supply dispatch, and LESCO utility agreements are governed strictly by the Sunchaser covenants below:
              </div>`}

              ${bodyImagesHtml}

              <div style="margin-top: 10px;">
                ${tcPage1Html}
              </div>
            ${pageShellClose}
            ${footerHtml}
          </div>
        `;
      }

      else if (pageType === 'terms2') {
        pagesHtml += `
          <div class="page" style="position: relative; ${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${headerHtml}
              <div class="page-title">${p.title}</div>
              
              ${p.bodyText ? rich(p.bodyText) : `<div style="font-size: 11.5px; line-height: 1.5; color: #475569; margin: 15px 0;">
                Consortium hardware replacement and force majeure exclusions continue below:
              </div>`}

              ${bodyImagesHtml}

              <div style="margin-top: 10px;">
                ${tcPage2Html}
              </div>
            ${pageShellClose}
            ${footerHtml}
          </div>
        `;
      }

      else if (pageType === 'signoff') {
        pagesHtml += `
          <div class="page" style="position: relative; ${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${headerHtml}
              <div class="page-title">${p.title}</div>

              ${bodyImagesHtml}

              <div class="card" style="margin: 15px 0 10px 0;">
                <div style="font-weight: 800; color: #0f172a; font-size: 11.5px; margin-bottom: 8px; text-transform: uppercase; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 2px;">
                  1. Customer Billing Profile
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: #475569;">
                  <div><strong>Client Title:</strong> <span style="color: #0f172a; font-weight: 600;">${proposal.clientName}</span></div>
                  <div><strong>CNIC Passport:</strong> <span style="color: #0f172a; font-weight: 600;">${quoteObj.cnic || 'Not specified'}</span></div>
                  <div><strong>Active Line:</strong> <span style="color: #0f172a;">${proposal.clientPhone}</span></div>
                  <div><strong>Email Inbox:</strong> <span style="color: #0f172a;">${proposal.clientEmail}</span></div>
                  <div style="grid-column: span 2;"><strong>Installation Address:</strong> <span style="color: #0f172a;">${siteLocationLabel}</span></div>
                </div>
              </div>

              <div class="card" style="margin-bottom: 15px; border-left: 4px solid #0284c7;">
                <div style="font-weight: 800; color: #0f172a; font-size: 11.5px; margin-bottom: 8px; text-transform: uppercase; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 2px;">
                  2. Utility Interconnect (LESCO Metering)
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: #475569;">
                  <div><strong>LESCO Meter ID:</strong> <span style="color: #0f172a; font-weight: 600; font-family: monospace;">${lescoObj.meterNo || 'Not Scanned'}</span></div>
                  <div><strong>Consumer A/C Number:</strong> <span style="color: #0f172a; font-weight: 600; font-family: monospace;">${lescoObj.consumerNo || 'Not Scanned'}</span></div>
                  <div><strong>Sanctioned Grid Load:</strong> <span style="color: #0f172a; font-weight: 600;">${lescoObj.sanctionedLoad ? lescoObj.sanctionedLoad + ' kW' : 'Not Scanned'}</span></div>
                  <div><strong>Terminations Phase:</strong> <span style="color: #0f172a;">${lescoObj.phaseType || 'Three Phase'}</span></div>
                  <div style="grid-column: span 2;"><strong>Turnkey Net Metering Licensing:</strong> <span style="color: #0284c7; font-weight: 700;">${netMeteringText === 'Yes' ? 'REQUIRED &amp; SOW INCLUDED' : 'NOT REQUIRED'}</span></div>
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
            ${pageShellClose}
            ${footerHtml}
          </div>
        `;
      }

      else if (pageType === 'bank') {
        pagesHtml += `
          <div class="page" style="position: relative; ${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${headerHtml}
              <div class="page-title">${p.title}</div>

              ${p.bodyText ? rich(p.bodyText) : ""}

              <div class="card" style="background-color: #fffbeb; border-color: #fde68a; margin-top: 15px; display: flex; gap: 10px; align-items: center; padding: 8px 12px;">
                <span style="font-size: 18px;">⚠️</span>
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
            ${pageShellClose}
            ${footerHtml}
          </div>
        `;
      }

      else if (pageType === 'final') {
        pagesHtml += `
          <div class="page" style="justify-content: center; text-align: center; padding: 30mm 20mm; position: relative; ${typoStyle}">
            ${watermarkHtml}
            ${absoluteImagesHtml}
            ${pageShellOpen}
              ${useDefaultCompanyContent ? `
              ${settings.logoUrl ? `<img src="${settings.logoUrl}" style="max-height: 72px; max-width: 180px; object-fit: contain; margin: 0 auto 20px auto; display: block;" alt="Logo" />` : `<div style="background-color: #0f172a; width: 64px; height: 64px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 32px; color: #ffffff; font-weight: bold; margin: 0 auto 20px auto; box-shadow: 0 4px 10px rgba(15,23,42,0.25);">☀️</div>`}
              <h2 style="font-size: 24px; font-weight: 850; letter-spacing: -0.02em; color: #0f172a; margin-bottom: 2px;">${settings.companyName.toUpperCase()}</h2>
              <div style="font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.15em; color: #d97706; font-weight: 700; margin-bottom: 25px;">Generational Infrastructure</div>
              ` : ''}
              
              ${p.bodyText ? `<div style="max-width: 440px; margin: 0 auto 40px auto;">${rich(p.bodyText)}</div>` : ''}

              ${bodyImagesHtml}

              ${useDefaultCompanyContent ? `
              <div style="border-top: 1.5px solid #cbd5e1; padding-top: 25px; font-size: 10.5px; color: #475569; max-width: 360px; margin: 0 auto; line-height: 1.5;">
                <strong style="color: #0f172a; font-size: 11px;">${settings.companyName}</strong><br/>
                ${settings.officeAddress}<br/>
                Hotlines: ${settings.phoneNumbers}<br/>
                Email: ${settings.billingEmail} | Web: ${settings.websiteUrl}
              </div>
              ` : ''}
            ${pageShellClose}
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
        ${quotePdfShellCss()}
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
          color: #d97706;
          border-left: 4px solid #f59e0b;
          padding-left: 8px;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }
        ${quotePdfPrintCss()}
        ${quoteAuthoringPrintCss(pdfQuality)}
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
        ${boqPdfSectionCss()}
        ${quotePdfDeckActionBarCss()}
        @media print {
          body {
            background-color: #ffffff !important;
          }
          .action-bar {
            display: none !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="action-bar">
        <div><strong>Sunchaser Proposal Deck</strong> - Client: ${quoteObj.clientName || leadObj.name}</div>
        <div class="action-bar-actions">
          <button type="button" class="btn-print" onclick="sunchaserPrintDeck()">Print</button>
          <button type="button" class="btn-download" onclick="sunchaserDownloadPdf()">Download PDF</button>
        </div>
      </div>

      <div class="pages-container">
        ${pagesHtml}
      </div>
      ${quotePdfDeckPreviewScripts()}
    </body>
    </html>
  `;
}


// 18. PDF Export Endpoints
app.get("/api/export/pdf/auto-sizer/:leadId", async (req, res) => {
  try {
    if (!REQUIRE_EXPLICIT_QUOTE_SAVE) {
      return res.status(403).send("Auto Sizer PDF export is temporarily disabled. Use Manual BOQ PDF with quoteId.");
    }
    loadDb();
    let activeState: Database = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }
    
    const lead = activeState.leads.find((l: any) => l.id === req.params.leadId);
    if (!lead) {
      return res.status(404).send("Lead not found.");
    }
    
    const quoteId = req.query.quoteId ? String(req.query.quoteId) : "";
    let quote = null;
    if (quoteId) {
      quote = lead.quotes?.find((q: any) => q.id === quoteId && q.quote_type === "auto_sizer");
    } else {
      quote = getLatestSavedQuote(lead, "auto_sizer");
    }
    if (!quote) {
      return res.status(404).send("Save a quote first.");
    }

    const defaultAutoSizerIds = [
      'h-1', 'panel_row', 'inverter_row', 'battery_row', 's-1',
      'h-2', 'dc_cable_row', 'ac_cable_row', 'earth_wire_row', 's-2',
      'h-3', 'db_box_row', 's-3',
      'h-4', 'supplies_row', 's-4',
      'h-5', 'earthing_bore_row', 's-5',
      'h-6', 'structure_row', 'civil_work_row', 'install_service_row', 's-6',
      'h-7', 'freight_row', 'net_metering_row', 'survey_design_row', 's-7'
    ];
    console.log(`[PDF BACKEND LOG] GET /api/export/pdf/auto-sizer/:leadId
      - quoteId: ${quote.id}
      - quote_type: ${quote.quote_type || "auto_sizer"}
      - includeSizerItems: true
      - manual rows count: 0
      - auto rows count: ${defaultAutoSizerIds.length}
      - final rows count: ${defaultAutoSizerIds.length}
    `);

    const pdfHtml = compileSunchaserPDFHtml('sizer', quote, lead, activeState);
    res.send(pdfHtml);
  } catch (err: any) {
    res.status(500).send("Error compiling PDF structure: " + err.message);
  }
});

app.post("/api/export/pdf/manual-quote", async (req, res) => {
  try {
    loadDb();
    let activeState: Database = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }

    let payload = req.body;
    if (payload && typeof payload.payload === 'string') {
      try {
        payload = JSON.parse(payload.payload);
      } catch (e) {
        // ignore
      }
    }
    
    // Create a lead object or find one if leadId is provided
    let lead = null;
    if (payload.leadId) {
      lead = activeState.leads.find((l: any) => l.id === payload.leadId);
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
        createdAt: new Date().toISOString(),
        notes: ""
      };
    }

    if (lead && payload.quoteId) {
      const exactManualQuote = lead.quotes?.find((q: any) => q.id === payload.quoteId && q.quote_type === "manual_boq");
      if (!exactManualQuote) {
        return res.status(404).send("Manual BOQ quote not found for this lead.");
      }
      payload = exactManualQuote;
    }

    const options = {
      includedPages: payload.includedPages || ['cover', 'profile', 'qr', 'ceo', 'structure', 'boq', 'terms1', 'terms2', 'signoff', 'bank', 'final'],
      templateId: payload.templateId || "tmpl-1",
      includeSizerItems: payload.includeSizerItems === true
    };

    const defaultAutoSizerIds = [
      'h-1', 'panel_row', 'inverter_row', 'battery_row', 's-1',
      'h-2', 'dc_cable_row', 'ac_cable_row', 'earth_wire_row', 's-2',
      'h-3', 'db_box_row', 's-3',
      'h-4', 'supplies_row', 's-4',
      'h-5', 'earthing_bore_row', 's-5',
      'h-6', 'structure_row', 'civil_work_row', 'install_service_row', 's-6',
      'h-7', 'freight_row', 'net_metering_row', 'survey_design_row', 's-7'
    ];
    const allRows = payload.boqRows || payload.boqItems || [];
    const autoSizerCount = allRows.filter((r: any) => defaultAutoSizerIds.includes(r.id)).length;
    const manualBoqCount = allRows.filter((r: any) => r && r.type === "item" && !defaultAutoSizerIds.includes(r.id)).length;
    const finalCount = options.includeSizerItems ? allRows.length : manualBoqCount;
    console.log(`[PDF BACKEND LOG] POST /api/export/pdf/manual-quote
      - quoteId: ${payload.id || 'N/A'}
      - quote_type: ${payload.quote_type || 'manual_boq'}
      - includeSizerItems: ${options.includeSizerItems}
      - manual rows count: ${manualBoqCount}
      - auto rows count: ${autoSizerCount}
      - final rows count: ${finalCount}
    `);

    const hasCompiledQuote = lead && lead.quotes && lead.quotes.some((q: any) => q.quote_type === 'manual_boq');

    if (manualBoqCount === 0 || !hasCompiledQuote) {
      res.send(`
        <div style="padding: 40px; color: #d97706; font-family: system-ui, -apple-system, sans-serif; text-align: center; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; max-width: 500px; margin: 50px auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <h2 style="margin-top: 0; color: #92400e; font-size: 20px; font-weight: 700;">No BOQ items added yet.</h2>
          <p style="color: #b45309; font-size: 14px; font-weight: 500; line-height: 1.5; margin-bottom: 0;">Please add BOQ rows and compile quote first.</p>
        </div>
      `);
      return;
    }

    const pdfHtml = compileSunchaserPDFHtml('manual', payload, lead, activeState, options);
    res.send(pdfHtml);
  } catch (err: any) {
    res.status(500).send("Error compiling Manual PDF structure: " + err.message);
  }
});

app.get("/api/export/pdf/template-preview/:templateId", async (req, res) => {
  try {
    loadDb();
    let activeState: Database = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }

    const templateId = req.params.templateId;
    
    // Create mock objects for previewing
    const mockLead = {
      id: "lead-preview",
      name: "Muhammad Allauddin (Preview)",
      email: "allai1432009@gmail.com",
      phone: "0309-0236666",
      address: "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore",
      location: "Lahore",
      monthlyBill: 120000,
      roofSpace: 1200,
      shading: "None",
      rating: 5,
      assignedSalesperson: "Technical Advisor (Preview)",
      createdAt: new Date().toISOString(),
      notes: "Preview of corporate proposal styling."
    };

    const mockQuote = {
      systemSizekW: 15,
      panelCount: 24,
      panelType: "JA Solar 550W Mono-PERC Panels",
      inverterType: "Growatt 15kW Hybrid Inverter",
      batteryCapacity: "10.24kWh Lithium Pack",
      totalCost: 1850000,
      structureType: "Elevated",
      accessories: "Standard accessories bundle",
      installationCharges: 80000,
      netMeteringCharges: 90000,
      paymentTerms: "50% Advance, 40% Delivery, 10% Commissioning",
      warrantyTerms: "Standard warranties apply",
      termsAndConditions: "Standard terms and conditions apply.",
      clientName: "Muhammad Allauddin",
      clientPhone: "0309-0236666",
      clientEmail: "allai1432009@gmail.com",
      clientAddress: "DHA Phase 6, Lahore",
      cityArea: "Lahore",
      systemType: "Hybrid",
      bdmName: "Technical Advisor (Preview)"
    };

    const includedFromTemplate = buildIncludedPagesFromTemplate(activeState, templateId);
    const options = {
      templateId,
      includedPages: includedFromTemplate
    };

    const pdfHtml = compileSunchaserPDFHtml('preview', { ...mockQuote, boqRows: [], boqItems: [] }, mockLead, activeState, options);
    res.send(pdfHtml);
  } catch (err: any) {
    res.status(500).send("Error compiling PDF preview: " + err.message);
  }
});

app.get("/api/export/pdf/manual-quote/:leadId/download", async (req, res) => {
  try {
    loadDb();
    let activeState: Database = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }

    const lead = activeState.leads.find((l: any) => l.id === req.params.leadId);
    if (!lead) {
      return res.status(404).send("Lead not found.");
    }
    const quoteId = req.query.quoteId ? String(req.query.quoteId) : "";
    let quote = null;
    if (quoteId) {
      quote = lead.quotes?.find((q: any) => q.id === quoteId && q.quote_type === "manual_boq");
    } else {
      quote = getLatestSavedQuote(lead, "manual_boq");
    }

    if (!quote) {
      return res.status(404).send("Save a quote first.");
    }

    const options = {
      includedPages: quote.includedPages || ['cover', 'profile', 'qr', 'ceo', 'structure', 'boq', 'terms1', 'terms2', 'signoff', 'bank', 'final'],
      templateId: quote.templateId || "tmpl-1",
      includeSizerItems: quote.includeSizerItems === true
    };

    const defaultAutoSizerIds = [
      'h-1', 'panel_row', 'inverter_row', 'battery_row', 's-1',
      'h-2', 'dc_cable_row', 'ac_cable_row', 'earth_wire_row', 's-2',
      'h-3', 'db_box_row', 's-3',
      'h-4', 'supplies_row', 's-4',
      'h-5', 'earthing_bore_row', 's-5',
      'h-6', 'structure_row', 'civil_work_row', 'install_service_row', 's-6',
      'h-7', 'freight_row', 'net_metering_row', 'survey_design_row', 's-7'
    ];
    const allRows = quote.boqRows || quote.boqItems || [];
    const manualBoqCount = allRows.filter((r: any) => r && r.type === "item" && !defaultAutoSizerIds.includes(r.id)).length;

    if (manualBoqCount === 0) {
      return res.status(400).send("No BOQ items added yet. Please add BOQ rows and compile quote first.");
    }

    const pdfHtml = compileSunchaserPDFHtml('manual', quote, lead, activeState, options);
    const pdfBuffer = await renderQuotationHtmlToPdf(pdfHtml);
    const filename = buildQuotationPdfFilename(lead, quote);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error("[PDF DOWNLOAD]", err);
    res.status(500).send("Error generating quotation PDF: " + err.message);
  }
});

app.get("/api/export/pdf/manual-quote/:leadId", async (req, res) => {
  try {
    loadDb();
    let activeState: Database = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }

    const lead = activeState.leads.find((l: any) => l.id === req.params.leadId);
    if (!lead) {
      return res.status(404).send("Lead not found.");
    }
    const quoteId = req.query.quoteId ? String(req.query.quoteId) : "";
    let quote = null;
    if (quoteId) {
      quote = lead.quotes?.find((q: any) => q.id === quoteId && q.quote_type === "manual_boq");
    } else {
      // ORDER BY updated_at DESC LIMIT 1 — most recent explicitly saved manual quote
      quote = getLatestSavedQuote(lead, "manual_boq");
    }

    if (!quote) {
      return res.status(404).send("Save a quote first.");
    }

    const options = {
      includedPages: quote.includedPages || ['cover', 'profile', 'qr', 'ceo', 'structure', 'boq', 'terms1', 'terms2', 'signoff', 'bank', 'final'],
      templateId: quote.templateId || "tmpl-1",
      includeSizerItems: quote.includeSizerItems === true
    };

    const defaultAutoSizerIds = [
      'h-1', 'panel_row', 'inverter_row', 'battery_row', 's-1',
      'h-2', 'dc_cable_row', 'ac_cable_row', 'earth_wire_row', 's-2',
      'h-3', 'db_box_row', 's-3',
      'h-4', 'supplies_row', 's-4',
      'h-5', 'earthing_bore_row', 's-5',
      'h-6', 'structure_row', 'civil_work_row', 'install_service_row', 's-6',
      'h-7', 'freight_row', 'net_metering_row', 'survey_design_row', 's-7'
    ];
    const allRows = quote.boqRows || quote.boqItems || [];
    const autoSizerCount = allRows.filter((r: any) => defaultAutoSizerIds.includes(r.id)).length;
    const manualBoqCount = allRows.filter((r: any) => r && r.type === "item" && !defaultAutoSizerIds.includes(r.id)).length;
    const finalCount = options.includeSizerItems ? allRows.length : manualBoqCount;
    console.log(`[PDF BACKEND LOG] GET /api/export/pdf/manual-quote/:leadId
      - quoteId: ${quote.id}
      - quote_type: ${quote.quote_type || 'manual_boq'}
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

    const pdfHtml = compileSunchaserPDFHtml('manual', quote, lead, activeState, options);
    await syncQuotationVaultForLead(
      lead,
      req.params.leadId,
      quote.id,
      lead.customerId || lead.customer_id || null,
      db
    );
    res.send(pdfHtml);
  } catch (err: any) {
    res.status(500).send("Error compiling manual quotation PDF: " + err.message);
  }
});

app.get("/api/export/pdf/:leadId", async (req, res) => {
  try {
    loadDb();
    let activeState: Database = db;
    if (isSupabaseActive()) {
      activeState = await fetchAppStateFromSupabase();
    }

    const lead = activeState.leads.find((l: any) => l.id === req.params.leadId);
    if (!lead) {
      return res.status(404).send("Lead not found.");
    }

    const quoteId = req.query.quoteId;
    if (!quoteId) {
      return res.status(400).send("quoteId is required.");
    }
    const quote = lead.quotes && lead.quotes.find((q: any) => q.id === quoteId);
    if (!quote) {
      return res.status(404).send("Quote not found for this lead.");
    }

    if (quote.quote_type === "auto_sizer" && REQUIRE_EXPLICIT_QUOTE_SAVE) {
      res.redirect(`/api/export/pdf/auto-sizer/${req.params.leadId}?quoteId=${quoteId}`);
    } else {
      res.redirect(`/api/export/pdf/manual-quote/${req.params.leadId}?quoteId=${quoteId}`);
    }
  } catch (err: any) {
    res.status(500).send("Error compiling Legacy PDF wrapper: " + err.message);
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

  const prompt = `Draft a formalized, highly elegant, professional Sunchaser Energy Systems Proposal contract blueprint for Client: **${customerName}** located at **${address || "Location not specified"}**.
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
**PREPARED FOR**: ${customerName} | **ADDRESS**: ${address || "Location not specified"}

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
  res.json({ status: "ok", service: "sunchaser-crm" });
});

/* --- VITE / PRODUCTION SPA --- */
function shouldServeBuiltFrontend() {
  if (process.env.NODE_ENV === "production") return true;
  const indexPath = path.join(process.cwd(), "dist", "index.html");
  return fs.existsSync(indexPath);
}

function resolveServerBuildMeta() {
  const bundlePath = path.relative(process.cwd(), __filename) || __filename;
  let commitHash =
    process.env.RENDER_GIT_COMMIT?.slice(0, 7) ||
    process.env.SERVER_BUILD_COMMIT ||
    "unknown";
  if (commitHash === "unknown") {
    try {
      const { execSync } = require("child_process") as typeof import("child_process");
      commitHash = execSync("git rev-parse --short HEAD", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
    } catch {
      // Render/production may not have .git at runtime
    }
  }
  let version = process.env.SERVER_BUILD_VERSION || process.env.npm_package_version || "0.0.0";
  if (version === "0.0.0") {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
      );
      version = pkg.version || version;
    } catch {
      // ignore
    }
  }
  return { bundlePath, commitHash, version };
}

function logServerBuildIdentity() {
  const { bundlePath, commitHash, version } = resolveServerBuildMeta();
  console.log(`[SERVER_BUILD_VERSION] ${version}`);
  console.log(`[COMMIT_HASH] ${commitHash}`);
  console.log(`[SERVER_BUNDLE_PATH] ${bundlePath}`);
  console.log(`Running bundle:\n${bundlePath}\n\nCommit:\n${commitHash}`);
}

async function startServer() {
  logServerBuildIdentity();

  if (!shouldServeBuiltFrontend()) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("[Sunchaser] Vite dev middleware — SPA at /");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const indexPath = path.join(distPath, "index.html");
    if (!fs.existsSync(indexPath)) {
      console.error("[Sunchaser] dist/index.html missing — run npm run build");
    }
    app.use(
      express.static(distPath, {
        index: "index.html",
        setHeaders(res, filePath) {
          if (filePath.endsWith("server.cjs") || filePath.endsWith(".map")) {
            res.setHeader("Cache-Control", "no-store");
          }
        },
      })
    );
    app.get("*", (req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (
        req.path.startsWith("/api") ||
        req.path === "/health" ||
        req.path.startsWith("/uploads")
      ) {
        return next();
      }
      res.sendFile(indexPath, (err) => (err ? next(err) : undefined));
    });
    console.log("[Sunchaser] Serving React SPA from dist/ at /");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Sunchaser Energy ERP] listening on port ${PORT}`);
  });
}

startServer();
