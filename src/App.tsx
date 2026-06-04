import React, { useEffect, useState } from "react";
import { 
  Sun, Users, Wrench, Bot, Shield, FileText, UserCircle, 
  Loader2, Inbox, RefreshCw, LogOut, ClipboardList, Send, FileSpreadsheet, Download
} from "lucide-react";
import AuthHub from "./components/AuthHub";
import { AppState, UserRole, User } from "./types";
import {
  fetchAppState,
  createLead,
  updateLead,
  scheduleSurvey,
  submitSurveyReport,
  createQuote,
  acceptQuote,
  updateInstallation,
  createTicket,
  replyToTicket,
  resolveTicket,
  updateProjectStage,
  updateNetMetering,
  payMilestone,
  procureInventory,
  setCurrencySymbol,
  API_BASE_URL,
  deleteLead,
  deleteQuote,
  fetchCustomerPortalMe,
  fetchTechnicalJobsMe,
  fetchOnboardingMe,
  completeOnboarding,
} from "./services/api";
import { CONNECTION_ERROR_MESSAGE } from "./lib/startupFetch";
import { isNativeApp } from "./lib/appPlatform";

declare const __GIT_COMMIT_HASH__: string;
declare const __BUILD_TIME__: string;
declare const __BUILD_ENV__: string;

// Submodule imports
import ClientPortalApp from "./components/ClientPortalApp";
import ClientPortalStaffNotice from "./components/ClientPortalStaffNotice";
import type { ClientPortalPayload } from "./lib/clientPortalTracker";
import SalesTeamApp from "./components/SalesTeamApp";
import CRMApp from "./components/CRMApp";
import InstallationTeamApp from "./components/InstallationTeamApp";
import TechnicalStaffApp from "./components/TechnicalStaffApp";
import WelcomeWizard from "./components/WelcomeWizard";
import AIAssistant from "./components/AIAssistant";
import AdminApp from "./components/AdminApp";
import AppLogo from "./components/AppLogo";
import { isTechnicalStaffRole } from "./lib/technicalStaff";

function needsCrmAppState(role: string) {
  return role !== "Customer" && !isTechnicalStaffRole(role);
}

