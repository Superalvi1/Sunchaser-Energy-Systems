import React from "react";
import { ChevronRight, LogOut, MoreHorizontal, User as UserIcon, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { mobileUi } from "../../lib/mobileUi";
import AppLogo from "../AppLogo";
import AppModal from "../ui/AppModal";

export type ShellTab = { id: string; label: string; icon: LucideIcon };

/**
 * Mobile app shell for the staff/admin surface.
 *
 * Only rendered below the `md` breakpoint. Desktop keeps its existing header +
 * horizontal tab strip untouched — nothing here is shared with it.
 *
 * Navigation is derived from the caller's allowed-tab list rather than a fixed
 * set, because `getAllowedTabs()` returns between one and six tabs depending on
 * role. A hardcoded Dashboard/CRM/Sales bar would offer Sales Executives a
 * Dashboard they cannot open, and Accounts Managers a Sales tab they do not have.
 * Taking the first three allowed tabs keeps the intended shape for Super Admin
 * while staying correct for every other role, and grants no new access.
 */

type TopBarProps = {
  title: string;
  userName?: string;
  onProfile?: () => void;
};

export function MobileTopBar({ title, userName, onProfile }: TopBarProps) {
  return (
    <header className={mobileUi.topBar}>
      <div className={mobileUi.topBarInner}>
        <AppLogo className="h-7 w-auto shrink-0" />
        <h1 className={mobileUi.topBarTitle}>{title}</h1>
        <button
          type="button"
          onClick={onProfile}
          aria-label={userName ? `Account: ${userName}` : "Account"}
          className={mobileUi.topBarBtn}
        >
          <UserIcon className={mobileUi.iconSm} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

type BottomNavProps = {
  tabs: ShellTab[];
  activeTab: string;
  onSelect: (id: string) => void;
  onMore: () => void;
  moreActive: boolean;
};

export function MobileBottomNav({ tabs, activeTab, onSelect, onMore, moreActive }: BottomNavProps) {
  // Three primary slots + More. Slots come from the role's own allowed tabs.
  const primary = tabs.slice(0, 3);
  return (
    <nav className={mobileUi.bottomNav} aria-label="Primary">
      <div className={mobileUi.bottomNavInner}>
        {primary.map((tab) => {
          const Icon = tab.icon;
          const active = !moreActive && activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              aria-current={active ? "page" : undefined}
              className={`${mobileUi.bottomNavBtn} ${active ? mobileUi.bottomNavActive : mobileUi.bottomNavIdle}`}
            >
              <Icon className={mobileUi.icon} aria-hidden="true" />
              <span className={mobileUi.bottomNavLabel}>{shortLabel(tab)}</span>
              {active && <span className="mt-0.5 h-0.5 w-6 rounded-full bg-amber-400" aria-hidden="true" />}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          aria-current={moreActive ? "page" : undefined}
          className={`${mobileUi.bottomNavBtn} ${moreActive ? mobileUi.bottomNavActive : mobileUi.bottomNavIdle}`}
        >
          <MoreHorizontal className={mobileUi.icon} aria-hidden="true" />
          <span className={mobileUi.bottomNavLabel}>More</span>
          {moreActive && <span className="mt-0.5 h-0.5 w-6 rounded-full bg-amber-400" aria-hidden="true" />}
        </button>
      </div>
    </nav>
  );
}

/** Bottom-nav labels are tight; use a short form without changing the tab's real label. */
function shortLabel(tab: ShellTab): string {
  const map: Record<string, string> = {
    "Admin Dashboard": "Dashboard",
    "CRM Database": "CRM",
    "Sales Advisor": "Sales",
    "Installer Deck": "Installer",
    "Sunchaser AI": "AI",
    "Activity Telemetry": "Activity",
    "Field Portal": "Field",
    "Customer Portal": "Home",
  };
  return map[tab.id] ?? tab.label;
}

type MoreSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Allowed tabs that did not fit in the bottom bar. */
  overflowTabs: ShellTab[];
  onSelectTab: (id: string) => void;
  userName?: string;
  userRole?: string;
  onLogout?: () => void;
  /** Module groups (Reports & Analytics, Business & Finance, …) rendered as rows. */
  children?: React.ReactNode;
};

export function MobileMoreSheet({
  open,
  onClose,
  overflowTabs,
  onSelectTab,
  userName,
  userRole,
  onLogout,
  children,
}: MoreSheetProps) {
  return (
    <AppModal open={open} onClose={onClose} panelClassName="max-w-lg">
      <div className="safe-area-top max-h-[88vh] overflow-y-auto rounded-3xl border border-slate-800 bg-slate-950 p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="app-chrome mb-3 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-bold text-slate-100">More</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={mobileUi.topBarBtn}>
            <X className={mobileUi.iconSm} aria-hidden="true" />
          </button>
        </div>

        {userName && (
          <div className="mb-3 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <UserIcon className={mobileUi.iconSm} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-slate-100">{userName}</span>
              {userRole && (
                <span className="block truncate text-[10px] uppercase tracking-wide text-amber-500">{userRole}</span>
              )}
            </span>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                aria-label="Log out"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-900/40 bg-red-950/45 text-red-400"
              >
                <LogOut className={mobileUi.iconSm} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {overflowTabs.length > 0 && (
          <div className="app-chrome mb-3 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            {overflowTabs.map((tab, i) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(tab.id);
                    onClose();
                  }}
                  className={`${mobileUi.listRow} ${i > 0 ? "border-t border-slate-800" : ""} hover:bg-slate-800/50`}
                >
                  <Icon className={`${mobileUi.iconSm} shrink-0 text-amber-400`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">{tab.label}</span>
                  <ChevronRight className={`${mobileUi.iconSm} shrink-0 text-slate-600`} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}

        {children}
      </div>
    </AppModal>
  );
}
