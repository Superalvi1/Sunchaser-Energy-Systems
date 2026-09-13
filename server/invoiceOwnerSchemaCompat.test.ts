import assert from "node:assert/strict";
import { isMissingInvoiceOwnerColumn } from "../invoiceDb.ts";

assert.equal(
  isMissingInvoiceOwnerColumn({
    code: "PGRST204",
    message: "Could not find the 'created_by_user_id' column of 'invoices' in the schema cache",
  }),
  true
);

assert.equal(
  isMissingInvoiceOwnerColumn({
    code: "PGRST204",
    message: "Could not find the 'created_by_user_id' column of 'delivery_challans' in the schema cache",
  }),
  false
);

assert.equal(
  isMissingInvoiceOwnerColumn({
    code: "42501",
    message: "permission denied for table invoices",
  }),
  false
);

console.log("invoice owner schema compatibility tests passed");
