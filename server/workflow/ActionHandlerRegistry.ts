import { UnknownActionHandlerError } from "./errors.ts";
import type { WorkflowContext } from "./types.ts";

export type ActionHandler = (
  input: unknown,
  context: WorkflowContext
) => unknown | Promise<unknown>;

export class ActionHandlerRegistry {
  private handlers = new Map<string, ActionHandler>();

  register(name: string, handler: ActionHandler): void {
    this.handlers.set(name, handler);
  }

  unregister(name: string): void {
    this.handlers.delete(name);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  names(): string[] {
    return [...this.handlers.keys()];
  }

  async invoke(name: string, input: unknown, context: WorkflowContext): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new UnknownActionHandlerError(name);
    }
    return await handler(input, context);
  }
}
