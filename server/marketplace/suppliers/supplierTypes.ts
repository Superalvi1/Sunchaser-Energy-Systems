export class SupplierError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SupplierError";
  }
}

export type PriceAlertDto = {
  id: string;
  runId: string | null;
  productId: string | null;
  variantId: string | null;
  alertType: string;
  severity: string;
  message: string;
  resolved: boolean;
  createdAt: string;
};

export type PriceCheckRunResultDto = {
  runId: string;
  status: "succeeded" | "failed";
  trigger: "manual" | "scheduled";
  observationsInserted: number;
  alertsCreated: number;
  variantsPublished: number;
  supplierFailures: Array<{
    supplierCode: string;
    mappingId: string;
    failureClass: string;
    message: string;
  }>;
  productionReady: false;
  note: string;
};
