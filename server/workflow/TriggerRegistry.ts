import type { ConditionExpression, WorkflowContext } from "./types.ts";
import { evaluateCondition } from "./ConditionEvaluator.ts";

export interface TriggerBinding {
  workflowId: string;
  event: string;
  condition?: ConditionExpression;
}

export class TriggerRegistry {
  private bindings: TriggerBinding[] = [];

  register(binding: TriggerBinding): void {
    const exists = this.bindings.some(
      (b) => b.workflowId === binding.workflowId && b.event === binding.event
    );
    if (exists) {
      throw new RangeError(
        `Workflow "${binding.workflowId}" is already bound to event "${binding.event}"`
      );
    }
    this.bindings.push(binding);
  }

  unregister(workflowId: string, event: string): void {
    this.bindings = this.bindings.filter(
      (b) => !(b.workflowId === workflowId && b.event === event)
    );
  }

  bindingsFor(workflowId: string): TriggerBinding[] {
    return this.bindings.filter((b) => b.workflowId === workflowId);
  }

  match(event: string, payload: WorkflowContext): TriggerBinding[] {
    return this.bindings.filter((b) => {
      if (b.event !== event) return false;
      if (!b.condition) return true;
      return evaluateCondition(b.condition, payload);
    });
  }

  clear(): void {
    this.bindings = [];
  }
}
