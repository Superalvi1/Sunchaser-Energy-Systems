/**
 * TikTok Content Posting API FILE_UPLOAD chunk planner.
 *
 * Source of truth (TikTok Media Transfer Guide, last updated 2026-08-04):
 *
 * - total_chunk_count = floor(video_size / chunk_size)
 * - Each non-final chunk must be >= 5 MB and <= 64 MB
 * - The final chunk may exceed chunk_size (up to 128 MB) to absorb remainder
 * - Videos < 5 MB MUST be uploaded as a whole (chunk_size === video_size, count === 1)
 * - Videos > 64 MB MUST be uploaded in multiple chunks
 * - 1 <= total_chunk_count <= 1000
 * - Chunks uploaded sequentially
 * - Content-Range: bytes {FIRST}-{LAST}/{TOTAL}  (inclusive indexes)
 *
 * Byte unit: TikTok's own example uses 10_000_000 and 50_000_123, i.e. decimal MB.
 */

export const TIKTOK_MB = 1_000_000;
export const TIKTOK_MIN_CHUNK_BYTES = 5 * TIKTOK_MB;
export const TIKTOK_MAX_REGULAR_CHUNK_BYTES = 64 * TIKTOK_MB;
export const TIKTOK_MAX_FINAL_CHUNK_BYTES = 128 * TIKTOK_MB;
export const TIKTOK_MAX_CHUNKS = 1000;
/** Official cap is 4 GB. Use 4 GiB to stay inside the documented ceiling. */
export const TIKTOK_MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
export const TIKTOK_PREFERRED_CHUNK_BYTES = 10 * TIKTOK_MB;

export class TikTokChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TikTokChunkError";
  }
}

export type ByteRange = {
  index: number;
  /** Inclusive first byte. */
  start: number;
  /** Inclusive last byte. */
  end: number;
  length: number;
};

export type ChunkPlan = {
  videoSize: number;
  /** Declared source_info.chunk_size (non-final size, or whole-file size). */
  chunkSize: number;
  /** Declared source_info.total_chunk_count. */
  totalChunkCount: number;
  ranges: ByteRange[];
  mode: "whole_file" | "chunked";
};

export function planTikTokFileUpload(
  videoSize: number,
  preferredChunkSize: number = TIKTOK_PREFERRED_CHUNK_BYTES
): ChunkPlan {
  if (!Number.isInteger(videoSize) || videoSize <= 0) {
    throw new TikTokChunkError("video_size must be a positive integer");
  }
  if (videoSize > TIKTOK_MAX_VIDEO_BYTES) {
    throw new TikTokChunkError(
      `video_size ${videoSize} exceeds TikTok 4GB limit (${TIKTOK_MAX_VIDEO_BYTES})`
    );
  }

  if (videoSize < TIKTOK_MIN_CHUNK_BYTES) {
    return wholeFile(videoSize);
  }

  // Prefer an explicit valid multi-chunk plan (TikTok's own 50,000,123 / 10MB example
  // is legal even though the file is under 64MB). Whole-file remains the fallback
  // whenever preferred chunk_size would yield count === 1.
  if (isValidDeclaredChunkSize(videoSize, preferredChunkSize)) {
    return buildChunkedPlan(videoSize, preferredChunkSize);
  }

  if (videoSize <= TIKTOK_MAX_REGULAR_CHUNK_BYTES) {
    return wholeFile(videoSize);
  }

  const chunkSize = chooseChunkSize(videoSize, preferredChunkSize);
  return buildChunkedPlan(videoSize, chunkSize);
}

function wholeFile(videoSize: number): ChunkPlan {
  return {
    videoSize,
    chunkSize: videoSize,
    totalChunkCount: 1,
    ranges: [
      {
        index: 0,
        start: 0,
        end: videoSize - 1,
        length: videoSize,
      },
    ],
    mode: "whole_file",
  };
}

function chooseChunkSize(videoSize: number, preferred: number): number {
  const candidates = uniquePositive([
    clamp(preferred, TIKTOK_MIN_CHUNK_BYTES, TIKTOK_MAX_REGULAR_CHUNK_BYTES),
    TIKTOK_PREFERRED_CHUNK_BYTES,
    TIKTOK_MAX_REGULAR_CHUNK_BYTES,
    TIKTOK_MIN_CHUNK_BYTES,
    Math.floor(videoSize / 2),
    Math.ceil(videoSize / TIKTOK_MAX_CHUNKS),
  ]);

  for (const size of candidates) {
    if (isValidDeclaredChunkSize(videoSize, size)) return size;
  }

  for (let size = TIKTOK_MAX_REGULAR_CHUNK_BYTES; size >= TIKTOK_MIN_CHUNK_BYTES; size -= TIKTOK_MB) {
    if (isValidDeclaredChunkSize(videoSize, size)) return size;
  }

  throw new TikTokChunkError(
    `No valid TikTok chunk_size for video_size=${videoSize}`
  );
}