export default function App() {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionSyncError, setSessionSyncError] = useState<string | null>(null);
  
  // Auth state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [cachedUsername, setCachedUsername] = useState("");

  // Active workspace navigation
  const [activeTab, setActiveTab] = useState<string>("Overview");
  const [portalData, setPortalData] = useState<ClientPortalPayload | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [forceWelcomeGuide, setForceWelcomeGuide] = useState(false);

  const loadCustomerPortal = async (user: User) => {
    setPortalLoading(true);
    setPortalError(null);
    console.log("Home screen API request:", `${API_BASE_URL}/api/customer-portal/me`);
    try {
      const data = await fetchCustomerPortalMe(user.id, user.username);
      setPortalData({
        customer: data.customer,
        lead: data.lead as ClientPortalPayload["lead"],
        project: data.project as ClientPortalPayload["project"],
        dashboard: data.dashboard as ClientPortalPayload["dashboard"],
        tracker: data.tracker as ClientPortalPayload["tracker"],
      });
    } catch (err: any) {
      setPortalError(err.message || CONNECTION_ERROR_MESSAGE);
    } finally {
      setPortalLoading(false);
      setLoading(false);
    }
  };

  const loadTechnicalSession = async (user: User) => {
    const jobsUrl = `${API_BASE_URL}/api/technical/jobs/me`;
    console.log("Home screen API request:", jobsUrl);
    setLoading(true);
    setSessionSyncError(null);
    try {
      await fetchTechnicalJobsMe(user.id, user.username);
    } catch (err: any) {
      console.error("Technical session load failed:", jobsUrl, err);
      setSessionSyncError(err.message || CONNECTION_ERROR_MESSAGE);
    } finally {
      setLoading(false);
    }
  };

  // Staff/admin CRM state — only after login, not on guest boot
  const loadDatabaseState = async () => {
    const homeStateUrl = `${API_BASE_URL}/api/state`;
    console.log("Home screen API request:", homeStateUrl);
    setLoading(true);
    setSessionSyncError(null);
    try {
      const state = await fetchAppState();
      setAppState(state);
      if (state.settings?.currencySettings) {
        const match = state.settings.currencySettings.match(/\(([^)]+)\)/);
        if (match) {
          setCurrencySymbol(match[1]);
        }
      }
    } catch (err: any) {
      console.error("CRM state load failed:", homeStateUrl, err);
      setSessionSyncError(err.message || CONNECTION_ERROR_MESSAGE);
    } finally {
      setLoading(false);
    }
  };

  const loadSessionForUser = async (user: User) => {
    if (user.role === "Customer") {
      await loadCustomerPortal(user);
      return;
    }
    if (isTechnicalStaffRole(user.role)) {
      await loadTechnicalSession(user);
      return;
    }
    if (needsCrmAppState(user.role)) {
      await loadDatabaseState();
    } else {
      setLoading(false);
    }
  };

  const refreshOnboardingGate = async (user: User, force = false) => {
    try {
      const ob = await fetchOnboardingMe(user.id, user.username);
      setShowOnboarding(force || !ob.onboardingCompleted);
    } catch {
      setShowOnboarding(force || !user.onboardingCompleted);
    }
  };

  const handleOnboardingComplete = async () => {
    if (!currentUser) return;
    await completeOnboarding(currentUser.id, currentUser.username);
    const updated = {
      ...currentUser,
      onboardingCompleted: true,
      onboardingCompletedAt: new Date().toISOString(),
    };
    setCurrentUser(updated);
    localStorage.setItem("sunchaser_user", JSON.stringify(updated));
    setShowOnboarding(false);
    setForceWelcomeGuide(false);
  };

  useEffect(() => {
    const cachedUser = localStorage.getItem("sunchaser_user");
    let parsed: User | null = null;
    if (cachedUser) {
      try {
        parsed = JSON.parse(cachedUser);
      } catch {
        localStorage.removeItem("sunchaser_user");
      }
    }

    if (isNativeApp()) {
      // Android/iOS: never auto-sync /api/state — show login until explicit sign-in
      if (parsed?.username) setCachedUsername(parsed.username);
      setLoading(false);
      return;
    }

    if (parsed) {
      setCurrentUser(parsed);
      loadSessionForUser(parsed);
      refreshOnboardingGate(parsed, forceWelcomeGuide);
    } else {
      setLoading(false);
    }
  }, []);

  // Set default tab based on logged-in role
  useEffect(() => {
    if (currentUser) {
      if (currentUser.role === "Customer") {
        setActiveTab("home");
      } else if (isTechnicalStaffRole(currentUser.role)) {
        setActiveTab("Field Portal");
      } else if (currentUser.role === "Sales Executive" || currentUser.role === "Sales Advisor") {
        setActiveTab("Sales Advisor");
      } else if (currentUser.role === "Technical CEO" || currentUser.role === "Director") {
        setActiveTab("Admin Dashboard");
      } else if (currentUser.role === "Admin" || currentUser.role === "Accounts Manager") {
        setActiveTab("Admin Dashboard");
      } else if (currentUser.role === "Sales Manager") {
        setActiveTab("CRM Database");
      } else {
        setActiveTab("Admin Dashboard"); // Super Admin defaults to high level metrics
      }
    }
  }, [currentUser]);

  /* --- AUTH HANDLERS --- */

  const handleAuthLoginSuccess = async (user: User) => {
    setCurrentUser(user);
    localStorage.setItem("sunchaser_user", JSON.stringify(user));
    await loadSessionForUser(user);
    await refreshOnboardingGate(user);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setPortalData(null);
    setPortalError(null);
    setSessionSyncError(null);
    setAppState(null);
    setError(null);
    setLoading(false);
    localStorage.removeItem("sunchaser_user");
    setActiveTab("Overview");
  };

  const retrySessionSync = () => {
    if (!currentUser) return;
    loadSessionForUser(currentUser);
  };

  /* --- DATA MUTATION PROXIES --- */

  const handleAddLead = async (leadData: any) => {
    try {
      setLoading(true);
      await createLead(leadData);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLead = async (id: string) => {
    try {
      setLoading(true);
      await deleteLead(id);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteQuote = async (leadId: string, quoteId: string) => {
    try {
      setLoading(true);
      await deleteQuote(leadId, quoteId);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateLead = async (id: string, updatedData: any) => {
    try {
      setLoading(true);
      await updateLead(id, updatedData);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleScheduleSurvey = async (id: string, scheduledDate: string) => {
    try {
      setLoading(true);
      await scheduleSurvey(id, scheduledDate);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitSurvey = async (id: string, surveyData: any) => {
    try {
      setLoading(true);
      await submitSurveyReport(id, surveyData);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateQuote = async (id: string, quoteData: any) => {
    try {
      setLoading(true);
      await createQuote(id, quoteData);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptQuote = async (leadId: string, quoteId: string) => {
    try {
      setLoading(true);
      await acceptQuote(leadId, quoteId);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateInstallation = async (leadId: string, installationData: any) => {
    try {
      setLoading(true);
      await updateInstallation(leadId, installationData);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTicket = async (ticketData: any) => {
    try {
      setLoading(true);
      await createTicket(ticketData);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReplyTicket = async (ticketId: string, text: string) => {
    try {
      const senderRole = currentUser?.role === "Customer" ? "Customer" : "Agent";
      await replyToTicket(ticketId, text, senderRole);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResolveTicket = async (id: string) => {
    try {
      setLoading(true);
      await resolveTicket(id);
      await loadDatabaseState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /* --- FLUID CSV EXPORTS GENERATION --- */
  const triggerExcelExport = (type: 'leads' | 'payments' | 'projects') => {
    window.open(`${API_BASE_URL}/api/export/${type}`, "_blank");
  };

  // Determine authorized navigational options based on roles
  const getAllowedTabs = () => {
    if (!currentUser) return [];

    switch (currentUser.role) {
      case "Super Admin":
        return [
          { id: "Admin Dashboard", label: "Admin Dashboard", icon: Shield },
          { id: "CRM Database", label: "CRM Database", icon: Users },
          { id: "Sales Advisor", label: "Sales Advisor", icon: FileText },
          { id: "Installer Deck", label: "Installer Deck", icon: Wrench },
          { id: "Sunchaser AI", label: "Sunchaser AI Assistant", icon: Bot },
          { id: "Activity Telemetry", label: "Activities & SMS Logs", icon: ClipboardList }
        ];
      case "Sales Manager":
        return [
          { id: "Admin Dashboard", label: "Manager Overview", icon: Shield },
          { id: "CRM Database", label: "CRM Lead Pool", icon: Users },
          { id: "Sunchaser AI", label: "Sunchaser AI Assistant", icon: Bot },
          { id: "Activity Telemetry", label: "Enterprise Tracing logs", icon: ClipboardList }
        ];
      case "Sales Executive":
      case "Sales Advisor":
        return [
          { id: "CRM Database", label: "My CRM Leads", icon: Users },
          { id: "Sales Advisor", label: "Solar Sizing & Calculator", icon: FileText },
          { id: "Sunchaser AI", label: "Sunchaser AI Assistant", icon: Bot }
        ];
      case "Technical CEO":
      case "Director":
        return [
          { id: "Admin Dashboard", label: "Executive Dashboard", icon: Shield },
          { id: "CRM Database", label: "CRM Database", icon: Users },
          { id: "Sales Advisor", label: "Sales Advisor", icon: FileText },
          { id: "Sunchaser AI", label: "Sunchaser AI Assistant", icon: Bot },
          { id: "Activity Telemetry", label: "Activities & SMS Logs", icon: ClipboardList }
        ];
      case "Admin":
      case "Accounts Manager":
        return [
          { id: "Admin Dashboard", label: "Admin Dashboard", icon: Shield },
          { id: "CRM Database", label: "CRM Database", icon: Users },
          { id: "Sunchaser AI", label: "Sunchaser AI Assistant", icon: Bot },
        ];
      case "Survey Engineer":
      case "Installation Team":
      case "Service Technician":
      case "Technician":
        return [{ id: "Field Portal", label: "Field Portal", icon: Wrench }];
      case "Customer":
        return [
          { id: "Customer Portal", label: "My Sunchaser Home Portal", icon: UserCircle },
          { id: "Sunchaser AI", label: "Chat with Solar AI", icon: Bot }
        ];
      default:
        return [];
    }
  };

  if (currentUser && showOnboarding) {
    const variant =
      currentUser.role === "Customer"
        ? "customer"
        : isTechnicalStaffRole(currentUser.role)
          ? "technical"
          : "staff";
    return (
      <WelcomeWizard
        variant={variant}
        roleLabel={currentUser.role}
        onComplete={handleOnboardingComplete}
      />
    );
  }

  if (currentUser?.role === "Customer") {
    return (
      <ClientPortalApp
        user={currentUser}
        data={portalData}
        loading={portalLoading}
        error={portalError}
        onRefresh={() => loadCustomerPortal(currentUser)}
        onLogout={handleLogout}
        onShowWelcomeGuide={() => setShowOnboarding(true)}
      />
    );
  }

  if (currentUser && isTechnicalStaffRole(currentUser.role)) {
    return (
      <>
        {sessionSyncError && (
          <div className="bg-amber-950/40 border-b border-amber-900/50 px-4 py-2 text-center text-xs text-amber-200">
            {sessionSyncError}{" "}
            <button
              type="button"
              onClick={retrySessionSync}
              className="underline font-bold text-amber-400 ml-1"
            >
              Try again
            </button>
          </div>
        )}
        <TechnicalStaffApp
          user={currentUser}
          onLogout={handleLogout}
          onShowWelcomeGuide={() => setShowOnboarding(true)}
        />
      </>
    );
  }

  const connectionRetryPanel = (
    <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl text-slate-300 text-sm max-w-xl mx-auto text-center space-y-4 shadow-sm">
      <Shield className="h-10 w-10 text-amber-500 mx-auto" />
      <p>{sessionSyncError || CONNECTION_ERROR_MESSAGE}</p>
      <button
        type="button"
        onClick={retrySessionSync}
        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-6 rounded-xl transition text-xs cursor-pointer"
      >
        Try again
      </button>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Floating App Header */}
      <header className="sticky top-0 z-50 bg-slate-900 border-b border-slate-800 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <AppLogo className="h-11 w-auto" />
            <div>
              <h1 className="text-lg font-extrabold tracking-tight font-sans">
                SUNCHASER <span className="text-amber-400 font-medium">Energy Systems</span>
              </h1>
              <p className="text-[10px] font-mono tracking-widest text-slate-400">ENTERPRISE CLOUD GRID • SECURE DB HARNESS</p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Sync trigger */}
            {currentUser && needsCrmAppState(currentUser.role) ? (
              <button
                onClick={loadDatabaseState}
                className="bg-slate-800 hover:bg-slate-700 p-2.5 rounded-xl text-slate-350 transition hover:text-white"
                title="Force Sync Database State"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            ) : null}

            {currentUser && !isTechnicalStaffRole(currentUser.role) && currentUser.role !== "Customer" ? (
              <button
                type="button"
                onClick={() => setShowOnboarding(true)}
                className="text-[10px] font-bold text-amber-400 bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl hover:bg-slate-800"
              >
                View Welcome Guide Again
              </button>
            ) : null}
            {currentUser ? (
              /* User authenticated menu panel */
              <div className="flex items-center gap-3 bg-slate-950/80 border border-slate-800 rounded-2xl p-1.5 pl-3">
                <div className="text-left font-mono">
                  <span className="text-[9px] uppercase font-bold text-amber-500 block">Logged In ({currentUser.role})</span>
                  <span className="text-xs text-slate-205 font-bold font-sans block">{currentUser.name}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="bg-red-950/45 hover:bg-red-900 border border-red-900/40 text-red-400 hover:text-red-300 p-2 rounded-xl transition flex items-center justify-center cursor-pointer"
                  title="Logout Session"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              /* Non authenticated status badge */
              <div className="text-[11px] bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60 font-mono text-amber-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span> Guest Mode
              </div>
            )}
          </div>
        </div>

        {/* Roles Toggler / Nav Bar */}
        {currentUser && (
          <div className="bg-slate-950 border-t border-slate-800/65 py-2 overflow-x-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-start md:justify-center gap-2 text-xs font-semibold">
              {getAllowedTabs().map((tab) => {
                const TabIcon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`py-2 px-3.5 rounded-xl flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${
                      activeTab === tab.id
                        ? "bg-amber-500 text-slate-950 font-bold shadow-md"
                        : "bg-slate-900 hover:bg-slate-850 text-slate-350 border border-slate-800"
                    }`}
                  >
                    <TabIcon className="h-4 w-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Main Container body scope */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 h-full">
        
        {loading && currentUser && needsCrmAppState(currentUser.role) && !appState ? (
          <div className="py-24 text-center">
            <Loader2 className="h-12 w-12 text-amber-500 animate-spin mx-auto mb-4" />
            <span className="text-sm font-semibold text-slate-400 font-mono">Loading your workspace…</span>
          </div>
        ) : !currentUser ? (
          <AuthHub onLoginSuccess={handleAuthLoginSuccess} initialUsername={cachedUsername} />
        ) : currentUser && sessionSyncError && needsCrmAppState(currentUser.role) && !appState ? (
          connectionRetryPanel
        ) : appState ? (
          /* ---------------- AUTHORIZED DASHBOARD VIEWPORT ---------------- */
          <div className="fade-in-entry space-y-8">
            {error && (
              <div className="bg-rose-950/20 border border-rose-900 px-4 py-2 rounded-xl text-rose-300 text-xs">
                {error}
              </div>
            )}
            
            {/* Super admin spreadsheet controls line */}
            {(currentUser.role === "Super Admin" || currentUser.role === "Technical CEO" || currentUser.role === "Sales Manager") && (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 flex flex-wrap justify-between items-center gap-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-amber-500" />
                  <span className="text-xs font-mono font-bold text-slate-300">
                    Sunchaser Central Accounting: <span className="text-[10px] bg-slate-950 border border-slate-800 text-emerald-400 py-1 px-2.5 rounded-xl ml-1 font-mono">Excel Integration Enabled</span>
                  </span>
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => triggerExcelExport('leads')}
                    className="bg-slate-950 hover:bg-slate-800 border border-slate-800 px-3.5 py-1.5 rounded-xl text-neutral-200 text-xs font-sans font-bold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Leads Export (.CSV)</span>
                  </button>
                  <button
                    onClick={() => triggerExcelExport('payments')}
                    className="bg-slate-950 hover:bg-slate-800 border border-slate-800 px-3.5 py-1.5 rounded-xl text-neutral-200 text-xs font-sans font-bold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Payments (.CSV)</span>
                  </button>
                  <button
                    onClick={() => triggerExcelExport('projects')}
                    className="bg-slate-950 hover:bg-slate-800 border border-slate-800 px-3.5 py-1.5 rounded-xl text-neutral-200 text-xs font-sans font-bold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Projects (.CSV)</span>
                  </button>
                </div>
              </div>
            )}

            {/* Component Layout Routing conditional switcher */}
            {activeTab === "Sales Advisor" && (
              <SalesTeamApp
                staffUser={currentUser}
                leads={appState.leads}
                inventory={appState.inventory}
                products={appState.products || []}
                onUpdateLead={handleUpdateLead}
                on创造Quote={handleCreateQuote}
                on提交Survey={handleSubmitSurvey}
                onRefreshState={loadDatabaseState}
                settings={appState.settings}
                quoteTemplates={appState.quoteTemplates || []}
                quoteTemplatePages={appState.quoteTemplatePages || []}
                bankAccounts={appState.bankAccounts || []}
                companyTerms={appState.companyTerms || []}
                ceoMessages={appState.ceoMessages || []}
                socialLinks={appState.socialLinks || []}
                structureDescriptions={appState.structureDescriptions || []}
                quotePdfSettings={appState.quotePdfSettings || []}
                onDeleteQuote={handleDeleteQuote}
              />
            )}

            {activeTab === "CRM Database" && currentUser && (
              <CRMApp
                staffUser={currentUser}
                leads={appState.leads}
                onUpdateLead={handleUpdateLead}
                onAddLead={handleAddLead}
                onDeleteLead={handleDeleteLead}
              />
            )}

            {activeTab === "Installer Deck" && (
              <InstallationTeamApp
                leads={appState.leads}
                onUpdateInstallation={handleUpdateInstallation}
                // Extended full-stack features
                userId={currentUser.id}
                userName={currentUser.name}
                userRole={currentUser.role}
                projects={appState.projects}
                netMeteringTrackers={appState.netMeteringTrackers || {}}
                paymentTracks={appState.paymentTracks || {}}
                onUpdateProjectStage={async (pId, stage) => {
                  setLoading(true);
                  await updateProjectStage(pId, stage);
                  await loadDatabaseState();
                }}
                onUpdateNetMetering={async (leadId, tracker) => {
                  setLoading(true);
                  await updateNetMetering(leadId, tracker);
                  await loadDatabaseState();
                }}
                onPayMilestone={async (leadId, milName, status) => {
                  setLoading(true);
                  await payMilestone(leadId, milName, status);
                  await loadDatabaseState();
                }}
              />
            )}

            {activeTab === "Sunchaser AI" && (
              <AIAssistant 
                onAddLead={handleAddLead} 
              />
            )}

            {activeTab === "Admin Dashboard" && (
              <AdminApp
                staffUser={currentUser}
                leads={appState.leads}
                tickets={appState.tickets}
                inventory={appState.inventory}
                stats={appState.stats}
                purchaseOrders={appState.purchaseOrders || []}
                categories={appState.categories || []}
                products={appState.products || []}
                orders={appState.orders || []}
                warranties={appState.warranties || []}
                solarPackages={appState.solarPackages || []}
                settings={appState.settings || {}}
                websiteContent={appState.websiteContent || {}}
                quotations={appState.quotations || []}
                quoteTemplates={appState.quoteTemplates || []}
                quoteTemplatePages={appState.quoteTemplatePages || []}
                bankAccounts={appState.bankAccounts || []}
                companyTerms={appState.companyTerms || []}
                ceoMessages={appState.ceoMessages || []}
                socialLinks={appState.socialLinks || []}
                structureDescriptions={appState.structureDescriptions || []}
                quotePdfSettings={appState.quotePdfSettings || []}
                onResolveTicket={handleResolveTicket}
                onProcureInventory={async (vendor, itemId, quantity) => {
                  setLoading(true);
                  try {
                    await procureInventory(vendor, itemId, quantity);
                    await loadDatabaseState();
                  } catch (err: any) {
                    setError(err.message);
                  } finally {
                    setLoading(false);
                  }
                }}
                onRefreshState={loadDatabaseState}
              />
            )}

            {/* Dynamic system logs browser only for Super Admin and Sales Manager */}
            {activeTab === "Activity Telemetry" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start fade-in-entry">
                
                {/* Outgoing automated SMS logs */}
                <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
                  <div>
                    <h3 className="text-base font-bold font-sans text-neutral-100 flex items-center gap-2">
                      <Send className="text-amber-500 h-4 w-4" /> Simulated WhatsApp Notification Transmissions
                    </h3>
                    <p className="text-xs text-slate-400">Outbound SMS messages dispatch log generated from core CRM event hooks.</p>
                  </div>
                  
                  <div className="space-y-3.5 max-h-[500px] overflow-y-auto pr-1">
                    {appState.whatsAppLogs && appState.whatsAppLogs.length > 0 ? (
                      appState.whatsAppLogs.map((wa) => (
                        <div key={wa.id} className="bg-slate-950 border border-slate-850 p-4 rounded-2xl relative overflow-hidden text-xs">
                          <div className="flex justify-between items-center mb-1.5 font-mono">
                            <span className="text-[10px] text-amber-400 uppercase font-bold bg-amber-500/10 py-0.5 px-2.5 rounded-lg border border-amber-500/20">
                              {wa.eventType.replace('_', ' ')}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {new Date(wa.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          
                          <p className="text-slate-300 leading-relaxed font-sans mb-2 select-all">&ldquo;{wa.messageText}&rdquo;</p>
                          
                          <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 pt-1.5 border-t border-slate-800/60">
                            <span>Phone: <strong className="text-slate-320">{wa.phone}</strong></span>
                            <span className="text-emerald-400 font-bold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> {wa.status}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 text-slate-500 text-xs font-mono">No SMS SMS dispatches tracked yet.</div>
                    )}
                  </div>
                </div>

                {/* Audit activities logs */}
                <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
                  <div>
                    <h3 className="text-base font-bold font-sans text-neutral-100 flex items-center gap-2">
                      <ClipboardList className="text-neutral-350 h-4 w-4" /> Database Audit Activity Logs
                    </h3>
                    <p className="text-xs text-slate-400">Persistent database audit logs tracking administrative, surveyor, sales, and customer transactions.</p>
                  </div>

                  <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1 text-xs">
                    {appState.activityLogs && appState.activityLogs.length > 0 ? (
                      appState.activityLogs.map((log) => (
                        <div key={log.id} className="bg-slate-950 border border-slate-850 p-3.5 rounded-2xl font-mono">
                          <div className="flex justify-between items-center flex-wrap gap-2 text-[10px] text-slate-500 mb-1">
                            <span className="font-bold text-slate-300">
                              {log.userName} ({log.role})
                            </span>
                            <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <div className="text-amber-500 font-bold font-mono pb-0.5">{log.action}</div>
                          <p className="text-slate-400 text-[11px] leading-relaxed font-sans font-light">{log.details}</p>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 text-slate-500 text-xs font-mono">No activities audited.</div>
                    )}
                  </div>
                </div>

              </div>
            )}

          </div>
        ) : currentUser ? (
          connectionRetryPanel
        ) : null}
      </main>

      {/* Humble Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 py-6 text-center text-slate-500 text-xs font-mono mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-col items-center md:items-start text-[11px] text-slate-500">
            <span>&copy; {new Date().getFullYear()} Sunchaser Energy Systems Inc. All Rights Reserved.</span>
            <span className="text-[10px] text-slate-600">STATE CONTROL COMPLIANCE • CONTAINER ISOLATED LAYER</span>
          </div>
          <div className="flex flex-col items-center md:items-end text-[10px] text-slate-500 border border-slate-800/80 rounded-2xl px-3 py-1.5 bg-slate-950/40">
            <span className="font-bold text-amber-500">Build {__GIT_COMMIT_HASH__} ({__BUILD_ENV__})</span>
            <span className="text-[9px] text-slate-400 mt-0.5">{__BUILD_TIME__}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
