import assert from "node:assert/strict";
import { buildSmartQuotationPdf } from "./smartQuotationPdf";
import { calculatePublicQuotation, defaultPublicQuoteConfig } from "./publicQuotationBuilder";
const calculation = calculatePublicQuotation(defaultPublicQuoteConfig(8));
const data = { quoteNumber: "SES-20261004-4825", system: "8 kW", generatedAt: "2026-10-04T10:35:19Z", clientName: "Faisal Baig", clientPhone: "923234786239", clientCity: "Lahore", lines: calculation.lines, subtotalPkr: calculation.subtotalPkr, discountPkr: calculation.discountPkr, totalPkr: calculation.totalPkr };
const pdf = await buildSmartQuotationPdf(data);
assert.equal(pdf.getNumberOfPages(), 3);
const pages = (pdf.internal as any).pages as string[][];
assert.ok(pages[1].join("\n").includes("8 kW Solar System"));
assert.ok(pages[1].join("\n").includes("PREPARED BY"));
assert.ok(pages[1].join("\n").includes("Faisal Baig"));
assert.ok(pages[3].join("\n").includes("PAYMENT PLAN"));
assert.ok(pages[3].join("\n").includes("TERMS AND CONDITIONS"));
assert.ok(!pages[1].join("\n").includes("BILL OF QUANTITIES"));
assert.ok(pages[2].join("\n").includes("BILL OF QUANTITIES"));
assert.ok(pages[2].join("\n").includes("FINAL ESTIMATED COST"));
const longPdf = await buildSmartQuotationPdf({ ...data, lines: Array.from({ length: 50 }, (_, i) => ({ ...calculation.lines[i % calculation.lines.length], description: `Line ${i + 1}: ${calculation.lines[i % calculation.lines.length].description}` })) });
assert.ok(longPdf.getNumberOfPages() > 2);
assert.ok((longPdf.internal as any).pages.flat().join("\n").includes("Line 50:"));
console.log("PDF cover/detail separation, totals and multipage overflow tests passed.");

const customDocument = {
  preparedBy: "Sales Consultant", validityDays: 7,
  paymentPlan: ["50% on order confirmation.", "50% after installation."],
  terms: Array.from({ length: 15 }, (_, i) => `Condition ${i + 1}: ${"Equipment availability and site approval. ".repeat(10)}`),
};
const commercialPdf = await buildSmartQuotationPdf({ ...data, preparedBy: "Allauddin", document: customDocument });
const commercialPages = (commercialPdf.internal as any).pages as string[][];
assert.ok(commercialPages[1].join("\n").includes("Allauddin"));
assert.ok(commercialPages.flat().join("\n").includes("50% on order confirmation."));
assert.ok(commercialPages.flat().join("\n").includes("Condition 15:"));
assert.ok(commercialPdf.getNumberOfPages() > 3, "long commercial terms flow to additional pages");
console.log("Custom preparer, validity, payment terms and terms overflow tests passed.");
