import assert from "node:assert/strict";
import { test } from "node:test";
import { clientNameTokens, namesPlausiblyMatch } from "./clientIdentity.ts";

const same: Array<[string, string]> = [
  ["Ahmed Khan", "Ahmed Khan"],
  ["Ahmed Khan", "  AHMED   khan "],
  ["Ahmed Khan", "Mr. Ahmed Khan."],
  ["Ahmed Khan", "Dr Ahmed-Khan"],
  ["Ahmed Khan", "khan, ahmed"],
  ["Ahmed Khan", "Ahmed Raza Khan"],
  ["Sana Malik", "Ms. Sana  Malik"],
  ["Muhammad Ali", "Mohammad Ali"],
  ["Muhammad Ali Khan", "Mohd. Ali Khan"],
  ["Muhammad Ali", "Ali Muhammad"],
  ["Zoë Ünal", "zoe unal"],
  ["علی خان", "علی  خان"],
  ["Engr. Bilal Ahmed Sheikh", "Bilal Ahmed Sheikh"],
];
const different: Array<[string, string]> = [
  ["Ahmed Khan", "Sana Malik"],
  ["Ahmed Khan", "Ahmad Khan"],
  ["Ahmed", "Ahmed Khan"],
  ["Muhammad Ali", "Muhammad Hassan"],
  ["Muhammad Ali", "Ali"],
  ["Muhammad", "Muhammad Ali"],
  ["A. Khan", "Ahmed Khan"],
  ["Ahmed Khan", "Ahmed Raza"],
  ["Ahmed Khan", ""],
  ["", ""],
  ["Mr.", "Mrs."],
  ["Ahmed Khan", "احمد خان"],
  ["Anonymous Lead", "Ahmed Khan"],
];

test("variants of one client's name match", () => {
  for (const [a, b] of same) {
    assert.ok(namesPlausiblyMatch(a, b), `${JSON.stringify(a)} should match ${JSON.stringify(b)}`);
    assert.ok(namesPlausiblyMatch(b, a), `symmetry: ${JSON.stringify(b)} should match ${JSON.stringify(a)}`);
  }
});

test("different people, single shared tokens, initials, typos and empty names do not match", () => {
  for (const [a, b] of different) {
    assert.equal(namesPlausiblyMatch(a, b), false, `${JSON.stringify(a)} must not match ${JSON.stringify(b)}`);
    assert.equal(namesPlausiblyMatch(b, a), false, `symmetry: ${JSON.stringify(b)} must not match ${JSON.stringify(a)}`);
  }
});

test("a two-token name is contained in a longer name of the same client (documented trade-off)", () => {
  assert.ok(namesPlausiblyMatch("Ali Khan", "Ali Raza Khan Traders"));
});

test("tokens drop titles but keep a name made only of titles", () => {
  assert.deepEqual(clientNameTokens("Mr. Dr. Ahmed"), ["ahmed"]);
  assert.deepEqual(clientNameTokens("Sir"), ["sir"]);
  assert.deepEqual(clientNameTokens(null), []);
  assert.deepEqual(clientNameTokens("  ..-- "), []);
});
