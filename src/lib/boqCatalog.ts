/** Live catalog products for BOQ quick-fill — same source as Pakistan Solar Hardware Catalog. */

export function isActiveCatalogProduct(product: unknown): product is Record<string, unknown> {
  if (!product || typeof product !== "object") return false;
  const p = product as Record<string, unknown>;
  if (!p.id) return false;
  if (p.deletedAt || p.deleted_at || p.isDeleted || p.is_deleted) return false;
  return true;
}

/** Dedupe by id; exclude soft-deleted / invalid rows. Never merges settings.boqMasterLibrary or seed data. */
export function getLiveCatalogProducts(products: unknown[] | undefined | null): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const raw of products || []) {
    if (!isActiveCatalogProduct(raw)) continue;
    const id = String(raw.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(raw);
  }
  return out;
}

function normalizeCategory(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const CATEGORY_EQUIVALENTS: Record<string, string[]> = {
  "solar panels": ["solar panels", "panels", "panel"],
  inverters: ["inverters", "inverter"],
  batteries: ["batteries", "battery"],
  structure: ["structure", "structure / fabrication", "structure/fabrication"],
  cables: ["cables", "cables & conductors", "cables and conductors"],
  protection: ["protection", "db boxes", "db boxes & breakers"],
  accessories: ["accessories", "electrical & mechanical supplies", "ducts / pipes / conduits"],
  "net metering": ["net metering"],
  "civil works": ["civil works", "civil work", "installation & commissioning", "installation and commissioning"],
};

function categoryMatches(productCategory: string, allowed: string[]): boolean {
  const norm = normalizeCategory(productCategory);
  if (!norm || !allowed.length) return false;
  for (const a of allowed) {
    const key = normalizeCategory(a);
    const equivalents = CATEGORY_EQUIVALENTS[key] || [key];
    if (equivalents.some((eq) => norm === eq || norm.includes(eq) || eq.includes(norm))) {
      return true;
    }
  }
  return false;
}

/** Map BOQ section heading text to preferred hardware catalog categories (sort hint only — never excludes). */
export function sectionHeadingToProductCategories(heading: string | null | undefined): string[] | null {
  if (!heading?.trim()) return null;
  const h = heading.toLowerCase();

  if (/imported equipment/.test(h)) {
    return ["Solar Panels", "Inverters", "Batteries"];
  }
  if (/photovoltaic|solar panel/.test(h)) return ["Solar Panels"];
  if (/\bpanel\b/.test(h) && !/inverter|batter|cable|structure/.test(h)) return ["Solar Panels"];
  if (/inverter/.test(h)) return ["Inverters"];
  if (/batter|storage|lithium|backup/.test(h)) return ["Batteries"];
  if (/structure|mounting|fabrication|girder|elevated|roof|frame|galvanized/.test(h)) {
    return ["Structure"];
  }
  if (/cable|conductor|wire/.test(h)) return ["Cables"];
  if (/\bdb\b|breaker|protection|spd|distribution/.test(h)) return ["Protection"];
  if (/net meter|net-meter|lesco/.test(h)) return ["Net Metering"];
  if (/civil|foundation|pillar|concrete/.test(h)) return ["Civil Works"];
  if (/install|commission|transport|earthing|supply|duct|pvc|conduit|accessory|mechanical/.test(h)) {
    return ["Accessories", "Civil Works"];
  }

  return null;
}

function normalizeSearchStem(value: string): string {
  if (value.endsWith("ies") && value.length > 4) return `${value.slice(0, -3)}y`;
  if (value.endsWith("es") && value.length > 4) return value.slice(0, -2);
  if (value.endsWith("s") && value.length > 3) return value.slice(0, -1);
  return value;
}

function catalogFieldMatchesQuery(field: string, q: string): boolean {
  if (!field || !q) return false;
  if (field.includes(q)) return true;
  const fieldStem = normalizeSearchStem(field);
  const queryStem = normalizeSearchStem(q);
  if (fieldStem.includes(queryStem) || queryStem.includes(fieldStem)) return true;
  if (field.startsWith(q) || fieldStem.startsWith(queryStem)) return true;
  return false;
}

export function filterBoqCatalogBySearch(
  products: Record<string, unknown>[],
  searchQuery: string | null | undefined
): Record<string, unknown>[] {
  const q = String(searchQuery || "").trim().toLowerCase();
  if (!q) return products;
  return products.filter((p) => {
    const fields = [p.category, p.brand, p.model, p.name, p.sku].map((v) =>
      String(v || "").toLowerCase()
    );
    return fields.some((f) => catalogFieldMatchesQuery(f, q));
  });
}

function sortProductsByLabel(products: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...products].sort((a, b) =>
    formatQuickFillOptionLabel(a).localeCompare(formatQuickFillOptionLabel(b))
  );
}

export type BoqQuickFillGroup = {
  category: string;
  products: Record<string, unknown>[];
};

/** All active catalog products for quick-fill, optionally search-filtered and category-prioritized. */
export function buildBoqQuickFillGroups(
  products: unknown[] | undefined | null,
  sectionHeading?: string | null,
  searchQuery?: string | null
): BoqQuickFillGroup[] {
  const live = filterBoqCatalogBySearch(getLiveCatalogProducts(products), searchQuery);
  if (!live.length) return [];

  const preferred = sectionHeadingToProductCategories(sectionHeading) || [];
  const byCategory = new Map<string, Record<string, unknown>[]>();

  for (const p of live) {
    const cat = String(p.category || "Uncategorized");
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(p);
  }

  const preferredCats = Array.from(byCategory.keys())
    .filter((c) => categoryMatches(c, preferred))
    .sort((a, b) => a.localeCompare(b));
  const otherCats = Array.from(byCategory.keys())
    .filter((c) => !categoryMatches(c, preferred))
    .sort((a, b) => a.localeCompare(b));

  return [...preferredCats, ...otherCats].map((category) => ({
    category,
    products: sortProductsByLabel(byCategory.get(category)!),
  }));
}

/** Flat list of all matching products (preferred categories first). Never excludes non-matching categories. */
export function getBoqQuickFillProducts(
  products: unknown[] | undefined | null,
  sectionHeading?: string | null,
  searchQuery?: string | null
): Record<string, unknown>[] {
  return buildBoqQuickFillGroups(products, sectionHeading, searchQuery).flatMap((g) => g.products);
}

export function formatQuickFillOptionLabel(product: Record<string, unknown>): string {
  const category = String(product.category || "Uncategorized");
  const brand = String(product.brand || "").trim();
  const model = String(product.model || product.name || "").trim();
  const sku = String(product.sku || "").trim();
  const label = [brand, model].filter(Boolean).join(" ") || String(product.name || product.id);
  const skuSuffix = sku ? ` (${sku})` : "";
  return `${category} — ${label}${skuSuffix}`;
}
