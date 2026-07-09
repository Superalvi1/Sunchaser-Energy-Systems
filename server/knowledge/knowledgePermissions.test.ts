import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import { createKnowledgeDocument } from "./KnowledgeDocument.ts";
import { createKnowledgeDocumentMetadata } from "./KnowledgeMetadata.ts";
import { isKnowledgeVisibility } from "./KnowledgeModels.ts";
import {
  assertKnowledgeReadAccess,
  canActorDeleteKnowledgeDocument,
  canActorReadKnowledgeDocument,
  canActorWriteKnowledgeDocument,
  evaluateKnowledgePermission,
  KnowledgePermissionError,
  knowledgeLinkedResourceToDomain,
} from "./KnowledgePermissions.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function actor(overrides: Partial<RequestActor> = {}): RequestActor {
  return {
    id: "user-1",
    username: "alice",
    name: "Alice",
    email: "alice@test.com",
    role: "Sales Executive",
    accountStatus: "Active",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
    ...overrides,
  };
}

function doc(overrides: Parameters<typeof createKnowledgeDocument>[0] extends infer T ? Partial<T> : never = {}) {
  return createKnowledgeDocument({
    id: "doc-1",
    title: "Quote PDF",
    collection: "Sales",
    owner: "user-1",
    visibility: "company",
    department: "Sales",
    companyId: "c1",
    tags: [],
    mimeType: "application/pdf",
    checksum: "x",
    language: "en",
    source: "upload",
    status: "active",
    ...overrides,
  });
}

check("undefined actor cannot read", !canActorReadKnowledgeDocument(undefined, doc()));
check("sales staff can read company-visible sales document", canActorReadKnowledgeDocument(actor(), doc()));
check("admin bypass can read finance collection", canActorReadKnowledgeDocument(actor({ role: "Admin", id: "admin-1" }), doc({ collection: "Finance", owner: "other" })));
check("director bypass can read finance collection", canActorReadKnowledgeDocument(actor({ role: "Director", id: "dir-1" }), doc({ collection: "Finance", owner: "other" })));
check("accounts manager can read finance collection", canActorReadKnowledgeDocument(actor({ role: "Accounts Manager", id: "acc-1" }), doc({ collection: "Finance", owner: "other" })));
check("sales staff can read finance collection via invoice route access (existing resolver)", canActorReadKnowledgeDocument(actor(), doc({ collection: "Finance", owner: "other" })));

check(
  "private document readable only by owner",
  canActorReadKnowledgeDocument(actor({ id: "user-1" }), doc({ visibility: "private" })) &&
    !canActorReadKnowledgeDocument(actor({ id: "user-2" }), doc({ visibility: "private", owner: "user-1" }))
);

check(
  "department visibility allows same department",
  canActorReadKnowledgeDocument(actor({ id: "user-2", role: "Sales Executive" }), doc({ visibility: "department", owner: "user-1" }), {}, "Sales")
);

check(
  "department visibility denies different department",
  !canActorReadKnowledgeDocument(actor({ id: "user-2" }), doc({ visibility: "department", owner: "user-1" }), {}, "Finance")
);

check(
  "role_restricted visibility allows listed role",
  canActorReadKnowledgeDocument(
    actor({ role: "Accounts Manager", id: "acc-1" }),
    doc({ visibility: "role_restricted", collection: "General", owner: "other" }),
    { metadata: createKnowledgeDocumentMetadata({ documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 1, allowedRoles: ["Accounts Manager"] }) }
  )
);

check(
  "customer_scoped document readable by matching customer",
  canActorReadKnowledgeDocument(
    actor({ role: "Customer", id: "cust-user", customerId: "cust-1" }),
    doc({ visibility: "customer_scoped", collection: "Customers" }),
    { metadata: createKnowledgeDocumentMetadata({ documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 1, linkedResource: { type: "customer", id: "cust-1", customerId: "cust-1" } }) }
  )
);

check(
  "customer_scoped document denied for wrong customer",
  !canActorReadKnowledgeDocument(
    actor({ role: "Customer", id: "cust-user", customerId: "cust-1" }),
    doc({ visibility: "customer_scoped", collection: "Customers" }),
    { metadata: createKnowledgeDocumentMetadata({ documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 1, linkedResource: { type: "customer", id: "cust-2", customerId: "cust-2" } }) }
  )
);

check(
  "technician can read assigned support document",
  canActorReadKnowledgeDocument(
    actor({ role: "Technician", id: "tech-1" }),
    doc({ collection: "Support" }),
    { linkedResourceRow: { assigned_user_id: "tech-1" } }
  )
);

check(
  "technician denied unassigned support linked resource",
  !canActorReadKnowledgeDocument(
    actor({ role: "Technician", id: "tech-1" }),
    doc({ collection: "Support" }),
    { linkedResourceRow: { assigned_user_id: "tech-2" } }
  )
);

check(
  "sales ownership enforced on linked lead",
  canActorReadKnowledgeDocument(
    actor({ role: "Sales Executive", id: "sales-1" }),
    doc({ collection: "Sales" }),
    { linkedResourceRow: { assigned_sales_user_id: "sales-1" } }
  ) &&
    !canActorReadKnowledgeDocument(
      actor({ role: "Sales Executive", id: "sales-2" }),
      doc({ collection: "Sales" }),
      { linkedResourceRow: { assigned_sales_user_id: "sales-1" } }
    )
);

