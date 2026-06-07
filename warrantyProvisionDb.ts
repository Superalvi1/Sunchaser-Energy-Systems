import { getSupabase, isSupabaseActive, type Database } from "./dbManager.js";
import {
  mapWarrantyRow,
  type WarrantyComponentType,
} from "./src/lib/clientPortalPhase2.ts";
import { defaultWarrantyEndDate } from "./src/lib/projectDelivery.ts";

const QUOTE_EXT_FALLBACK_PREFIX = "__SUNCHASER_EXT__:";

function parseQuotationExtendedData(row: any): Record<string, any> {
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

const ALL_COMPONENTS: WarrantyComponentType[] = [
  "solar_panels",
  "inverter",
  "battery",
  "installation_workmanship",
];

const SERIAL_MEDIA_BY_COMPONENT: Record<string, WarrantyComponentType> = {
  panel_serial_photo: "solar_panels",
  inverter_serial_photo: "inverter",
  battery_serial_photo: "battery",
};

export type WarrantyProvisionResult = {
  customerId: string;
  deliveryId: string;
  warranties: ReturnType<typeof mapWarrantyRow>[];
};

function splitBrandModel(text: string | null | undefined): { brand: string | null; model: string | null } {
  const raw = String(text || "").trim();
  if (!raw || /^none$/i.test(raw)) return { brand: null, model: null };
  const parts = raw.split(/\s+/);
  if (parts.length === 1) return { brand: parts[0], model: null };
  return { brand: parts[0], model: parts.slice(1).join(" ") };
}

function itemForCategory(items: any[], ...needles: string[]) {
  const lower = needles.map((n) => n.toLowerCase());
  return items.find((item) => {
    const cat = String(item.item_category || item.itemCategory || "").toLowerCase();
    return lower.some((n) => cat.includes(n));
  });
}

function hasBatteryInQuote(quote: any, ext: Record<string, any>): boolean {
  const opt = String(ext.batteryOption || quote?.battery_capacity || quote?.batteryCapacity || "").trim();
  if (!opt || /^none$/i.test(opt)) return false;
  return true;
}

async function loadDeliveryItems(deliveryId: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("project_delivery_items")
      .select("*")
      .eq("delivery_id", deliveryId);
    return data || [];
  }
  return ((localDb as any)?.projectDeliveryItems || []).filter(
    (i: any) => (i.delivery_id || i.deliveryId) === deliveryId
  );
}

async function loadCustomerSystem(customerId: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("customer_systems")
      .select("*")
      .eq("customer_id", customerId)
      .maybeSingle();
    return data;
  }
  return ((localDb as any)?.customerSystems || []).find(
    (s: any) => (s.customer_id || s.customerId) === customerId
  );
}

async function loadQuotationForDelivery(
  delivery: any,
  localDb?: Database
): Promise<{ quote: any; ext: Record<string, any> } | null> {
  const quotationId = delivery.quotation_id || delivery.quotationId;
  const leadId = delivery.lead_id || delivery.leadId;

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    if (quotationId) {
      const { data } = await supabase.from("quotations").select("*").eq("id", quotationId).maybeSingle();
      if (data) return { quote: data, ext: parseQuotationExtendedData(data) };
    }
    if (leadId) {
      const { data } = await supabase
        .from("quotations")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      const rows = data || [];
      const accepted = rows.find((q) => q.status === "Accepted");
      const pick = accepted || rows[0];
      if (pick) return { quote: pick, ext: parseQuotationExtendedData(pick) };
    }
    return null;
  }

  const localQuotes = (localDb as any)?.quotations || [];
  if (quotationId) {
    const hit = localQuotes.find((q: any) => q.id === quotationId);
    if (hit) return { quote: hit, ext: parseQuotationExtendedData(hit) };
  }
  if (leadId) {
    const rows = localQuotes.filter((q: any) => (q.lead_id || q.leadId) === leadId);
    const accepted = rows.find((q: any) => q.status === "Accepted");
    const pick = accepted || rows[0];
    if (pick) return { quote: pick, ext: parseQuotationExtendedData(pick) };
    const lead = (localDb as any)?.leads?.find((l: any) => l.id === leadId);
    const leadQuotes = lead?.quotes || [];
    const lAccepted = leadQuotes.find((q: any) => q.status === "Accepted");
    const lPick = lAccepted || leadQuotes[0];
    if (lPick) return { quote: lPick, ext: lPick };
  }
  return null;
}

