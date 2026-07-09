/**
 * Phase 1B.2B technician ownership tests — run: npm run test:phase-1b2b
 */
import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import {
  TechnicianOwnershipError,
  TechnicianOwnershipResolver,
  assertAssigneeOwnedByActor,
  legacyAssigneeNameMatches,
  parseTechnicalJobId,
  readAssignedUserId,
} from "./TechnicianOwnershipResolver.ts";

const technicianActor: RequestActor = {
  id: "u-tech-1",
  username: "technician",
  name: "Dave Installer",
  email: "dave@sunchaser.com",
  role: "Technician",
  accountStatus: "Approved",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};

const otherTechnician: RequestActor = {
  ...technicianActor,
  id: "u-tech-2",
  username: "othertech",
  name: "Other Tech",
};

const surveyActor: RequestActor = {
  ...technicianActor,
  id: "u-surveyor",
  username: "surveyor",
  name: "Bob Surveyor",
  role: "Survey Engineer",
};

const mockDb = {
  users: [
    { id: "u-tech-1", username: "technician", name: "Dave Installer", role: "Technician" },
    { id: "u-surveyor", username: "surveyor", name: "Bob Surveyor", role: "Survey Engineer" },
  ],
  leads: [
    {
      id: "lead-1",
      name: "Customer A",
      status: "Contracted",
      survey: {},
      installation: { progress: 20 },
    },
    {
      id: "lead-2",
      name: "Customer B",
      status: "Contracted",
      survey: { completed: true },
      installation: { progress: 100 },
    },
  ],
  serviceRequests: [
    { id: "sr-1", assigned_user_id: "u-tech-1", assigned_technician: "Dave Installer", service_type: "Cleaning" },
    { id: "sr-2", assigned_user_id: "u-tech-2", assigned_technician: "Other Tech", service_type: "Inspection" },
    { id: "sr-legacy", assigned_technician: "Dave Installer", service_type: "Inspection" },
  ],
  tickets: [
    { id: "ticket-1", assigned_user_id: "u-tech-1", assigned_technician: "Dave Installer", status: "Open" },
    { id: "ticket-2", assigned_technician: "Other Tech", status: "Open" },
  ],
  warrantyClaims: [
    { id: "wc-1", status: "New", customer_id: "cust-1" },
    { id: "wc-2", status: "New", customer_id: "cust-2", ticket_id: "ticket-1" },
  ],
  projectDeliveries: [
    { id: "del-1", assigned_technician_user_id: "u-tech-1" },
    { id: "del-2", assigned_technician_user_id: "u-tech-2" },
    { id: "del-unassigned", assigned_technician_user_id: null },
  ],
} as any;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    failed += 1;
  }
}

await test("assertTechnicianActor returns actor id", () => {
  assert.equal(TechnicianOwnershipResolver.assertTechnicianActor(technicianActor), "u-tech-1");
});

await test("assertTechnicianActor rejects non-technical role", () => {
  assert.throws(
    () =>
      TechnicianOwnershipResolver.assertTechnicianActor({
        ...technicianActor,
        role: "Sales Executive",
      }),
    TechnicianOwnershipError
  );
});

await test("readAssignedUserId prefers durable user id fields", () => {
  assert.equal(readAssignedUserId({ assigned_user_id: "u-tech-1", assigned_technician: "Other" }), "u-tech-1");
  assert.equal(
    readAssignedUserId({ assigned_technician_user_id: "u-tech-1", assigned_technician: "Other" }),
    "u-tech-1"
  );
});

await test("assertAssigneeOwnedByActor matches durable user id", () => {
  assertAssigneeOwnedByActor(technicianActor, { assigned_user_id: "u-tech-1" });
});

await test("assertAssigneeOwnedByActor rejects mismatched user id", () => {
  assert.throws(
    () => assertAssigneeOwnedByActor(technicianActor, { assigned_user_id: "u-tech-2" }),
    TechnicianOwnershipError
  );
});

await test("legacyAssigneeNameMatches supports exact name or username only", () => {
  assert.equal(legacyAssigneeNameMatches(technicianActor, "Dave Installer"), true);
  assert.equal(legacyAssigneeNameMatches(technicianActor, "technician"), true);
  assert.equal(legacyAssigneeNameMatches(technicianActor, "Other Tech"), false);
  assert.equal(legacyAssigneeNameMatches(technicianActor, "Dave"), false);
  assert.equal(legacyAssigneeNameMatches(technicianActor, "Installer"), false);
});

await test("assertAssigneeOwnedByActor falls back to legacy name when user id absent", () => {
  assertAssigneeOwnedByActor(technicianActor, { assigned_technician: "Dave Installer" });
  assert.throws(
    () => assertAssigneeOwnedByActor(technicianActor, { assigned_technician: "Other Tech" }),
    TechnicianOwnershipError
  );
});

await test("parseTechnicalJobId recognizes supported job prefixes", () => {
  assert.deepEqual(parseTechnicalJobId("lead-surv-lead-1"), { kind: "survey", leadId: "lead-1" });
  assert.deepEqual(parseTechnicalJobId("lead-inst-lead-1"), { kind: "installation", leadId: "lead-1" });
  assert.deepEqual(parseTechnicalJobId("svc-sr-1"), { kind: "service_request", id: "sr-1" });
  assert.deepEqual(parseTechnicalJobId("sup-ticket-1"), { kind: "support_ticket", id: "ticket-1" });
  assert.equal(parseTechnicalJobId("war-wc-1"), null);
});

