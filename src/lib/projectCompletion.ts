export const COMPLETION_STAGES = [
  "Survey",
  "Installation Started",
  "Panels Installed",
  "Inverter Installed",
  "Battery Installed",
  "Earthing Completed",
  "QA Inspection",
  "Customer Handover",
  "Completed",
] as const;

export type CompletionStage = (typeof COMPLETION_STAGES)[number];

export const COMPLETION_MEDIA_TYPES = [
  { key: "panel_site_photo", label: "Site panel photo", group: "Panels" },
  { key: "panel_serial_photo", label: "Panel serial number photo", group: "Panels" },
  { key: "inverter_installed_photo", label: "Installed inverter photo", group: "Inverter" },
  { key: "inverter_serial_photo", label: "Inverter serial number photo", group: "Inverter" },
  { key: "battery_installed_photo", label: "Installed battery photo", group: "Battery", batteryOnly: true },
  { key: "battery_serial_photo", label: "Battery serial number photo", group: "Battery", batteryOnly: true },
  { key: "earth_bore_photo", label: "Earth bore photo", group: "Earthing" },
  { key: "earthing_connection_photo", label: "Earthing connection photo", group: "Earthing" },
  { key: "complete_site_photo", label: "Complete site photo", group: "Final" },
  { key: "customer_handover_photo", label: "Customer handover photo", group: "Final" },
] as const;

export type CompletionMediaType = (typeof COMPLETION_MEDIA_TYPES)[number]["key"];

export function requiredMediaTypes(batteryApplicable: boolean): CompletionMediaType[] {
  return COMPLETION_MEDIA_TYPES.filter((m) => !m.batteryOnly || batteryApplicable).map(
    (m) => m.key as CompletionMediaType
  );
}

export function getMissingCompletionSerials(
  media: { mediaType?: string; media_type?: string; serialNumber?: string | null; serial_number?: string | null }[],
  batteryApplicable: boolean
): CompletionMediaType[] {
  const serialTypes: CompletionMediaType[] = ["panel_serial_photo", "inverter_serial_photo"];
  if (batteryApplicable) serialTypes.push("battery_serial_photo");
  const byType = new Map<string, (typeof media)[0]>();
  for (const m of media) {
    byType.set(String(m.mediaType || m.media_type || ""), m);
  }
  return serialTypes.filter((t) => {
    const row = byType.get(t);
    return !row || !String(row.serialNumber || row.serial_number || "").trim();
  });
}

export function getMissingCompletionMedia(
  uploaded: string[],
  batteryApplicable: boolean
): CompletionMediaType[] {
  const required = requiredMediaTypes(batteryApplicable);
  const have = new Set(uploaded);
  return required.filter((t) => !have.has(t));
}

export function canMarkProjectCompleted(
  uploaded: string[],
  batteryApplicable: boolean,
  media: { mediaType?: string; media_type?: string; serialNumber?: string | null; serial_number?: string | null }[] = []
): boolean {
  if (getMissingCompletionMedia(uploaded, batteryApplicable).length > 0) return false;
  return getMissingCompletionSerials(media, batteryApplicable).length === 0;
}

export function mediaLabel(key: string): string {
  return COMPLETION_MEDIA_TYPES.find((m) => m.key === key)?.label || key;
}

export function stageIndex(stage: string): number {
  const i = COMPLETION_STAGES.indexOf(stage as CompletionStage);
  return i >= 0 ? i : 0;
}

export function canAdvanceToStage(
  target: string,
  uploaded: string[],
  batteryApplicable: boolean,
  media: { mediaType?: string; media_type?: string; serialNumber?: string | null; serial_number?: string | null }[] = []
): { ok: boolean; reason?: string } {
  if (target !== "Completed") return { ok: true };
  const missing = getMissingCompletionMedia(uploaded, batteryApplicable);
  if (missing.length) {
    return {
      ok: false,
      reason: `Upload required proof first: ${missing.map(mediaLabel).join(", ")}`,
    };
  }
  const missingSerials = getMissingCompletionSerials(media, batteryApplicable);
  if (missingSerials.length) {
    return {
      ok: false,
      reason: `Enter serial numbers for: ${missingSerials.map(mediaLabel).join(", ")}`,
    };
  }
  return { ok: true };
}
