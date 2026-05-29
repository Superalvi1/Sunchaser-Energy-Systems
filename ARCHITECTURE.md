# SUNCHASER ENTERPRISE ERP SYSTEM ARCHITECTURE
This document serves as the official enterprise system architecture blueprint for the upgraded **Sunchaser** Multi-Business mobile application and manual Admin administration ERP portal.

---

## 1. Database Entity Relationship Diagram (ERD) & Schema
Sunchaser's persistent layer uses a robust, scalable structure compatible with local file-backed structures (`database.json`) as well as production cloud architectures (Supabase PostgreSQL, Firestore). 

```
                                  [ Users ]
                                      | (1)
                                      |
                                      | (N)
                                  [ Leads/Customers ] (Profile Records)
                                      |
         +----------------------------+----------------------------+
         | (1)                        | (1)                        | (1)
         |                            |                            |
         | (N)                        | (N)                        | (N)
    [ Quotations ]               [ Orders ]                   [ Support Tickets ]
    - Equipment configuration    - Multi-category checkout    - Field complaints
    - Prices & gross margins     - Delivery/Status tracking   - Technician diagnostic notes
    - Tax incentives             - Milestone payment plans    - File/Image proof attachments
         |                            |                            |
         | (N)                        | (N)                        | (N)
         +----------------------------+----------------------------+
                                      |
                                      | (Matching SKUs)
                                  [ Catalog hardware/Stock ]
                                  - Categories list
                                  - Low-stock alerts
                                  - Wholesale costs & profit metrics
```

---

## 2. Structured Data Definitions & Relationships
Sunchaser represents transaction objects through strict TypeScript interfaces. Relationships are linked via deterministic parent-child IDs:

### A. Customers & Leads (`Leads` collection)
Holds customer identity, address, utility metrics, and assigned advisor.
*   **Fields**: `id` (PK), `name`, `email`, `phone`, `address`, `status`, `roofSpace`, `shading`, `assignedSalesperson`, `createdAt`, `notes`.
*   **Relationships**: Primary profile identifier linked into `orders`, `tickets`, and `quotations` via `leadId` or direct email.

### B. Catalog Products (`Products` collection)
A multi-category inventory item table supporting solar hardware as well as other diverse appliances.
*   **Fields**: `id` (PK), `name`, `category` (Panels/Inverters/Batteries/EV Chargers/Appliances), `brand`, `model`, `sku`, `price`, `discount`, `stock`, `images`, `warrantyPeriod`, `specifications`.
*   **Relationships**: Linked to order line items and quotations.

### C. Solar Packages (`SolarPackages` collection)
Manages pre-integrated equipment configurations.
*   **Fields**: `id` (PK), `name`, `panelBrand`, `inverterBrand`, `batteryOption`, `price`, `structureType`, `profitMargin`, `enabled`.

### D. Quotations (`Quotations` collection)
Pre-sales sizing estimates dynamically calculated for solar and equipment setups.
*   **Fields**: `id` (PK), `customer` (Lead), `lines` (Sub-Items list), `discount`, `totalCost`, `federalTaxCredit`, `netCost`, `paybackPeriodYears`, `status`.

### E. Orders & Shipments (`Orders` collection)
Direct multi-category checkouts mapping deliverables, status trackers, and milestones.
*   **Fields**: `id` (PK), `customerName`, `email`, `phone`, `address`, `status` (Pending/Processing/Dispatched/Delivered/Installed), `items` (Product SKUs list), `totalCost`.

### F. Maintenance Diagnostic Tickets (`Tickets` collection)
Supports photo/video upload, field technician allocation, and internal notes.
*   **Fields**: `id` (PK), `customerName`, `email`, `subject`, `description`, `status` (Open/In Progress/Closed), `priority`, `assignedTechnician`, `internalNotes`, `messages`.

---

## 3. User Roles, Access & Permissions Matrix
Sunchaser implements Role-Based Access Control (RBAC) across 11 specific user roles to guarantee data compliance and operational partitioning:

