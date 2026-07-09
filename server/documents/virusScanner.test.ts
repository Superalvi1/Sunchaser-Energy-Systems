import assert from "node:assert/strict";
import { buildUploadRequest, intakeUpload } from "./DocumentUpload.ts";
import { DocumentPipelineError } from "./DocumentModels.ts";
import {
  assertScanClean,
  createNullVirusScanner,
  createStaticVirusScanner,
  NULL_VIRUS_SCANNER,
  NullVirusScanner,
  StaticVirusScanner,
  VIRUS_SCANNER_NOT_IMPLEMENTED_MESSAGE,
} from "./VirusScanner.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const file = intakeUpload(buildUploadRequest());

check("NullVirusScanner reports clean", new NullVirusScanner().scan(file).status === "clean");
check("createNullVirusScanner returns a NullVirusScanner", createNullVirusScanner() instanceof NullVirusScanner);
check("NULL_VIRUS_SCANNER singleton reports clean", NULL_VIRUS_SCANNER.scan(file).status === "clean");
check("NullVirusScanner is deterministic across calls", new NullVirusScanner().scan(file).status === new NullVirusScanner().scan(file).status);
check("NullVirusScanner engine label present", new NullVirusScanner().scan(file).engine === "null-scanner");
check("NullVirusScanner message documents the placeholder", new NullVirusScanner().scan(file).message === VIRUS_SCANNER_NOT_IMPLEMENTED_MESSAGE);
check("NullVirusScanner scannedAt is a string", typeof new NullVirusScanner().scan(file).scannedAt === "string");

check(
  "assertScanClean does not throw for clean result",
  (() => {
    assertScanClean({ status: "clean", engine: "x", scannedAt: "t", message: "" });
    return true;
  })()
);

check(
  "assertScanClean throws DocumentPipelineError for infected",
  (() => {
    try {
      assertScanClean({ status: "infected", engine: "x", scannedAt: "t", message: "found", threatName: "EICAR" });
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError && e.stage === "virus_scan";
    }
  })()
);

check(
  "assertScanClean throws for error status",
  (() => {
    try {
      assertScanClean({ status: "error", engine: "x", scannedAt: "t", message: "scan failed" });
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError;
    }
  })()
);

check(
  "assertScanClean error carries threatName in details",
  (() => {
    try {
      assertScanClean({ status: "infected", engine: "x", scannedAt: "t", message: "m", threatName: "EICAR" });
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError && e.details?.threatName === "EICAR";
    }
  })()
);

check(
  "StaticVirusScanner returns configured infected result",
  new StaticVirusScanner({ status: "infected", engine: "test", scannedAt: "t", message: "m", threatName: "Trojan" }).scan().status ===
    "infected"
);
check(
  "StaticVirusScanner preserves threatName",
  new StaticVirusScanner({ status: "infected", engine: "test", scannedAt: "t", message: "m", threatName: "Trojan" }).scan()
    .threatName === "Trojan"
);
check(
  "createStaticVirusScanner returns configured error result",
  createStaticVirusScanner({ status: "error", engine: "test", scannedAt: "t", message: "boom" }).scan().status === "error"
);
check(
  "StaticVirusScanner is deterministic (same result every call)",
  (() => {
    const scanner = createStaticVirusScanner({ status: "clean", engine: "test", scannedAt: "t", message: "" });
    return scanner.scan().status === "clean" && scanner.scan().status === "clean";
  })()
);
check(
  "StaticVirusScanner + assertScanClean composes to throw on infected",
  (() => {
    const scanner = createStaticVirusScanner({ status: "infected", engine: "test", scannedAt: "t", message: "m", threatName: "X" });
    try {
      assertScanClean(scanner.scan());
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError;
    }
  })()
);

console.log(`\nVirusScanner tests: ${pass} passed`);
