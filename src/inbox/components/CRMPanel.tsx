import {
  ExternalLink,
  FileText,
  FolderKanban,
  Loader2,
  UserPlus,
  Users,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import type { InboxConversationDetail } from "../types";
import { displayContactLabel } from "../utils/format";

type CRMPanelProps = {
  detail: InboxConversationDetail | undefined;
  isLoading?: boolean;
  creatingLead?: boolean;
  onCreateLead: () => void;
  onOpenCrm: () => void;
};

function Row({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-[var(--inbox-border)] py-2.5 last:border-0">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--inbox-muted)]">
          {label}
        </p>
        <p className="mt-0.5 text-sm text-[var(--inbox-fg)]">{value}</p>
      </div>
      {action}
    </div>
  );
}

export default function CRMPanel({
  detail,
  isLoading,
  creatingLead,
  onCreateLead,
  onOpenCrm,
}: CRMPanelProps) {
  if (isLoading) {
    return (
      <aside
        className="flex h-full items-center justify-center border-l border-[var(--inbox-border)] bg-[var(--inbox-surface)]"
        aria-label="CRM panel loading"
        aria-busy="true"
      >
        <Loader2 className="h-5 w-5 animate-spin text-[var(--inbox-muted)]" />
      </aside>
    );
  }

  if (!detail) {
    return (
      <aside
        className="hidden h-full border-l border-[var(--inbox-border)] bg-[var(--inbox-surface)] p-4 lg:block"
        aria-label="CRM panel"
      >
        <p className="text-xs text-[var(--inbox-muted)]">
          Select a conversation to view CRM context.
        </p>
      </aside>
    );
  }

  const { conversation, crmLink } = detail;
  const contact = displayContactLabel(conversation);

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l border-[var(--inbox-border)] bg-[var(--inbox-surface)]"
      aria-label="CRM panel"
    >
      <div className="border-b border-[var(--inbox-border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--inbox-fg)]">CRM</h2>
        <p className="text-xs text-[var(--inbox-muted)]">Linked records</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <Row label="Customer" value={contact} />
        <Row
          label="Lead"
          value={
            crmLink?.linkedEntityType === "lead"
              ? crmLink.linkedEntityId
              : "Not linked"
          }
        />
        <Row
          label="Customer record"
          value={
            crmLink?.linkedEntityType === "customer"
              ? crmLink.linkedEntityId
              : "—"
          }
        />
        <Row label="Project" value="—" />
        <Row label="Quotation" value="—" />
        <Row label="Survey" value="—" />
        <Row label="Payment" value="—" />
        <Row label="Warranty" value="—" />
        <Row label="Tickets" value="—" />

        <div className="mt-3 rounded-xl border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--inbox-muted)]">
            Recent activity
          </p>
          <ul className="mt-2 space-y-2 text-xs text-[var(--inbox-fg)]">
            <li className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-[var(--inbox-muted)]" aria-hidden />
              Conversation {conversation.status}
            </li>
            <li className="flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-[var(--inbox-muted)]" aria-hidden />
              Updated {new Date(conversation.updatedAt).toLocaleString()}
            </li>
            {crmLink ? (
              <li className="flex items-center gap-2">
                <FolderKanban
                  className="h-3.5 w-3.5 text-[var(--inbox-muted)]"
                  aria-hidden
                />
                Linked {crmLink.linkedEntityType} · {crmLink.linkedEntityId}
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-[var(--inbox-border)] p-3">
        <button
          type="button"
          onClick={onOpenCrm}
          aria-label="Open customer in CRM"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--inbox-border)] px-2 py-2 text-xs font-medium text-[var(--inbox-fg)] hover:bg-[var(--inbox-surface-2)]"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Open Customer
        </button>
        <button
          type="button"
          disabled
          aria-label="Open project (unavailable)"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--inbox-border)] px-2 py-2 text-xs font-medium text-[var(--inbox-muted)] opacity-50"
        >
          <FolderKanban className="h-3.5 w-3.5" aria-hidden />
          Open Project
        </button>
        <button
          type="button"
          disabled
          aria-label="Open quote (unavailable)"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--inbox-border)] px-2 py-2 text-xs font-medium text-[var(--inbox-muted)] opacity-50"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Open Quote
        </button>
        <button
          type="button"
          onClick={onCreateLead}
          disabled={creatingLead || Boolean(crmLink)}
          aria-label="Create lead from conversation"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--inbox-accent)] px-2 py-2 text-xs font-semibold text-neutral-950 hover:opacity-90 disabled:opacity-40"
        >
          {creatingLead ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
          )}
          Create Lead
        </button>
      </div>
    </aside>
  );
}
