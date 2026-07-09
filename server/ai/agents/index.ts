import type { AgentDefinition } from "../core/AIRouter.ts";
import { SalesAgent } from "./SalesAgent.ts";
import { FinanceAgent } from "./FinanceAgent.ts";
import { OperationsAgent } from "./OperationsAgent.ts";
import { SupportAgent } from "./SupportAgent.ts";
import { ProcurementAgent } from "./ProcurementAgent.ts";
import { CEOAgent } from "./CEOAgent.ts";

export { SalesAgent, FinanceAgent, OperationsAgent, SupportAgent, ProcurementAgent, CEOAgent };

export const PLATFORM_AGENTS: AgentDefinition[] = [
  SalesAgent,
  FinanceAgent,
  OperationsAgent,
  SupportAgent,
  ProcurementAgent,
  CEOAgent,
];
