import assert from "node:assert/strict";
import { authenticateUser, registerUser, backfillUnlinkedClientUsers } from "./userAuthDb.ts";
import { hashPassword } from "./src/lib/passwordHash.ts";

function emptyDb() {
  return {
    users: [] as any[],
    customers: [] as any[],
    leads: [] as any[],
    tickets: [],
    netMeteringHistory: [],
    inventory: [],
    projects: [],
    netMeteringTrackers: {},
    paymentTracks: {},
    activityLogs: [],
  };
}

const db = emptyDb();
const registered = await registerUser(
  {
    username: "hassan",
    password: "HassanPass123!",
    name: "Hassan",
    email: "hassan@example.com",
    role: "Customer",
    phone: "03001234567",
  },
  db as any
);

assert.equal(registered.user.role, "Customer");
assert.ok(registered.user.customerId);
assert.equal(db.customers.length, 1);
assert.equal(db.customers[0].user_id, registered.user.id);
assert.equal(db.leads.length, 1);
assert.equal(db.leads[0].customer_id, registered.user.customerId);
console.log("ok - self-register creates user + customer + lead");

const again = await registerUser(
  {
    username: "hassan2",
    password: "HassanPass123!",
    name: "Hassan Two",
    email: "hassan.two@example.com",
    role: "Customer",
    phone: "03001234567",
  },
  db as any
);
assert.equal(db.customers.length, 2);
assert.notEqual(again.user.customerId, registered.user.customerId);
assert.equal(db.leads.length, 2);
console.log("ok - already-linked customer is not stolen by a second user with the same phone");

const reuseDb = emptyDb();
reuseDb.customers.push({
  id: "cust-existing",
  name: "Existing",
  email: "reuse@example.com",
  phone: "03009998888",
  user_id: null,
});
reuseDb.leads.push({
  id: "lead-existing",
  customer_id: "cust-existing",
  name: "Existing",
  email: "reuse@example.com",
  phone: "03009998888",
  address: "Lahore",
});
const reused = await registerUser(
  {
    username: "reuse.client",
    password: "HassanPass123!",
    name: "Reuse Client",
    email: "reuse@example.com",
    role: "Customer",
    phone: "03009998888",
  },
  reuseDb as any
);
assert.equal(reused.user.customerId, "cust-existing");
assert.equal(reuseDb.customers.length, 1);
assert.equal(reuseDb.leads.length, 1);
assert.equal(reuseDb.customers[0].user_id, reused.user.id);
console.log("ok - unlinked customer and lead are reused instead of duplicated");

await assert.rejects(
  () =>
    registerUser(
      {
        username: "hassan",
        password: "HassanPass123!",
        name: "Hassan",
        email: "hassan-dup@example.com",
        role: "Customer",
      },
      db as any
    ),
  /Username already taken/
);
console.log("ok - duplicate username is rejected");

const orphanDb = emptyDb();
orphanDb.users.push({
  id: "u-orphan",
  username: "orphan",
  password: "x",
  name: "Orphan Client",
  email: "orphan@example.com",
  role: "Customer",
  account_status: "Approved",
  email_verified: true,
});
const backfilled = await backfillUnlinkedClientUsers(orphanDb as any);
assert.equal(backfilled.length, 1);
assert.ok(backfilled[0].customerId);
assert.ok(backfilled[0].leadId);
assert.equal(orphanDb.customers.length, 1);
assert.equal(orphanDb.leads.length, 1);
console.log("ok - backfill provisions Hassan-style orphan customer users");

const loginDb = emptyDb();
loginDb.users.push({
  id: "u-hassan-login",
  username: "hassanlogin",
  password: hashPassword("HassanPass123!"),
  name: "Hassan",
  email: "hassan.login@example.com",
  role: "Customer",
  account_status: "Approved",
  email_verified: true,
});
const loggedIn = await authenticateUser("hassanlogin", "HassanPass123!", loginDb as any);
assert.ok(loggedIn.customerId);
assert.equal(loginDb.customers.length, 1);
assert.equal(loginDb.leads.length, 1);
console.log("ok - login backfills a missing CRM profile");

const stealDb = emptyDb();
stealDb.customers.push({
  id: "cust-taken",
  name: "Other Owner",
  email: "owner@example.com",
  phone: "03111111111",
  user_id: "u-other",
});
stealDb.users.push({
  id: "u-hassan-stale",
  username: "hassanstale",
  password: "x",
  name: "Hassan Stale",
  email: "hassan.stale@example.com",
  role: "Customer",
  customer_id: "cust-taken",
  account_status: "Approved",
  email_verified: true,
});
const repaired = await backfillUnlinkedClientUsers(stealDb as any);
assert.equal(repaired.length, 1);
assert.notEqual(repaired[0].customerId, "cust-taken");
assert.equal(stealDb.customers.find((c: any) => c.id === "cust-taken")?.user_id, "u-other");
assert.equal(stealDb.customers.length, 2);
assert.equal(stealDb.leads.length, 1);
assert.equal(stealDb.leads[0].customer_id, repaired[0].customerId);
console.log("ok - stale customer_id does not steal another user's customer");

const isolationDb = emptyDb();
const first = await registerUser(
  {
    username: "client.a",
    password: "HassanPass123!",
    name: "Client A",
    email: "client.a@example.com",
    role: "Customer",
    phone: "03001110001",
  },
  isolationDb as any
);
const second = await registerUser(
  {
    username: "client.b",
    password: "HassanPass123!",
    name: "Client B",
    email: "client.b@example.com",
    role: "Customer",
    phone: "03001110002",
  },
  isolationDb as any
);
assert.notEqual(first.user.customerId, second.user.customerId);
assert.equal(isolationDb.leads.filter((l: any) => l.customer_id === first.user.customerId).length, 1);
assert.equal(isolationDb.leads.filter((l: any) => l.customer_id === second.user.customerId).length, 1);
console.log("ok - two clients stay isolated on customer and lead rows");

console.log("userAuthDb client-link tests passed");
