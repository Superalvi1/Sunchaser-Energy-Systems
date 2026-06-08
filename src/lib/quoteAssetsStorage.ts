import fs from "fs";
import path from "path";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import { getQuoteAssetPublicUrl } from "./quotePdfSettingsStore.ts";
import {
  QUOTE_ASSETS_BUCKET,
  QUOTE_WATERMARK_ALLOWED_MIME,
  QUOTE_WATERMARK_MAX_BYTES,
} from "./quoteAssetsConstants.ts";

export { QUOTE_ASSETS_BUCKET, QUOTE_WATERMARK_MAX_BYTES, QUOTE_WATERMARK_ALLOWED_MIME };

export type ParsedQuoteAssetUpload = {
  buffer: Buffer;
  contentType: string;
  extension: string;
};

export function parseQuoteAssetBase64Upload(base64Input: string): ParsedQuoteAssetUpload {
  const raw = String(base64Input || "").trim();
  if (!raw) throw new Error("Image data is required.");

  let contentType = "image/png";
  let base64Body = raw;
  const matches = raw.match(/^data:([A-Za-z0-9+/.-]+);base64,(.+)$/);
  if (matches) {
    contentType = matches[1].toLowerCase();
    base64Body = matches[2];
  }

  if (!QUOTE_WATERMARK_ALLOWED_MIME.has(contentType)) {
    throw new Error("Only PNG, JPG, and WEBP watermark images are allowed.");
  }

  const buffer = Buffer.from(base64Body, "base64");
  if (!buffer.length) throw new Error("Invalid image data.");
  if (buffer.length > QUOTE_WATERMARK_MAX_BYTES) {
    throw new Error("Watermark image must be 5MB or smaller.");
  }

  const extension =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : "jpg";

  return { buffer, contentType, extension };
}

async function ensureQuoteAssetsBucket() {
  if (!isSupabaseActive()) return;
  const supabase = getSupabase()!;
  try {
    await supabase.storage.createBucket(QUOTE_ASSETS_BUCKET, { public: true });
  } catch {
    /* bucket may already exist */
  }
}

export async function uploadQuoteWatermarkAsset(
  buffer: Buffer,
  contentType: string,
  extension: string,
  settingsId = "settings-1"
): Promise<{ globalWatermarkFile: string; publicUrl: string }> {
  const safeId = String(settingsId || "settings-1").replace(/[^a-zA-Z0-9_-]/g, "_");
  const storagePath = `watermarks/${safeId}-${Date.now()}.${extension}`;

  if (isSupabaseActive()) {
    await ensureQuoteAssetsBucket();
    const supabase = getSupabase()!;
    const { error } = await supabase.storage.from(QUOTE_ASSETS_BUCKET).upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });
    if (error) throw new Error(error.message);
    return {
      globalWatermarkFile: storagePath,
      publicUrl: getQuoteAssetPublicUrl(storagePath),
    };
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "quote-assets", "watermarks");
  fs.mkdirSync(uploadsDir, { recursive: true });
  const fileName = `${safeId}-${Date.now()}.${extension}`;
  const fullPath = path.join(uploadsDir, fileName);
  fs.writeFileSync(fullPath, buffer);
  const globalWatermarkFile = `watermarks/${fileName}`;
  return {
    globalWatermarkFile,
    publicUrl: getQuoteAssetPublicUrl(globalWatermarkFile),
  };
}

export async function deleteQuoteWatermarkAsset(storagePath: string): Promise<void> {
  const normalized = String(storagePath || "").trim().replace(/^\/+/, "");
  if (!normalized) return;

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { error } = await supabase.storage.from(QUOTE_ASSETS_BUCKET).remove([normalized]);
    if (error) throw new Error(error.message);
    return;
  }

  const fullPath = path.join(process.cwd(), "public", "uploads", "quote-assets", normalized);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
}
