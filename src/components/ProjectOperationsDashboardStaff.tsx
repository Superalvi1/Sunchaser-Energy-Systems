import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  ClipboardList,
  Loader2,
  Phone,
  Truck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { User as StaffUser } from "../types";
import { fetchProjectOperationsDashboard, fetchProjectOperationsDetail } from "../services/api";
import {
  PIPELINE_STAGES,
  canViewProjectOperations,
  isOperationsCeoMode,
  type KanbanColumnKey,
  type OperationsProjectCard,
  type PipelineStageKey,
  type ProjectOperationsDashboard,
  type ProjectOperationsDetail,
} from "../lib/projectOperations";

const KANBAN_COLUMNS: { key: KanbanColumnKey; label: string; color: string }[] = [
  { key: "survey", label: "Survey", color: "border-sky-500/40 bg-sky-500/5" },
  { key: "procurement", label: "Procurement", color: "border-amber-500/40 bg-amber-500/5" },
  { key: "installation", label: "Installation", color: "border-violet-500/40 bg-violet-500/5" },
  { key: "net_metering", label: "Net Metering", color: "border-cyan-500/40 bg-cyan-500/5" },
  { key: "completed", label: "Completed", color: "border-emerald-500/40 bg-emerald-500/5" },
];

const DELAY_CLASS = {
  green: "border-emerald-500/30",
  amber: "border-amber-500/40",
  red: "border-red-500/50 bg-red-950/20",
};

function KpiCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{label}</div>
      <div className="mt-2 text-xl font-extrabold text-neutral-50">{value}</div>
    </div>
  );
}