function buildComponentSpecs(
  component: WarrantyComponentType,
  quotePack: { quote: any; ext: Record<string, any> } | null,
  items: any[],
  system: any,
  batteryApplicable: boolean
): { brand: string | null; model: string | null } {
  const quote = quotePack?.quote;
  const ext = quotePack?.ext || {};

  if (component === "solar_panels") {
    const item = itemForCategory(items, "panel");
    if (item?.brand || item?.model) {
      return { brand: item.brand || null, model: item.model || null };
    }
    if (system?.panel_brand || system?.panelBrand) {
      const qty = system.panel_quantity || system.panelQuantity;
      const watt = system.panel_wattage || system.panelWattage;
      return {
        brand: system.panel_brand || system.panelBrand,
        model: [watt ? `${watt}W` : null, qty ? `×${qty}` : null].filter(Boolean).join(" ") || null,
      };
    }
    const brand = ext.panelBrand || splitBrandModel(quote?.panel_type).brand;
    const model =
      [ext.panelWattage ? `${ext.panelWattage}W` : null, quote?.panel_count ? `×${quote.panel_count}` : null]
        .filter(Boolean)
        .join(" ") ||
      splitBrandModel(quote?.panel_type).model ||
      quote?.panel_type ||
      null;
    return { brand: brand || null, model: model || null };
  }

  if (component === "inverter") {
    const item = itemForCategory(items, "inverter");
    if (item?.brand || item?.model) {
      return { brand: item.brand || null, model: item.model || null };
    }
    if (system?.inverter_brand || system?.inverterBrand) {
      const size = system.inverter_size_kw || system.inverterSizeKw;
      return {
        brand: system.inverter_brand || system.inverterBrand,
        model: size ? `${size} kW` : ext.inverterCapacity || quote?.inverter_type || null,
      };
    }
    return {
      brand: ext.inverterBrand || splitBrandModel(quote?.inverter_type).brand || null,
      model:
        ext.inverterCapacity ||
        splitBrandModel(quote?.inverter_type).model ||
        quote?.inverter_type ||
        null,
    };
  }

  if (component === "battery") {
    if (!batteryApplicable && !hasBatteryInQuote(quote, ext)) {
      return { brand: null, model: "Not applicable" };
    }
    const item = itemForCategory(items, "battery");
    if (item?.brand || item?.model) {
      return { brand: item.brand || null, model: item.model || null };
    }
    if (system?.battery_brand || system?.batteryBrand) {
      const cap = system.battery_capacity_kwh || system.batteryCapacityKwh;
      return {
        brand: system.battery_brand || system.batteryBrand,
        model: cap ? `${cap} kWh` : null,
      };
    }
    const bat = ext.batteryOption || quote?.battery_capacity || quote?.batteryCapacity;
    const parsed = splitBrandModel(bat);
    return { brand: parsed.brand, model: parsed.model || bat || null };
  }

  return {
    brand: "Sunchaser Energy Systems",
    model: "Installation & Workmanship",
  };
}

function serialsFromMedia(media: any[]): Partial<Record<WarrantyComponentType, string>> {
  const out: Partial<Record<WarrantyComponentType, string>> = {};
  for (const m of media) {
    const type = m.media_type || m.mediaType;
    const component = SERIAL_MEDIA_BY_COMPONENT[type];
    const serial = String(m.serial_number || m.serialNumber || "").trim();
    if (component && serial) out[component] = serial;
  }
  return out;
}

