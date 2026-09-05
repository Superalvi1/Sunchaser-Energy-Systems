/**
 * Transaction-safe persistence for website catalog sync.
 *
 * Website source owns catalogue identity/content. CRM owns live inventory
 * quantity (`stock`) and manually managed `discount`. Those CRM fields are
 * re-read at persist time and omitted from UPDATE payloads.
 *
 * Settings: `websiteCatalogSync` is patched onto the latest settings object
 * immediately before write — never onto the pre-network baseline.
 *
 * Supabase commit order:
 * 1. persist changed website rows
 * 2. if product persistence fails: do not commit the proposed catalog locally
 * 3. if products succeed: persist the sync report, then commit local state
 *
 * If products persist but the settings report write fails, the API must say
 * products were saved (not "nothing happened").
 */

import type { Product } from "../../types";
import {
  applyWebsiteCatalogPersistenceFailure,
  patchLatestSettingsWithWebsiteCatalogSync,
  type WebsiteCatalogSyncReport,
  type WebsiteCatalogSyncResult,
} from "./sync";

export const CRM_OWNED_INVENTORY_FIELDS = ["stock", "discount"] as const;

export type WebsiteCatalogSupabaseRow = {
  id: string;
  name: string;
  category: string;
  brand: string;
  model: string;
  sku: string;
  price: number;
  images: string[];
  warranty_period: string;
  specifications: Record<string, unknown>;
  stock?: number;
  discount?: number;
};

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mergeCurrentCrmOwnedInventory(
  proposed: Product,
  currentRemote: Partial<Product> | null | undefined
): Product {
  if (!currentRemote) {
    return {
      ...proposed,
      stock: 0,
      discount: finiteNumber(proposed.discount) ?? 0,
    };
  }
  return {
    ...proposed,
    stock: finiteNumber(currentRemote.stock) ?? 0,
    discount: finiteNumber(currentRemote.discount) ?? 0,
  };
}

export function applyCurrentCrmOwnedInventory(
  products: Product[],
  currentById: Map<string, Partial<Product>>,
  persistIds: Iterable<string>
): Product[] {
  const ids = new Set(persistIds);
  return products.map((product) => {
    if (!ids.has(product.id)) return product;
    return mergeCurrentCrmOwnedInventory(product, currentById.get(product.id));
  });
}

export function mapWebsiteCatalogProductForSupabase(
  product: Product,
  options: { existsRemotely: boolean }
): WebsiteCatalogSupabaseRow {
  const row: WebsiteCatalogSupabaseRow = {
    id: product.id,
    name: product.name,
    category: product.category,
    brand: product.brand || "",
    model: product.model || "",
    sku: product.sku || "",
    price: Number(product.price || 0),
    images: product.images || [],
    warranty_period: product.warrantyPeriod || "2 Years",
    specifications: product.specifications || {},
  };
  if (!options.existsRemotely) {
    row.stock = 0;
    row.discount = finiteNumber(product.discount) ?? 0;
  }
  return row;
}

export async function readSettingsAtPersistTime(
  fetchLatestSettings: () => Promise<unknown>,
  fallback: unknown
): Promise<unknown> {
  try {
    const latest = await fetchLatestSettings();
    return latest ?? fallback;
  } catch {
    return fallback;
  }
}

export interface WebsiteCatalogPersistAdapters {
  fetchLatestSettings: () => Promise<unknown>;
  fetchCurrentProductsByIds: (ids: string[]) => Promise<Map<string, Product>>;
  upsertProductChunk: (rows: WebsiteCatalogSupabaseRow[]) => Promise<{ error?: string | null }>;
  upsertSettings: (settings: Record<string, any>) => Promise<void>;
}

export interface WebsiteCatalogFinalizeInput {
  supabaseActive: boolean;
  baselineProducts: Product[];
  localSettingsFallback: unknown;
  result: WebsiteCatalogSyncResult;
  adapters: WebsiteCatalogPersistAdapters;
  chunkSize?: number;
}

export interface WebsiteCatalogFinalizeOutput {
  success: boolean;
  httpStatus: number;
  products: Product[];
  settings: Record<string, any>;
  commitLocalProducts: boolean;
  commitLocalSettings: boolean;
  productsPersisted: boolean;
  settingsPersisted: boolean;
  settingsMetadataFailed: boolean;
  report: WebsiteCatalogSyncReport;
  error?: string;
}