| Role | Operational Scope | Authorized Actions |
| :--- | :--- | :--- |
| **Super Admin** | Unlimited global configuration | Manage products, staff permissions, download CSV files, alter pricing models, override system variables. |
| **Sales Advisor**| Client engagement tracking | Access Leads tab, design bespoke quotations, trigger WhatsApp proposals, log engagement scores. |
| **Inventory Head**| Hardware procurement operations| Authorize stock purchase orders, configure wholesale costs, track supplier catalogs, audit low-stock warnings. |
| **Technician** | Field installation & diagnostic | Access technician case notes, upload proof images of finished diagnostic repairs, update diagnostic ticket statuses. |
| **Customer** | Mobile portal experience | View live shipping timelines, upload electric utility Bills, track active warranties coverage, submit support issues. |

---

## 4. Mobile App Screens & Flows (Customer Portal)
1.  **Sizing Wizard tab**: 
    -   *Input screen*: Enter roof space and current monthly electricity bills.
    -   *Bill AI OCR loader*: Drag-and-drop or select PDF bill files; triggers standard simulated parsing.
    -   *Equations Engine screen*: Staggers immediate calculations for upfront initial investments, federal savings ratios, and investment payback schedules.
2.  **Product Store tab**:
    -   *Home catalog grid*: Modular card items filterable by category (Panels, Inverters, EV Chargers, Appliances, Electronics).
    -   *Hardware specification screen*: Displays model details, warranty spans, price overrides, and "Process order" buttons.
3.  **Active project track screen**:
    -   *Milestone tracking meter*: Continuous progress visual bar covering site stages: "Proposed", "Surveyed", "Contracted", "Installed".
4.  **Complaints submit screen**:
    -   *Diagnostic submission form*: Input description, title, select priority level. Includes upload inputs for diagnostic photos/videos.
    -   *Dynamic chat panel*: Real-time conversation thread with designated tech support agents.

---

## 5. Manual Admin Control Panel Screens (Admin ERP)
Direct database modification screen including 11 distinct management interfaces:
1.  **Catalog Products Manager**: Real-time CRUD form to update, add, or prune hardware entries.
2.  **Solar Packages Configurator**: Alter panel/inverter details, modify standard gross margins, or toggle packages.
3.  **Manual Quotation Panel**: Input client profiles, build multi-line equipment bundles with live cost calculations, configure localized terms, download quotes, or dispatch WhatsApp notices.
4.  **Customer Base Directory**: List leads. Focus on user history timeline covering past invoices, service warranties, and milestone logs.
5.  **Manual Order Pipeline**: Input manual client checkouts, delegate shipping status tiers, or modify products.
6.  **Complaints Center**: Oversee active claims, schedule technician visits, and save technical case logs.
7.  **Stocks & Inventory**: Track gross value statistics, trigger restock purchase triggers, and manage margins.
8.  **CMS Content Manager**: Edit landing promotion labels, banner slideshow items, and FAQs.
9.  **Credentials & Roles**: Audit team users login properties and assign access credentials.
10. **Global Settings**: Configure banking specifications, terms and conditions clauses, taxes, and phone contacts.
11. **CSV Spreadsheet Utility**: Single-click bulk spreadsheet loaders and CSV template exports.

---

## 6. API Architecture & Routing
Sunchaser uses a high-performance, stateless RESTful API powered by Express. Built with defensive middleware and clean endpoints mapping:

### A. Core State API
*   `GET /api/state`
    *   *Payload*: Dynamic assembly of leads, tickets, products, orders, categories, settings, content, and quotations. Handles fallback synchronization with Supabase.

### B. Manual ERP CRUD Engine
*   `POST /api/db/update`
    *   *Parameters*: `{ action, table, data, id }`
    *   *Behavior*: Performs localized CRUD operations on target database collections using memory locks and commits updates synchronously into `database.json`.

### C. Operation Handlers
*   `POST /api/leads` (Creates pre-sale advisor profile)
*   `POST /api/procure` (Initiates supplier stock increments)
*   `POST /api/tickets/advanced` (Dispatches site complaint cases)
*   `GET /api/export/leads` (Gathers customer sheets CSV)
*   `GET /api/export/tickets` (Gathers maintenance CSV)

---

## 7. Future Multi-Expansion Roadmap
Sunchaser's modular, decoupled system design is primed for immediate multi-business expansion:
1.  **Category Insertion**: Inject new categories like "Electric Vehicles" or "Smart Home Electronics" directly into `categories` array. No code edits required; the UI dynamically adapts and renders categories.
2.  **IoT Grid Telemetry**: Register physical smart energy variables directly using serial numbers tracked in the Customer Portal.
3.  **Localized Tax Matrices**: Extend global settings to define zip-code level tax and rebate structures.
