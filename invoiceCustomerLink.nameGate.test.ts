import assert from "node:assert/strict";
import { test } from "node:test";
import { findExistingCustomerIdForLinking, resolveInvoiceCustomerId } from "./invoiceCustomerLink.ts";

// No Supabase configured in unit tests: the in-memory customer list is used.
const customers = () => ({
  customers: [
    { id: "cust-ahmed", name: "Ahmed Khan", phone: "923011234567", email: "ahmed@example.test" },
    { id: "cust-sana", name: "Sana Malik", phone: "0301-1234567", email: "sana@example.test" },
  ],
}) as any;

test("a phone shared by two clients resolves to the customer whose name matches", async () => {
  assert.equal(await findExistingCustomerIdForLinking({ phone: "03011234567", name: "Ms. Sana  Malik" }, customers()), "cust-sana");
  assert.equal(await findExistingCustomerIdForLinking({ phone: "+92 301 1234567", name: "AHMED KHAN" }, customers()), "cust-ahmed");
});

test("a phone match with a different buyer name is not used", async () => {
  assert.equal(await findExistingCustomerIdForLinking({ phone: "03011234567", name: "Different Buyer Pvt Ltd" }, customers()), null);
});

test("callers that supply no name keep the previous phone-only behaviour", async () => {
  assert.equal(await findExistingCustomerIdForLinking({ phone: "03011234567" }, customers()), "cust-ahmed");
});

test("e-mail and CNIC matching are unchanged", async () => {
  assert.equal(await findExistingCustomerIdForLinking({ phone: "03011234567", email: "SANA@example.test", name: "Different Buyer" }, customers()), "cust-sana");
});

test("a manual invoice for a different buyer on a known phone gets its own customer instead of the existing client's", async () => {
  const db = customers();
  const id = await resolveInvoiceCustomerId({ customerName: "Different Buyer Pvt Ltd", customerPhone: "0301-1234567" }, db);
  assert.ok(id && id !== "cust-ahmed" && id !== "cust-sana", `expected a new customer, got ${id}`);
  assert.equal(db.customers.length, 3);
  const same = await resolveInvoiceCustomerId({ customerName: "Ahmed Khan", customerPhone: "0301-1234567" }, db);
  assert.equal(same, "cust-ahmed");
});
