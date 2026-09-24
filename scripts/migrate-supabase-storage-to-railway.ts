import {
  isRailwayObjectStorageConfigured,
  putRailwayObject,
} from "../server/storage/railwayObjectStorage.ts";

const SOURCE_ORIGIN = "https://xxtdfvgkurxabpbmjban.supabase.co";

const manifest = [
  { namespace: "customer-documents" as const, key: "cust-101/1780719695995_verify-upload.pdf", size: 220, mime: "application/pdf" },
  { namespace: "customer-documents" as const, key: "cust-1780604494102/1780606835461_verify-quotation.pdf", size: 335, mime: "application/pdf" },
  { namespace: "customer-documents" as const, key: "cust-1780604494102/1780607934950_verify-quotation.pdf", size: 335, mime: "application/pdf" },
  { namespace: "customer-documents" as const, key: "cust-1780850560339/1780870384905_10kw_hybrid_31may_ad.pdf", size: 5801098, mime: "application/pdf" },
  { namespace: "customer-documents" as const, key: "cust-1780850560339/1780932316665_verify-upload.pdf", size: 220, mime: "application/pdf" },
  { namespace: "customer-documents" as const, key: "cust-1789646179053/1789927488888_zohra_hassan_tech_society.pdf", size: 5276078, mime: "application/pdf" },
  { namespace: "customer-documents" as const, key: "cust-1789646179053/1789927754482_zohra_hassan_tech_society.pdf", size: 5276078, mime: "application/pdf" },
  { namespace: "customer-documents" as const, key: "cust-1789646179053/1789927771262_zohra_hassan.pdf", size: 517541, mime: "application/pdf" },
  { namespace: "quote-assets" as const, key: "watermarks/settings-1-1780918970791.png", size: 1105866, mime: "image/png" },
  { namespace: "quote-assets" as const, key: "watermarks/settings-1-1781373750953.png", size: 1105866, mime: "image/png" },
] as const;

async function main() {
  if (process.env.CONFIRM_RAILWAY_STORAGE_MIGRATION !== "2026-09-24-sunchaser") {
    throw new Error("Refusing storage migration without exact confirmation value.");
  }
  if (!isRailwayObjectStorageConfigured()) {
    throw new Error("Railway object storage credentials are not configured.");
  }

  let copied = 0;
  let bytes = 0;
  for (const item of manifest) {
    const sourceUrl =
      `${SOURCE_ORIGIN}/storage/v1/object/public/${item.namespace}/` +
      item.key.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(sourceUrl, { redirect: "error" });
    if (!res.ok) {
      throw new Error(`Source object fetch failed (HTTP ${res.status}).`);
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.byteLength !== item.size) {
      throw new Error(
        `Source object size changed; expected ${item.size}, got ${body.byteLength}. Refresh manifest before migration.`,
      );
    }
    const contentType = res.headers.get("content-type")?.split(";")[0] || item.mime;
    await putRailwayObject(item.namespace, item.key, body, contentType);
    copied += 1;
    bytes += body.byteLength;
  }

  const expectedBytes = manifest.reduce((sum, item) => sum + item.size, 0);
  if (copied !== manifest.length || bytes !== expectedBytes) {
    throw new Error("Storage migration verification failed.");
  }
  console.log(`RAILWAY_STORAGE_MIGRATION_COMPLETE objects=${copied} bytes=${bytes}`);
}

main().catch((err) => {
  console.error("RAILWAY_STORAGE_MIGRATION_FAILED", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