async function upsertWarrantyRow(
  customerId: string,
  projectId: string | null,
  component: WarrantyComponentType,
  payload: {
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    startDate: string;
    endDate: string;
  },
  localDb?: Database
) {
  let existing: any = null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("customer_warranties")
      .select("*")
      .eq("customer_id", customerId)
      .eq("component_type", component)
      .maybeSingle();
    existing = data;
  } else {
    existing = ((localDb as any)?.customerWarranties || []).find(
      (w: any) =>
        (w.customer_id || w.customerId) === customerId &&
        (w.component_type || w.componentType) === component
    );
  }

  const pick = (next: string | null | undefined, prev: string | null | undefined) => {
    const n = String(next || "").trim();
    if (n) return n;
    const p = String(prev || "").trim();
    return p || null;
  };

  const merged = {
    brand: pick(payload.brand, existing?.brand),
    model: pick(payload.model, existing?.model),
    serial_number: pick(payload.serialNumber, existing?.serial_number || existing?.serialNumber),
    start_date: payload.startDate || existing?.start_date || existing?.startDate || null,
    end_date: payload.endDate || existing?.end_date || existing?.endDate || null,
    project_id: projectId || existing?.project_id || existing?.projectId || null,
  };

  const row = {
    id: existing?.id || `cw-${component}-${customerId}`,
    customer_id: customerId,
    project_id: merged.project_id,
    component_type: component,
    brand: merged.brand,
    model: merged.model,
    serial_number: merged.serial_number,
    start_date: merged.start_date,
    end_date: merged.end_date,
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("customer_warranties")
      .upsert(row, { onConflict: "customer_id,component_type" })
      .select("*")
      .single();
    if (error) {
      const { data: data2, error: error2 } = await supabase
        .from("customer_warranties")
        .upsert({ ...row, id: `cw-${Date.now()}-${component}` })
        .select("*")
        .single();
      if (error2) throw error2;
      return mapWarrantyRow(data2);
    }
    return mapWarrantyRow(data);
  }

  const db = localDb as any;
  db.customerWarranties = db.customerWarranties || [];
  const idx = db.customerWarranties.findIndex(
    (w: any) =>
      (w.customer_id || w.customerId) === customerId &&
      (w.component_type || w.componentType) === component
  );
  const mapped = {
    id: row.id,
    customerId,
    projectId,
    componentType: component,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serial_number,
    startDate: row.start_date,
    endDate: row.end_date,
  };
  if (idx >= 0) db.customerWarranties[idx] = mapped;
  else db.customerWarranties.push(mapped);
  return mapWarrantyRow({
    id: mapped.id,
    customer_id: customerId,
    project_id: projectId,
    component_type: component,
    brand: mapped.brand,
    model: mapped.model,
    serial_number: mapped.serialNumber,
    start_date: mapped.startDate,
    end_date: mapped.endDate,
  });
}

