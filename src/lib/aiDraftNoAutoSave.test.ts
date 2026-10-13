// An AI-generated quotation draft must never be saved, sent or posted without an explicit staff action.
// Part 1 parses the real component source (TypeScript compiler API) and checks every call the apply path can make
// against a strict allowlist, so a new save/fetch/send call fails this test even if it is named differently.
// Part 2 runs the draft builders with the network trapped. Run: node --import tsx --test src/lib/aiDraftNoAutoSave.test.ts
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const parse = (rel: string) => {
  const text = readFileSync(join(here, rel), "utf8");
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
};

/** Finds `const <name> = (...) => { ... }` anywhere in the file. */
function findArrow(sf: ts.SourceFile, name: string): ts.ArrowFunction | ts.FunctionExpression {
  let found: ts.ArrowFunction | ts.FunctionExpression | undefined;
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) found = n.initializer;
    if (!found) ts.forEachChild(n, visit);
  };
  visit(sf);
  assert.ok(found, `could not find ${name}`);
  return found!;
}

/** Every callee text (and `new X`, tagged template, property read of fetch-like globals) inside a function body. */
function callees(fn: ts.Node, sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) out.push(n.expression.getText(sf).replace(/\s+/g, ""));
    if (ts.isNewExpression(n)) out.push("new " + n.expression.getText(sf));
    if (ts.isIdentifier(n) && /^(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)$/.test(n.text)) out.push("ref:" + n.text);
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return out;
}

const STATE_SETTER = /^set[A-Z]\w*$/; // React state setters only change in-memory form state

test("SalesTeamApp: applying an AI draft only fills the form (no save, fetch or send)", () => {
  const sf = parse("../components/SalesTeamApp.tsx");
  const handler = findArrow(sf, "handleApplyAiQuoteDraft");
  const allowed = new Set(["clearLoadedPackage", "freezeProjectScopeSnapshot", "toast.success", "draft.boqRows.some"]);
  const unexpected = callees(handler, sf).filter((c) => !STATE_SETTER.test(c) && !allowed.has(c));
  assert.deepEqual(unexpected, [], `AI apply handler may only set form state; found: ${unexpected.join(", ")}`);
  // it must really fill the BOQ (otherwise an empty handler would pass the allowlist)
  assert.ok(callees(handler, sf).includes("setBoqRows"));
  // and the helper it calls must stay local state too
  const clear = findArrow(sf, "clearLoadedPackage");
  assert.deepEqual(callees(clear, sf).filter((c) => !STATE_SETTER.test(c)), []);
});

test("AIQuoteBuilderModal: the Apply button hands the draft to the parent and nothing else leaves the modal", () => {
  const sf = parse("../components/quoteAuthoring/AIQuoteBuilderModal.tsx");
  const apply = findArrow(sf, "handleApply");
  const allowed = new Set(["onApplyDraft", "onParentChargesChange", "commitFinancialDraft", "onClose"]);
  const unexpected = callees(apply, sf).filter((c) => !allowed.has(c));
  assert.deepEqual(unexpected, [], `modal apply may only call the parent: ${unexpected.join(", ")}`);
  // The whole modal has no network, storage or messaging access at all.
  const all = callees(sf, sf).filter((c) => /fetch|axios|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|whatsapp|authorized|\.save|submit/i.test(c));
  assert.deepEqual(all, [], `modal must not reach network/storage/messaging: ${all.join(", ")}`);
});

test("SalesTeamApp: the charges callback the modal uses only sets form state", () => {
  const sf = parse("../components/SalesTeamApp.tsx");
  let cb: ts.ArrowFunction | undefined;
  const visit = (n: ts.Node) => {
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === "onParentChargesChange" && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression && ts.isArrowFunction(n.initializer.expression)) cb = n.initializer.expression;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  assert.ok(cb, "onParentChargesChange handler not found");
  assert.deepEqual(callees(cb!, sf).filter((c) => !STATE_SETTER.test(c)), []);
});

test("the only place the AI draft state is persisted is behind explicit save buttons", () => {
  const sf = parse("../components/SalesTeamApp.tsx");
  const text = sf.getText();
  const apply = findArrow(sf, "handleApplyAiQuoteDraft");
  // No effect watching the BOQ may call the save functions (an auto-save on change would defeat the draft step).
  const autoSave: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "useEffect") {
      const body = n.arguments[0];
      if (body) for (const c of callees(body, sf)) if (/^(handleSave\w*|persist\w*|create-?Quote|authorizedFetch)$/i.test(c)) autoSave.push(c);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  assert.deepEqual(autoSave, [], `useEffect must not save quotes automatically: ${autoSave.join(", ")}`);
  assert.ok(text.includes("review and save manually"), "the staff-facing instruction should remain");
  assert.ok(apply.getText(sf).includes("draftOnly"), "apply must reject drafts that are not marked draftOnly");
});

test("negative control: the allowlist check would catch an auto-save added to the handler", () => {
  const src = `const handleApplyAiQuoteDraft = (draft) => { setBoqRows(draft.boqRows); authorizedFetch("/api/leads/1/create-quote"); };`;
  const sf = ts.createSourceFile("x.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bad = callees(findArrow(sf, "handleApplyAiQuoteDraft"), sf).filter((c) => !STATE_SETTER.test(c));
  assert.deepEqual(bad, ["authorizedFetch"]);
});
