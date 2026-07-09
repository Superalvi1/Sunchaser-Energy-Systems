/**
 * Roof Studio — elevated structure layout (H-Beam, C-Channel, columns, foundations).
 */

import type { Point2D } from "../../server/solar/roof/RoofModels.ts";
import { requireValidScale } from "./roofStudioCalibration.ts";
import { segmentLength, unitsToMeters } from "../../server/solar/roof/RoofMeasurement.ts";
import { nextStudioId } from "./roofStudioClient.ts";

export type StructureMemberType = "h-beam" | "c-channel" | "column" | "foundation";

export interface StructureMember {
  id: string;
  type: StructureMemberType;
  start: Point2D;
  end: Point2D;
  label: string;
  heightM: number;
}

export interface StructureLayout {
  structureHeightM: number;
  airPassageM: number;
  cleaningSpaceM: number;
  civilLabels: string[];
  members: StructureMember[];
}

export const DEFAULT_STRUCTURE_LAYOUT: StructureLayout = {
  structureHeightM: 3,
  airPassageM: 0.6,
  cleaningSpaceM: 0.45,
  civilLabels: ["RCC foundation blocks", "Waterproofing membrane", "Earthing bond"],
  members: [],
};

export const STRUCTURE_TYPE_LABELS: Record<StructureMemberType, string> = {
  "h-beam": "H-Beam / Girder",
  "c-channel": "C-Channel / Purlin",
  column: "Column / Post",
  foundation: "Foundation Block",
};

export function addStructureMember(
  layout: StructureLayout,
  type: StructureMemberType,
  start: Point2D,
  end: Point2D,
  heightM?: number
): StructureLayout {
  const member: StructureMember = {
    id: nextStudioId("struct"),
    type,
    start: { ...start },
    end: { ...end },
    label: STRUCTURE_TYPE_LABELS[type],
    heightM: heightM ?? layout.structureHeightM,
  };
  return { ...layout, members: [...layout.members, member] };
}

export function removeStructureMember(layout: StructureLayout, memberId: string): StructureLayout {
  return { ...layout, members: layout.members.filter((m) => m.id !== memberId) };
}

export function memberLengthM(member: StructureMember, metersPerUnit: number): number {
  return unitsToMeters(segmentLength(member.start, member.end), requireValidScale(metersPerUnit));
}

export function structureMemberCounts(layout: StructureLayout): Record<StructureMemberType, number> {
  const counts: Record<StructureMemberType, number> = {
    "h-beam": 0,
    "c-channel": 0,
    column: 0,
    foundation: 0,
  };
  for (const m of layout.members) counts[m.type] += 1;
  return counts;
}
