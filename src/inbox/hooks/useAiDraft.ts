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
  /** Immediate mutex — blocks duplicate calls before React re-renders. */
  const generateLockRef = useRef(false);

  // Clear draft when switching conversations — prevents cross-customer leak.
  useEffect(() => {
    activeConversationRef.current = conversationId;
    generateLockRef.current = false;
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
    async (input: { messageId?: string; messageText?: string } = {}) => {
      if (!conversationId) return;
      // Ref/mutex guard must run before any await or setState so two synchronous
      // clicks cannot both enter generation before status becomes "loading".
      if (generateLockRef.current) return;
      generateLockRef.current = true;

      const generationId = ++inflightRef.current;
      const requestConversationId = conversationId;
      setState((prev) => ({
        ...prev,
        status: "loading",
        errorMessage: null,
        reasonCode: null,
      }));

      try {
        const outcome = await generateInboxAiDraft({
          conversationId: requestConversationId,
          messageId: input.messageId,
          messageText: input.messageText,
        });

        if (
          generationId !== inflightRef.current ||
          activeConversationRef.current !== requestConversationId
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
          conversationId: requestConversationId,
          draft: outcome,
          editableText: outcome.answer,
          errorMessage: null,
          reasonCode: null,
        });
      } catch (err) {
        if (
          generationId !== inflightRef.current ||
          activeConversationRef.current !== requestConversationId
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
      } finally {
        // Only the current generation releases the lock; stale generations leave
        // the lock to the newer owner / conversation-switch reset.
        if (generationId === inflightRef.current) {
          generateLockRef.current = false;
        }
      }
    },
    [conversationId]
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