/** Create or refresh the full warranty package when a project is marked Completed. */
export async function provisionWarrantiesOnProjectCompletion(
  deliveryId: string,
  localDb?: Database
): Promise<WarrantyProvisionResult | null> {
  let delivery: any;
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("project_deliveries")
      .select("*")
      .eq("id", deliveryId)
      .maybeSingle();
    if (error || !data) return null;
    delivery = data;
  } else {
    delivery = (localDb as any)?.projectDeliveries?.find((d: any) => d.id === deliveryId);
    if (!delivery) return null;
  }

  const customerId = delivery.customer_id || delivery.customerId;
  if (!customerId) return null;

  const batteryApplicable =
    delivery.battery_applicable !== false && delivery.batteryApplicable !== false;

  const startDate =
    String(
      delivery.warranty_start_date ||
        delivery.warrantyStartDate ||
        delivery.installation_completed_date ||
        delivery.installationCompletedDate ||
        new Date().toISOString().slice(0, 10)
    ).slice(0, 10) || new Date().toISOString().slice(0, 10);

  let media: any[] = [];
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("project_completion_media")
      .select("*")
      .eq("delivery_id", deliveryId);
    media = data || [];
  } else {
    media = ((localDb as any)?.projectCompletionMedia || []).filter(
      (m: any) => (m.delivery_id || m.deliveryId) === deliveryId
    );
  }

  const serials = serialsFromMedia(media);
  const [quotePack, items, system] = await Promise.all([
    loadQuotationForDelivery(delivery, localDb),
    loadDeliveryItems(deliveryId, localDb),
    loadCustomerSystem(customerId, localDb),
  ]);

  let projectId: string | null = null;
  if (isSupabaseActive()) {
    const { data: proj } = await getSupabase()!
      .from("projects")
      .select("id")
      .eq("customer_id", customerId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    projectId = proj?.id || null;
  } else {
    const proj = (localDb as any)?.projects?.find(
      (p: any) => (p.customer_id || p.customerId) === customerId
    );
    projectId = proj?.id || null;
  }

  const warranties = [];
  for (const component of ALL_COMPONENTS) {
    if (component === "battery" && !batteryApplicable && !hasBatteryInQuote(quotePack?.quote, quotePack?.ext || {})) {
      const endDate = defaultWarrantyEndDate(component, startDate);
      warranties.push(
        await upsertWarrantyRow(
          customerId,
          projectId,
          component,
          {
            brand: null,
            model: "Not applicable",
            serialNumber: null,
            startDate,
            endDate,
          },
          localDb
        )
      );
      continue;
    }

    const { brand, model } = buildComponentSpecs(
      component,
      quotePack,
      items,
      system,
      batteryApplicable
    );
    const endDate =
      String(delivery.warranty_end_date || delivery.warrantyEndDate || "").slice(0, 10) ||
      defaultWarrantyEndDate(component, startDate);

    warranties.push(
      await upsertWarrantyRow(
        customerId,
        projectId,
        component,
        {
          brand,
          model,
          serialNumber: component === "installation_workmanship" ? null : serials[component] || null,
          startDate,
          endDate:
            component === "installation_workmanship"
              ? defaultWarrantyEndDate("installation_workmanship", startDate)
              : endDate,
        },
        localDb
      )
    );
  }

  console.log(
    "[WarrantyProvision] Auto-provisioned warranty package",
    JSON.stringify({ deliveryId, customerId, components: warranties.map((w) => w.componentType) })
  );

  return { customerId, deliveryId, warranties };
}

/** Update a single component serial when technician saves a serial photo. */
export async function syncWarrantySerialFromCompletionMedia(
  deliveryId: string,
  mediaType: string,
  serialNumber: string,
  localDb?: Database
) {
  const component = SERIAL_MEDIA_BY_COMPONENT[mediaType];
  const serial = String(serialNumber || "").trim();
  if (!component || !serial) return null;

  let delivery: any;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("project_deliveries")
      .select("customer_id, warranty_start_date, warranty_end_date")
      .eq("id", deliveryId)
      .maybeSingle();
    delivery = data;
  } else {
    delivery = (localDb as any)?.projectDeliveries?.find((d: any) => d.id === deliveryId);
  }
  if (!delivery) return null;

  const customerId = delivery.customer_id || delivery.customerId;
  const startDate =
    String(delivery.warranty_start_date || delivery.warrantyStartDate || new Date().toISOString().slice(0, 10)).slice(
      0,
      10
    );

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: existing } = await supabase
      .from("customer_warranties")
      .select("*")
      .eq("customer_id", customerId)
      .eq("component_type", component)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from("customer_warranties")
        .update({ serial_number: serial, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      return mapWarrantyRow(data);
    }
  } else {
    const db = localDb as any;
    const idx = (db.customerWarranties || []).findIndex(
      (w: any) =>
        (w.customer_id || w.customerId) === customerId &&
        (w.component_type || w.componentType) === component
    );
    if (idx >= 0) {
      db.customerWarranties[idx].serialNumber = serial;
      db.customerWarranties[idx].serial_number = serial;
      return mapWarrantyRow(db.customerWarranties[idx]);
    }
  }

  return upsertWarrantyRow(
    customerId,
    null,
    component,
    {
      brand: null,
      model: null,
      serialNumber: serial,
      startDate,
      endDate: defaultWarrantyEndDate(component, startDate),
    },
    localDb
  );
}
