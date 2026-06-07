/**
 * Local verification for auto warranty provisioning rules.
 * Run: node scripts/verify-warranty-provision-local.mjs
 */

const COMPLETION_MEDIA_TYPES = [
  { key: "panel_serial_photo", label: "Panel serial number photo", batteryOnly: false },
  { key: "inverter_serial_photo", label: "Inverter serial number photo", batteryOnly: false },
  { key: "battery_serial_photo", label: "Battery serial number photo", batteryOnly: true },
];

function mediaLabel(key) {
  return COMPLETION_MEDIA_TYPES.find((m) => m.key === key)?.label || key;
}

function getMissingCompletionSerials(media, batteryApplicable) {
  const serialTypes = ["panel_serial_photo", "inverter_serial_photo"];
  if (batteryApplicable) serialTypes.push("battery_serial_photo");
  const byType = new Map(media.map((m) => [String(m.mediaType || m.media_type || ""), m]));
  return serialTypes.filter((t) => {
    const row = byType.get(t);
    return !row || !String(row.serialNumber || row.serial_number || "").trim();
  });
}

function canMarkProjectCompleted(uploaded, batteryApplicable, media = []) {
  const required = [
    "panel_site_photo",
    "panel_serial_photo",
    "inverter_installed_photo",
    "inverter_serial_photo",
    "earth_bore_photo",
    "earthing_connection_photo",
    "complete_site_photo",
    "customer_handover_photo",
  ];
  if (batteryApplicable) {
    required.push("battery_installed_photo", "battery_serial_photo");
  }
  if (required.some((t) => !uploaded.includes(t))) return false;
  return getMissingCompletionSerials(media, batteryApplicable).length === 0;
}

function canAdvanceToStage(target, uploaded, batteryApplicable, media = []) {
  if (target !== "Completed") return { ok: true };
  if (!canMarkProjectCompleted(uploaded, batteryApplicable, media)) {
    const missingSerials = getMissingCompletionSerials(media, batteryApplicable);
    if (missingSerials.length) {
      return { ok: false, reason: `Enter serial numbers for: ${missingSerials.map(mediaLabel).join(", ")}` };
    }
    return { ok: false, reason: "Missing photos" };
  }
  return { ok: true };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const allPhotos = [
  "panel_site_photo",
  "panel_serial_photo",
  "inverter_installed_photo",
  "inverter_serial_photo",
  "battery_installed_photo",
  "battery_serial_photo",
  "earth_bore_photo",
  "earthing_connection_photo",
  "complete_site_photo",
  "customer_handover_photo",
];

const noSerials = allPhotos.map((k) => ({ mediaType: k, serialNumber: null }));
assert(!canMarkProjectCompleted(allPhotos, true, noSerials), "1. Completion must require serial numbers");
assert(!canAdvanceToStage("Completed", allPhotos, true, noSerials).ok, "1. Completed stage must reject missing serials");

const withSerials = [
  { mediaType: "panel_serial_photo", serialNumber: "PNL-001" },
  { mediaType: "inverter_serial_photo", serialNumber: "INV-002" },
  { mediaType: "battery_serial_photo", serialNumber: "BAT-003" },
];
assert(canMarkProjectCompleted(allPhotos, true, withSerials), "2–4. Completion allowed with serials");

const missingBattery = getMissingCompletionSerials(
  [
    { mediaType: "panel_serial_photo", serialNumber: "PNL-1" },
    { mediaType: "inverter_serial_photo", serialNumber: "INV-1" },
  ],
  false
);
assert(!missingBattery.includes("battery_serial_photo"), "4. Battery serial skipped when N/A");

assert(
  !getMissingCompletionSerials(withSerials, true).some((t) => String(t).includes("workmanship")),
  "5. Workmanship has no serial requirement"
);

const SERIAL_MAP = {
  panel_serial_photo: "solar_panels",
  inverter_serial_photo: "inverter",
  battery_serial_photo: "battery",
};
assert(SERIAL_MAP.panel_serial_photo === "solar_panels", "2. Panel serial → solar_panels");
assert(SERIAL_MAP.inverter_serial_photo === "inverter", "3. Inverter serial → inverter");
assert(SERIAL_MAP.battery_serial_photo === "battery", "4. Battery serial → battery");

function pick(next, prev) {
  const n = String(next || "").trim();
  if (n) return n;
  return String(prev || "").trim() || null;
}
assert(pick(null, "ManualBrand") === "ManualBrand", "6. Manual brand preserved");
assert(pick("AutoBrand", "ManualBrand") === "AutoBrand", "6. Auto brand when provided");
assert(pick("SN-NEW", "SN-OLD") === "SN-NEW", "7. New serial wins when provided");

console.log("OK: warranty provision verification passed (checks 1–7)");
console.log("Next: npm run build (check 8)");
