import { authorizedFetch } from "../services/api.ts";

export type LearningStudioLaunchTicket = {
  action: string;
  method: "POST";
  token: string;
  next: string;
  expiresInSeconds: number;
};

export async function requestLearningStudioTicket(
  next = "/"
): Promise<LearningStudioLaunchTicket> {
  const response = await authorizedFetch("/api/learning/sso-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ next }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body?.error === "string"
        ? body.error
        : "Unable to open Sunchaser Learning Studio.";
    throw new Error(message);
  }

  if (
    !body ||
    typeof body.action !== "string" ||
    body.method !== "POST" ||
    typeof body.token !== "string" ||
    typeof body.next !== "string"
  ) {
    throw new Error("Learning Studio returned an invalid launch ticket.");
  }

  return body as LearningStudioLaunchTicket;
}

export function submitLearningStudioTicket(ticket: LearningStudioLaunchTicket): void {
  if (typeof document === "undefined") {
    throw new Error("Learning Studio launch requires a browser.");
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = ticket.action;
  form.target = "_self";
  form.style.display = "none";

  const tokenInput = document.createElement("input");
  tokenInput.type = "hidden";
  tokenInput.name = "token";
  tokenInput.value = ticket.token;

  const nextInput = document.createElement("input");
  nextInput.type = "hidden";
  nextInput.name = "next";
  nextInput.value = ticket.next;

  form.append(tokenInput, nextInput);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export async function openLearningStudio(next = "/"): Promise<void> {
  const ticket = await requestLearningStudioTicket(next);
  submitLearningStudioTicket(ticket);
}