export function isValidDeclaredChunkSize(videoSize: number, chunkSize: number): boolean {
  if (!Number.isInteger(chunkSize)) return false;
  if (chunkSize < TIKTOK_MIN_CHUNK_BYTES || chunkSize > TIKTOK_MAX_REGULAR_CHUNK_BYTES) {
    return false;
  }
  const count = Math.floor(videoSize / chunkSize);
  if (count < 2 || count > TIKTOK_MAX_CHUNKS) return false;
  const lastLen = videoSize - (count - 1) * chunkSize;
  if (lastLen < TIKTOK_MIN_CHUNK_BYTES || lastLen > TIKTOK_MAX_FINAL_CHUNK_BYTES) {
    return false;
  }
  return true;
}

function buildChunkedPlan(videoSize: number, chunkSize: number): ChunkPlan {
  const totalChunkCount = Math.floor(videoSize / chunkSize);
  if (totalChunkCount !== Math.floor(videoSize / chunkSize)) {
    throw new TikTokChunkError("internal: count must equal floor(size/chunk_size)");
  }
  const ranges: ByteRange[] = [];
  let cursor = 0;
  for (let i = 0; i < totalChunkCount; i += 1) {
    const isLast = i === totalChunkCount - 1;
    const length = isLast ? videoSize - cursor : chunkSize;
    const start = cursor;
    const end = cursor + length - 1;
    ranges.push({ index: i, start, end, length });
    cursor += length;
  }
  return {
    videoSize,
    chunkSize,
    totalChunkCount,
    ranges,
    mode: "chunked",
  };
}

export type CoverageReport = {
  ok: boolean;
  errors: string[];
};

/**
 * Invariants the worker must satisfy before/after upload:
 * declared count equals ranges sent, no overlap, no gaps, full coverage,
 * last chunk absorbs remainder, small-video is a single whole-file PUT.
 */
export function assertChunkPlan(plan: ChunkPlan): CoverageReport {
  const errors: string[] = [];
  const { videoSize, chunkSize, totalChunkCount, ranges, mode } = plan;

  if (totalChunkCount !== ranges.length) {
    errors.push(
      `declared total_chunk_count ${totalChunkCount} !== ranges sent ${ranges.length}`
    );
  }
  if (totalChunkCount < 1 || totalChunkCount > TIKTOK_MAX_CHUNKS) {
    errors.push(`total_chunk_count ${totalChunkCount} outside 1..${TIKTOK_MAX_CHUNKS}`);
  }
  if (videoSize < TIKTOK_MIN_CHUNK_BYTES) {
    if (mode !== "whole_file" || totalChunkCount !== 1 || chunkSize !== videoSize) {
      errors.push("small-video must be a single whole-file upload (chunk_size === video_size)");
    }
  }
  if (videoSize > TIKTOK_MAX_REGULAR_CHUNK_BYTES && totalChunkCount < 2) {
    errors.push("videos > 64MB must be uploaded in multiple chunks");
  }
  if (totalChunkCount !== Math.floor(videoSize / chunkSize)) {
    errors.push(
      `total_chunk_count must equal floor(video_size/chunk_size); got ${totalChunkCount} vs ${Math.floor(videoSize / chunkSize)}`
    );
  }

  let covered = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    const r = ranges[i]!;
    if (r.index !== i) errors.push(`range index ${r.index} expected ${i}`);
    if (r.start !== covered) {
      errors.push(`gap or overlap at chunk ${i}: start ${r.start} expected ${covered}`);
    }
    if (r.end < r.start) errors.push(`chunk ${i} end < start`);
    if (r.length !== r.end - r.start + 1) {
      errors.push(`chunk ${i} length ${r.length} != end-start+1`);
    }
    if (i < ranges.length - 1) {
      if (r.length !== chunkSize) {
        errors.push(`non-final chunk ${i} length ${r.length} != declared chunk_size ${chunkSize}`);
      }
      if (r.length < TIKTOK_MIN_CHUNK_BYTES || r.length > TIKTOK_MAX_REGULAR_CHUNK_BYTES) {
        errors.push(`non-final chunk ${i} outside 5MB..64MB`);
      }
    } else {
      if (r.length < TIKTOK_MIN_CHUNK_BYTES && videoSize >= TIKTOK_MIN_CHUNK_BYTES) {
        errors.push(`final chunk too small: ${r.length}`);
      }
      if (r.length > TIKTOK_MAX_FINAL_CHUNK_BYTES) {
        errors.push(`final chunk ${r.length} exceeds 128MB`);
      }
      if (videoSize >= TIKTOK_MIN_CHUNK_BYTES && r.length < chunkSize && ranges.length > 1) {
        errors.push("final chunk must be >= chunk_size (remainder is absorbed, never a short last piece)");
      }
    }
    covered = r.end + 1;
  }

  if (covered !== videoSize) {
    errors.push(`coverage ${covered} !== video_size ${videoSize}`);
  }

  const sum = ranges.reduce((acc, r) => acc + r.length, 0);
  if (sum !== videoSize) errors.push(`sum(lengths) ${sum} !== video_size ${videoSize}`);

  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i]!.start <= ranges[i - 1]!.end) {
      errors.push(`overlap between chunk ${i - 1} and ${i}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function contentRangeHeader(range: ByteRange, videoSize: number): string {
  return `bytes ${range.start}-${range.end}/${videoSize}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function uniquePositive(values: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of values) {
    if (!Number.isFinite(v) || v <= 0) continue;
    const n = Math.floor(v);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
