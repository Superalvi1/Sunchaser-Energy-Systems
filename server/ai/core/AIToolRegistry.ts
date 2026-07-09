/**
 * Tool registry — the single catalog of every capability the engine can
 * offer a model.
 *
 * Modules register tools at wiring time; agents reference tools by name;
 * the engine resolves declarations per request, filtered by the actor's
 * static permissions. ToolSource is the forward-compatible hook for dynamic
 * catalogs (MCP servers) that surface tools at runtime.
 */

import type { AIActor, AIPermissionEvaluator } from "./AIPermissions.ts";
import type { Tool } from "../tools/Tool.ts";
import { bindToolHandler, type ToolHandler } from "../tools/Tool.ts";
import { AIToolNotFoundError } from "./AIErrors.ts";

/**
 * A dynamic supplier of tools (future MCP support). Sources are consulted at
 * request time, after the static catalog, and may vary per actor.
 */
export interface ToolSource {
  readonly id: string;
  listTools(actor: AIActor): Promise<Tool[]>;
}

export class AIToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly sources = new Map<string, ToolSource>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  registerMany(tools: Tool[]): void {
    for (const tool of tools) this.register(tool);
  }

  /** Bind (or replace) the handler of an already-registered tool. */
  bind(name: string, handler: ToolHandler): void {
    const existing = this.tools.get(name);
    if (!existing) throw new AIToolNotFoundError(name);
    this.tools.set(name, bindToolHandler(existing, handler));
  }

  registerSource(source: ToolSource): void {
    this.sources.set(source.id, source);
  }

  get(name: string): Tool | null {
    return this.tools.get(name) ?? null;
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /**
   * Resolve the tool set for one request: the named static tools plus every
   * source-provided tool, filtered to what the actor may even see.
   * Ownership (argument-level) checks happen later, at execution time.
   */
  async resolveFor(
    actor: AIActor,
    allowedToolNames: readonly string[],
    evaluator: AIPermissionEvaluator
  ): Promise<Tool[]> {
    const resolved: Tool[] = [];
    for (const name of allowedToolNames) {
      const tool = this.tools.get(name);
      if (!tool) throw new AIToolNotFoundError(name);
      if (evaluator.canAccess(actor, tool.permissions).allowed) resolved.push(tool);
    }
    for (const source of this.sources.values()) {
      const dynamicTools = await source.listTools(actor);
      for (const tool of dynamicTools) {
        if (resolved.some((t) => t.name === tool.name)) continue;
        if (evaluator.canAccess(actor, tool.permissions).allowed) resolved.push(tool);
      }
    }
    return resolved;
  }
}
