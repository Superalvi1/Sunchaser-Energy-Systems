/**
 * Product catalog — real, functional in-memory catalog of solar BOQ line
 * items (panels, inverters, batteries, cables, structures, accessories).
 * No external inventory system is wired; swap for a real backend via DI.
 */

import { isNonEmptyString, isNonNegativeNumber, QuotationEngineError } from "./QuotationModels.ts";

export const SOLAR_PRODUCT_CATEGORIES = [
  "panel",
  "inverter",
  "battery",
  "structure",
  "dc_cable",
  "ac_cable",
  "earth_wire",
  "db_box",
  "earthing_bore",
  "supplies",
  "civil_work",
  "install_service",
  "freight",
  "net_metering",
  "survey_design",
] as const;

export type SolarProductCategory = (typeof SOLAR_PRODUCT_CATEGORIES)[number];

const SOLAR_PRODUCT_CATEGORY_SET = new Set<string>(SOLAR_PRODUCT_CATEGORIES);

export function isSolarProductCategory(value: string): value is SolarProductCategory {
  return SOLAR_PRODUCT_CATEGORY_SET.has(value);
}

export const SOLAR_PRODUCT_UNITS = ["piece", "meter", "foot", "kw", "lot", "job"] as const;
export type SolarProductUnit = (typeof SOLAR_PRODUCT_UNITS)[number];

const SOLAR_PRODUCT_UNIT_SET = new Set<string>(SOLAR_PRODUCT_UNITS);

export function isSolarProductUnit(value: string): value is SolarProductUnit {
  return SOLAR_PRODUCT_UNIT_SET.has(value);
}

export interface SolarProduct {
  id: string;
  category: SolarProductCategory;
  name: string;
  brand: string;
  unit: SolarProductUnit;
  /** Supplier/landed cost per unit. Never shown to non-margin-privileged viewers. */
  unitCost: number;
  /** List/sell price per unit before any discount. */
  unitPrice: number;
  /** e.g. wattage for panels, kVA for inverters, kWh for batteries. Free-form spec map. */
  specs: Record<string, string | number>;
  active: boolean;
}

export type SolarProductInput = SolarProduct;

export interface ProductValidationResult {
  ok: true;
  product: SolarProduct;
}
export interface ProductValidationError {
  ok: false;
  errors: string[];
}
export type ProductValidation = ProductValidationResult | ProductValidationError;

export function validateSolarProduct(input: SolarProductInput): ProductValidation {
  const errors: string[] = [];

  if (!isNonEmptyString(input.id)) errors.push("id is required");
  if (!isNonEmptyString(input.category) || !isSolarProductCategory(input.category)) {
    errors.push("category is invalid");
  }
  if (!isNonEmptyString(input.name)) errors.push("name is required");
  if (!isNonEmptyString(input.brand)) errors.push("brand is required");
  if (!isNonEmptyString(input.unit) || !isSolarProductUnit(input.unit)) errors.push("unit is invalid");
  if (!isNonNegativeNumber(input.unitCost)) errors.push("unitCost must be a non-negative number");
  if (!isNonNegativeNumber(input.unitPrice)) errors.push("unitPrice must be a non-negative number");
  if (typeof input.specs !== "object" || input.specs === null) errors.push("specs must be an object");
  if (typeof input.active !== "boolean") errors.push("active must be a boolean");

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    product: {
      id: input.id.trim(),
      category: input.category,
      name: input.name.trim(),
      brand: input.brand.trim(),
      unit: input.unit,
      unitCost: input.unitCost,
      unitPrice: input.unitPrice,
      specs: { ...input.specs },
      active: input.active,
    },
  };
}

export function createSolarProduct(input: SolarProductInput): SolarProduct {
  const result = validateSolarProduct(input);
  if (!result.ok) {
    throw new QuotationEngineError("product_catalog", "Invalid solar product.", { errors: result.errors });
  }
  return result.product;
}

export interface ProductCatalog {
  register(product: SolarProduct): void;
  get(id: string): SolarProduct | null;
  listByCategory(category: SolarProductCategory): SolarProduct[];
  listActive(): SolarProduct[];
}

/** Real, functional in-memory catalog. Swap for a real inventory-backed source via DI. */
export class InMemoryProductCatalog implements ProductCatalog {
  private products = new Map<string, SolarProduct>();

  register(product: SolarProduct): void {
    this.products.set(product.id, product);
  }

  get(id: string): SolarProduct | null {
    return this.products.get(id) ?? null;
  }

  listByCategory(category: SolarProductCategory): SolarProduct[] {
    return [...this.products.values()]
      .filter((p) => p.category === category && p.active)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  listActive(): SolarProduct[] {
    return [...this.products.values()].filter((p) => p.active).sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Test helper. */
  size(): number {
    return this.products.size;
  }
}

export function createInMemoryProductCatalog(): InMemoryProductCatalog {
  return new InMemoryProductCatalog();
}

/** Throws QuotationEngineError("product_catalog", ...) if the product does not exist or is inactive. */
export function requireActiveProduct(catalog: ProductCatalog, productId: string): SolarProduct {
  const product = catalog.get(productId);
  if (!product || !product.active) {
    throw new QuotationEngineError("product_catalog", "Product not found or inactive.", { productId });
  }
  return product;
}

export function buildSolarProduct(overrides: Partial<SolarProductInput> = {}): SolarProduct {
  return createSolarProduct({
    id: "panel-longi-550",
    category: "panel",
    name: "LONGi Hi-MO 550W",
    brand: "LONGi",
    unit: "piece",
    unitCost: 28000,
    unitPrice: 34000,
    specs: { wattage: 550 },
    active: true,
    ...overrides,
  });
}
