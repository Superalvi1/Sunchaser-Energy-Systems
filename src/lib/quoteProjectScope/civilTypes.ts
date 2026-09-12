export interface CivilFoundationDetail {
  foundationPadQty: number;
  padLength: string;
  padWidth: string;
  padDepth: string;
  excavationQty: string;
  pccGrade: string;
  pccQty: string;
  rccGrade: string;
  rccQty: string;
  rebarGrade: string;
  rebarKg: string;
  formworkArea: string;
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
    excavationQty: "",
    pccGrade: "",
    pccQty: "",
    rccGrade: "",
    rccQty: "",
    rebarGrade: "",
    rebarKg: "",
    formworkArea: "",
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
