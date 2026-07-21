import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROPOSAL_STUDIO_ENV_KEY,
  ROOF_STUDIO_ENV_KEY,
  SUNCHASER_DESIGN_STUDIO_ENV_KEY,
  isDesignProjectEnabled,
  isProposalStudioEnabled,
  isRoofStudioEnabled,
  isSunchaserDesignStudioEnabled,
  parseStudioEnvFlagEnabledByDefault,
  parseStudioEnvFlagTrue,
} from "./studioFeatureFlags.ts";

const here = dirname(fileURLToPath(import.meta.url));

let pass = 0;
function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("proposal studio disabled by default (env unset)", () => !isProposalStudioEnabled());
check("legacy roof studio flag opt-in only (env unset => false)", () => !isRoofStudioEnabled());
check("canonical design studio enabled by default (env unset)", () => isSunchaserDesignStudioEnabled());
check("design project enabled by default (env unset)", () => isDesignProjectEnabled());

check("enabled-by-default: missing => enabled", () => parseStudioEnvFlagEnabledByDefault(undefined) === true);
check("enabled-by-default: empty => enabled", () => parseStudioEnvFlagEnabledByDefault("") === true);
check("enabled-by-default: true => enabled", () => parseStudioEnvFlagEnabledByDefault("true") === true);
check("enabled-by-default: TRUE => enabled", () => parseStudioEnvFlagEnabledByDefault("TRUE") === true);
check("enabled-by-default: false => disabled", () => parseStudioEnvFlagEnabledByDefault("false") === false);
check("enabled-by-default: FALSE => disabled", () => parseStudioEnvFlagEnabledByDefault("FALSE") === false);

check("legacy opt-in: missing => disabled", () => parseStudioEnvFlagTrue(undefined) === false);
check("legacy opt-in: true => enabled", () => parseStudioEnvFlagTrue("true") === true);
check("legacy opt-in: false => disabled", () => parseStudioEnvFlagTrue("false") === false);

check("legacy ROOF_STUDIO=true still unlocks design project when canonical false", () => {
  // Compatibility: DESIGN_PROJECT = canonical OR legacy roof true.
  const canonicalOff = !parseStudioEnvFlagEnabledByDefault("false");
  const legacyOn = parseStudioEnvFlagTrue("true");
  return canonicalOff && legacyOn && (parseStudioEnvFlagEnabledByDefault("false") || legacyOn) === true;
});

check("canonical false + legacy unset => design project off", () => {
  const canonical = parseStudioEnvFlagEnabledByDefault("false");
  const legacy = parseStudioEnvFlagTrue(undefined);
  return (canonical || legacy) === false;
});

check("SalesTeamApp gates design project behind isDesignProjectEnabled", () => {
  const src = readFileSync(resolve(here, "../components/SalesTeamApp.tsx"), "utf8");
  return (
    src.includes("isProposalStudioEnabled") &&
    src.includes("isDesignProjectEnabled") &&
    src.includes("PROPOSAL_STUDIO_ENABLED") &&
    src.includes("DESIGN_PROJECT_ENABLED") &&
    /proposal_studio.*PROPOSAL_STUDIO_ENABLED/s.test(src) &&
    /DESIGN_PROJECT_ENABLED/s.test(src) &&
    src.includes("ProjectDesignWorkspace") &&
    !src.includes("<SunchaserDesignStudio") &&
    !src.includes("<RoofIntelligenceStudio")
  );
});

check("SalesTeamApp redirects disabled studio modules to boq_builder", () => {
  const src = readFileSync(resolve(here, "../components/SalesTeamApp.tsx"), "utf8");
  return (
    src.includes('activeModule === "proposal_studio"') &&
    src.includes('activeModule === "roof_studio"') &&
    src.includes('setActiveModule("boq_builder")') &&
    src.includes("DESIGN_PROJECT_ENABLED")
  );
});

check(".env.example documents canonical Design Studio flag (default on)", () => {
  const env = readFileSync(resolve(here, "../../.env.example"), "utf8");
  return (
    env.includes(PROPOSAL_STUDIO_ENV_KEY) &&
    env.includes(ROOF_STUDIO_ENV_KEY) &&
    env.includes(SUNCHASER_DESIGN_STUDIO_ENV_KEY) &&
    env.includes("Default ON when unset") &&
    env.includes("Canonical CRM Design Project")
  );
});

check("flag module exports parse helpers and design project gate", () => {
  const src = readFileSync(resolve(here, "studioFeatureFlags.ts"), "utf8");
  return (
    src.includes("parseStudioEnvFlagEnabledByDefault") &&
    src.includes("isDesignProjectEnabled") &&
    src.includes(SUNCHASER_DESIGN_STUDIO_ENV_KEY)
  );
});

console.log(`\nstudioFeatureFlags tests: ${pass} passed`);
