import assert from "node:assert/strict";
import {
  barcodeMatchesSku,
  detectBarcodeFormat,
  GS1_APPLICATION_IDENTIFIERS,
  normalizeBarcodeInput,
  parseBarcode,
  parseEan13,
  parseGs1128,
  parseQrPayload,
} from "./BarcodeParser.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("normalizeBarcodeInput trims", normalizeBarcodeInput("  abc  ") === "abc");
check("detect EAN13", detectBarcodeFormat("1234567890123") === "ean13");
check("detect QR prefix", detectBarcodeFormat("QR:gtin=123") === "qr");
check("detect GS1 paren", detectBarcodeFormat("(01)09501101530003(10)LOT1") === "code128");

check("parseEan13 valid", parseEan13("1234567890123")?.format === "ean13");
check("parseEan13 invalid", parseEan13("123") === null);
check("parseEan13 gtin padded", parseEan13("1234567890123")?.applicationIdentifiers["01"]?.length === 14);

const gs1 = parseGs1128("(01)09501101530003(10)ABC123(21)SN001(17)251231");
check("GS1 parse format", gs1?.format === "code128");
check("GS1 gtin", gs1?.gtin === "09501101530003");
check("GS1 batch", gs1?.batchNumber === "ABC123");
check("GS1 serial", gs1?.serialNumber === "SN001");
check("GS1 expiry formatted", gs1?.expiryDate === "2025-12-31");

check("parseQrPayload", parseQrPayload("QR:gtin=123;serial=SN1;batch=B1")?.serialNumber === "SN1");
check("parseQrPayload batch", parseQrPayload("QR:gtin=123;serial=SN1;batch=B1")?.batchNumber === "B1");

check("parseBarcode routes EAN", parseBarcode("1234567890123").format === "ean13");
check("parseBarcode routes GS1", parseBarcode("(01)09501101530003(10)LOT").batchNumber === "LOT");
check("parseBarcode unknown", parseBarcode("random-code").format === "unknown");
check("parseBarcode empty", parseBarcode("").format === "unknown");

check("barcodeMatchesSku by gtin", barcodeMatchesSku(parseBarcode("(01)09501101530003(10)X"), undefined, "9501101530003"));
check("barcodeMatchesSku by raw", barcodeMatchesSku(parseBarcode("1234567890123"), "1234567890123", "SKU-X"));

check("GS1 AI 01 defined", GS1_APPLICATION_IDENTIFIERS["01"]?.label === "GTIN");
check("GS1 AI 10 defined", GS1_APPLICATION_IDENTIFIERS["10"]?.label === "BATCH");
check("GS1 AI 21 defined", GS1_APPLICATION_IDENTIFIERS["21"]?.label === "SERIAL");

console.log(`\nbarcodeParser.test.ts: ${pass} passed`);
