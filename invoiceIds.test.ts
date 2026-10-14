import test from "node:test";
import assert from "node:assert/strict";
import { newInvoiceCustomerId, newInvoiceId, newInvoiceItemId } from "./invoiceIds.ts";

// The previous ids were built from the clock alone. Freeze the clock to ONE millisecond (the situation of two requests arriving together).
const frozen = <T>(fn: () => T): T => { const real = Date.now; Date.now = () => 1_700_000_000_000; try { return fn(); } finally { Date.now = real; } };

test("regression: the old clock-only format collides inside one millisecond (this is the defect)", () => {
  const old = () => frozen(() => `inv-${Date.now()}`);
  assert.equal(old(), old());
});

test("ids made in the same millisecond are all different: 20 000 invoice ids, item ids and customer ids", () => {
  frozen(() => {
    for (const make of [newInvoiceId, () => newInvoiceItemId(0), newInvoiceCustomerId]) {
      const seen = new Set<string>();
      for (let i = 0; i < 20_000; i++) seen.add(make());
      assert.equal(seen.size, 20_000);
    }
  });
});

test("ids keep their readable prefix and timestamp, and item ids keep the line position", () => {
  frozen(() => {
    assert.match(newInvoiceId(), /^inv-1700000000000-[0-9a-f]{12}$/);
    assert.match(newInvoiceItemId(3), /^item-1700000000000-3-[0-9a-f]{12}$/);
    assert.match(newInvoiceCustomerId(), /^cust-inv-1700000000000-[0-9a-f]{12}$/);
  });
});
