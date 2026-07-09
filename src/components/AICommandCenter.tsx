import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  ChevronDown,
  Loader2,
  Send,
  Sparkles,
  X,
  AlertCircle,
} from "lucide-react";
import { postAiChat, buildAiChatRequestPayload, type AiChatAgentId } from "../services/api";

type AgentOption = {
  id: string;
  label: string;
  apiAgent?: AiChatAgentId;
};

const AGENT_OPTIONS: AgentOption[] = [
  { id: "general", label: "General" },
  { id: "sales", label: "Sales", apiAgent: "sales" },
  { id: "finance", label: "Finance", apiAgent: "finance" },
  { id: "operations", label: "Operations", apiAgent: "operations" },
  { id: "support", label: "Support", apiAgent: "support" },
  { id: "procurement", label: "Procurement", apiAgent: "procurement" },
  { id: "ceo", label: "CEO", apiAgent: "ceo" },
];

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  meta?: {
    model: string;
    latencyMs: number;
    totalTokens: number;
    costUsd: number;
  };
};

export interface AICommandCenterProps {
  /** Adjust FAB position for customer bottom nav. */
  layout?: "staff" | "customer";
}

function nextId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function AICommandCenter({ layout = "staff" }: AICommandCenterProps) {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState("general");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useBusinessContext, setUseBusinessContext] = useState(false);
  const [expandedMeta, setExpandedMeta] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectedAgent = AGENT_OPTIONS.find((a) => a.id === agentId) ?? AGENT_OPTIONS[0]!;

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (open) {
      scrollToBottom();
      const t = window.setTimeout(() => inputRef.current?.focus(), 120);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open, messages, scrollToBottom]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setError(null);
    setInput("");
    const userMsg: ChatMessage = { id: nextId(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const payload = buildAiChatRequestPayload({
        message: text,
        conversationId,
        agent: selectedAgent.apiAgent,
        includeBusinessContext: useBusinessContext,
      });

      const result = await postAiChat(payload);
      setConversationId(result.conversationId);

      const assistantMsg: ChatMessage = {
        id: result.id,
        role: "assistant",
        text: result.response || "(No response text)",
        meta: {
          model: result.model,
          latencyMs: result.latencyMs,
          totalTokens: result.tokens.totalTokens,
          costUsd: result.costUsd,
        },
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "AI chat request failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const fabClass =
    layout === "customer"
      ? "fixed right-5 z-[60] bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))]"
      : "fixed bottom-6 right-6 z-[60]";

  const drawer =
    open && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[9998] flex justify-end" role="presentation">
            <button
              type="button"
              aria-label="Close AI assistant"
              className="absolute inset-0 bg-black/60 backdrop-blur-[2px] border-0 cursor-default"
              onClick={() => setOpen(false)}
            />
            <aside
              className="relative flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-950 shadow-2xl shadow-black/50"
              role="dialog"
              aria-modal="true"
              aria-label="AI Command Center"
            >
              <header className="shrink-0 border-b border-slate-800/80 bg-gradient-to-r from-slate-900 to-slate-950 px-4 py-4 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30">
                      <Sparkles className="h-5 w-5 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold text-white tracking-tight">AI Command Center</h2>
                      <p className="text-[10px] text-amber-400/90 font-medium mt-0.5">
                        Read-only AI Assistant — actions disabled
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {AGENT_OPTIONS.map((opt) => {
                    const active = agentId === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={loading}
                        onClick={() => setAgentId(opt.id)}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition border ${
                          active
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                            : "bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-200"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                <p className="mt-2 text-[10px] text-slate-500">
                  <kbd className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 font-mono text-[9px]">
                    {typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl"}+K
                  </kbd>{" "}
                  toggle · Enter send · Shift+Enter new line
                </p>

                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5">
                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={useBusinessContext}
                      disabled={loading}
                      onChange={(e) => setUseBusinessContext(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 text-amber-500 focus:ring-amber-500/40"
                    />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold text-slate-200">
                        Use safe business context
                      </span>
                      <span className="block mt-1 text-[10px] text-slate-500 leading-relaxed">
                        Only permission-filtered summaries are shared. No raw customer, invoice,
                        phone, address, CNIC, bank, or private-note data is sent.
                      </span>
                    </span>
                  </label>
                </div>
              </header>

              {useBusinessContext && (
                <div className="shrink-0 px-4 pt-3 sm:px-5">
                  <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold text-sky-300">
                    Business context on
                  </span>
                </div>
              )}

              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-4 py-4 space-y-3 sm:px-5"
              >
                {messages.length === 0 && !loading && (
                  <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-4 py-8 text-center">
                    <Bot className="mx-auto h-8 w-8 text-slate-600 mb-3" />
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Ask about Sunchaser processes, solar concepts, or your role workflow.
                      This assistant is read-only — no CRM actions will run.
                    </p>
                  </div>
                )}

                {messages.map((msg) => {
                  const isUser = msg.role === "user";
                  const metaOpen = expandedMeta[msg.id] ?? false;
                  return (
                    <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                          isUser
                            ? "bg-amber-500/15 text-amber-50 border border-amber-500/25 rounded-tr-sm"
                            : "bg-slate-900 text-slate-200 border border-slate-800 rounded-tl-sm"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                        {!isUser && msg.meta && (
                          <div className="mt-2 border-t border-slate-800/80 pt-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedMeta((prev) => ({ ...prev, [msg.id]: !metaOpen }))
                              }
                              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition"
                            >
                              <ChevronDown
                                className={`h-3 w-3 transition ${metaOpen ? "rotate-180" : ""}`}
                              />
                              Response metadata
                            </button>
                            {metaOpen && (
                              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-slate-500 font-mono">
                                <div>
                                  <dt className="text-slate-600">model</dt>
                                  <dd className="text-slate-300 truncate">{msg.meta.model}</dd>
                                </div>
                                <div>
                                  <dt className="text-slate-600">latency</dt>
                                  <dd className="text-slate-300">{msg.meta.latencyMs}ms</dd>
                                </div>
                                <div>
                                  <dt className="text-slate-600">tokens</dt>
                                  <dd className="text-slate-300">{msg.meta.totalTokens}</dd>
                                </div>
                                <div>
                                  <dt className="text-slate-600">cost</dt>
                                  <dd className="text-slate-300">${msg.meta.costUsd.toFixed(4)}</dd>
                                </div>
                              </dl>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {loading && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                      Thinking…
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="shrink-0 mx-4 mb-2 flex items-start gap-2 rounded-xl border border-rose-900/50 bg-rose-950/40 px-3 py-2.5 text-xs text-rose-200 sm:mx-5">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                  <p className="leading-relaxed">{error}</p>
                </div>
              )}

              <footer className="shrink-0 border-t border-slate-800 bg-slate-900/80 p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onInputKeyDown}
                    disabled={loading}
                    rows={2}
                    placeholder="Message the assistant…"
                    className="flex-1 resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={loading || !input.trim()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-lg shadow-amber-500/20"
                    aria-label="Send message"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </footer>
            </aside>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${fabClass} group flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 shadow-xl shadow-amber-500/25 hover:scale-105 hover:shadow-amber-500/40 active:scale-95 transition-all`}
        aria-label="Open AI Command Center"
        title="AI Command Center (Ctrl+K)"
      >
        <Sparkles className="h-6 w-6 group-hover:rotate-12 transition-transform" />
      </button>
      {drawer}
    </>
  );
}
