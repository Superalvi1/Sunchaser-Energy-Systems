import React, { useMemo } from "react";
import { motion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Circle,
  Lightbulb,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ActivityLog, DashboardStats, InventoryItem, Lead, Ticket } from "../types";
import { buildEnterpriseDashboardModel } from "../lib/enterpriseDashboard";
import type { InsightDisplayItem } from "../lib/insightLabels";
import { currencySymbol } from "../services/api";

const CHART_COLORS = ["#6366f1", "#22d3ee", "#f59e0b", "#10b981", "#f43f5e", "#a78bfa"];

const glassCard =
  "relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.35)]";

const accentMap = {
  emerald: "from-emerald-500/20 to-emerald-500/0 text-emerald-300",
  amber: "from-amber-500/20 to-amber-500/0 text-amber-300",
  indigo: "from-indigo-500/20 to-indigo-500/0 text-indigo-300",
  rose: "from-rose-500/20 to-rose-500/0 text-rose-300",
  sky: "from-sky-500/20 to-sky-500/0 text-sky-300",
  violet: "from-violet-500/20 to-violet-500/0 text-violet-300",
} as const;

const severityStyles = {
  critical: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
} as const;

const priorityStyles: Record<string, string> = {
  Low: "text-emerald-300 bg-emerald-500/15 border-emerald-500/25",
  Medium: "text-amber-300 bg-amber-500/15 border-amber-500/25",
  High: "text-orange-300 bg-orange-500/15 border-orange-500/25",
  Critical: "text-rose-300 bg-rose-500/15 border-rose-500/25",
};

const stagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

const insightSeverityStyles = {
  critical: "border-rose-500/30 bg-rose-500/10 text-rose-100",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-100",
  positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
} as const;

const departmentAccent: Record<string, string> = {
  sales: "from-indigo-500/15 to-indigo-500/0 text-indigo-300",
  finance: "from-emerald-500/15 to-emerald-500/0 text-emerald-300",
  operations: "from-amber-500/15 to-amber-500/0 text-amber-300",
  support: "from-rose-500/15 to-rose-500/0 text-rose-300",
  procurement: "from-violet-500/15 to-violet-500/0 text-violet-300",
};

function InsightList({
  items,
  emptyLabel,
}: {
  items: InsightDisplayItem[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-8 text-center">
        <CheckCircle2 className="mb-2 h-7 w-7 text-emerald-400/70" />
        <p className="text-sm text-neutral-400">{emptyLabel}</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.code}
          className={`rounded-xl border px-3 py-3 ${insightSeverityStyles[item.severity] ?? insightSeverityStyles.info}`}
        >
          <div className="text-sm font-medium">{item.title}</div>
          <div className="mt-1 text-xs opacity-80">{item.detail}</div>
        </li>
      ))}
    </ul>
  );
}

function GlassTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-neutral-950/90 px-3 py-2 text-xs shadow-xl backdrop-blur-md">
      <div className="text-neutral-400">{label}</div>
      <div className="font-semibold text-white">{payload[0].value.toLocaleString()}</div>
    </div>
  );
}

export interface EnterpriseDashboardProps {
  stats: DashboardStats;
  leads: Lead[];
  tickets: Ticket[];
  inventory: InventoryItem[];
  activityLogs?: ActivityLog[];
  profitabilityBanner?: React.ReactNode;
  deliveryBanner?: React.ReactNode;
}

