/**
 * Complete planning-context catalogue load helpers.
 * Never return a silently truncated listing set for matching.
 */

/** Rows per PostgREST page while assembling the full auto-import catalogue. */
export const AUTO_IMPORT_LISTINGS_PAGE_SIZE = 500;

/**
 * Safety bound: refuse rather than silently truncate if the catalogue is huge.
 * 100 × 500 = 50_000 rows — far above expected CEO auto-import inventory.
 */
export const AUTO_IMPORT_LISTINGS_MAX_PAGES = 100;

/**
 * Fetch every page until a short page signals completion.
 * Throws PLAN_CONTEXT_INCOMPLETE if the safety bound is hit (truncation refused).
 */
export async function fetchCompleteListingPages<T>(opts: {
  pageSize?: number;
  maxPages?: number;
  fetchPage: (offset: number, limit: number) => Promise<T[]>;
}): Promise<T[]> {
  const pageSize = opts.pageSize ?? AUTO_IMPORT_LISTINGS_PAGE_SIZE;
  const maxPages = opts.maxPages ?? AUTO_IMPORT_LISTINGS_MAX_PAGES;
  if (!(pageSize > 0) || !(maxPages > 0)) {
    throw new Error("PLAN_CONTEXT_FAILED: invalid pagination bounds");
  }

  const all: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * pageSize;
    const rows = await opts.fetchPage(offset, pageSize);
    if (!Array.isArray(rows)) {
      throw new Error("PLAN_CONTEXT_FAILED: listListings page returned non-array");
    }
    all.push(...rows);
    if (rows.length < pageSize) {
      return all;
    }
  }

  throw new Error(
    `PLAN_CONTEXT_INCOMPLETE: listing catalogue exceeds ${maxPages * pageSize} rows; refusing truncated planning context`,
  );
}
