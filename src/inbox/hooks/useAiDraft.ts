/**
 * AI-03 in-memory draft state — never persists to browser web storage APIs.
 * Scoped per conversation; switching conversations clears the prior draft.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { generateInboxAiDraft } from "../api/inboxApi";
import { InboxClientError } from "../types";
import type { InboxAiDraftResult } from "../types";

export type AiDraftUiStatus =
  | "idle"
  | "loading"
  | "ready"
  | "timeout"
  | "failure"
  | "unavailable"
  | "denied";

export type AiDraftUiState = {
  status: AiDraftUiStatus;
  conversationId: string | null;
  draft: InboxAiDraftResult | null;
  /** Editable copy of draft.answer — never auto-sent. */
  editableText: string;
  errorMessage: string | null;
  reasonCode: string | null;
};

const INITIAL: AiDraftUiState = {
  status: "idle",
  conversationId: null,
  draft: null,
  editableText: "",
  errorMessage: null,
  reasonCode: null,
};

function mapError(err: unknown): Pick<
  AiDraftUiState,
  "status" | "errorMessage" | "reasonCode"
> {
  if (err instanceof InboxClientError) {
    const code = err.code;
    if (
      code === "feature_disabled" ||
      code === "provider_unavailable" ||
      code === "config_unavailable" ||
      code === "send_unavailable"
    ) {
      return {
        status: "unavailable",
        errorMessage: err.message,
        reasonCode: code,
      };
    }
    if (code === "timeout") {
      return {
        status: "timeout",
        errorMessage: err.message,
        reasonCode: code,
      };
    }
    return {
      status: code === "forbidden" || code === "unauthorized" ? "denied" : "failure",
      errorMessage: err.message,
      reasonCode: code,
    };
  }
  const message = err instanceof Error ? err.message : "AI draft failed";
  if (/timed?\s*out/i.test(message)) {
    return { status: "timeout", errorMessage: message, reasonCode: "timeout" };
  }
  return { status: "failure", errorMessage: message, reasonCode: "failure" };
}

export function useAiDraft(conversationId: string | null) {
  const [state, setState] = useState<AiDraftUiState>(INITIAL);
  const inflightRef = useRef(0);
  const activeConversationRef = useRef<string | null>(conversationId);

  // Clear draft when switching conversations — prevents cross-customer leak.
  useEffect(() => {
    activeConversationRef.current = conversationId;
    setState({
      ...INITIAL,
      conversationId,
    });
    inflightRef.current += 1; // invalidate in-flight responses
  }, [conversationId]);

  const setEditableText = useCallback((text: string) => {
    setState((prev) => ({ ...prev, editableText: text }));
  }, []);

  const discard = useCallback(() => {
    setState((prev) => ({
      ...INITIAL,
      conversationId: prev.conversationId,
    }));
  }, []);

  const generate = useCallback(
    async (input: { messageText: string; messageId?: string }) => {
      if (!conversationId) return;
      if (state.status === "loading") return; // prevent duplicate clicks

      const generationId = ++inflightRef.current;
      setState((prev) => ({
        ...prev,
        status: "loading",
        errorMessage: null,
        reasonCode: null,
      }));

      try {
        const outcome = await generateInboxAiDraft({
          conversationId,
          messageText: input.messageText,
          messageId: input.messageId,
        });

        if (
          generationId !== inflightRef.current ||
          activeConversationRef.current !== conversationId
        ) {
          return; // stale — conversation switched
        }

        if (outcome.status === "denied") {
          setState((prev) => ({
            ...prev,
            status:
              outcome.reasonCode === "feature_disabled" ||
              outcome.reasonCode === "provider_unavailable" ||
              outcome.reasonCode === "config_unavailable"
                ? "unavailable"
                : outcome.reasonCode === "timeout"
                  ? "timeout"
                  : "denied",
            draft: null,
            editableText: "",
            errorMessage: outcome.message,
            reasonCode: outcome.reasonCode,
          }));
          return;
        }

        setState({
          status: "ready",
          conversationId,
          draft: outcome,
          editableText: outcome.answer,
          errorMessage: null,
          reasonCode: null,
        });
      } catch (err) {
        if (
          generationId !== inflightRef.current ||
          activeConversationRef.current !== conversationId
        ) {
          return;
        }
        const mapped = mapError(err);
        setState((prev) => ({
          ...prev,
          ...mapped,
          draft: null,
          editableText: "",
        }));
      }
    },
    [conversationId, state.status]
  );

  return {
    state,
    generate,
    regenerate: generate,
    discard,
    setEditableText,
    isGenerating: state.status === "loading",
  };
}
