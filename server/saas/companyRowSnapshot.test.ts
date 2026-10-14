import test from "node:test";
import assert from "node:assert/strict";
import { describeSnapshotDiff, diffRowSnapshots, snapshotRowTotal, snapshotsIdentical, type RowSnapshot } from "./companyBackup.ts";

const snap = (): RowSnapshot => ({
  tables: {
    leads: { pk: ["id"], rows: { "lead-1": "h1", "lead-2": "h2" } },
    invoice_items: { pk: ["id"], rows: { "item-1": "i1", "item-2": "i2", "item-3": "i3" } },
    activity_logs: { pk: ["id"], rows: {} },
  },
  objects: { "customer-documents/c/co_a/x.pdf": "o1" },
});
const clone = (s: RowSnapshot): RowSnapshot => JSON.parse(JSON.stringify(s));

test("identical snapshots: no difference of any kind", () => {
  const d = diffRowSnapshots(snap(), snap());
  assert.ok(snapshotsIdentical(d));
  assert.equal(describeSnapshotDiff(d), "identical");
  assert.equal(snapshotRowTotal(snap()), 5);
});

test("a single missing row is named, with its table and primary key, and fails the comparison", () => {
  const a = clone(snap()); delete a.tables.invoice_items.rows["item-2"];
  const d = diffRowSnapshots(snap(), a);
  assert.deepEqual(d.missing, ["invoice_items: item-2"]);
  assert.deepEqual([d.added, d.changed], [[], []]);
  assert.ok(!snapshotsIdentical(d));
  assert.deepEqual(d.counts.find((c) => c.table === "invoice_items"), { table: "invoice_items", before: 3, after: 2 });
});

test("a row added, and a row whose content changed with the same key, are each named", () => {
  const a = clone(snap()); a.tables.leads.rows["lead-3"] = "h3"; a.tables.leads.rows["lead-1"] = "CHANGED";
  const d = diffRowSnapshots(snap(), a);
  assert.deepEqual(d.added, ["leads: lead-3"]);
  assert.deepEqual(d.changed, ["leads: lead-1"]);
  assert.ok(!snapshotsIdentical(d));
});

test("a row in a table that had none (activity log) is an addition; a vanished table's rows are missing", () => {
  const a = clone(snap()); a.tables.activity_logs.rows["log-9"] = "l9"; delete a.tables.leads;
  const d = diffRowSnapshots(snap(), a);
  assert.deepEqual(d.added, ["activity_logs: log-9"]);
  assert.deepEqual(d.missing.sort(), ["leads: lead-1", "leads: lead-2"]);
});

test("stored objects are compared too: a missing, an extra and an altered object", () => {
  const a = clone(snap()); a.objects["customer-documents/c/co_a/x.pdf"] = "ALTERED"; a.objects["quote-assets/c/co_a/y.png"] = "o2";
  const d = diffRowSnapshots(snap(), a);
  assert.deepEqual(d.changed, ["object: customer-documents/c/co_a/x.pdf"]);
  assert.deepEqual(d.added, ["object: quote-assets/c/co_a/y.png"]);
  const b = clone(snap()); b.objects = {};
  assert.deepEqual(diffRowSnapshots(snap(), b).missing, ["object: customer-documents/c/co_a/x.pdf"]);
});

test("the description lists the first entries and says how many there are", () => {
  const b = snap(); const a = clone(b);
  for (let i = 0; i < 10; i++) b.tables.leads.rows[`x${i}`] = "h";
  const text = describeSnapshotDiff(diffRowSnapshots(b, a), 3);
  assert.match(text, /^10 missing: leads: x0; leads: x1; leads: x2; \.\.\./);
});
