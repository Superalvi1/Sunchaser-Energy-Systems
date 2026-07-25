/**
 * PR 2 Inbox API router — mounted at `/api/inbox` (Step 4A / 4B).
 *
 * Controllers use the service layer exclusively. JWT is enforced by the global
 * authorization middleware; this router adds inbox RBAC (Approved + crm_leads).
 *
 * Production send strategy: inject real outbound transport when WhatsApp is
 * enabled+configured; otherwise disable POST /messages/send (503, no claim).
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import type { RequestActor } from "../middleware/actor.ts";
import {
  createInboxControllers,
  type InboxControllerDeps,
  type InboxControllers,
  type InboxSendPort,
} from "./whatsappInboxControllers.ts";
import { inboxFail } from "./whatsappInboxHttp.ts";
import { canViewInbox } from "./whatsappInboxPermissions.ts";
import {
  createDefaultWhatsAppInboxRepositories,
  createInMemoryWhatsAppInboxRepositories,
  type WhatsAppInboxRepositories,
} from "./whatsappInboxRepository.ts";
import {
  createWhatsAppInboxServices,
  type CreateWhatsAppInboxServicesOptions,
  type WhatsAppInboxServices,
} from "./whatsappInboxServices.ts";
import { createInboxOutboundSendPort } from "./whatsappInboxSendTransport.ts";
import type { MessagingRepository } from "../unifiedMessaging/messagingRepository.ts";

export type WhatsAppInboxRouterDeps = {
  /** Injected services (tests). When omitted, built from repositories. */
  services?: WhatsAppInboxServices;
  repositories?: WhatsAppInboxRepositories;
  serviceOptions?: CreateWhatsAppInboxServicesOptions;
  /**
   * Outbound transport for POST /messages/send.
   * - omit: resolve production port via createInboxOutboundSendPort()
   * - null: explicitly disable send
   * - function: use injected port (tests / custom wiring)
   */
  sendPort?: InboxSendPort | null;
  /**
   * Optional factory used when `sendPort` is omitted (tests of production
   * resolution). Defaults to createInboxOutboundSendPort.
   */
  resolveSendPort?: () => InboxSendPort | null;
  /**
   * Explicit send feature flag. Defaults to true iff a send port is available.
   */
  sendEnabled?: boolean;
  /** Force in-memory repos when services/repos not provided (tests only). */
  useInMemory?: boolean;
  /** Optional connection-status resolver (tests). */
  getConnectionStatus?: InboxControllerDeps["getConnectionStatus"];
  /** Task 5B: normalized messaging dual-write for inbox outbound send. */
  messagingRepository?: MessagingRepository | null;
};

/**
 * RBAC gate for inbox routes. Runs after global JWT hydration.
 * Requires Approved staff with crm_leads (canViewInbox).
 */
export function requireInboxRbac(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const actor = req.actor as RequestActor | undefined;
  if (!actor) {
    inboxFail(res, 401, "unauthorized", "Unauthorized");
    return;
  }
  if (!canViewInbox(actor)) {
    inboxFail(res, 403, "forbidden", "Inbox access denied");
    return;
  }
  next();
}

function resolveServices(deps: WhatsAppInboxRouterDeps): WhatsAppInboxServices {
  if (deps.services) return deps.services;
  const repos =
    deps.repositories ??
    (deps.useInMemory
      ? createInMemoryWhatsAppInboxRepositories()
      : createDefaultWhatsAppInboxRepositories());
  return createWhatsAppInboxServices(repos, deps.serviceOptions);
}

function resolveOutboundSendPort(
  deps: WhatsAppInboxRouterDeps
): InboxSendPort | null {
  if (deps.sendPort !== undefined) return deps.sendPort;
  if (deps.resolveSendPort) return deps.resolveSendPort();
  return createInboxOutboundSendPort({
    messagingRepository: deps.messagingRepository,
  });
}

export function createWhatsAppInboxRouter(
  deps: WhatsAppInboxRouterDeps = {}
): Router {
  const router = Router();
  const sendPort = resolveOutboundSendPort(deps);
  const sendEnabled = deps.sendEnabled ?? sendPort != null;
  let controllers: InboxControllers | null = null;

  const getControllers = (): InboxControllers => {
    if (controllers) return controllers;
    const services = resolveServices(deps);
    controllers = createInboxControllers(services, {
      sendPort: sendPort ?? undefined,
      sendEnabled,
      getConnectionStatus: deps.getConnectionStatus,
    });
    return controllers;
  };

  const run =
    (handler: (c: InboxControllers, req: Request, res: Response) => unknown) =>
    async (req: Request, res: Response) => {
      try {
        await handler(getControllers(), req, res);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/Supabase|inbox repositories require/i.test(message)) {
          inboxFail(
            res,
            503,
            "service_unavailable",
            "Inbox persistence is unavailable"
          );
          return;
        }
        throw err;
      }
    };

  router.use(requireInboxRbac);

  router.get(
    "/conversations",
    run((c, req, res) => c.listConversations(req, res))
  );
  router.get(
    "/conversations/:conversationId",
    run((c, req, res) => c.getConversation(req, res))
  );
  router.get(
    "/conversations/:conversationId/messages",
    run((c, req, res) => c.listMessages(req, res))
  );
  router.get(
    "/delta",
    run((c, req, res) => c.listDelta(req, res))
  );

  router.post(
    "/messages/send",
    run((c, req, res) => c.sendMessage(req, res))
  );
  router.post(
    "/messages/read",
    run((c, req, res) => c.markRead(req, res))
  );
  // Alias — same inbound watermark contract as POST /messages/read.
  router.post(
    "/watermark",
    run((c, req, res) => c.markRead(req, res))
  );

  router.post(
    "/assign",
    run((c, req, res) => c.assign(req, res))
  );
  router.post(
    "/unassign",
    run((c, req, res) => c.unassign(req, res))
  );
  router.post(
    "/status",
    run((c, req, res) => c.updateStatus(req, res))
  );

  router.post(
    "/crm/link",
    run((c, req, res) => c.linkCrm(req, res))
  );
  router.post(
    "/crm/create-lead",
    run((c, req, res) => c.createLead(req, res))
  );
  router.delete(
    "/crm/link",
    run((c, req, res) => c.unlinkCrm(req, res))
  );

  router.get(
    "/admin/whatsapp/connection-status",
    run((c, req, res) => c.getConnectionStatus(req, res))
  );
  router.post(
    "/admin/whatsapp/embedded-signup/state",
    run((c, req, res) => c.generateEmbeddedSignupState(req, res))
  );
  router.post(
    "/admin/whatsapp/embedded-signup",
    run((c, req, res) => c.processEmbeddedSignup(req, res))
  );
  router.post(
    "/admin/whatsapp/disconnect",
    run((c, req, res) => c.disconnectWhatsApp(req, res))
  );
  router.get(
    "/admin/whatsapp/diagnostics",
    run((c, req, res) => c.getOnboardingDiagnostics(req, res))
  );
  router.post(
    "/admin/whatsapp/test-connection",
    run((c, req, res) => c.testWhatsAppConnection(req, res))
  );

  return router;
}
