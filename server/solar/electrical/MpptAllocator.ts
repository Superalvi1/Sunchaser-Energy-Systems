/**
 * MPPT allocation — distribute strings across inverter MPPT channels.
 */

import { round4, type InverterElectricalSpec, type MpptAllocation, type StringGroup } from "./ElectricalModels.ts";

export interface MpptAllocatorResult {
  strings: StringGroup[];
  allocations: MpptAllocation[];
  compatible: boolean;
  issues: string[];
}

function canAccept(
  bucket: { strings: StringGroup[]; maxStrings: number; maxCurrentA: number; minV: number; maxV: number },
  str: StringGroup
): boolean {
  if (bucket.strings.length >= bucket.maxStrings) return false;
  const nextCurrent = (bucket.strings.length + 1) * str.impA;
  if (nextCurrent > bucket.maxCurrentA + 0.01) return false;
  if (str.vmpAtTmaxV < bucket.minV - 0.01 || str.vmpAtTmaxV > bucket.maxV + 0.01) return false;
  return true;
}

/**
 * Assign strings to MPPTs: prefer least-loaded channel that can accept voltage+current.
 */
export function allocateStringsToMppts(
  strings: StringGroup[],
  inverter: InverterElectricalSpec
): MpptAllocatorResult {
  const issues: string[] = [];
  const assigned: StringGroup[] = strings.map((s) => ({
    ...s,
    panelIds: [...s.panelIds],
    issues: [...s.issues],
  }));

  const buckets = inverter.mppts.map((m) => ({
    mpptId: m.mpptId,
    strings: [] as StringGroup[],
    maxStrings: m.maxStrings ?? 99,
    maxCurrentA: m.maxCurrentA,
    minV: m.minV,
    maxV: m.maxV,
  }));

  for (const str of assigned) {
    const candidates = buckets
      .filter((b) => canAccept(b, str))
      .sort((a, b) => a.strings.length - b.strings.length || a.mpptId.localeCompare(b.mpptId));

    if (candidates.length === 0) {
      issues.push(`No MPPT capacity remaining for ${str.stringId}.`);
      str.valid = false;
      str.mpptId = "";
      str.issues.push("No MPPT available.");
      continue;
    }

    const target = candidates[0];
    str.mpptId = target.mpptId;
    target.strings.push(str);
  }

  const allocations: MpptAllocation[] = buckets.map((b) => {
    const totalCurrentA = round4(b.strings.reduce((s, x) => s + x.impA, 0));
    const withinCurrentLimit = totalCurrentA <= b.maxCurrentA + 0.01;
    const withinVoltageWindow = b.strings.every(
      (s) => s.vmpAtTmaxV >= b.minV - 0.01 && s.vmpAtTmaxV <= b.maxV + 0.01
    );
    const localIssues: string[] = [];
    if (!withinCurrentLimit) localIssues.push("MPPT current exceeded.");
    if (!withinVoltageWindow) localIssues.push("One or more strings outside MPPT voltage window.");
    return {
      mpptId: b.mpptId,
      stringIds: b.strings.map((s) => s.stringId),
      stringCount: b.strings.length,
      totalCurrentA,
      withinCurrentLimit,
      withinVoltageWindow,
      issues: localIssues,
    };
  });

  const compatible =
    issues.length === 0 &&
    assigned.every((s) => s.valid && s.mpptId.length > 0) &&
    allocations.every((a) => a.withinCurrentLimit && a.withinVoltageWindow);

  return { strings: assigned, allocations, compatible, issues };
}
