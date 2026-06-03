import React, { useState } from "react";
import {
  Sun,
  LogOut,
  RefreshCw,
  Loader2,
  Home,
  FolderOpen,
  Shield,
  Headphones,
} from "lucide-react";
import { User } from "../types";
import type { ClientPortalPayload } from "../lib/clientPortalTracker";
import ClientPortalHome from "./ClientPortalHome";
import ClientPortalDocuments from "./ClientPortalDocuments";
import ClientPortalWarranties from "./ClientPortalWarranties";
import ClientPortalSupport from "./ClientPortalSupport";

interface ClientPortalAppProps {
  user: User;
  data: ClientPortalPayload | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onLogout: () => void;
}

type PortalTab = "home" | "documents" | "warranty" | "support";

export default function ClientPortalApp({
  user,
  data,
  loading,
  error,
  onRefresh,
  onLogout,
}: ClientPortalAppProps) {
  const [activeTab, setActiveTab] = useState<PortalTab>("home");
  const projectStatus =
    data?.project?.stage || data?.dashboard?.projectStatus || "No data available";

  const tabs: { id: PortalTab; label: string; icon: React.ElementType }[] = [
    { id: "home", label: "Home", icon: Home },
    { id: "documents", label: "Documents", icon: FolderOpen },
    { id: "warranty", label: "Warranty", icon: Shield },
    { id: "support", label: "Support", icon: Headphones },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-50 bg-slate-900 border-b border-slate-800 shadow-md">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-gradient-to-tr from-amber-400 to-orange-500 p-2 rounded-xl shrink-0">
              <Sun className="h-5 w-5 text-slate-950" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-extrabold truncate">
                {data?.customer?.name || user.name}
              </h1>
              <p className="text-[10px] text-slate-500 font-mono truncate">
                {data?.customer?.email || user.email}
              </p>
              <p className="text-[9px] text-slate-600 font-mono truncate">
                ID: {data?.customer?.id || "No data available"} · {projectStatus}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRefresh}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="p-2 rounded-xl bg-red-950/50 border border-red-900/40 text-red-400"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="border-t border-slate-800/80 px-4 pb-2">
          <div className="max-w-3xl mx-auto flex gap-2 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap ${
                    activeTab === tab.id
                      ? "bg-amber-500 text-slate-950"
                      : "bg-slate-950 text-slate-400 border border-slate-800"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-6 pb-10">
        {activeTab === "home" && (
          <>
            {loading && !data ? (
              <div className="py-20 text-center">
                <Loader2 className="h-10 w-10 text-amber-500 animate-spin mx-auto mb-3" />
                <p className="text-sm text-slate-400">Loading your project…</p>
              </div>
            ) : error ? (
              <div className="bg-rose-950/30 border border-rose-900 rounded-2xl p-6 text-center text-rose-300 text-sm">
                {error}
                <button
                  type="button"
                  onClick={onRefresh}
                  className="mt-4 block mx-auto text-xs font-bold text-amber-400 underline"
                >
                  Try again
                </button>
              </div>
            ) : (
              <ClientPortalHome
                data={data}
                onRequestUpgrade={() => setActiveTab("support")}
                onOpenSupport={() => setActiveTab("support")}
              />
            )}
          </>
        )}

        {activeTab === "documents" && <ClientPortalDocuments user={user} />}
        {activeTab === "warranty" && <ClientPortalWarranties user={user} />}
        {activeTab === "support" && <ClientPortalSupport user={user} />}
      </main>
    </div>
  );
}
