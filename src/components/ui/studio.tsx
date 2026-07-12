/**
 * Shared visual primitives for Design Studio / Roof Studio surfaces.
 * Presentation only — no business logic.
 */

import React from "react";
import { Loader2, type LucideIcon } from "lucide-react";

/* ── Panel ─────────────────────────────────────────────────────────── */

export function StudioPanel({
  title,
  icon: Icon,
  children,
  className = "",
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`studio-panel ${className}`}>
      <div className="studio-panel-header">
        <Icon className="studio-panel-icon" aria-hidden />
        <h3 className="studio-panel-title">{title}</h3>
      </div>
      <div className="studio-panel-body">{children}</div>
    </div>
  );
}

/* ── Buttons ───────────────────────────────────────────────────────── */

type StudioBtnVariant = "primary" | "secondary" | "ghost" | "tool" | "tool-active" | "danger";

const BTN_VARIANT: Record<StudioBtnVariant, string> = {
  primary: "studio-btn studio-btn-primary",
  secondary: "studio-btn studio-btn-secondary",
  ghost: "studio-btn studio-btn-ghost",
  tool: "studio-btn studio-btn-tool",
  "tool-active": "studio-btn studio-btn-tool studio-btn-tool-active",
  danger: "studio-btn studio-btn-danger",
};

export function StudioButton({
  children,
  variant = "secondary",
  className = "",
  loading,
  icon: Icon,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: StudioBtnVariant;
  loading?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      className={`${BTN_VARIANT[variant]} ${className}`}
      disabled={props.disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
      ) : Icon ? (
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

export function StudioToolButton({
  active,
  children,
  icon: Icon,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      className={`studio-btn studio-btn-tool ${active ? "studio-btn-tool-active" : ""} ${className}`}
      {...props}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      {children}
    </button>
  );
}

/* ── Empty state ───────────────────────────────────────────────────── */

export function StudioEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
  ...rest
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`studio-empty ${className}`} {...rest}>
      <div className="studio-empty-icon-wrap">
        <Icon className="studio-empty-icon" aria-hidden />
      </div>
      <h3 className="studio-empty-title">{title}</h3>
      <p className="studio-empty-desc">{description}</p>
      {action && <div className="studio-empty-action">{action}</div>}
    </div>
  );
}

/* ── Gate / status ─────────────────────────────────────────────────── */

export function StudioGateNote({ reason }: { reason: string | null | undefined }) {
  if (!reason) return null;
  return <p className="studio-gate-note">{reason}</p>;
}

export function StudioStatusLine({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}) {
  return (
    <div className="studio-status-line">
      <span className={ok ? "studio-status-dot studio-status-dot-ok" : "studio-status-dot"} />
      <span>{label}</span>
    </div>
  );
}

export function StudioRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="studio-row">
      <span className="studio-row-label">{label}</span>
      <span className="studio-row-value">{value}</span>
    </div>
  );
}

/* ── Loading ───────────────────────────────────────────────────────── */

export function StudioSpinner({ label }: { label?: string }) {
  return (
    <div className="studio-spinner" role="status">
      <Loader2 className="h-4 w-4 animate-spin text-amber-400" aria-hidden />
      {label && <span className="studio-spinner-label">{label}</span>}
    </div>
  );
}

export function StudioSkeleton({ className = "" }: { className?: string }) {
  return <div className={`studio-skeleton ${className}`} aria-hidden />;
}

/* ── Page chrome ───────────────────────────────────────────────────── */

export function StudioPageHeader({
  icon: Icon,
  title,
  badges,
  description,
}: {
  icon: LucideIcon;
  title: string;
  badges?: React.ReactNode;
  description: string;
}) {
  return (
    <div className="studio-page-header">
      <div className="studio-page-header-icon">
        <Icon className="h-5 w-5 text-amber-400" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="studio-page-title">{title}</h2>
          {badges}
        </div>
        <p className="studio-page-desc">{description}</p>
      </div>
    </div>
  );
}

export function StudioBadge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "accent" | "muted";
}) {
  const cls =
    variant === "accent"
      ? "studio-badge studio-badge-accent"
      : variant === "muted"
        ? "studio-badge studio-badge-muted"
        : "studio-badge";
  return <span className={cls}>{children}</span>;
}
