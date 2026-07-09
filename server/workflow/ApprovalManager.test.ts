import assert from "node:assert/strict";
import { ApprovalManager } from "./ApprovalManager.ts";
import { ManualClock } from "./Clock.ts";
import { DuplicateVoteError, UnauthorizedApproverError } from "./errors.ts";

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

await test("request rejects an approval step with no approvers", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  assert.throws(() => manager.request("step-1", []), RangeError);
});

await test("request defaults quorum to the full approver count", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  const state = manager.request("step-1", ["alice", "bob", "carol"]);
  assert.equal(state.quorum, 3);
});

await test("request accepts an explicit quorum below the approver count", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  const state = manager.request("step-1", ["alice", "bob", "carol"], 2);
  assert.equal(state.quorum, 2);
});

await test("request rejects a quorum of 0", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  assert.throws(() => manager.request("step-1", ["alice"], 0), RangeError);
});

await test("request rejects a quorum greater than the approver count", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  assert.throws(() => manager.request("step-1", ["alice"], 2), RangeError);
});

await test("request starts in pending status with no votes", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  const state = manager.request("step-1", ["alice"]);
  assert.equal(state.status, "pending");
  assert.deepEqual(state.votes, []);
});

await test("request stamps requestedAt from the clock", () => {
  const manager = new ApprovalManager(new ManualClock(777));
  const state = manager.request("step-1", ["alice"]);
  assert.equal(state.requestedAt, 777);
});

await test("request omits timeoutMs when not provided", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  const state = manager.request("step-1", ["alice"]);
  assert.equal(state.timeoutMs, undefined);
});

await test("request stores timeoutMs when provided", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  const state = manager.request("step-1", ["alice"], undefined, 5_000);
  assert.equal(state.timeoutMs, 5_000);
});

await test("request copies the approvers array (mutating the input does not affect state)", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  const approvers = ["alice", "bob"];
  const state = manager.request("step-1", approvers);
  approvers.push("carol");
  assert.deepEqual(state.approvers, ["alice", "bob"]);
});

await test("vote records a single approval and stays pending under multi-approver quorum", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  let state = manager.request("step-1", ["alice", "bob"], 2);
  state = manager.vote(state, "alice", "approved");
  assert.equal(state.status, "pending");
  assert.equal(state.votes.length, 1);
});

await test("vote resolves to approved once quorum of approvals is reached", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  let state = manager.request("step-1", ["alice", "bob"], 2);
  state = manager.vote(state, "alice", "approved");
  state = manager.vote(state, "bob", "approved");
  assert.equal(state.status, "approved");
});

await test("single-approver approval resolves immediately", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  let state = manager.request("step-1", ["alice"]);
  state = manager.vote(state, "alice", "approved");
  assert.equal(state.status, "approved");
});

await test("single-approver rejection resolves immediately", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  let state = manager.request("step-1", ["alice"]);
  state = manager.vote(state, "alice", "rejected");
  assert.equal(state.status, "rejected");
});

await test("quorum-of-2-of-3 approves once two approvals land, ignoring the third voter", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  let state = manager.request("step-1", ["alice", "bob", "carol"], 2);
  state = manager.vote(state, "alice", "approved");
  assert.equal(state.status, "pending");
  state = manager.vote(state, "bob", "approved");
  assert.equal(state.status, "approved");
});

await test("under unanimous quorum, a single rejection immediately makes approval unreachable", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  let state = manager.request("step-1", ["alice", "bob", "carol"], 3);
  state = manager.vote(state, "alice", "rejected");
  assert.equal(state.status, "rejected");
});

await test("rejection resolves rejected once quorum becomes mathematically unreachable with quorum below full count", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  let state = manager.request("step-1", ["alice", "bob", "carol", "dave"], 3);
  state = manager.vote(state, "alice", "rejected");
  assert.equal(state.status, "pending");
  state = manager.vote(state, "bob", "rejected");
  assert.equal(state.status, "rejected");
});