function ProjectCard({
  p,
  onClick,
}: {
  p: OperationsProjectCard;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-3 transition hover:ring-1 hover:ring-amber-500/30 ${DELAY_CLASS[p.delayTone]}`}
    >
      <div className="font-bold text-neutral-100 text-xs truncate">{p.customerName}</div>
      <div className="text-[10px] text-neutral-500 mt-0.5">{p.customerPhone || "—"}</div>
      <div className="text-[10px] text-neutral-400 mt-2">
        {p.systemSizeKw ? `${p.systemSizeKw} kW` : "—"} · {p.location?.slice(0, 28) || "—"}
      </div>
      <div className="flex justify-between items-center mt-2 text-[9px]">
        <span className="text-violet-300">{p.assignedTeam}</span>
        <span className="text-neutral-500">{p.daysInStage}d in stage</span>
      </div>
      <div className="text-[9px] text-amber-400/80 mt-1 truncate">{p.completionStage}</div>
    </button>
  );
}

export default function ProjectOperationsDashboardStaff({ staffUser }: { staffUser: StaffUser }) {
  const allowed = canViewProjectOperations(staffUser.username, staffUser.role);
  const ceoMode = isOperationsCeoMode(staffUser.username, staffUser.role);
  const [data, setData] = useState<ProjectOperationsDashboard | null>(null);
  const [detail, setDetail] = useState<ProjectOperationsDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stageFilter, setStageFilter] = useState<PipelineStageKey | "all">("all");
  const [kanbanFilter, setKanbanFilter] = useState<KanbanColumnKey | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchProjectOperationsDashboard(staffUser);
      setData(res as ProjectOperationsDashboard);
    } catch (e: any) {
      setError(e.message || "Failed to load operations dashboard.");
    } finally {
      setLoading(false);
    }
  }, [staffUser]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetchProjectOperationsDetail(staffUser, id);
      setDetail(res as ProjectOperationsDetail);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  const filteredKanban = useMemo(() => {
    if (!data) return KANBAN_COLUMNS.map((c) => ({ ...c, items: [] as OperationsProjectCard[] }));
    return KANBAN_COLUMNS.map((col) => {
      let items = data.kanban[col.key] || [];
      if (stageFilter !== "all") {
        items = items.filter((p) => p.pipelineStage === stageFilter);
      }
      if (kanbanFilter !== "all" && kanbanFilter !== col.key) {
        items = [];
      }
      return { ...col, items };
    });
  }, [data, stageFilter, kanbanFilter]);

  const filteredDelays = useMemo(() => {
    if (!data) return [];
    let rows = data.delays;
    if (stageFilter !== "all") rows = rows.filter((p) => p.pipelineStage === stageFilter);
    if (kanbanFilter !== "all") rows = rows.filter((p) => p.kanbanColumn === kanbanFilter);
    return rows;
  }, [data, stageFilter, kanbanFilter]);

  if (!allowed) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-400">
        Project Operations Dashboard is available to management users.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-neutral-400">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading operations dashboard…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-6 text-red-300 text-sm">
        {error || "No data"}
        <button type="button" onClick={load} className="ml-3 underline text-xs">Retry</button>
      </div>
    );
  }

  const fmt = (n: number) => `PKR ${Math.round(n).toLocaleString("en-PK")}`;

  return (
    <div className="space-y-6 pb-8 relative">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-neutral-100 flex items-center gap-2">
            <Truck className="h-5 w-5 text-amber-400" />
            Project Operations
          </h2>
          <p className="text-[11px] text-neutral-500 mt-1">Pipeline, delays, and team workload</p>
        </div>
        <button type="button" onClick={load} className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-300">
          Refresh
        </button>
      </div>

      {ceoMode && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Projects Active" value={data.ceoSummary.projectsActive} accent="border-violet-500/30 bg-violet-500/5" />
          <KpiCard label="Projects Delayed" value={data.ceoSummary.projectsDelayed} accent="border-red-500/30 bg-red-500/5" />
          <KpiCard label="Awaiting Net Metering" value={data.ceoSummary.awaitingNetMetering} accent="border-cyan-500/30 bg-cyan-500/5" />
          <KpiCard label="Completed (Month)" value={data.ceoSummary.completedThisMonth} accent="border-emerald-500/30 bg-emerald-500/5" />
          <KpiCard label="Revenue In Progress" value={fmt(data.ceoSummary.estimatedRevenueInProgress)} accent="border-amber-500/30 bg-amber-500/5" />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard label="In Progress" value={data.summary.projectsInProgress} accent="border-violet-500/35 bg-violet-500/10" />
        <KpiCard label="Waiting Survey" value={data.summary.waitingSurvey} accent="border-sky-500/35 bg-sky-500/10" />
        <KpiCard label="Waiting Material" value={data.summary.waitingMaterial} accent="border-amber-500/35 bg-amber-500/10" />
        <KpiCard label="Waiting Installation" value={data.summary.waitingInstallation} accent="border-indigo-500/35 bg-indigo-500/10" />
        <KpiCard label="Waiting Net Metering" value={data.summary.waitingNetMetering} accent="border-cyan-500/35 bg-cyan-500/10" />
        <KpiCard label="Completed (Month)" value={data.summary.completedThisMonth} accent="border-emerald-500/35 bg-emerald-500/10" />
        <KpiCard label="Overdue" value={data.summary.overdueProjects} accent="border-red-500/35 bg-red-500/10" />
      </div>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">Project Pipeline</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setStageFilter("all"); setKanbanFilter("all"); }}
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold border ${stageFilter === "all" ? "border-amber-500 bg-amber-500/20 text-amber-200" : "border-neutral-700 text-neutral-400"}`}
          >
            All ({data.projects.length})
          </button>
          {PIPELINE_STAGES.map((s) => {
            const count = data.pipelineCounts[s.key] || 0;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStageFilter(stageFilter === s.key ? "all" : s.key)}
                className={`px-3 py-1.5 rounded-full text-[10px] font-bold border transition ${
                  stageFilter === s.key
                    ? "border-amber-500 bg-amber-500/20 text-amber-200"
                    : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
                }`}
              >
                {s.label} ({count})
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Project Board</h3>
          <div className="flex gap-1">
            {(["all", ...KANBAN_COLUMNS.map((c) => c.key)] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKanbanFilter(k === "all" ? "all" : k)}
                className={`px-2 py-1 rounded text-[9px] font-bold ${kanbanFilter === k ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}
              >
                {k === "all" ? "All cols" : KANBAN_COLUMNS.find((c) => c.key === k)?.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 min-h-[200px]">
          {filteredKanban.map((col) => (
            <div key={col.key} className={`rounded-2xl border p-3 ${col.color}`}>
              <div className="text-[10px] font-bold uppercase text-neutral-300 mb-2 flex justify-between">
                <span>{col.label}</span>
                <span className="text-neutral-500">{col.items.length}</span>
              </div>
              <div className="space-y-2 max-h-[420px] overflow-y-auto">
                {col.items.map((p) => (
                  <ProjectCard key={p.id} p={p} onClick={() => openDetail(p.id)} />
                ))}
                {col.items.length === 0 && (
                  <div className="text-[10px] text-neutral-600 py-4 text-center">No projects</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/80 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300">Delay Tracker</h3>
          </div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-neutral-500 border-b border-neutral-800">
                  <th className="text-left py-2 px-3">Customer</th>
                  <th className="text-left px-2">Stage</th>
                  <th className="text-center px-2">Days</th>
                  <th className="text-left px-2">Team</th>
                </tr>
              </thead>
              <tbody>
                {filteredDelays.slice(0, 25).map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-neutral-800/50 cursor-pointer hover:bg-neutral-800/40 ${DELAY_CLASS[p.delayTone]}`}
                    onClick={() => openDetail(p.id)}
                  >
                    <td className="py-2 px-3 font-semibold text-neutral-100">{p.customerName}</td>
                    <td className="px-2 text-neutral-400">{p.deliveryStatus}</td>
                    <td className={`text-center px-2 font-bold ${p.delayTone === "red" ? "text-red-400" : p.delayTone === "amber" ? "text-amber-400" : "text-emerald-400"}`}>
                      {p.daysInStage}
                    </td>
                    <td className="px-2 text-neutral-500">{p.assignedTeam}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/80 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2">
            <Users className="h-4 w-4 text-violet-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300">Team Performance</h3>
          </div>
          <div className="p-4 space-y-3">
            {data.teamPerformance.map((t, i) => (
              <div key={t.team} className="flex items-center gap-3 rounded-xl border border-neutral-800 p-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${i === 0 ? "bg-amber-500/20 text-amber-300" : "bg-neutral-800 text-neutral-400"}`}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-neutral-100 text-xs">{t.team}</div>
                  <div className="text-[10px] text-neutral-500">
                    {t.assigned} assigned · {t.completed} completed
                    {t.avgCompletionDays != null ? ` · avg ${t.avgCompletionDays}d` : ""}
                  </div>
                </div>
              </div>
            ))}
            {data.teamPerformance.length === 0 && (
              <div className="text-neutral-500 text-sm text-center py-6">No team data yet</div>
            )}
          </div>
        </div>
      </section>

      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setDetail(null)}>
          <div
            className="w-full max-w-md h-full bg-neutral-900 border-l border-neutral-800 overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-neutral-900 border-b border-neutral-800 px-4 py-3 flex items-center justify-between">
              <h3 className="font-bold text-neutral-100 text-sm">Project Detail</h3>
              <button type="button" onClick={() => setDetail(null)} className="p-1 rounded hover:bg-neutral-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            {detailLoading && (
              <div className="p-8 text-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
            )}
            {detail && !detailLoading && (
              <div className="p-4 space-y-4 text-sm">
                <div>
                  <div className="text-lg font-extrabold text-neutral-100">{detail.customer?.name || detail.project.customerName}</div>
                  <div className="text-neutral-400 text-xs flex items-center gap-1 mt-1">
                    <Phone className="h-3 w-3" /> {detail.customer?.phone || detail.project.customerPhone || "—"}
                  </div>
                  <div className="text-neutral-500 text-xs mt-1">{detail.customer?.address || detail.project.location || "—"}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg border border-neutral-800 p-2">
                    <div className="text-neutral-500">System</div>
                    <div className="font-bold text-neutral-100">{detail.project.systemSizeKw ? `${detail.project.systemSizeKw} kW` : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-neutral-800 p-2">
                    <div className="text-neutral-500">Status</div>
                    <div className="font-bold text-amber-300">{detail.project.deliveryStatus}</div>
                  </div>
                  <div className="rounded-lg border border-neutral-800 p-2 col-span-2">
                    <div className="text-neutral-500 flex items-center gap-1"><Zap className="h-3 w-3" /> Equipment</div>
                    <div className="text-neutral-300 text-[10px] mt-1">Panels: {detail.equipment.panels || "—"}</div>
                    <div className="text-neutral-300 text-[10px]">Inverter: {detail.equipment.inverter || "—"}</div>
                    <div className="text-neutral-300 text-[10px]">Battery: {detail.equipment.battery || "—"}</div>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-neutral-500 mb-2">Timeline</div>
                  <div className="space-y-2">
                    {detail.timeline.map((t) => (
                      <div key={t.id} className="flex gap-2 text-[10px]">
                        <ChevronRight className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <div className="text-neutral-200">{t.newStatus}</div>
                          <div className="text-neutral-600">{String(t.createdAt).slice(0, 10)} {t.notes ? `· ${t.notes}` : ""}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-neutral-500 mb-2">Linked Records</div>
                  <div className="space-y-1 text-[11px] text-neutral-400">
                    {detail.links.quotationId && (
                      <div className="flex items-center gap-1"><ClipboardList className="h-3 w-3" /> Quotation: {detail.links.quotationId}</div>
                    )}
                    {detail.links.invoiceIds.length > 0 && (
                      <div className="flex items-center gap-1"><Building2 className="h-3 w-3" /> Invoices: {detail.links.invoiceIds.join(", ")}</div>
                    )}
                    <div className="flex items-center gap-1">Customer ID: {detail.links.customerId}</div>
                  </div>
                </div>
                {detail.netMetering && (
                  <div>
                    <div className="text-[10px] font-bold uppercase text-neutral-500 mb-2">Net Metering</div>
                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                      {Object.entries(detail.netMetering).map(([k, v]) => (
                        <div key={k} className={v ? "text-emerald-400" : "text-neutral-600"}>
                          {k.replace(/([A-Z])/g, " $1")}: {v ? "✓" : "—"}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
