import assert from "node:assert/strict";
import {
  normalizeLearningNextPath,
  signLearningSsoTicket,
  verifyLearningSsoTicket,
} from "./learningSso.ts";
import type { RequestActor } from "../middleware/actor.ts";

const actor: RequestActor = {
  id: "user-123",
  username: "learner",
  name: "Learner One",
  email: "learner@example.com",
  role: "Customer",
  customerId: "customer-9",
  accountStatus: "Active",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};
const env = {
  NODE_ENV: "test",
  LEARNING_SSO_SECRET: "0123456789abcdef0123456789abcdef",
} as NodeJS.ProcessEnv;
const nowMs = Date.UTC(2026, 8, 26, 6, 0, 0);

const ticket = signLearningSsoTicket(actor, { nowMs, env, ttlSeconds: 90 });
const claims = verifyLearningSsoTicket(ticket, { nowMs: nowMs + 10_000, env });
assert.equal(claims.sub, actor.id);
assert.equal(claims.customerId, actor.customerId);
assert.equal(claims.role, "Customer");

assert.throws(() => verifyLearningSsoTicket(ticket + "x", { nowMs, env }), /signature|format/i);
assert.throws(() => verifyLearningSsoTicket(ticket, { nowMs: nowMs + 91_000, env }), /expired/i);
assert.equal(normalizeLearningNextPath("/classroom/abc"), "/classroom/abc");
assert.equal(normalizeLearningNextPath("https://evil.example"), "/");
assert.equal(normalizeLearningNextPath("//evil.example"), "/");

console.log("learning SSO tests passed");
