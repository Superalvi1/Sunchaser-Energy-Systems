import assert from "node:assert/strict";
import type { RejectLedgerEntry } from "../catalogueManager/catalogueManagerTypes.ts";
import { createDailyPriceSyncRejectLedger } from "./dailyPriceSyncRejectLedger.ts";

function entry(id: string): RejectLedgerEntry {
  return {
    runId: "mpair_test",
    supplier: "kamal",
    reason: "price_only_untracked_listing",
    sourceKey: `kamal:${id}`,
    supplierProductId: id,
    canonicalUrl: `https://kamalsolar.pk/products/${id}`,
    title: `Rejected ${id}`,
    identityKey: `separate:kamal:kamal:${id}`,
    stage: "import",
    detail: {},
  };
}

{
  const recorded: RejectLedgerEntry[] = [];
  const ledger = createDailyPriceSyncRejectLedger({
    async recordReject(value) {
      recorded.push(value);
    },
  });

  await ledger.sink.record(entry("one"));
  await ledger.sink.record(entry("two"));

  assert.equal(recorded.length, 2);
  assert.deepEqual(ledger.stats, { attempted: 2, recorded: 2, failed: 0 });
  assert.equal(ledger.isComplete(2), true);
  assert.equal(ledger.isComplete(1), false);
}

console.log("ok - daily reject ledger proves complete durable recording");

{
  const ledger = createDailyPriceSyncRejectLedger({
    async recordReject() {
      throw new Error("database unavailable");
    },
  });

  await assert.rejects(() => ledger.sink.record(entry("failed")));
  assert.deepEqual(ledger.stats, { attempted: 1, recorded: 0, failed: 1 });
  assert.equal(ledger.isComplete(1), false);
}

console.log("ok - daily reject ledger fails closed on incomplete recording");
