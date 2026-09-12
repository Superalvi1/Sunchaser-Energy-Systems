import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TIKTOK_MB,
  TIKTOK_MIN_CHUNK_BYTES,
  TIKTOK_MAX_REGULAR_CHUNK_BYTES,
  TIKTOK_PREFERRED_CHUNK_BYTES,
  assertChunkPlan,
  contentRangeHeader,
  planTikTokFileUpload,
} from "../src/providers/tiktok/chunking.ts";

const CASES: Array<{ label: string; bytes: number }> = [
  { label: "2 MB", bytes: 2 * TIKTOK_MB },
  { label: "4.9 MB", bytes: Math.round(4.9 * TIKTOK_MB) },
  { label: "5 MB", bytes: 5 * TIKTOK_MB },
  { label: "5.1 MB", bytes: Math.round(5.1 * TIKTOK_MB) },
  { label: "10 MB", bytes: 10 * TIKTOK_MB },
  { label: "11 MB", bytes: 11 * TIKTOK_MB },
  { label: "49 MB", bytes: 49 * TIKTOK_MB },
  { label: "50 MB", bytes: 50 * TIKTOK_MB },
  { label: "51 MB", bytes: 51 * TIKTOK_MB },
  { label: "287.3 MB", bytes: Math.round(287.3 * TIKTOK_MB) },
  { label: "500 MB", bytes: 500 * TIKTOK_MB },
];

describe("TikTok chunk planner — required sizes", () => {
  for (const { label, bytes } of CASES) {
    it(`${label} (${bytes} bytes) satisfies TikTok coverage invariants`, () => {
      const plan = planTikTokFileUpload(bytes);
      const report = assertChunkPlan(plan);
      assert.equal(report.ok, true, report.errors.join("; "));
      assert.equal(plan.totalChunkCount, plan.ranges.length, "declared count must equal chunks sent");
      assert.equal(
        plan.totalChunkCount,
        Math.floor(plan.videoSize / plan.chunkSize),
        "total_chunk_count must equal floor(video_size/chunk_size)"
      );

      let covered = 0;
      for (let i = 0; i < plan.ranges.length; i += 1) {
        const r = plan.ranges[i]!;
        assert.equal(r.start, covered, `gap before chunk ${i}`);
        if (i > 0) {
          assert.ok(r.start > plan.ranges[i - 1]!.end, `overlap at chunk ${i}`);
        }
        covered = r.end + 1;
      }
      assert.equal(covered, bytes, "complete file coverage");

      const last = plan.ranges[plan.ranges.length - 1]!;
      if (plan.ranges.length > 1) {
        const remainder = bytes % plan.chunkSize;
        const expectedLast = remainder === 0 ? plan.chunkSize : plan.chunkSize + remainder;
        assert.equal(last.length, expectedLast, "last chunk must absorb remainder");
        assert.ok(last.length >= plan.chunkSize);
      }

      if (bytes < TIKTOK_MIN_CHUNK_BYTES) {
        assert.equal(plan.mode, "whole_file");
        assert.equal(plan.totalChunkCount, 1);
        assert.equal(plan.chunkSize, bytes);
      }
      if (bytes > TIKTOK_MAX_REGULAR_CHUNK_BYTES) {
        assert.ok(plan.totalChunkCount >= 2, "videos > 64MB must be multi-chunk");
      }
    });
  }

  it("matches TikTok official example: 50,000,123 bytes / 10,000,000 chunk_size → 5 chunks, last 10,000,123", () => {
    const plan = planTikTokFileUpload(50_000_123, 10_000_000);
    assert.equal(plan.chunkSize, 10_000_000);
    assert.equal(plan.totalChunkCount, 5);
    assert.equal(plan.ranges[4]!.length, 10_000_123);
    assert.equal(plan.ranges[0]!.length, 10_000_000);
    const report = assertChunkPlan(plan);
    assert.equal(report.ok, true, report.errors.join("; "));
    assert.equal(contentRangeHeader(plan.ranges[0]!, plan.videoSize), "bytes 0-9999999/50000123");
    assert.equal(contentRangeHeader(plan.ranges[4]!, plan.videoSize), "bytes 40000000-50000122/50000123");
  });

  it("uses preferred 10MB chunks when valid", () => {
    const plan = planTikTokFileUpload(200 * TIKTOK_MB);
    assert.equal(plan.chunkSize, TIKTOK_PREFERRED_CHUNK_BYTES);
    assert.equal(assertChunkPlan(plan).ok, true);
  });

  it("files just over 64MB still split into at least 2 chunks", () => {
    const size = TIKTOK_MAX_REGULAR_CHUNK_BYTES + 1;
    const plan = planTikTokFileUpload(size);
    assert.ok(plan.totalChunkCount >= 2);
    assert.equal(assertChunkPlan(plan).ok, true);
  });

  it("rejects non-positive and oversize files", () => {
    assert.throws(() => planTikTokFileUpload(0));
    assert.throws(() => planTikTokFileUpload(-1));
    assert.throws(() => planTikTokFileUpload(5 * 1024 * 1024 * 1024));
  });
});
