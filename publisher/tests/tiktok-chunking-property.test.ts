import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TIKTOK_MB,
  TIKTOK_MAX_VIDEO_BYTES,
  TIKTOK_MIN_CHUNK_BYTES,
  TIKTOK_MAX_REGULAR_CHUNK_BYTES,
  assertChunkPlan,
  planTikTokFileUpload,
} from "../src/providers/tiktok/chunking.ts";

function sweepSizes(): number[] {
  const sizes = new Set<number>();
  for (let b = 1; b <= 20; b += 1) sizes.add(b);
  for (let mb = 1; mb <= 140; mb += 1) sizes.add(mb * TIKTOK_MB);
  for (const edge of [
    TIKTOK_MIN_CHUNK_BYTES - 1,
    TIKTOK_MIN_CHUNK_BYTES,
    TIKTOK_MIN_CHUNK_BYTES + 1,
    TIKTOK_MAX_REGULAR_CHUNK_BYTES - 1,
    TIKTOK_MAX_REGULAR_CHUNK_BYTES,
    TIKTOK_MAX_REGULAR_CHUNK_BYTES + 1,
    64 * TIKTOK_MB + 123,
    128 * TIKTOK_MB,
    128 * TIKTOK_MB + 1,
    287_300_000,
    500_000_000,
    1_000_000_000,
    2_000_000_000,
  ]) {
    sizes.add(edge);
  }
  for (let i = 0; i < 400; i += 1) {
    sizes.add(1 + Math.floor((i * 7_919_393) % (TIKTOK_MAX_VIDEO_BYTES - 1)));
  }
  return [...sizes].filter((n) => n > 0 && n <= TIKTOK_MAX_VIDEO_BYTES).sort((a, b) => a - b);
}

describe("TikTok chunk planner — property/sweep", () => {
  const sizes = sweepSizes();

  it(`covers ${sizes.length} file sizes without gaps, overlaps, or count drift`, () => {
    let checked = 0;
    for (const size of sizes) {
      const plan = planTikTokFileUpload(size);
      const report = assertChunkPlan(plan);
      assert.equal(report.ok, true, `size=${size}: ${report.errors.join("; ")}`);
      assert.equal(plan.totalChunkCount, plan.ranges.length);
      const sum = plan.ranges.reduce((acc, r) => acc + r.length, 0);
      assert.equal(sum, size);
      checked += 1;
    }
    assert.ok(checked >= 500, `expected a large sweep, got ${checked}`);
  });

  it("never uses Math.ceil for total_chunk_count (the classic TikTok off-by-one)", () => {
    const awkward = [50_000_123, 64_000_001, 10_000_001, 99_999_999, 123_456_789];
    for (const size of awkward) {
      const plan = planTikTokFileUpload(size, 10_000_000);
      const floored = Math.floor(size / plan.chunkSize);
      const ceiled = Math.ceil(size / plan.chunkSize);
      assert.equal(plan.totalChunkCount, floored);
      if (size % plan.chunkSize !== 0) {
        assert.notEqual(plan.totalChunkCount, ceiled);
      }
    }
  });
});
