/**
 * Approved static (WS1 seed) catalogue repository.
 * Used when MARKETPLACE_CATALOGUE_SOURCE=static (default / fail-closed).
 * Never reads mp_products or any live database catalogue table.
 */
import {
  WS1_SEED_CATEGORY_SLUGS,
  WS1_SEED_PRODUCTS,
} from "./catalogueSeedData.ts";
import type { CatalogueRepository } from "./catalogueRepository.ts";
import type {
  CatalogueBrandDto,
  CatalogueCategoryDto,
  CataloguePage,
  CatalogueListFilters,
  CatalogueProductDto,
} from "./catalogueTypes.ts";

function buildStaticCatalogue(): {
  categories: CatalogueCategoryDto[];
  brands: CatalogueBrandDto[];
  products: CatalogueProductDto[];
} {
  const categories: CatalogueCategoryDto[] = WS1_SEED_CATEGORY_SLUGS.map(
    (slug, i) => ({
      slug,
      name: slug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      description: null,
      sortOrder: i + 1,
    }),
  );

  const brands: CatalogueBrandDto[] = Array.from(
    new Map(
      WS1_SEED_PRODUCTS.map((p) => [
        p.brandSlug,
        { slug: p.brandSlug, name: p.brandName },
      ]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));

  const products: CatalogueProductDto[] = WS1_SEED_PRODUCTS.map(
    (p): CatalogueProductDto => {
      const category = categoryBySlug.get(p.categorySlug) ?? {
        slug: p.categorySlug,
        name: p.categorySlug,
        description: null,
        sortOrder: 0,
      };
      return {
        slug: p.slug,
        title: p.title,
        description: p.description,
        shortDescription: null,
        model: null,
        seoTitle: null,
        seoDescription: null,
        datasheetUrl: null,
        brand: { slug: p.brandSlug, name: p.brandName },
        category,
        tags: [...p.tags],
        featured: p.featured,
        specifications: { ...p.specifications },
        warranty: p.warranty,
        image: null,
        images: [],
        defaultVariant: {
          sku: p.sku,
          title: "Default",
          isDefault: true,
          websitePrice: p.websitePrice,
          websitePriceState: "priced_auto",
          websitePriceSource: "seed",
          stockStatus: "unknown",
        },
      };
    },
  ).sort((a, b) => a.title.localeCompare(b.title));

  return { categories, brands, products };
}

/** In-memory static catalogue backed solely by WS1_SEED_PRODUCTS. */
export function createStaticCatalogueRepository(): CatalogueRepository {
  const { categories, brands, products } = buildStaticCatalogue();

  return {
    async listCategories() {
      return categories.map((c) => ({ ...c }));
    },
    async listBrands() {
      return brands.map((b) => ({ ...b }));
    },
    async listProducts(filters: CatalogueListFilters): Promise<CataloguePage> {
      const offset = filters.offset ?? 0;
      const allMatched = products.filter((p) => {
        if (filters.featured !== undefined && p.featured !== filters.featured) return false;
        if (filters.category && p.category.slug !== filters.category) return false;
        if (filters.brand && p.brand.slug !== filters.brand) return false;
        return true;
      });
      const total = allMatched.length;
      const sliced = filters.limit !== undefined
        ? allMatched.slice(offset, offset + filters.limit)
        : allMatched.slice(offset);
      const items = sliced.map((p) => ({
        ...p,
        brand: { ...p.brand },
        category: { ...p.category },
        tags: [...p.tags],
        specifications: { ...p.specifications },
        images: [...p.images],
        defaultVariant: { ...p.defaultVariant },
      })) as CatalogueProductDto[];
      return { items, total, limit: filters.limit ?? total, offset };
    },
    async getProductBySlug(slug: string) {
      const product = products.find((p) => p.slug === slug);
      if (!product) return null;
      return {
        ...product,
        brand: { ...product.brand },
        category: { ...product.category },
        tags: [...product.tags],
        specifications: { ...product.specifications },
        images: [...product.images],
        defaultVariant: { ...product.defaultVariant },
      };
    },
  };
}
