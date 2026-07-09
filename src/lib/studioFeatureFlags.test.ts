import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROPOSAL_STUDIO_ENV_KEY,
  ROOF_STUDIO_ENV_KEY,
  isProposalStudioEnabled,
  isRoofStudioEnabled,
} from "./studioFeatureFlags.ts";

const here = dirname(fileURLToPath(import.meta.url));

let pass = 0;
function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("proposal studio disabled by default (env unset)", () => !isProposalStudioEnabled());
check("roof studio disabled by default (env unset)", () => !isRoofStudioEnabled());

check("SalesTeamApp gates proposal and roof studio tabs behind feature flags", () => {
  const src = readFileSync(resolve(here, "../components/SalesTeamApp.tsx"), "utf8");
  return (
    src.includes("isProposalStudioEnabled") &&
    src.includes("isRoofStudioEnabled") &&
    src.includes("PROPOSAL_STUDIO_ENABLED") &&
    src.includes("ROOF_STUDIO_ENABLED") &&
    /proposal_studio.*PROPOSAL_STUDIO_ENABLED/s.test(src) &&
    /roof_studio.*ROOF_STUDIO_ENABLED/s.test(src)
  );
});

check("SalesTeamApp redirects disabled studio modules to boq_builder", () => {
  const src = readFileSync(resolve(here, "../components/SalesTeamApp.tsx"), "utf8");
  return (
    src.includes('activeModule === "proposal_studio"') &&
    src.includes('activeModule === "roof_studio"') &&
    src.includes('setActiveModule("boq_builder")')
  );
});

check(".env.example documents studio feature flags (default off)", () => {
  const env = readFileSync(resolve(here, "../../.env.example"), "utf8");
  return env.includes(PROPOSAL_STUDIO_ENV_KEY) && env.includes(ROOF_STUDIO_ENV_KEY);
});

console.log(`\nstudioFeatureFlags tests: ${pass} passed`);