check("deleted document read denied", !canActorReadKnowledgeDocument(actor(), doc({ status: "deleted" })));
check("owner can write own document", canActorWriteKnowledgeDocument(actor({ id: "user-1" }), doc({ owner: "user-1" })));
check("non-owner sales staff cannot write others document", !canActorWriteKnowledgeDocument(actor({ id: "user-2" }), doc({ owner: "user-1" })));
check("admin can write any document", canActorWriteKnowledgeDocument(actor({ role: "Admin", id: "admin-1" }), doc({ owner: "user-1" })));
check("owner can delete own document", canActorDeleteKnowledgeDocument(actor({ id: "user-1" }), doc({ owner: "user-1" })));
check("non-owner non-admin cannot delete", !canActorDeleteKnowledgeDocument(actor({ id: "user-2" }), doc({ owner: "user-1" })));
check("admin can delete any document", canActorDeleteKnowledgeDocument(actor({ role: "Admin", id: "admin-1" }), doc({ owner: "user-1" })));

check(
  "assertKnowledgeReadAccess throws KnowledgePermissionError when denied",
  (() => {
    try {
      assertKnowledgeReadAccess(undefined, doc());
      return false;
    } catch (e) {
      return e instanceof KnowledgePermissionError && e.statusCode === 403;
    }
  })()
);

check("knowledgeLinkedResourceToDomain maps invoice to finance", knowledgeLinkedResourceToDomain({ type: "invoice", id: "i1" }) === "finance");
check("knowledgeLinkedResourceToDomain maps lead to sales", knowledgeLinkedResourceToDomain({ type: "lead", id: "l1" }) === "sales");
check("knowledgeLinkedResourceToDomain maps support_ticket to technician", knowledgeLinkedResourceToDomain({ type: "support_ticket", id: "t1" }) === "technician");
check("knowledgeLinkedResourceToDomain maps customer to customer", knowledgeLinkedResourceToDomain({ type: "customer", id: "c1" }) === "customer");

check(
  "evaluateKnowledgePermission returns domain in decision",
  evaluateKnowledgePermission(actor(), doc({ collection: "Finance" }), "read").domain === "finance"
);

check("HR collection denied for sales staff", !canActorReadKnowledgeDocument(actor(), doc({ collection: "HR", owner: "hr-1" })));
check("HR collection allowed for Admin", canActorReadKnowledgeDocument(actor({ role: "Admin", id: "a1" }), doc({ collection: "HR", owner: "hr-1" })));

// --- General/SOPs/Products domain: staff-only company visibility ---

check(
  "Customer denied General",
  !canActorReadKnowledgeDocument(
    actor({ role: "Customer", id: "cust-1", customerId: "cust-1" }),
    doc({ collection: "General", owner: "other" })
  )
);

check(
  "Customer denied SOP",
  !canActorReadKnowledgeDocument(
    actor({ role: "Customer", id: "cust-1", customerId: "cust-1" }),
    doc({ collection: "SOPs", owner: "other" })
  )
);

check(
  "Customer denied Products",
  !canActorReadKnowledgeDocument(
    actor({ role: "Customer", id: "cust-1", customerId: "cust-1" }),
    doc({ collection: "Products", owner: "other" })
  )
);

check(
  "Sales allowed on General",
  canActorReadKnowledgeDocument(actor({ role: "Sales Executive", id: "sales-1" }), doc({ collection: "General", owner: "other" }))
);

check(
  "Technician allowed on SOP",
  canActorReadKnowledgeDocument(actor({ role: "Technician", id: "tech-1" }), doc({ collection: "SOPs", owner: "other" }))
);

check(
  "Support allowed on Products",
  canActorReadKnowledgeDocument(actor({ role: "Support Agent", id: "support-1" }), doc({ collection: "Products", owner: "other" }))
);

check(
  "Admin allowed on General",
  canActorReadKnowledgeDocument(actor({ role: "Admin", id: "admin-1" }), doc({ collection: "General", owner: "other" }))
);

check(
  "Director allowed on SOP",
  canActorReadKnowledgeDocument(actor({ role: "Director", id: "dir-1" }), doc({ collection: "SOPs", owner: "other" }))
);

check(
  "Super Admin allowed on Products",
  canActorReadKnowledgeDocument(actor({ role: "Super Admin", id: "sa-1" }), doc({ collection: "Products", owner: "other" }))
);

// Regression checks (unchanged by this fix — verified still true):
check(
  "Customer visibility still works (matching customer)",
  canActorReadKnowledgeDocument(
    actor({ role: "Customer", id: "cust-user", customerId: "cust-1" }),
    doc({ visibility: "customer_scoped", collection: "Customers" }),
    { metadata: createKnowledgeDocumentMetadata({ documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 1, linkedResource: { type: "customer", id: "cust-1", customerId: "cust-1" } }) }
  )
);
check(
  "Public visibility still rejected as an unimplemented value (unaffected by this fix)",
  !isKnowledgeVisibility("public")
);

console.log(`\nKnowledgePermissions tests: ${pass} passed`);
