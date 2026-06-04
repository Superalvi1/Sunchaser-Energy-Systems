import type { WarrantyComponentType } from "./clientPortalPhase2.ts";

export const DELIVERY_STATUSES = [
  "Order Confirmed",
  "Material Ordered",
  "Material Delivered",
  "Installation Scheduled",
  "Installation In Progress",
  "Installation Completed",
  "Handover Completed",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const SYSTEM_TYPES = ["On-grid", "Hybrid", "Off-grid", "EV Charger"] as const;
export const PROJECT_TYPES = ["Residential", "Commercial", "Industrial"] as const;

export const PLANNED_ITEM_CATEGORIES = [
  "Panels",
  "Inverter",
  "Battery",
  "Structure",
  "AC SPD",
  "DC SPD",
  "Breakers",
  "Cables",
  "Earthing",
  "DB box",
  "Changeover",
  "Monitoring device",
  "Other accessories",
] as const;

export const INSTALLATION_PHOTO_CATEGORIES = [
  "Panels photo",
  "Inverter photo",
  "Battery photo",
  "DB photo",
  "Breaker/SPD photo",
  "Earthing photo",
  "Cable routing photo",
  "Final site photo",
] as const;

export const DELIVERY_SAFETY_CHECKLIST = [
  { key: "acBreakerChecked", label: "AC breaker checked" },
  { key: "dcBreakerChecked", label: "DC breaker checked" },
  { key: "spdInstalled", label: "SPD installed" },
  { key: "earthingChecked", label: "Earthing checked" },
  { key: "inverterPoweredOn", label: "Inverter powered on" },
  { key: "batteryChecked", label: "Battery charging/discharging checked" },
  { key: "monitoringConfigured", label: "Monitoring app configured" },
  { key: "customerBriefed", label: "Customer briefed" },
  { key: "siteCleaned", label: "Site cleaned" },
] as const;

export const RESIDENTIAL_PROGRESS_STEPS = [
  { key: "order", label: "Order Confirmed", statuses: ["Order Confirmed", "Material Ordered"] },
  { key: "material", label: "Material Delivered", statuses: ["Material Delivered", "Installation Scheduled"] },
  { key: "install", label: "Installation Completed", statuses: ["Installation In Progress", "Installation Completed"] },
  { key: "aftersales", label: "After-Sales Active", statuses: ["Handover Completed"] },
] as const;

export const COMMERCIAL_PROGRESS_STEPS = [
  "Order Confirmed",
  "Material Ordered",
  "Material Delivered",
  "Installation Scheduled",
  "Installation In Progress",
  "Installation Completed",
  "Handover Completed",
] as const;

export function warrantyComponentForEquipmentType(
  equipmentType: string
): WarrantyComponentType | null {
  const t = String(equipmentType || "").toLowerCase();
  if (t.includes("panel")) return "solar_panels";
  if (t.includes("inverter")) return "inverter";
  if (t.includes("battery")) return "battery";
  return null;
}

export function defaultWarrantyEndDate(
  component: WarrantyComponentType,
  startDate: string
): string {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return startDate;
  const years =
    component === "solar_panels" ? 25 : component === "battery" ? 10 : component === "inverter" ? 5 : 2;
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + years);
  return end.toISOString().slice(0, 10);
}

export function buildCustomerDeliveryProgress(
  projectType: string,
  deliveryStatus: string
): { mode: "residential" | "detailed"; steps: { label: string; status: "completed" | "active" | "pending" }[] } {
  const status = deliveryStatus || "Order Confirmed";
  if (projectType === "Residential") {
    const order = DELIVERY_STATUSES.indexOf(status as DeliveryStatus);
    const steps = RESIDENTIAL_PROGRESS_STEPS.map((step, idx) => {
      const maxStatus = Math.max(
        ...step.statuses.map((s) => DELIVERY_STATUSES.indexOf(s as DeliveryStatus))
      );
      let state: "completed" | "active" | "pending" = "pending";
      if (order >= maxStatus) state = "completed";
      else if (step.statuses.includes(status as DeliveryStatus) || order === maxStatus - 1) {
        state = "active";
      }
      if (status === "Handover Completed") state = "completed";
      return { label: step.label, status: state };
    });
    return { mode: "residential", steps };
  }
  const idx = COMMERCIAL_PROGRESS_STEPS.indexOf(status as (typeof COMMERCIAL_PROGRESS_STEPS)[number]);
  const steps = COMMERCIAL_PROGRESS_STEPS.map((label, i) => {
    let state: "completed" | "active" | "pending" = "pending";
    if (idx < 0) state = i === 0 ? "active" : "pending";
    else if (i < idx) state = "completed";
    else if (i === idx) state = "active";
    return { label, status: state };
  });
  return { mode: "detailed", steps };
}

export type ProjectDeliveryRecord = {
  id: string;
  customerId: string;
  leadId?: string | null;
  quotationId?: string | null;
  projectTitle: string;
  systemType: string;
  projectType: string;
  systemSizeKw?: number | null;
  assignedTechnicianUserId?: string | null;
  installationAddress?: string | null;
  expectedInstallationDate?: string | null;
  deliveryStatus: string;
  safetyChecklist?: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
};
