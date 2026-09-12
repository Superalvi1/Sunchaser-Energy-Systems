export interface CivilFoundationDetail {
  foundationPadQty: number;
  padLength: string;
  padWidth: string;
  padDepth: string;
  excavationQty: number;
  pccGrade: string;
  pccQty: number;
  rccGrade: string;
  rccQty: number;
  rebarGrade: string;
  rebarKg: number;
  formworkArea: number;
  anchorBoltQty: number;
  anchorBoltDiameter: string;
  anchorBoltGrade: string;
  grouting: string;
  curingDays: string;
  waterproofingRequired: "" | "yes" | "no" | "pending";
  designStatus: "pending_structural_design" | "provided";
  designNote: string;
}

export function emptyCivilFoundation(): CivilFoundationDetail {
  return {
    foundationPadQty: 0,
    padLength: "",
    padWidth: "",
    padDepth: "",
    excavationQty: 0,
    pccGrade: "",
    pccQty: 0,
    rccGrade: "",
    rccQty: 0,
    rebarGrade: "",
    rebarKg: 0,
    formworkArea: 0,
    anchorBoltQty: 0,
    anchorBoltDiameter: "",
    anchorBoltGrade: "",
    grouting: "",
    curingDays: "",
    waterproofingRequired: "pending",
    designStatus: "pending_structural_design",
    designNote: "",
  };
}

export function civilFoundationDisplay(detail: CivilFoundationDetail | undefined): string {
  if (!detail || detail.designStatus !== "provided") return "Pending structural design";
  const note = String(detail.designNote || "").trim();
  return note || "Pending structural design";
}