await test("assertResourceOwnedByActor service_request uses user id", async () => {
  await TechnicianOwnershipResolver.assertResourceOwnedByActor(
    technicianActor,
    "service_request",
    "sr-1",
    mockDb
  );
  try {
    await TechnicianOwnershipResolver.assertResourceOwnedByActor(
      technicianActor,
      "service_request",
      "sr-2",
      mockDb
    );
    assert.fail("expected TechnicianOwnershipError");
  } catch (err) {
    assert.ok(err instanceof TechnicianOwnershipError);
    assert.equal(err.statusCode, 403);
  }
});

await test("assertResourceOwnedByActor support_ticket enforces assignee", async () => {
  await TechnicianOwnershipResolver.assertResourceOwnedByActor(
    technicianActor,
    "support_ticket",
    "ticket-1",
    mockDb
  );
  try {
    await TechnicianOwnershipResolver.assertResourceOwnedByActor(
      technicianActor,
      "support_ticket",
      "ticket-2",
      mockDb
    );
    assert.fail("expected TechnicianOwnershipError");
  } catch (err) {
    assert.ok(err instanceof TechnicianOwnershipError);
  }
});

await test("assertResourceOwnedByActor delivery_record requires durable user id", async () => {
  await TechnicianOwnershipResolver.assertResourceOwnedByActor(
    technicianActor,
    "delivery_record",
    "del-1",
    mockDb
  );
  for (const id of ["del-2", "del-unassigned"]) {
    try {
      await TechnicianOwnershipResolver.assertResourceOwnedByActor(
        technicianActor,
        "delivery_record",
        id,
        mockDb
      );
      assert.fail(`expected denial for ${id}`);
    } catch (err) {
      assert.ok(err instanceof TechnicianOwnershipError);
    }
  }
});

await test("assertResourceOwnedByActor survey requires Survey Engineer role", async () => {
  await TechnicianOwnershipResolver.assertResourceOwnedByActor(surveyActor, "survey", "lead-1", mockDb);
  try {
    await TechnicianOwnershipResolver.assertResourceOwnedByActor(technicianActor, "survey", "lead-1", mockDb);
    assert.fail("expected TechnicianOwnershipError");
  } catch (err) {
    assert.ok(err instanceof TechnicianOwnershipError);
  }
});

await test("assertResourceOwnedByActor installation_job requires Installation Team role", async () => {
  const installer: RequestActor = {
    ...technicianActor,
    id: "u-installer",
    role: "Installation Team",
    name: "Install Crew",
  };
  await TechnicianOwnershipResolver.assertResourceOwnedByActor(
    installer,
    "installation_job",
    "lead-1",
    mockDb
  );
  try {
    await TechnicianOwnershipResolver.assertResourceOwnedByActor(
      technicianActor,
      "installation_job",
      "lead-1",
      mockDb
    );
    assert.fail("expected TechnicianOwnershipError");
  } catch (err) {
    assert.ok(err instanceof TechnicianOwnershipError);
  }
});

await test("assertTechnicalJobOwnedByActor allows assigned service job", async () => {
  await TechnicianOwnershipResolver.assertTechnicalJobOwnedByActor(
    technicianActor,
    "svc-sr-legacy",
    mockDb
  );
});

await test("assertTechnicalJobOwnedByActor denies unassigned service job", async () => {
  try {
    await TechnicianOwnershipResolver.assertTechnicalJobOwnedByActor(
      technicianActor,
      "svc-sr-2",
      mockDb
    );
    assert.fail("expected TechnicianOwnershipError");
  } catch (err) {
    assert.ok(err instanceof TechnicianOwnershipError);
    assert.equal(err.statusCode, 403);
  }
});

await test("assertAssigneeOwnedByActor rejects stale legacy when durable user id points elsewhere", () => {
  assert.throws(
    () =>
      assertAssigneeOwnedByActor(technicianActor, {
        assigned_user_id: "u-tech-2",
        assigned_technician: "Dave Installer",
      }),
    TechnicianOwnershipError
  );
});

await test("filterOwnedTechnicalJobs keeps only owned service and ticket jobs", async () => {
  const candidates = [
    { id: "svc-sr-1", status: "Assigned" },
    { id: "svc-sr-2", status: "Assigned" },
    { id: "sup-ticket-1", status: "Open" },
    { id: "sup-ticket-2", status: "Open" },
  ];
  const owned = await TechnicianOwnershipResolver.filterOwnedTechnicalJobs(
    technicianActor,
    candidates,
    mockDb
  );
  assert.deepEqual(
    owned.map((job) => job.id).sort(),
    ["svc-sr-1", "sup-ticket-1"].sort()
  );
});

await test("assertTechnicalJobOwnedByActor denies warranty jobs until durable assignee exists", async () => {
  try {
    await TechnicianOwnershipResolver.assertTechnicalJobOwnedByActor(
      technicianActor,
      "war-wc-1",
      mockDb
    );
    assert.fail("expected TechnicianOwnershipError");
  } catch (err) {
    assert.ok(err instanceof TechnicianOwnershipError);
    assert.equal(err.statusCode, 403);
  }
});

console.log(`\nPhase 1B.2B tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