await test("under a two-approver unanimous quorum, a single rejection resolves rejected", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  let state = manager.request("step-1", ["alice", "bob"], 2);
  state = manager.vote(state, "alice", "rejected");
  assert.equal(state.status, "rejected");
});

await test("mixed votes can still resolve approved when quorum is less than unanimous", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  let state = manager.request("step-1", ["alice", "bob", "carol"], 2);
  state = manager.vote(state, "alice", "rejected");
  assert.equal(state.status, "pending");
  state = manager.vote(state, "bob", "approved");
  assert.equal(state.status, "pending");
  state = manager.vote(state, "carol", "approved");
  assert.equal(state.status, "approved");
});

await test("vote throws UnauthorizedApproverError for a non-approver", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  const state = manager.request("step-1", ["alice"]);
  assert.throws(() => manager.vote(state, "mallory", "approved"), UnauthorizedApproverError);
});

await test("vote throws DuplicateVoteError when the same approver votes twice", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  let state = manager.request("step-1", ["alice", "bob"], 2);
  state = manager.vote(state, "alice", "approved");
  assert.throws(() => manager.vote(state, "alice", "approved"), DuplicateVoteError);
});

await test("vote throws when voting on an already-resolved approval", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  let state = manager.request("step-1", ["alice"]);
  state = manager.vote(state, "alice", "approved");
  assert.throws(() => manager.vote(state, "alice", "approved"), RangeError);
});

await test("vote does not mutate the state object passed in", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  const original = manager.request("step-1", ["alice", "bob"], 2);
  manager.vote(original, "alice", "approved");
  assert.equal(original.votes.length, 0);
  assert.equal(original.status, "pending");
});

await test("vote stamps each vote with the clock's current time", () => {
  const clock = new ManualClock(0);
  const manager = new ApprovalManager(clock);
  const state = manager.request("step-1", ["alice"]);
  clock.advance(250);
  const voted = manager.vote(state, "alice", "approved");
  assert.equal(voted.votes[0].timestamp, 250);
});

await test("isTimedOut is false when no timeoutMs is configured", () => {
  const clock = new ManualClock(0);
  const manager = new ApprovalManager(clock);
  const state = manager.request("step-1", ["alice"]);
  clock.advance(1_000_000);
  assert.equal(manager.isTimedOut(state), false);
});

await test("isTimedOut is false before the timeout elapses", () => {
  const clock = new ManualClock(0);
  const manager = new ApprovalManager(clock);
  const state = manager.request("step-1", ["alice"], undefined, 1_000);
  clock.advance(999);
  assert.equal(manager.isTimedOut(state), false);
});

await test("isTimedOut is true once the timeout elapses exactly", () => {
  const clock = new ManualClock(0);
  const manager = new ApprovalManager(clock);
  const state = manager.request("step-1", ["alice"], undefined, 1_000);
  clock.advance(1_000);
  assert.equal(manager.isTimedOut(state), true);
});

await test("isTimedOut is true well past the timeout", () => {
  const clock = new ManualClock(0);
  const manager = new ApprovalManager(clock);
  const state = manager.request("step-1", ["alice"], undefined, 1_000);
  clock.advance(5_000);
  assert.equal(manager.isTimedOut(state), true);
});

await test("isTimedOut is false for a state that already resolved to approved", () => {
  const clock = new ManualClock(0);
  const manager = new ApprovalManager(clock);
  let state = manager.request("step-1", ["alice"], undefined, 100);
  state = manager.vote(state, "alice", "approved");
  clock.advance(1_000);
  assert.equal(manager.isTimedOut(state), false);
});

await test("computeStatus is pure and can be called independently of vote", () => {
  const manager = new ApprovalManager(new ManualClock(0));
  const state = manager.request("step-1", ["alice", "bob"], 2);
  assert.equal(manager.computeStatus(state), "pending");
});

console.log(`\nApprovalManager tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