export default function EnterpriseDashboard({
  stats,
  leads,
  tickets,
  inventory,
  activityLogs = [],
  profitabilityBanner,
  deliveryBanner,
}: EnterpriseDashboardProps) {
  const model = useMemo(
    () =>
      buildEnterpriseDashboardModel({
        stats,
        leads,
        tickets,
        inventory,
        activityLogs,
        currencySymbol,
      }),
    [stats, leads, tickets, inventory, activityLogs]
  );

  const healthCircumference = 2 * Math.PI * 54;
  const healthOffset = healthCircumference - (model.healthScore / 100) * healthCircumference;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="relative space-y-6">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-indigo-500/[0.07] via-transparent to-transparent" />

      {profitabilityBanner}
      {deliveryBanner}

      {/* Hero: Health + AI Summary */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <motion.div variants={fadeUp} className={`${glassCard} xl:col-span-4 p-6`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">Business Health</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-white">Health Score</h2>
            </div>
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${priorityStyles[model.healthPriority]}`}
            >
              {model.healthPriority}
            </span>
          </div>

          <div className="mt-6 flex items-center justify-center">
            <div className="relative h-36 w-36">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
                <motion.circle
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  stroke="url(#healthGradient)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={healthCircumference}
                  initial={{ strokeDashoffset: healthCircumference }}
                  animate={{ strokeDashoffset: healthOffset }}
                  transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                />
                <defs>
                  <linearGradient id="healthGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="50%" stopColor="#22d3ee" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-semibold tracking-tight text-white">{model.healthScore}</span>
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">out of 100</span>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {model.healthBreakdown.map((item) => (
              <div key={item.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <div className="text-[10px] text-neutral-500">{item.label}</div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-400"
                      initial={{ width: 0 }}
                      animate={{ width: `${item.score}%` }}
                      transition={{ duration: 0.8, delay: 0.2 }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-neutral-300">{item.score}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className={`${glassCard} xl:col-span-8 p-6`}>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">Intelligence</p>
              <h2 className="text-lg font-semibold tracking-tight text-white">AI Summary</h2>
            </div>
            <Sparkles className="ml-auto h-4 w-4 text-violet-400/80" />
          </div>
          <ul className="mt-5 space-y-3">
            {model.aiSummary.map((line, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.08 }}
                className="flex gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-sm leading-relaxed text-neutral-300"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r from-violet-400 to-cyan-400" />
                {line}
              </motion.li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] text-neutral-600">
            Deterministic BI from live CRM metrics — no external AI calls. Open AI Command Center for conversational insights.
          </p>
        </motion.div>
      </div>

      {/* Executive BI: Warnings, Opportunities, Priorities */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <motion.div variants={fadeUp} className={`${glassCard} p-5`}>
          <div className="mb-4 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-rose-400" />
            <h3 className="text-sm font-semibold text-white">Critical Warnings</h3>
          </div>
          <InsightList items={model.bi.criticalWarnings} emptyLabel="No critical warnings" />
        </motion.div>

        <motion.div variants={fadeUp} className={`${glassCard} p-5`}>
          <div className="mb-4 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">Opportunities</h3>
          </div>
          <InsightList items={model.bi.opportunities} emptyLabel="No opportunities flagged" />
        </motion.div>
      </div>

      <motion.div variants={fadeUp} className={`${glassCard} p-5`}>
        <div className="mb-4 flex items-center gap-2">
          <Target className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Today&apos;s Priorities</h3>
        </div>
        <InsightList items={model.bi.todaysPriorities} emptyLabel="No priority actions for today" />
      </motion.div>

      {/* Department BI */}
      <motion.div variants={fadeUp}>
        <div className="mb-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">Departments</p>
          <h3 className="text-base font-semibold text-white">Business Intelligence by Function</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {model.bi.departments.map((dept) => (
            <div key={dept.id} className={`${glassCard} p-4`}>
              <div className={`absolute inset-0 bg-gradient-to-br ${departmentAccent[dept.id] ?? departmentAccent.sales} opacity-50`} />
              <div className="relative">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-white">{dept.label}</h4>
                  <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-neutral-200">
                    {dept.score}
                  </span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${dept.score}%` }}
                    transition={{ duration: 0.8 }}
                  />
                </div>
                <ul className="mt-3 space-y-2">
                  {dept.insights.length === 0 ? (
                    <li className="text-xs text-neutral-500">No insights</li>
                  ) : (
                    dept.insights.slice(0, 3).map((insight) => (
                      <li key={insight.code} className="text-xs leading-relaxed text-neutral-400">
                        <span className="font-medium text-neutral-300">{insight.title}</span>
                        <span className="block opacity-80">{insight.detail}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* KPI Cards */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {model.kpis.map((kpi) => (
          <div key={kpi.id} className={`${glassCard} group p-5 transition hover:border-white/[0.14]`}>
            <div className={`absolute inset-0 bg-gradient-to-br ${accentMap[kpi.accent]} opacity-60`} />
            <div className="relative">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">{kpi.label}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{kpi.value}</p>
              {kpi.sub && <p className="mt-1 text-xs text-neutral-500">{kpi.sub}</p>}
              <ArrowUpRight className="absolute right-0 top-0 h-4 w-4 text-neutral-600 opacity-0 transition group-hover:opacity-100" />
            </div>
          </div>
        ))}
      </motion.div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <motion.div variants={fadeUp} className={`${glassCard} xl:col-span-7 p-6`}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">Pipeline</p>
              <h3 className="text-base font-semibold text-white">Lead Progression</h3>
            </div>
            <TrendingUp className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={model.pipelineChart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#737373" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#737373" }} axisLine={false} tickLine={false} />
                <Tooltip content={<GlassTooltip />} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} barSize={28}>
                  {model.pipelineChart.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className={`${glassCard} xl:col-span-5 p-6`}>
          <div className="mb-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">Revenue</p>
            <h3 className="text-base font-semibold text-white">Sales Performance</h3>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={model.revenueChart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#737373" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#737373" }} axisLine={false} tickLine={false} />
                <Tooltip content={<GlassTooltip />} />
                <Area type="monotone" dataKey="value" stroke="#818cf8" strokeWidth={2} fill="url(#revFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 flex justify-center">
            <ResponsiveContainer width="100%" height={100}>
              <PieChart>
                <Pie
                  data={model.pipelineChart}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={28}
                  outerRadius={42}
                  paddingAngle={3}
                >
                  {model.pipelineChart.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.9} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Alerts, Tasks, Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <motion.div variants={fadeUp} className={`${glassCard} p-5`}>
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">Alerts</h3>
          </div>
          <div className="space-y-2">
            {model.alerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-xl border px-3 py-3 ${severityStyles[alert.severity]}`}
              >
                <div className="text-sm font-medium">{alert.title}</div>
                <div className="mt-1 text-xs opacity-80">{alert.detail}</div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className={`${glassCard} p-5`}>
          <div className="mb-4 flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Today&apos;s Tasks</h3>
          </div>
          {model.todayTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-10 text-center">
              <CheckCircle2 className="mb-2 h-8 w-8 text-emerald-400/70" />
              <p className="text-sm text-neutral-400">All clear for today</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {model.todayTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3"
                >
                  {task.done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">{task.title}</div>
                    <div className="truncate text-xs text-neutral-500">{task.context}</div>
                  </div>
                  <span className="ml-auto shrink-0 rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-neutral-400">
                    {task.dueLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </motion.div>

        <motion.div variants={fadeUp} className={`${glassCard} p-5`}>
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
          </div>
          <ul className="space-y-3">
            {model.recentActivity.length === 0 ? (
              <li className="text-sm text-neutral-500">No recent activity recorded.</li>
            ) : (
              model.recentActivity.map((item, i) => (
                <li key={item.id} className="relative flex gap-3 pl-4">
                  {i < model.recentActivity.length - 1 && (
                    <span className="absolute left-[7px] top-5 h-full w-px bg-white/10" />
                  )}
                  <span
                    className={`relative z-10 mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      item.kind === "ticket"
                        ? "bg-rose-400"
                        : item.kind === "lead"
                          ? "bg-amber-400"
                          : "bg-indigo-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-white">{item.title}</p>
                      <span className="shrink-0 text-[10px] text-neutral-600">{item.time}</span>
                    </div>
                    <p className="truncate text-xs text-neutral-500">{item.subtitle}</p>
                  </div>
                </li>
              ))
            )}
          </ul>
        </motion.div>
      </div>

      {/* Footer strip */}
      <motion.div
        variants={fadeUp}
        className={`${glassCard} flex flex-wrap items-center justify-between gap-3 px-5 py-3`}
      >
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          Live dashboard · deterministic BI · updates with CRM state
        </div>
        <div className="text-[11px] text-neutral-600">
          {stats.totalLeads} leads · {tickets.length} tickets · {inventory.length} inventory SKUs
        </div>
      </motion.div>
    </motion.div>
  );
}
