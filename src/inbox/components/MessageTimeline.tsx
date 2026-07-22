import {
  Check,
  CheckCheck,
  FileText,
  Image as ImageIcon,
  MapPin,
  Mic,
  RefreshCw,
  Video as VideoIcon,
} from "lucide-react";
import type { InboxMessage } from "../types";
import { formatClock } from "../utils/format";
import { TimelineSkeleton } from "./InboxSkeleton";
import InboxEmptyState from "./InboxEmptyState";
import InboxErrorState from "./InboxErrorState";

type TimelineEvent = {
  id: string;
  kind: "system";
  text: string;
  at: string;
};

type MessageTimelineProps = {
  messages: InboxMessage[];
  events?: TimelineEvent[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onLoadOlder?: () => void;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onRetryFailed?: (message: InboxMessage) => void;
};

function DeliveryIcon({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "read" || s === "played") {
    return <CheckCheck className="h-3.5 w-3.5 text-sky-400" aria-label="Read" />;
  }
  if (s === "delivered") {
    return (
      <CheckCheck className="h-3.5 w-3.5 text-[var(--inbox-muted)]" aria-label="Delivered" />
    );
  }
  if (s === "sent" || s === "accepted") {
    return <Check className="h-3.5 w-3.5 text-[var(--inbox-muted)]" aria-label="Sent" />;
  }
  if (s === "failed" || s === "failed_known") {
    return (
      <span className="text-[10px] font-semibold text-rose-400" aria-label="Failed">
        Failed
      </span>
    );
  }
  return (
    <span className="text-[10px] text-[var(--inbox-muted)]" aria-label="Pending">
      …
    </span>
  );
}

function AttachmentChip({
  kind,
  label,
}: {
  kind: "image" | "pdf" | "voice" | "video" | "location";
  label: string;
}) {
  const Icon =
    kind === "image"
      ? ImageIcon
      : kind === "pdf"
      ? FileText
      : kind === "voice"
      ? Mic
      : kind === "video"
      ? VideoIcon
      : MapPin;
  return (
    <div className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface)]/60 px-2 py-1 text-[11px] text-[var(--inbox-muted)]">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </div>
  );
}

function MessageBody({ message }: { message: InboxMessage }) {
  const type = (message.messageType || "").toLowerCase();
  const caption = message.caption || (type !== "text" ? message.textBody : null);

  if (type === "image") {
    return (
      <div className="space-y-1">
        <AttachmentChip kind="image" label="Image received" />
        {caption ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{caption}</p>
        ) : null}
      </div>
    );
  }

  if (type === "document") {
    const label = message.filename
      ? `Document received (${message.filename})`
      : "Document received";
    return (
      <div className="space-y-1">
        <AttachmentChip kind="pdf" label={label} />
        {caption ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{caption}</p>
        ) : null}
      </div>
    );
  }

  if (type === "voice" || (type === "audio" && message.voice)) {
    return (
      <div className="space-y-1">
        <AttachmentChip kind="voice" label="Voice note received" />
      </div>
    );
  }

  if (type === "audio") {
    return (
      <div className="space-y-1">
        <AttachmentChip kind="voice" label="Audio received" />
      </div>
    );
  }

  if (type === "video") {
    return (
      <div className="space-y-1">
        <AttachmentChip kind="video" label="Video received" />
        {caption ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{caption}</p>
        ) : null}
      </div>
    );
  }

  if (type === "location") {
    const locText = message.placeName
      ? message.placeName + (message.address ? ` (${message.address})` : "")
      : message.address ||
        (message.latitude != null ? `${message.latitude}, ${message.longitude}` : null);
    return (
      <div className="space-y-1">
        <AttachmentChip kind="location" label="Location received" />
        {locText ? (
          <p className="text-xs text-[var(--inbox-muted)]">{locText}</p>
        ) : null}
      </div>
    );
  }

  if (message.textBody) {
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {message.textBody}
      </p>
    );
  }

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed opacity-70">
      Message received
    </p>
  );
}

export default function MessageTimeline({
  messages,
  events = [],
  isLoading,
  isError,
  errorMessage,
  onRetry,
  onLoadOlder,
  hasOlder,
  loadingOlder,
  onRetryFailed,
}: MessageTimelineProps) {
  if (isLoading) return <TimelineSkeleton />;
  if (isError) {
    return (
      <InboxErrorState
        message={errorMessage || "Could not load messages"}
        onRetry={onRetry}
      />
    );
  }

  const systemItems = events.map((e) => ({
    sortAt: e.at,
    node: (
      <div key={e.id} className="flex justify-center py-1">
        <p className="rounded-full bg-[var(--inbox-surface-2)] px-3 py-1 text-[11px] text-[var(--inbox-muted)]">
          {e.text}
        </p>
      </div>
    ),
  }));

  const messageItems = messages.map((m) => {
    const inbound = m.direction === "inbound";
    const failed = /fail/i.test(m.status);
    return {
      sortAt: m.createdAt,
      node: (
        <div
          key={m.id}
          className={`flex ${inbound ? "justify-start" : "justify-end"}`}
        >
          <div
            className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
              inbound
                ? "rounded-tl-md bg-[var(--inbox-bubble-in)] text-[var(--inbox-fg)]"
                : "rounded-tr-md bg-[var(--inbox-bubble-out)] text-[var(--inbox-fg)]"
            }`}
          >
            <MessageBody message={m} />
            <div
              className={`mt-1 flex items-center gap-1.5 ${inbound ? "justify-start" : "justify-end"}`}
            >
              <time
                className="text-[10px] text-[var(--inbox-muted)]"
                dateTime={m.createdAt}
              >
                {formatClock(m.createdAt)}
              </time>
              {!inbound ? <DeliveryIcon status={m.status} /> : null}
              {failed && onRetryFailed ? (
                <button
                  type="button"
                  onClick={() => onRetryFailed(m)}
                  aria-label="Retry failed message"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-400 hover:underline"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden />
                  Retry
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ),
    };
  });

  const items = [...systemItems, ...messageItems].sort((a, b) =>
    a.sortAt < b.sortAt ? -1 : a.sortAt > b.sortAt ? 1 : 0
  );

  if (items.length === 0) {
    return (
      <InboxEmptyState
        title="No messages yet"
        description="Inbound WhatsApp messages and your replies will show here."
      />
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3"
      role="log"
      aria-label="Message timeline"
      aria-live="polite"
    >
      {hasOlder ? (
        <div className="mb-3 flex justify-center">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            aria-label="Load older messages"
            className="rounded-full border border-[var(--inbox-border)] bg-[var(--inbox-surface)] px-3 py-1 text-[11px] text-[var(--inbox-muted)] hover:text-[var(--inbox-fg)] disabled:opacity-50"
          >
            {loadingOlder ? "Loading…" : "Load older"}
          </button>
        </div>
      ) : null}
      <div className="space-y-2">{items.map((i) => i.node)}</div>
    </div>
  );
}
