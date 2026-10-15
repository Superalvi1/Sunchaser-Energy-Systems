import test from "node:test";
import assert from "node:assert/strict";
import { runWithCompany, runAsSystem } from "./companyContext.ts";
import { scopedSettingKey, settingsScopeCompany, unscopeSettingRows, usesNeutralIdentity } from "./companyIdentity.ts";

const ON = { MULTI_COMPANY_ENABLED: "true" } as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;

test("flag off: nothing changes (plain keys, Sunchaser defaults)", () => {
  runWithCompany({ companyId: "acme" }, () => {
    assert.equal(settingsScopeCompany(OFF), null);
    assert.equal(scopedSettingKey("global", settingsScopeCompany(OFF)), "global");
    assert.equal(usesNeutralIdentity(OFF), false);
  });
});

test("founding company keeps its plain keys and its defaults", () => {
  runWithCompany({ companyId: "sunchaser" }, () => {
    assert.equal(settingsScopeCompany(ON), null);
    assert.equal(scopedSettingKey("company_branding", settingsScopeCompany(ON)), "company_branding");
    assert.equal(usesNeutralIdentity(ON), false);
  });
});

test("another company: scoped keys and no Sunchaser default", () => {
  runWithCompany({ companyId: "acme" }, () => {
    assert.equal(settingsScopeCompany(ON), "acme");
    assert.equal(scopedSettingKey("global", settingsScopeCompany(ON)), "acme:global");
    assert.equal(usesNeutralIdentity(ON), true);
  });
});

test("multi-company mode without a company context never defaults to Sunchaser", () => {
  assert.equal(usesNeutralIdentity(ON), true);
  runAsSystem("test", () => assert.equal(usesNeutralIdentity(ON), true));
});

test("unscoping keeps only this company's rows and removes the prefix", () => {
  const rows = [{ key: "acme:global", value: 1 }, { key: "other:global", value: 2 }, { key: "global", value: 3 }];
  assert.deepEqual(unscopeSettingRows(rows, "acme"), [{ key: "global", value: 1 }]);
  assert.deepEqual(unscopeSettingRows(rows, null), rows);
  assert.deepEqual(unscopeSettingRows(null, "acme"), []);
});
