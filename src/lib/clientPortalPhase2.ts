export const DOCUMENT_WALLET_TYPES = [
  { type: "quotation_pdf", label: "Quotation PDF" },
  { type: "agreement", label: "Agreement" },
  { type: "agreement_word", label: "Agreement (Word)" },
  { type: "agreement_excel", label: "Agreement / BOQ (Excel)" },
  { type: "boq_excel", label: "BOQ (Excel)" },
  { type: "invoice", label: "Invoice" },
  { type: "warranty_certificate", label: "Warranty Card" },
  { type: "net_metering_documents", label: "Net Metering" },
  { type: "completion_certificate", label: "Completion Report" },
  { type: "site_survey_report", label: "Site Survey Report" },
  { type: "cnic_copy", label: "CNIC Copy" },
  { type: "electricity_bill", label: "Electricity Bill" },
  { type: "product_datasheet", label: "Product Datasheet" },
  { type: "other", label: "Other" },
] as const;

export type DocumentWalletType = (typeof DOCUMENT_WALLET_TYPES)[number]["type"];

export const WARRANTY_COMPONENT_TYPES = [
  { type: "solar_panels", label: "Solar Panels" },
  { type: "inverter", label: "Inverter" },
  { type: "battery", label: "Battery" },
  { type: "installation_workmanship", label: "Installation Workmanship" },
] as const;

export type WarrantyComponentType = (typeof WARRANTY_COMPONENT_TYPES)[number]["type"];

export type WarrantyLifecycleStatus = "Active" | "Expiring Soon" | "Expired" | "No data available";

export interface CustomerDocumentRecord {
  id: string;
  customerId: string;
  projectId?: string | null;
  documentType: DocumentWalletType | string;
  title: string;
  fileUrl: string;
  fileName?: string | null;
  uploadedBy: string;
  uploadedAt: string;
  visibleToCustomer: boolean;
  internalOnly: boolean;
  notes?: string | null;
  mimeType?: string | null;
}

export interface CustomerSystemProfile {
  customerId: string;
  systemSizeKw?: number | null;
  systemType?: "On-grid" | "Hybrid" | "Off-grid" | null;
  panelBrand?: string | null;
  panelWattage?: number | null;
  panelQuantity?: number | null;
  inverterBrand?: string | null;
  inverterSizeKw?: number | null;
  batteryBrand?: string | null;
  batteryCapacityKwh?: number | null;
  structureType?: string | null;
  installationDate?: string | null;
  warrantyStart?: string | null;
  warrantyEnd?: string | null;
  netMeteringStatus?: string | null;
  meterNumber?: string | null;
  consumerNumber?: string | null;
  sanctionedLoadKw?: number | null;
  siteAddress?: string | null;
  notes?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export interface CustomerWarrantyRecord {
  id: string;
  customerId: string;
  projectId?: string | null;
  componentType: WarrantyComponentType;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status: WarrantyLifecycleStatus;
  remainingLabel: string;
}

export interface WarrantyClaimRecord {
  id: string;
  customerId: string;
  ticketId?: string | null;
  component: string;
  issueDescription: string;
  photoUrl?: string | null;
  status: "New" | "In Review" | "Technician Assigned" | "Resolved" | "Rejected";
  createdAt: string;
  updatedAt: string;
}

export function computeWarrantyLifecycle(endDate?: string | null): {
  status: WarrantyLifecycleStatus;
  remainingLabel: string;
} {
  if (!endDate) {
    return { status: "No data available" as WarrantyLifecycleStatus, remainingLabel: "—" };
  }
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) {
    return { status: "No data available" as WarrantyLifecycleStatus, remainingLabel: "—" };
  }
  const now = new Date();
  const ms = end.getTime() - now.getTime();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) {
    return { status: "Expired", remainingLabel: "Expired" };
  }
  if (days <= 90) {
    return { status: "Expiring Soon", remainingLabel: `${days} day${days === 1 ? "" : "s"} left` };
  }
  return { status: "Active", remainingLabel: `${days} day${days === 1 ? "" : "s"} left` };
}

export function mapDocumentRow(row: any): CustomerDocumentRecord {
  const internalOnly = !!(row.internal_only ?? row.internalOnly);
  const visible =
    row.visible_to_customer ?? row.visibleToCustomer ?? !internalOnly;
  return {
    id: row.id,
    customerId: row.customer_id,
    projectId: row.project_id,
    documentType: row.document_type,
    title: row.title,
    fileUrl: row.file_url,
    fileName: row.file_name || row.fileName || null,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    visibleToCustomer: visible !== false && !internalOnly,
    internalOnly,
    notes: row.notes || null,
    mimeType: row.mime_type || row.mimeType || null,
  };
}

export function mapWarrantyRow(row: any): CustomerWarrantyRecord {
  const { status, remainingLabel } = computeWarrantyLifecycle(row.end_date);
  return {
    id: row.id,
    customerId: row.customer_id,
    projectId: row.project_id,
    componentType: row.component_type,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serial_number,
    startDate: row.start_date,
    endDate: row.end_date,
    status,
    remainingLabel,
  };
}

export function mapWarrantyClaimRow(row: any): WarrantyClaimRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    ticketId: row.ticket_id,
    component: row.component,
    issueDescription: row.issue_description,
    photoUrl: row.photo_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCustomerSystemRow(row: any): CustomerSystemProfile {
  return {
    customerId: row.customer_id,
    systemSizeKw: row.system_size_kw,
    systemType: row.system_type,
    panelBrand: row.panel_brand,
    panelWattage: row.panel_wattage,
    panelQuantity: row.panel_quantity,
    inverterBrand: row.inverter_brand,
    inverterSizeKw: row.inverter_size_kw,
    batteryBrand: row.battery_brand,
    batteryCapacityKwh: row.battery_capacity_kwh,
    structureType: row.structure_type,
    installationDate: row.installation_date,
    warrantyStart: row.warranty_start,
    warrantyEnd: row.warranty_end,
    netMeteringStatus: row.net_metering_status,
    meterNumber: row.meter_number,
    consumerNumber: row.consumer_number,
    sanctionedLoadKw: row.sanctioned_load_kw,
    siteAddress: row.site_address,
    notes: row.notes,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function buildDocumentWalletSlots(documents: CustomerDocumentRecord[]) {
  const primaryTypes = [
    "quotation_pdf",
    "agreement",
    "invoice",
    "warranty_certificate",
    "net_metering_documents",
    "completion_certificate",
  ];
  return DOCUMENT_WALLET_TYPES.filter((s) => primaryTypes.includes(s.type) || s.type === "agreement_word").map(
    (slot) => {
      const doc = documents
        .filter((d) => d.documentType === slot.type || (slot.type === "agreement" && d.documentType === "agreement_word"))
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
      return { ...slot, document: doc || null };
    }
  );
}

export function buildWarrantyCenterCards(warranties: CustomerWarrantyRecord[]) {
  return WARRANTY_COMPONENT_TYPES.map((slot) => {
    const row = warranties.find((w) => w.componentType === slot.type);
    return { ...slot, warranty: row || null };
  });
}
