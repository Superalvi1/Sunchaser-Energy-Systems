import React, { useEffect, useState } from "react";
import { 
  Sun, Users, Wrench, Bot, Shield, FileText, UserCircle, 
  Loader2, Sparkles, Inbox, RefreshCw, LogOut, Lock, Key, ClipboardList, Send, FileSpreadsheet, Download
} from "lucide-react";
import { AppState, UserRole, User } from "./types";
import { 
  fetchAppState, createLead, updateLead, scheduleSurvey, 
  submitSurveyReport, createQuote, acceptQuote, updateInstallation, 
  createTicket, replyToTicket, resolveTicket, loginUser, updateProjectStage, updateNetMetering, payMilestone, procureInventory,
  setCurrencySymbol, API_BASE_URL
} from "./services/api";

// Submodule imports
import CustomerPortal from "./components/CustomerPortal";
import SalesTeamApp from "./components/SalesTeamApp";
import CRMApp from "./components/CRMApp";
import InstallationTeamApp from "./components/InstallationTeamApp";
import AIAssistant from "./components/AIAssistant";
import AdminApp from "./components/AdminApp";

export default function App() {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Auth state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Active workspace navigation
  const [activeTab, setActiveTab] = useState<string>("Overview");

  // Load backend database state on mount & synchronize
  const loadDatabaseState = async () => {
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
      console.error(err);
      setError("Unable to sync with Sunchaser central grids. Please click refresh.");
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    // 1. Load data
    loadDatabaseState();
    
    // 2. Load cached user session
    const cachedUser = localStorage.getItem("sunchaser_user");
    if (cachedUser) {
      try {
        setCurrentUser(JSON.parse(cachedUser));
      } catch (e) {
        localStorage.removeItem("sunchaser_user");
      }
    }
  }, []);

  // Set default tab based on logged-in role
  useEffect(() => {
    if (currentUser) {
      if (currentUser.role === "Customer") {
        setActiveTab("Customer Portal");
      } else if (currentUser.role === "Survey Engineer" || currentUser.role === "Installation Team") {
        setActiveTab("Installer Deck");
      } else if (currentUser.role === "Sales Executive") {
        setActiveTab("Sales Advisor");
      } else if (currentUser.role === "Sales Manager") {
        setActiveTab("CRM Database");
      } else {
        setActiveTab("Admin Dashboard"); // Super Admin defaults to high level metrics
      }
    }
  }, [currentUser]);

  /* --- AUTH HANDLERS --- */

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setLoginError("Please enter both username and password.");
      return;
    }
    
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await loginUser({ username, password });
      if (res.success) {
        setCurrentUser(res.user);
        localStorage.setItem("sunchaser_user", JSON.stringify(res.user));
        // Force refresh state to fetch activities correctly
        await loadDatabaseState();
      }
    } catch (err: any) {
      setLoginError(err.message || "Invalid credentials. Try guest profiles.");
    } finally {
      setLoginLoading(false);
    }
  };

  // Pre-fill quick logins for easier developer preview
  const handleQuickLogin = async (usr: string, psw: string) => {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await loginUser({ username: usr, password: psw });
      if (res.success) {
        setCurrentUser(res.user);
        localStorage.setItem("sunchaser_user", JSON.stringify(res.user));
        await loadDatabaseState();
      }
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem("sunchaser_user");
    setActiveTab("Overview");
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
          { id: "Customer Portal", label: "Customer Portal", icon: UserCircle },
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
        return [
          { id: "CRM Database", label: "My CRM Leads", icon: Users },
          { id: "Sales Advisor", label: "Solar Sizing & Calculator", icon: FileText },
          { id: "Sunchaser AI", label: "Sunchaser AI Assistant", icon: Bot }
        ];
      case "Survey Engineer":
        return [
          { id: "Installer Deck", label: "Roof CAD Site Surveys", icon: Wrench }
        ];
      case "Installation Team":
        return [
          { id: "Installer Deck", label: "Grid Deployment Staging", icon: Wrench }
        ];
      case "Customer":
        return [
          { id: "Customer Portal", label: "My Sunchaser Home Portal", icon: UserCircle },
          { id: "Sunchaser AI", label: "Chat with Solar AI", icon: Bot }
        ];
      default:
        return [];
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Floating App Header */}
      <header className="sticky top-0 z-50 bg-slate-900 border-b border-slate-800 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-amber-400 to-orange-500 p-2.5 rounded-2xl shadow-inner shadow-amber-300">
              <Sun className="h-6 w-6 text-slate-950 animate-spin-slow" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight font-sans">
                SUNCHASER <span className="text-amber-400 font-medium">Energy Systems</span>
              </h1>
              <p className="text-[10px] font-mono tracking-widest text-slate-400">ENTERPRISE CLOUD GRID • SECURE DB HARNESS</p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Sync trigger */}
            <button
              onClick={loadDatabaseState}
              className="bg-slate-800 hover:bg-slate-700 p-2.5 rounded-xl text-slate-350 transition hover:text-white"
              title="Force Sync Database State"
            >
              <RefreshCw className="h-4 w-4" />
            </button>

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
        
        {/* Loading screen */}
        {loading && !appState ? (
          <div className="py-24 text-center">
            <Loader2 className="h-12 w-12 text-amber-500 animate-spin mx-auto mb-4" />
            <span className="text-sm font-semibold text-slate-400 font-mono">Synchronizing Sunchaser Solar Data Grid...</span>
          </div>
        ) : error ? (
          /* Error screen */
          <div className="bg-rose-950/20 border border-rose-900 p-8 rounded-3xl text-rose-300 text-sm max-w-xl mx-auto text-center space-y-4 shadow-sm">
            <Shield className="h-10 w-10 text-rose-500 mx-auto" />
            <div>
              <strong className="block font-bold mb-1 text-rose-400">Database Coherence Alert</strong>
              <span>{error}</span>
            </div>
            <button
              onClick={loadDatabaseState}
              className="bg-rose-900 hover:bg-rose-850 text-white font-bold py-2.5 px-6 rounded-xl transition text-xs cursor-pointer"
            >
              Retry Central Link
            </button>
          </div>
        ) : !currentUser ? (
          /* ---------------- AUTHENTICATION HUB PANEL ---------------- */
          <div className="max-w-4xl mx-auto space-y-8 py-6 fade-in-entry">
            <div className="text-center space-y-2">
              <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold">
                ERP CONTROL NODE ACCESS GATES
              </span>
              <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight font-sans text-white">
                Solar Business Login Hub
              </h2>
              <p className="text-slate-400 text-sm max-w-lg mx-auto">
                Secure access gateway for Sunchaser Energy Systems administrators, engineering surveyors, sales reps, and customer accounts.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch pt-4">
              {/* Login form */}
              <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl relative overflow-hidden flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Lock className="text-amber-500 h-5 w-5" />
                    <h3 className="text-lg font-bold">Sign In Secures</h3>
                  </div>
                  <form onSubmit={handleLoginSubmit} className="space-y-4 text-xs font-mono">
                    <div className="space-y-1">
                      <label className="text-slate-400 block font-semibold">Username ID</label>
                      <input
                        type="text"
                        placeholder="e.g. admin, surveyor, customer"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-amber-500 text-sm font-sans"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400 block font-semibold">Key Password</label>
                      <input
                        type="password"
                        placeholder="Enter password (built-in test: 123)"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>
                    {loginError && (
                      <p className="text-red-400 text-center font-semibold text-[11px] pt-1 leading-snug">{loginError}</p>
                    )}
                    <button
                      type="submit"
                      disabled={loginLoading}
                      className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-extrabold text-sm py-3 px-4 rounded-xl transition cursor-pointer font-sans shadow shadow-amber-500/20 active:translate-y-px flex items-center justify-center gap-2"
                    >
                      {loginLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-slate-950" />
                          <span>Authorizing Identity...</span>
                        </>
                      ) : (
                        <>
                          <Key className="h-4 w-4" />
                          <span>Enter Command Console</span>
                        </>
                      )}
                    </button>
                  </form>
                </div>
                <div className="pt-4 border-t border-slate-800/70 text-[10px] text-slate-500 leading-relaxed font-mono">
                   * Encryption Hash: SHA-256 AES Secures<br />
                   * Standard administrative passcode is <strong className="text-amber-500/80">123</strong> for testing personas.
                </div>
              </div>

              {/* Dev Quick switcher / Roles directory list */}
              <div className="lg:col-span-7 bg-slate-900/60 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-lg flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2 font-mono">
                    <Sparkles className="text-amber-500 h-4 w-4" /> DEV & TESTING QUICK PERSONA SWITCHER
                  </h3>
                  <p className="text-xs text-slate-400 mb-4 font-sans">
                     Click any of Sunchaser's standard test profiles below to auto-login as that role and preview their custom workspace:
                  </p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { u: "admin", label: "Super Admin", desc: "Alex Admin", cap: "Unlocks metrics, full CRM, blueprints & server logs", col: "border-purple-900/40 hover:border-purple-500" },
                      { u: "manager", label: "Sales Manager", desc: "Sarah Manager", cap: "CRM lead delegator, manager metrics, tracers", col: "border-indigo-900/40 hover:border-indigo-500" },
                      { u: "sales", label: "Sales Executive", desc: "Sarah Connor", cap: "Sizing calculators, lead tracking, PDF quotations", col: "border-blue-900/40 hover:border-blue-500" },
                      { u: "surveyor", label: "Survey Engineer", desc: "Bob Surveyor", cap: "Roof CAD maps drawing & measures audits", col: "border-amber-900/40 hover:border-amber-500" },
                      { u: "installer", label: "Installation Team", desc: "Dave Installer", cap: "Staging, task checklists & commissioning", col: "border-emerald-950/40 hover:border-emerald-500" },
                      { u: "customer", label: "Customer Portal", desc: "John Miller (lead-1)", cap: "View/sign proposal, net meter, file support cases", col: "border-pink-900/40 hover:border-pink-500" }
                    ].map((pOpt) => (
                      <button
                        key={pOpt.u}
                        onClick={() => handleQuickLogin(pOpt.u, "123")}
                        className={`p-3 rounded-2xl bg-slate-950 text-left border ${pOpt.col} cursor-pointer transition flex flex-col justify-between h-28`}
                      >
                        <div>
                          <span className="text-xs font-bold font-sans text-neutral-100 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>{pOpt.label}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 mb-1.5 block">User: {pOpt.u} ({pOpt.desc})</span>
                        </div>
                        <p className="text-[9px] text-slate-500 leading-snug line-clamp-2 font-sans">{pOpt.cap}</p>
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="text-[10px] text-slate-400 border-t border-slate-800/50 pt-3 italic font-sans">
                  Choose a persona to explore role-based permissions immediately without typing.
                </div>
              </div>
            </div>
          </div>
        ) : appState ? (
          /* ---------------- AUTHORIZED DASHBOARD VIEWPORT ---------------- */
          <div className="fade-in-entry space-y-8">
            
            {/* Super admin spreadsheet controls line */}
            {(currentUser.role === "Super Admin" || currentUser.role === "Sales Manager") && (
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
            {activeTab === "Customer Portal" && (
              <CustomerPortal
                leads={appState.leads}
                tickets={appState.tickets}
                netMeteringList={appState.netMeteringHistory}
                onAddLead={handleAddLead}
                onAcceptQuote={handleAcceptQuote}
                onCreateTicket={handleCreateTicket}
                onReplyTicket={handleReplyTicket}
                categories={appState.categories || []}
                products={appState.products || []}
                orders={appState.orders || []}
                warranties={appState.warranties || []}
                notifications={appState.notifications || []}
                onRefreshState={loadDatabaseState}
              />
            )}

            {activeTab === "Sales Advisor" && (
              <SalesTeamApp
                leads={appState.leads}
                inventory={appState.inventory}
                onUpdateLead={handleUpdateLead}
                on创造Quote={handleCreateQuote}
                on提交Survey={handleSubmitSurvey}
                settings={appState.settings}
              />
            )}

            {activeTab === "CRM Database" && (
              <CRMApp
                leads={appState.leads}
                onUpdateLead={handleUpdateLead}
                onAddLead={handleAddLead}
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
        ) : (
          <div className="py-24 text-center text-slate-400 font-mono">
            <Inbox className="h-10 w-10 mx-auto opacity-50 mb-2" />
            <span>Connection pipeline down. Please refresh.</span>
          </div>
        )}
      </main>

      {/* Humble Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 py-6 text-center text-slate-500 text-xs font-mono mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <span>&copy; {new Date().getFullYear()} Sunchaser Energy Systems Inc. All Rights Reserved.</span>
          <span className="text-[10px] text-slate-600">STATE CONTROL COMPLIANCE • CONTAINER ISOLATED LAYER</span>
        </div>
      </footer>
    </div>
  );
}
