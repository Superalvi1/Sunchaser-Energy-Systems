/**
 * Design Studio UI primitives — static source checks (presentation layer only).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

let pass = 0;

function check(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`  ✓ ${name}`);
}

console.log("studio UI polish tests");

check("studio.tsx exports core primitives", () => {
  const src = read("components/ui/studio.tsx");
  for (const sym of [
    "StudioPanel",
    "StudioButton",
    "StudioEmptyState",
    "StudioPageHeader",
    "StudioGateNote",
    "StudioStatusLine",
  ]) {
    assert.match(src, new RegExp(`export function ${sym}`));
  }
});

check("index.css defines studio design tokens", () => {
  const css = read("index.css");
  assert.match(css, /--color-studio-accent/);
  assert.match(css, /\.studio-toolbar/);
  assert.match(css, /\.studio-panel/);
  assert.match(css, /\.studio-empty/);
});

check("ProjectDesignWorkspace uses studio page header", () => {
  const src = read("components/roofStudio/ProjectDesignWorkspace.tsx");
  assert.match(src, /StudioPageHeader/);
  assert.match(src, /StudioEmptyState/);
  assert.doesNotMatch(src, /bg-cyan-500 px-4 py-2/);
});

check("RoofIntelligenceStudio toolbar uses unified studio classes", () => {
  const src = read("components/roofStudio/RoofIntelligenceStudio.tsx");
  assert.match(src, /studio-toolbar/);
  assert.match(src, /studio-btn-tool-active/);
  assert.match(src, /studio-status-bar/);
  assert.match(src, /studio-canvas-frame/);
  assert.doesNotMatch(src, /bg-cyan-500 text-slate-950/);
});

check("DesignStudioLeftControlPanel uses StudioPanel", () => {
  const src = read("components/roofStudio/DesignStudioLeftControlPanel.tsx");
  assert.match(src, /StudioPanel/);
  assert.match(src, /studio-input/);
});

check("DesignStudioResultsPanel uses StudioPanel and gate notes", () => {
  const src = read("components/roofStudio/DesignStudioResultsPanel.tsx");
  assert.match(src, /StudioPanel/);
  assert.match(src, /StudioGateNote/);
  assert.match(src, /studio-fade-in/);
});

console.log(`\n${pass} passed`);
