import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DocumentPipelineError } from "./DocumentModels.ts";
import {
  assertChecksumMatches,
  CHECKSUM_ALGORITHM,
  checksumsMatch,
  computeChecksum,
  computeChecksumResult,
  verifyChecksum,
} from "./Checksum.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const contentA = Buffer.from("hello world");
const contentB = Buffer.from("hello world!");
const empty = Buffer.alloc(0);

check("CHECKSUM_ALGORITHM is sha256", CHECKSUM_ALGORITHM === "sha256");

check(
  "computeChecksum matches independent sha256 computation",
  computeChecksum(contentA) === createHash("sha256").update(contentA).digest("hex")
);
check("computeChecksum is deterministic for same content", computeChecksum(contentA) === computeChecksum(Buffer.from("hello world")));
check("computeChecksum differs for different content", computeChecksum(contentA) !== computeChecksum(contentB));
check("computeChecksum handles empty buffer without throwing", typeof computeChecksum(empty) === "string");
check("computeChecksum of empty buffer is the known sha256 empty hash", computeChecksum(empty) === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
check("computeChecksum output is 64 hex chars", computeChecksum(contentA).length === 64);
check("computeChecksum output is lowercase hex", /^[0-9a-f]{64}$/.test(computeChecksum(contentA)));
check("computeChecksum is sensitive to single-byte difference", computeChecksum(Buffer.from("a")) !== computeChecksum(Buffer.from("b")));
check("computeChecksum handles large buffer", computeChecksum(Buffer.alloc(1_000_000, 7)).length === 64);

check("computeChecksumResult reports algorithm", computeChecksumResult(contentA).algorithm === "sha256");
check("computeChecksumResult reports sizeBytes", computeChecksumResult(contentA).sizeBytes === contentA.byteLength);
check("computeChecksumResult value matches computeChecksum", computeChecksumResult(contentA).value === computeChecksum(contentA));

check("checksumsMatch true for identical strings", checksumsMatch("abc", "abc"));
check("checksumsMatch false for different strings", !checksumsMatch("abc", "abd"));
check("checksumsMatch false for different lengths", !checksumsMatch("abc", "abcd"));
check("checksumsMatch false for empty vs non-empty", !checksumsMatch("", "a"));
check("checksumsMatch true for two empty strings", checksumsMatch("", ""));

check("verifyChecksum true for matching content+checksum", verifyChecksum(contentA, computeChecksum(contentA)));
check("verifyChecksum false for mismatched checksum", !verifyChecksum(contentA, computeChecksum(contentB)));
check("verifyChecksum false for garbage checksum string", !verifyChecksum(contentA, "not-a-real-checksum"));

check(
  "assertChecksumMatches does not throw when matching",
  (() => {
    assertChecksumMatches(contentA, computeChecksum(contentA));
    return true;
  })()
);
check(
  "assertChecksumMatches throws DocumentPipelineError when mismatched",
  (() => {
    try {
      assertChecksumMatches(contentA, computeChecksum(contentB));
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError && e.stage === "checksum";
    }
  })()
);
check(
  "assertChecksumMatches error details include both checksums",
  (() => {
    try {
      assertChecksumMatches(contentA, "expected-value");
      return false;
    } catch (e) {
      return (
        e instanceof DocumentPipelineError &&
        e.details?.expectedChecksum === "expected-value" &&
        e.details?.actualChecksum === computeChecksum(contentA)
      );
    }
  })()
);

console.log(`\nChecksum tests: ${pass} passed`);