async function persistFailedReportSettings(
  input: WebsiteCatalogFinalizeInput,
  report: WebsiteCatalogSyncReport
): Promise<{ settings: Record<string, any>; settingsPersisted: boolean; report: WebsiteCatalogSyncReport }> {
  const latest = await readSettingsAtPersistTime(
    input.adapters.fetchLatestSettings,
    input.localSettingsFallback
  );
  const settings = patchLatestSettingsWithWebsiteCatalogSync(latest, report);
  try {
    await input.adapters.upsertSettings(settings);
    return { settings, settingsPersisted: true, report };
  } catch (err: any) {
    const nextReport = applyWebsiteCatalogPersistenceFailure(
      report,
      `Sync report settings write failed: ${err?.message || err}`
    );
    return {
      settings: patchLatestSettingsWithWebsiteCatalogSync(latest, nextReport),
      settingsPersisted: false,
      report: nextReport,
    };
  }
}

export async function finalizeWebsiteCatalogSync(
  input: WebsiteCatalogFinalizeInput
): Promise<WebsiteCatalogFinalizeOutput> {
  const chunkSize = input.chunkSize || 80;
  let report = input.result.report;
  let products = input.result.products;

  if (!input.supabaseActive) {
    const latest = await readSettingsAtPersistTime(
      input.adapters.fetchLatestSettings,
      input.localSettingsFallback
    );
    const settings = patchLatestSettingsWithWebsiteCatalogSync(latest, report);
    const failed = report.lastStatus === "failed";
    return {
      success: !failed,
      httpStatus: failed ? 500 : 200,
      products,
      settings,
      commitLocalProducts: true,
      commitLocalSettings: true,
      productsPersisted: true,
      settingsPersisted: true,
      settingsMetadataFailed: false,
      report,
      error: failed ? report.errors[0] || "Website catalog sync failed." : undefined,
    };
  }

  const toPersist = input.result.productsToPersist || [];
  const persistIds = input.result.changedProductIds || toPersist.map((p) => p.id);

  if (toPersist.length > 0) {
    const currentById = await input.adapters.fetchCurrentProductsByIds(persistIds);
    products = applyCurrentCrmOwnedInventory(products, currentById, persistIds);
    const rows = toPersist.map((product) => {
      const merged = mergeCurrentCrmOwnedInventory(product, currentById.get(product.id));
      return mapWebsiteCatalogProductForSupabase(merged, { existsRemotely: currentById.has(product.id) });
    });

    let persistedCount = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await input.adapters.upsertProductChunk(chunk);
      if (error) {
        report = applyWebsiteCatalogPersistenceFailure(
          report,
          `Supabase product upsert failed: ${error}`,
          { persistedCount, attemptedCount: rows.length }
        );
        const failedSettings = await persistFailedReportSettings(input, report);
        return {
          success: false,
          httpStatus: 500,
          products: input.baselineProducts,
          settings: failedSettings.settings,
          commitLocalProducts: false,
          commitLocalSettings: true,
          productsPersisted: persistedCount > 0,
          settingsPersisted: failedSettings.settingsPersisted,
          settingsMetadataFailed: false,
          report: failedSettings.report,
          error: failedSettings.report.errors.at(-1),
        };
      }
      persistedCount += chunk.length;
    }
    report = { ...report, persistedCount };
  } else {
    report = { ...report, persistedCount: 0 };
  }

  const latest = await readSettingsAtPersistTime(
    input.adapters.fetchLatestSettings,
    input.localSettingsFallback
  );
  const settings = patchLatestSettingsWithWebsiteCatalogSync(latest, report);
  try {
    await input.adapters.upsertSettings(settings);
  } catch (err: any) {
    const message = `Website catalog products were saved, but sync report settings failed: ${err?.message || err}`;
    report = applyWebsiteCatalogPersistenceFailure(report, message);
    return {
      success: false,
      httpStatus: 500,
      products,
      settings: patchLatestSettingsWithWebsiteCatalogSync(latest, report),
      commitLocalProducts: true,
      commitLocalSettings: true,
      productsPersisted: true,
      settingsPersisted: false,
      settingsMetadataFailed: true,
      report,
      error: message,
    };
  }

  if (report.lastStatus === "failed") {
    return {
      success: false,
      httpStatus: 500,
      products: input.baselineProducts,
      settings,
      commitLocalProducts: false,
      commitLocalSettings: true,
      productsPersisted: false,
      settingsPersisted: true,
      settingsMetadataFailed: false,
      report,
      error: report.errors[0] || "Website catalog sync failed.",
    };
  }

  return {
    success: true,
    httpStatus: 200,
    products,
    settings,
    commitLocalProducts: true,
    commitLocalSettings: true,
    productsPersisted: true,
    settingsPersisted: true,
    settingsMetadataFailed: false,
    report,
  };
}
