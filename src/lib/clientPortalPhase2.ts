export const DOCUMENT_WALLET_TYPES = [
  { type: "quotation_pdf", label: "Quotation PDF" },
  { type: "agreement", label: "Agreement" },
  { type: "invoice", label: "Invoice" },
  { type: "warranty_certificate", label: "Warranty Certificate" },
  { type: "net_metering_documents", label: "Net Metering Documents" },
  { type: "completion_certificate", label: "Completion Certificate" },
  { type: "product_datasheet", label: "Product Datasheets" },
] as const;

export type DocumentWalletType = (typeof DOCUMENT_WALLET_TYPES)[number]["type"];

export const WARRANTY_COMPONENT_TYPES = [
  { type: "solar_panels", label: "Solar Panels" },
  { type: "inverter", label: "Inverter" },
  { type: "battery", label: "Battery" },
  { type: "installation_workmanship", label: "Installation Workmanship" },
] as const;

export type WarrantyComponentType = (typeof WARRANTY_COMPONENT_TYPES)[number]["type"];

export type WarrantyLifecycleStatus = "Active" | "Expiring Soon" | "Expired" | "Not available yet";

export interface CustomerDocumentRecord {
  id: string;
  customerId: string;
  projectId?: string | null;
  documentType: DocumentWalletType;
  title: string;
  fileUrl: string;
  uploadedBy: string;
  uploadedAt: string;
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
    return { status: "Not available yet", remainingLabel: "—" };
  }
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) {
    return { status: "Not available yet", remainingLabel: "—" };
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
  return {
    id: row.id,
    customerId: row.customer_id,
    projectId: row.project_id,
    documentType: row.document_type,
    title: row.title,
    fileUrl: row.file_url,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
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

export function buildDocumentWalletSlots(documents: CustomerDocumentRecord[]) {
  return DOCUMENT_WALLET_TYPES.map((slot) => {
    const doc = documents
      .filter((d) => d.documentType === slot.type)
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
    return {
      ...slot,
      document: doc || null,
    };
  });
}

export function buildWarrantyCenterCards(warranties: CustomerWarrantyRecord[]) {
  return WARRANTY_COMPONENT_TYPES.map((slot) => {
    const row = warranties.find((w) => w.componentType === slot.type);
    return {
      ...slot,
      warranty: row || null,
    };
  });
}
