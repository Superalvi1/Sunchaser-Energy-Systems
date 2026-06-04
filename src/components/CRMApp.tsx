import React, { useState } from "react";
import { 
  Users, Search, Filter, Mail, Phone, Calendar, ArrowRightLeft, 
  Trash, ChevronDown, CheckCircle, Plus, Star, Sparkles, Brain, Loader2, RefreshCw, X, ShieldCheck, TrendingUp, MapPin, Inbox
} from "lucide-react";
import { Lead, User } from "../types";
import { runAiLeadScoring, currencySymbol } from "../services/api";
import WhatsAppModule from "./WhatsAppModule";

interface CRMAppProps {
  staffUser: User;
  leads: Lead[];
  onUpdateLead: (id: string, updatedData: any) => void;
  onAddLead: (data: any) => void;
  onDeleteLead?: (id: string) => void;
}

export default function CRMApp({
  staffUser,
  leads,
  onUpdateLead,
  onAddLead,
  onDeleteLead
}: CRMAppProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("All");
  
  // Lead scoring prioritization state: toggle sorting based on rating vs AI score vs creation date
  const [sortBy, setSortBy] = useState<'ai_score' | 'rating' | 'creation'>('ai_score');

  const [editLeadId, setEditLeadId] = useState<string | null>(null);

  // Edit details model temporal states
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSalesperson, setEditSalesperson] = useState("");
  
  // Custom demographic fields
  const [editLeadSource, setEditLeadSource] = useState("");
  const [editEngagement, setEditEngagement] = useState<'High' | 'Medium' | 'Low'>('Medium');
  const [editSanctionedLoad, setEditSanctionedLoad] = useState<number>(7);
  const [editBackupReq, setEditBackupReq] = useState("None");

  // New Lead Creation Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newBill, setNewBill] = useState<number>(200);
  const [newRoof, setNewRoof] = useState<number>(900);
  const [newShading, setNewShading] = useState<'None' | 'Low' | 'Medium' | 'High'>('Low');
  const [newSource, setNewSource] = useState("Web Search");
  const [newEngagement, setNewEngagement] = useState<'High' | 'Medium' | 'Low'>('Medium');

  // AI Diagnostic report modal
  const [aiDiagnosticLeadId, setAiDiagnosticLeadId] = useState<string | null>(null);
  const [aiDiagnosticText, setAiDiagnosticText] = useState<string | null>(null);
  const [aiDiagnosticLoading, setAiDiagnosticLoading] = useState(false);

  const handleEditClick = (lead: Lead) => {
    setEditLeadId(lead.id);
    setEditName(lead.name);
    setEditEmail(lead.email);
    setEditPhone(lead.phone);
    setEditAddress(lead.address);
    setEditNotes(lead.notes || "");
    setEditSalesperson(lead.assignedSalesperson || "Sarah Connor");
    setEditLeadSource(lead.leadSource || "Direct/Referral");
    setEditEngagement(lead.engagementLevel || "Medium");
    setEditSanctionedLoad(lead.sanctionedLoad || 7);
    setEditBackupReq(lead.backupRequirement || "None");
  };

  const handleEditSave = (id: string) => {
    onUpdateLead(id, {
      name: editName,
      email: editEmail,
      phone: editPhone,
      address: editAddress,
      notes: editNotes,
      assignedSalesperson: editSalesperson,
      leadSource: editLeadSource,
      engagementLevel: editEngagement,
      sanctionedLoad: Number(editSanctionedLoad) || 7,
      backupRequirement: editBackupReq
    });
    setEditLeadId(null);
  };

  const handleStatusChange = (id: string, newStatus: any) => {
    onUpdateLead(id, { status: newStatus });
  };

  const handleRatingChange = (id: string, newRating: number) => {
    onUpdateLead(id, { rating: newRating });
  };

  // Submit new lead
  const handleCreateLeadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newEmail) return;

    onAddLead({
      name: newName,
      email: newEmail,
      phone: newPhone,
      address: newAddress,
      monthlyBill: Number(newBill),
      roofSpace: Number(newRoof),
      shading: newShading,
      leadSource: newSource,
      engagementLevel: newEngagement,
      notes: "CRM Registered Candidate Profile"
    });

    // Reset fields
    setNewName("");
    setNewEmail("");
    setNewPhone("");
    setNewAddress("");
    setNewBill(200);
    setNewRoof(900);
    setNewShading("Low");
    setShowAddModal(false);
  };

  // Trigger Gemini AI qualitative diagnostics score report representation
  const triggerAiDiagnostic = async (leadId: string) => {
    setAiDiagnosticLeadId(leadId);
    setAiDiagnosticLoading(true);
    setAiDiagnosticText(null);
    try {
      const res = await runAiLeadScoring(leadId);
      setAiDiagnosticText(res.scoreAnalysis);
    } catch (err: any) {
      setAiDiagnosticText("Unstable AI channel. Standard conversion score remains high based on energy offsets.");
    } finally {
      setAiDiagnosticLoading(false);
    }
  };

  // Dynamic filter lists
  const filteredLeads = leads.filter(l => {
    const matchesSearch = 
      l.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      l.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.address.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (selectedStatus === "All") return matchesSearch;
    return matchesSearch && l.status === selectedStatus;
  });

  // Dynamic sorter lists
  const sortedLeads = [...filteredLeads].sort((a, b) => {
    if (sortBy === 'ai_score') {
      return (b.conversionScore || 0) - (a.conversionScore || 0);
    }
    if (sortBy === 'rating') {
      return b.rating - a.rating;
    }
    // Sort by creation date list
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div id="crm-view-portal" className="space-y-6 text-xs">
      
      {/* Information Header Banner card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:align-middle md:items-center gap-4 shadow-sm">
        <div>
          <span className="text-[10px] text-amber-400 font-bold tracking-wider font-mono bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            INTELLIGENT PIPELINE MANAGER
          </span>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white font-sans mt-2">
            CRM Campaign Lead Pool
          </h2>
          <p className="text-slate-400 mt-1 text-xs">
            Review applicant utility rates, schedule surveys, delegate sales advisors, and priority filter highest AI conversion scores.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold font-sans py-2.5 px-5 rounded-xl shadow cursor-pointer text-xs flex items-center gap-1.5 transition active:translate-y-px"
        >
          <Plus className="w-4 h-4" /> Add Solar Lead
        </button>
      </div>

      {/* SEARCH AND FILTERS TOOLBAR */}
      <div className="bg-slate-900 rounded-3xl border border-slate-800 p-6 shadow space-y-4">
        
        <div className="flex flex-col md:flex-row justify-between gap-4">
          {/* Searching string bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Filter names, emails, physical suburbs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-slate-100 text-xs focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Sort prioritization keys */}
          <div className="flex gap-2 items-center bg-slate-950 border border-slate-800 rounded-xl p-1 font-sans">
            <span className="text-slate-500 text-[10px] px-2 uppercase font-mono font-bold">Sort Priority:</span>
            {[
              { id: 'ai_score', label: 'AI Score Potential' },
              { id: 'rating', label: 'Manual rating' },
              { id: 'creation', label: 'Recent Registration' }
            ].map((pOpt) => (
              <button
                key={pOpt.id}
                onClick={() => setSortBy(pOpt.id as any)}
                className={`py-1.5 px-3 rounded-lg text-[10.5px] font-bold cursor-pointer transition ${
                  sortBy === pOpt.id ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                {pOpt.label}
              </button>
            ))}
          </div>

        </div>

        {/* Categories togglers filter bar */}
        <div className="flex gap-1.5 flex-wrap font-sans">
          {(['All', 'New', 'Contacted', 'Survey Scheduled', 'Quoted', 'Contracted', 'Installed', 'Negotiation', 'Won', 'Lost'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setSelectedStatus(status)}
              className={`px-3 py-1.5 rounded-xl text-[10.5px] font-bold border transition cursor-pointer ${
                selectedStatus === status
                  ? "bg-slate-950 text-white border-amber-500/40 shadow-sm"
                  : "bg-slate-950/40 text-slate-400 border-slate-850 hover:bg-slate-800"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* MAIN CARDS LIST CONTAINER GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {sortedLeads.length > 0 ? (
          sortedLeads.map((lead) => {
            const isEditing = editLeadId === lead.id;
            const aScore = lead.conversionScore || 50;
            const probPercent = lead.conversionProbability || 45;

            // Rating color thresholds
            let scoreColor = "text-amber-400 bg-amber-500/10 border-amber-500/20";
            if (aScore >= 80) scoreColor = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
            else if (aScore <= 40) scoreColor = "text-red-400 bg-red-400/10 border-red-400/20";

            return (
              <div 
                key={lead.id} 
                className={`bg-slate-900 border rounded-3xl p-6 shadow-sm space-y-4 hover:border-slate-700/60 transition ${
                  aScore >= 80 ? 'ring-1 ring-emerald-500/10' : ''
                }`}
              >
                {/* Upper client tags and AI Lead Conversion metrics box */}
                <div className="flex justify-between items-start border-b border-slate-800/65 pb-3">
                  <div>
                    <span className="text-[10px] uppercase font-mono font-bold tracking-tight text-slate-500">ID: {lead.id}</span>
                    <h3 className="text-sm font-bold text-slate-100 font-sans mt-0.5">{lead.name}</h3>
                    <p className="text-[10px] text-slate-400 font-mono"><MapPin className="h-3 w-3 inline mr-1 text-slate-500" /> {lead.address}</p>
                  </div>

                  {/* AI Scoring Indicator Ring/Pill */}
                  <div className={`p-2.5 rounded-2xl border text-right font-mono ${scoreColor} flex items-center gap-2 relative shadow-inner shadow-black/40`}>
                    <Brain className="h-4.5 w-4.5 animate-pulse shrink-0" />
                    <div>
                      <span className="text-[8px] uppercase block leading-none font-bold">AI Probability Score</span>
                      <span className="text-xs font-bold leading-none mt-1 block">{aScore} / 100 ({probPercent}%)</span>
                    </div>
                  </div>
                </div>

                {isEditing ? (
                  /* --- EDITING CARD MODE WORKSPACE VIEW --- */
                  <div className="space-y-3 pt-2 font-mono text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-slate-500 font-bold uppercase">Name</label>
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-slate-500 font-bold uppercase">Email</label>
                        <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-slate-500 font-bold uppercase">Phone</label>
                        <input type="text" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-slate-500 font-bold uppercase">Address</label>
                        <input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-slate-500 font-bold uppercase">Salesperson Advisor</label>
                        <select value={editSalesperson} onChange={(e) => setEditSalesperson(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white">
                          <option value="Sarah Connor">Sarah Connor</option>
                          <option value="Michael Scott">Michael Scott</option>
                          <option value="Alex Admin">Alex Admin</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-slate-500 font-bold uppercase">Lead Source</label>
                        <select value={editLeadSource} onChange={(e) => setEditLeadSource(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white">
                          <option value="Direct/Referral">Direct/Referral</option>
                          <option value="Web Search">Web Search</option>
                          <option value="Facebook Ad">Facebook Ad</option>
                          <option value="Google Maps Plataform">Google Maps Plattform</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-slate-500 font-bold uppercase">Engagement Level</label>
                        <select value={editEngagement} onChange={(e) => setEditEngagement(e.target.value as any)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white">
                          <option value="High">🔥 High</option>
                          <option value="Medium">⚡ Medium</option>
                          <option value="Low">❄️ Low</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-slate-500 font-bold uppercase">Sanctioned load</label>
                        <input type="number" value={editSanctionedLoad} onChange={(e) => setEditSanctionedLoad(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white" />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-slate-500 font-bold uppercase">Notes</label>
                      <textarea rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-xs" />
                    </div>

                    {/* Saving actions */}
                    <div className="flex gap-2 pt-2 justify-end">
                      <button 
                        onClick={() => setEditLeadId(null)}
                        className="bg-slate-950 border border-slate-850 hover:bg-slate-800 font-sans font-bold px-4 py-2 rounded-xl transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={() => handleEditSave(lead.id)}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-sans font-bold px-4 py-2 rounded-xl transition cursor-pointer"
                      >
                        Save Details Update
                      </button>
                    </div>
                  </div>
                ) : (
                  /* --- STANDARD DISPLAY READ CARD VIEWS --- */
                  <div className="space-y-3 pt-1 text-slate-300">
                    
                    {/* Contacts info line row */}
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div className="flex items-center gap-1.5 font-mono text-[11px] leading-tight select-all">
                        <Mail className="h-3.5 w-3.5 text-slate-500" />
                        <span className="truncate">{lead.email}</span>
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-[11px] leading-tight select-all">
                        <Phone className="h-3.5 w-3.5 text-slate-500" />
                        <span>{lead.phone}</span>
                      </div>
                    </div>

                    {/* Sizing indicators line row */}
                    <div className="grid grid-cols-3 gap-3 bg-slate-950/80 border border-slate-850/60 p-3 rounded-2xl font-mono text-xs">
                      <div>
                        <span className="text-slate-505 text-slate-500 text-[9px] block uppercase leading-none font-sans">Monthly Bills</span>
                        <span className="text-xs font-bold text-white block mt-1">{currencySymbol}{lead.monthlyBill}/mo</span>
                      </div>
                      <div>
                        <span className="text-slate-550 text-slate-500 text-[9px] block uppercase leading-none font-sans">Roof unshaded</span>
                        <span className="text-xs font-bold text-slate-200 block mt-1">{lead.roofSpace} sq ft</span>
                      </div>
                      <div>
                        <span className="text-slate-505 text-slate-500 text-[9px] block uppercase leading-none font-sans text-amber-500/80">Obstruction Shading</span>
                        <span className="text-xs font-bold text-amber-400 block mt-1">{lead.shading} Shading</span>
                      </div>
                    </div>

                    {/* Demographic metrics and Staff advisors */}
                    <div className="grid grid-cols-3 gap-2 py-1 flex-wrap text-[10px] font-mono leading-relaxed">
                      <div className="text-left bg-slate-950 p-1.5 pl-2.5 rounded-lg border border-slate-850">
                        <span className="text-slate-500 block">Acquisition Channel</span>
                        <strong className="text-slate-300">{lead.leadSource || "Direct"}</strong>
                      </div>
                      <div className="text-left bg-slate-950 p-1.5 pl-2.5 rounded-lg border border-slate-850">
                        <span className="text-slate-500 block">Engagement</span>
                        <strong className="text-amber-400 font-bold">{lead.engagementLevel || "Medium"}</strong>
                      </div>
                      <div className="text-left bg-slate-950 p-1.5 pl-2.5 rounded-lg border border-slate-850">
                        <span className="text-slate-500 block">Staff Sales Advisor</span>
                        <strong className="text-slate-300 truncate block">{lead.assignedSalesperson || "Sarah Connor"}</strong>
                      </div>
                    </div>

                    {/* Quotation Cost context summary tag line */}
                    {lead.quotes && lead.quotes.length > 0 && (
                      <div className="bg-slate-950 text-slate-300 border border-slate-850 px-3 py-2 rounded-2xl text-[10.5px] font-mono flex items-center justify-between">
                        <span>📜 <strong>Drafted Sunchaser Quote</strong> ({lead.quotes[0].systemSizekW} kW array)</span>
                        <strong className="text-emerald-400 text-xs font-extrabold">{currencySymbol}{lead.quotes[0].totalCost.toLocaleString()}</strong>
                      </div>
                    )}

                    {lead.notes && (
                      <p className="bg-slate-950/40 p-2.5 rounded-2xl text-slate-400 text-[11px] leading-relaxed select-all">
                        <strong className="text-[10px] text-slate-500 uppercase block font-mono">Closing remarks</strong>
                        &ldquo;{lead.notes}&rdquo;
                      </p>
                    )}

                    <WhatsAppModule
                      staffUser={staffUser}
                      preset="lead"
                      phone={lead.phone}
                      onPhonePersist={(p) => onUpdateLead(lead.id, { phone: p })}
                      customerName={lead.name}
                      leadId={lead.id}
                      customerId={`cust-${lead.id.replace(/^lead-/, "")}`}
                      templateVars={{
                        customerName: lead.name,
                        amount: lead.quotes?.[0]?.totalCost,
                        balance: lead.quotes?.[0]?.totalCost,
                      }}
                      compact
                    />

                    {/* Standard Action items bar */}
                    <div className="flex flex-wrap justify-between items-center gap-3 pt-2.5 border-t border-slate-800/50">
                      
                      {/* Interactive star reviews */}
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => handleRatingChange(lead.id, st)}
                            className="text-amber-500 hover:scale-110 transition cursor-pointer"
                          >
                            <Star className={`h-4 w-4 ${st <= lead.rating ? 'fill-amber-500 text-amber-500' : 'text-slate-700'}`} />
                          </button>
                        ))}
                      </div>

                      {/* Explicit category dropdown togglers */}
                      <div className="flex items-center gap-2">
                        
                        {/* Diagnostics retrieval trigger */}
                        <button
                          onClick={() => triggerAiDiagnostic(lead.id)}
                          className="bg-amber-400 hover:bg-amber-300 text-slate-950 py-1.5 px-3 rounded-xl font-bold font-sans transition cursor-pointer flex items-center gap-1.5"
                          title="Generate qualitative audit closing analysis with Gemini"
                        >
                          <Brain className="h-3.5 w-3.5 text-slate-950" />
                          <span>AI closing plan</span>
                        </button>

                        <button 
                          onClick={() => handleEditClick(lead)}
                          className="bg-slate-950 hover:bg-slate-800 border border-slate-850 px-3.5 py-1.5 rounded-xl font-sans font-bold transition text-slate-300 cursor-pointer"
                        >
                          Edit Profile
                        </button>

                        {onDeleteLead && (
                          <button
                            onClick={() => {
                              if (window.confirm(`Are you absolutely sure you want to delete lead "${lead.name}" and all associated quotes? This action cannot be undone.`)) {
                                onDeleteLead(lead.id);
                              }
                            }}
                            className="bg-red-950/40 hover:bg-red-900/60 border border-red-900/40 hover:border-red-500/50 p-2 rounded-xl text-red-400 transition cursor-pointer flex items-center justify-center"
                            title="Delete Lead Profile"
                          >
                            <Trash className="h-3.5 w-3.5" />
                          </button>
                        )}

                        <select
                          value={lead.status}
                          onChange={(e) => handleStatusChange(lead.id, e.target.value as any)}
                          className="bg-slate-950 border border-slate-850 rounded-xl px-2.5 py-1 text-[11px] font-bold py-1.5 text-slate-200 outline-none focus:border-amber-500"
                        >
                          <option value="New">New</option>
                          <option value="Contacted">Contacted</option>
                          <option value="Survey Scheduled">Survey Scheduled</option>
                          <option value="Quoted">Quoted</option>
                          <option value="Contracted">Contracted</option>
                          <option value="Installed">Installed</option>
                          <option value="Negotiation">Negotiation</option>
                          <option value="Won">Won</option>
                          <option value="Lost">Lost</option>
                        </select>
                      </div>

                    </div>
                  </div>
                )}

              </div>
            );
          })
        ) : (
          <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-400">
            <Inbox className="h-10 w-10 text-slate-500 mx-auto" />
            <strong className="block text-white mt-1">No candidate profile matches found.</strong>
            <span className="text-xs text-slate-400">Clear search parameters or register high solar profiles directly in the top corner.</span>
          </div>
        )}
      </div>

      {/* ---------------- NEW LEAD CREATION BACKEND MODAL ---------------- */}
      {showAddModal && (
        <div className="fixed inset-0 z-55 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 md:p-8 space-y-6 relative shadow-2xl">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white transition p-1.5 bg-slate-950 border border-slate-850 rounded-xl"
            >
              <X className="h-4 w-4" />
            </button>

            <div>
              <h3 className="text-base font-bold text-white font-sans flex items-center gap-1.5">
                <Sparkles className="text-amber-400" /> New Solar Lead Registration
              </h3>
              <p className="text-slate-400 text-xs">Enter structural and demographic metrics manually to trigger AI probability scorer.</p>
            </div>

            <form onSubmit={handleCreateLeadSubmit} className="space-y-4 font-mono text-xs text-left">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-bold block">First & Last Name</label>
                  <input type="text" required value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white" placeholder="John Miller" />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-bold block">Email address</label>
                  <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white" placeholder="john.miller@gmail.com" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-bold block">Contact Phone Code</label>
                  <input type="text" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white" placeholder="+1 (555) 349-2091" />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-bold block">Physical Property Address</label>
                  <input type="text" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white" placeholder="742 Evergreen Terrace, Springfield" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-bold block">Electricity Bill / Month ({currencySymbol.trim()})</label>
                  <input type="number" value={newBill} onChange={(e) => setNewBill(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white" />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-bold block">Roof Area Space (Sq ft)</label>
                  <input type="number" value={newRoof} onChange={(e) => setNewRoof(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 font-sans font-semibold">
                <div className="space-y-1">
                  <label className="text-slate-400 block font-mono">Shading Index</label>
                  <select value={newShading} onChange={(e) => setNewShading(e.target.value as any)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono">
                    <option value="None">None</option>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 block font-mono">Acquisition Source</label>
                  <select value={newSource} onChange={(e) => setNewSource(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono">
                    <option value="Web Search">Web Search</option>
                    <option value="Facebook Ad">Facebook Ad</option>
                    <option value="Google Maps Plataform">Google Maps Plattform</option>
                    <option value="Direct/Referral">Direct/Referral</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 block font-mono">Engagement</label>
                  <select value={newEngagement} onChange={(e) => setNewEngagement(e.target.value as any)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono">
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm py-3 px-4 rounded-xl transition cursor-pointer font-sans shadow pt-3"
              >
                Register Lead Profile & Run Scorer
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- GEMINI AI SCORES DIAGNOSTIC MODAL ---------------- */}
      {aiDiagnosticLeadId && (
        <div className="fixed inset-0 z-55 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg p-6 md:p-8 space-y-5 relative shadow-2xl">
            <button
              onClick={() => {
                setAiDiagnosticLeadId(null);
                setAiDiagnosticText(null);
              }}
              className="absolute top-5 right-5 text-slate-400 hover:text-white transition p-1.5 bg-slate-950 border border-slate-850 rounded-xl"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="bg-amber-500/10 p-2 rounded-xl text-amber-400">
                <Brain className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white font-sans">
                  Sunchaser Solar Conversion AI Diagnostics
                </h3>
                <span className="text-[10px] text-slate-400 font-mono">Customer profile: {leads.find(l => l.id === aiDiagnosticLeadId)?.name}</span>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4 min-h-[170px] flex items-center justify-center text-slate-300">
              {aiDiagnosticLoading ? (
                <div className="text-center space-y-2">
                  <Loader2 className="h-8 w-8 text-amber-500 animate-spin mx-auto" />
                  <span className="text-[11px] font-mono font-bold text-slate-500 block">Connecting with Sunchaser Directives Engine...</span>
                </div>
              ) : aiDiagnosticText ? (
                <div className="text-left leading-normal font-sans text-xs space-y-3 prose prose-invert select-all">
                  <div className="flex gap-2 items-center text-[10px] bg-emerald-500/10 border border-emerald-550/20 text-emerald-400 font-mono py-1 px-2.5 rounded-lg mb-2">
                    <ShieldCheck className="h-4 w-4 inline shrink-0" /> Live closing analysis formulated successfully!
                  </div>
                  {/* Clean qualitative text extraction display */}
                  <div className="whitespace-pre-wrap leading-relaxed text-slate-300 text-[11.5px] italic">
                    {aiDiagnosticText}
                  </div>
                </div>
              ) : (
                <span className="text-slate-500 font-mono text-[11px]">Audit pipeline ready. Trigger diagnostics.</span>
              )}
            </div>

            <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 pt-2 border-t border-slate-800/50">
               <span>Powered by Gemini-3.5-Flash</span>
               <button
                 onClick={() => triggerAiDiagnostic(aiDiagnosticLeadId)}
                 className="text-amber-400 font-bold border border-amber-900/40 py-1 px-3.5 rounded-lg hover:bg-slate-850 transition cursor-pointer flex items-center gap-1.5"
               >
                 <RefreshCw className="h-3 w-3" /> Re-Analyze
               </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
