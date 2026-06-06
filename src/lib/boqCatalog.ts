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
  if (!norm) return false;
  for (const a of allowed) {
    const key = normalizeCategory(a);
    const equivalents = CATEGORY_EQUIVALENTS[key] || [key];
    if (equivalents.some((eq) => norm === eq || norm.includes(eq) || eq.includes(norm))) {
      return true;
    }
  }
  return false;
}

/** Map BOQ section heading text to hardware catalog categories (if recognizable). */
export function sectionHeadingToProductCategories(heading: string | null | undefined): string[] | null {
  if (!heading?.trim()) return null;
  const h = heading.toLowerCase();

  if (/panel|imported equipment|photovoltaic|module|solar panel/.test(h)) {
    return ["Solar Panels", "Panels"];
  }
  if (/inverter/.test(h)) return ["Inverters"];
  if (/batter|storage|lithium/.test(h)) return ["Batteries"];
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

export function getBoqQuickFillProducts(
  products: unknown[] | undefined | null,
  sectionHeading?: string | null
): Record<string, unknown>[] {
  const live = getLiveCatalogProducts(products);
  const categories = sectionHeadingToProductCategories(sectionHeading);
  if (!categories?.length) return live;

  const filtered = live.filter((p) => categoryMatches(String(p.category || ""), categories));
  return filtered.length > 0 ? filtered : live;
}

export function formatQuickFillOptionLabel(product: Record<string, unknown>): string {
  const category = String(product.category || "Uncategorized");
  const brand = String(product.brand || "").trim();
  const model = String(product.model || product.name || "").trim();
  const label = [brand, model].filter(Boolean).join(" ") || String(product.name || product.id);
  return `${category} - ${label}`;
}
