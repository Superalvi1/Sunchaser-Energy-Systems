import type { AuditLog } from "./AuditLog.ts";
import type { ActionHandlerRegistry } from "./ActionHandlerRegistry.ts";
import type { WorkflowContext } from "./types.ts";

export type EscalationReason = "approvalTimeout" | "approvalRejected" | "retryExhausted";

export interface EscalationRequest {
  instanceId: string;
  stepId: string;
  reason: EscalationReason;
  handler?: string;
  context: WorkflowContext;
}

export class EscalationManager {
  constructor(
    private readonly registry: ActionHandlerRegistry,
    private readonly audit: AuditLog
  ) {}

  async escalate(request: EscalationRequest): Promise<void> {
    this.audit.record(request.instanceId, "escalation.triggered", request.stepId, {
      reason: request.reason,
      handler: request.handler,
    });
    if (!request.handler) return;
    try {
      await this.registry.invoke(
        request.handler,
        { reason: request.reason, stepId: request.stepId },
        request.context
      );
      this.audit.record(request.instanceId, "escalation.handled", request.stepId, {
        reason: request.reason,
        handler: request.handler,
      });
    } catch (err) {
      this.audit.record(request.instanceId, "escalation.handlerFailed", request.stepId, {
        reason: request.reason,
        handler: request.handler,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
