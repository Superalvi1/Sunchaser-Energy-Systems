import React, { useState } from "react";
import { 
  Wrench, CheckSquare, Square, Upload, FileText, CheckCircle2, 
  MapPin, Loader2, Sparkles, Inbox, RefreshCw, Layers, DollarSign, CloudSun, Eye, Trash2, ShieldCheck, Plus, CheckCircle, Info
} from "lucide-react";
import { Lead, Installation, InstallationTask } from "../types";
import { currencySymbol, API_BASE_URL } from "../services/api";

interface InstallationTeamAppProps {
  leads: Lead[];
  onUpdateInstallation: (leadId: string, installationData: any) => void;
  // Admin-integrated full-stack models
  userId?: string;
  userName?: string;
  userRole?: string;
  projects?: any[];
  netMeteringTrackers?: Record<string, any>;
  paymentTracks?: Record<string, any>;
  onUpdateProjectStage?: (projectId: string, stage: string) => Promise<void>;
  onUpdateNetMetering?: (leadId: string, tracker: any) => Promise<void>;
  onPayMilestone?: (leadId: string, milestoneName: string, status: 'Pending' | 'Paid') => Promise<void>;
}

export default function InstallationTeamApp({
  leads,
  onUpdateInstallation,
  userId = "u-4",
  userName = "Staff Operator",
  userRole = "Super Admin",
  projects = [],
  netMeteringTrackers = {},
  paymentTracks = {},
  onUpdateProjectStage,
  onUpdateNetMetering,
  onPayMilestone
}: InstallationTeamAppProps) {
  
  // Tab within the operational view: permit switching if Super Admin, otherwise lock active deck
  const [opSegment, setOpSegment] = useState<'survey' | 'installation' | 'contracts'>('survey');

  // Filter leads that are contracted, quoted, or completed
  const activeLeads = leads.filter(l => l.status !== "New" && l.status !== "Lost");
  
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    activeLeads.length > 0 ? activeLeads[0].id : null
  );

  const activeLead = leads.find(l => l.id === selectedLeadId);
  const activeInstallation = activeLead?.installation;

  // Real-time site survey local builders
  const [surveyPitch, setSurveyPitch] = useState("25° Degrees");
  const [surveyRafters, setSurveyRafters] = useState("16 inches OC");
  const [surveyServicePanel, setSurveyServicePanel] = useState("200A Amp Central");
  const [surveyObstructions, setSurveyObstructions] = useState("Chimney on East corner, plumbing ventilation pipes");
  const [shadingPercent, setShadingPercent] = useState(5);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);
  const [reportNotes, setReportNotes] = useState("");
  const [surveySavedConfirm, setSurveySavedConfirm] = useState(false);

  // CAD Roof placement points mock list inside active session
  const [panelPlacements, setPanelPlacements] = useState<Array<{ x: number; y: number; id: number }>>(
    activeLead?.survey?.panelPlacements || [
      { x: 140, y: 120, id: 1 },
      { x: 180, y: 120, id: 2 },
      { x: 220, y: 120, id: 3 },
      { x: 140, y: 160, id: 4 },
      { x: 180, y: 160, id: 5 }
    ]
  );

  // Installer tracking reports states
  const [installerReport, setInstallerReport] = useState("");
  const [installerUploading, setInstallerUploading] = useState(false);

  const activeProject = projects.find(p => p.leadId === selectedLeadId);
  const activeTracker = netMeteringTrackers[selectedLeadId || ""];
  const activePayment = paymentTracks[selectedLeadId || ""];

  // Click on satellite canvas roof mock to append panel at cursor
  const handleRooftopCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);

    // Filter margin caps
    if (x < 10 || y < 10 || x > rect.width - 15 || y > rect.height - 15) return;

    const newPanel = {
      x,
      y,
      id: Date.now() + Math.random()
    };

    setPanelPlacements([...panelPlacements, newPanel]);
  };

  const removePanelAt = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPanelPlacements(panelPlacements.filter(p => p.id !== id));
  };

  const clearCADPanels = () => {
    setPanelPlacements([]);
  };

  // Submit site survey results on database
  const handleSurveyFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLead) return;

    const surveyReport = {
      shadingPercent,
      optimalPlacement: "Southern Facing Shingle Face with maximum 94% heat index",
      notes: reportNotes || "CAD structural panel spacing validated against rafter spacing.",
      measurements: {
        roofPitch: surveyPitch,
        rafterSpacing: surveyRafters,
        dimensions: `${surveyServicePanel} panel, unshaded area approx ${(panelPlacements.length * 18).toFixed(0)} sq ft`,
        obstructions: surveyObstructions
      },
      structureRecommendation: "Standard waterproof rail mounts config",
      dbInverterLocation: "Main Service Board exterior wall",
      panelPlacements
    };

    // Perform state update fetch 
    const res = await fetch(`${API_BASE_URL}/api/leads/${activeLead.id}/survey-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(surveyReport)
    });

    if (res.ok) {
      setSurveySavedConfirm(true);
      setTimeout(() => setSurveySavedConfirm(false), 3500);
      // Advance to quoted stage so salesperson can outline totals
      activeLead.status = "Quoted";
    }
  };

  // Toggle dynamic installer task marks
  const toggleInstallerTask = (taskId: string) => {
    if (!activeLead || !activeLead.installation) return;

    const updatedTasks = activeLead.installation.tasks.map(t => {
      if (t.id === taskId) return { ...t, done: !t.done };
      return t;
    });

    const doneCount = updatedTasks.filter(t => t.done).length;
    const progress = Math.round((doneCount / updatedTasks.length) * 100);

    onUpdateInstallation(activeLead.id, {
      ...activeLead.installation,
      tasks: updatedTasks,
      progress,
      status: progress === 100 ? "Completed" : progress > 0 ? "In Progress" : "Scheduled"
    });
  };

  const triggerUploadInstallerPhoto = () => {
    setInstallerUploading(true);
    setTimeout(() => {
      setInstallerUploading(false);
      if (activeLead && activeLead.installation) {
        onUpdateInstallation(activeLead.id, {
          ...activeLead.installation,
          completionPhotos: [
            "https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=800&auto=format&fit=crop&q=60",
            ...(activeLead.installation.completionPhotos || [])
          ]
        });
      }
    }, 1500);
  };

  const submitInstallerReportNotes = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLead || !activeLead.installation) return;

    onUpdateInstallation(activeLead.id, {
      ...activeLead.installation,
      report: installerReport
    });
    setInstallerReport("");
  };

  return (
    <div id="installation-deck-workspace" className="space-y-8 animate-fade-in text-xs">
      
      {/* Upper informational tag card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:align-middle md:items-center gap-4">
        <div>
          <span className="text-[10px] uppercase tracking-widest font-mono text-amber-400 font-bold bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full">
            Engineering Auditing & Dispatch Command
          </span>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white font-sans mt-2">
            Surveyor & Deployment Manager
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Conduct roof structural audits, complete interactive CAD panel placements, verify step checklists, and commission meters.
          </p>
        </div>

        {/* Workspace Switcher Segments */}
        <div className="bg-slate-950/80 border border-slate-800 p-1 rounded-xl flex gap-1 font-sans">
          <button
            onClick={() => setOpSegment('survey')}
            className={`py-1.5 px-3 rounded-lg font-bold cursor-pointer transition ${
              opSegment === 'survey' ? 'bg-amber-505 text-slate-950 font-extrabold bg-amber-400' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="h-3.5 w-3.5 inline mr-1" /> Site Survey CAD
          </button>
          <button
            onClick={() => setOpSegment('installation')}
            className={`py-1.5 px-3 rounded-lg font-bold cursor-pointer transition ${
              opSegment === 'installation' ? 'bg-amber-505 text-slate-950 font-extrabold bg-amber-400' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Wrench className="h-3.5 w-3.5 inline mr-1" /> Installer tasks
          </button>
          <button
            onClick={() => setOpSegment('contracts')}
            className={`py-1.5 px-3 rounded-lg font-bold cursor-pointer transition ${
              opSegment === 'contracts' ? 'bg-amber-505 text-slate-950 font-extrabold bg-amber-400' : 'text-slate-400 hover:text-white'
            }`}
          >
            <DollarSign className="h-3.5 w-3.5 inline mr-1" /> Project Ledger & Payments
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* SIDE BAR: SELECT ACTIVE LEAD CASE */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-md">
          <div className="border-b border-slate-800 pb-2">
            <h3 className="text-sm font-bold text-slate-105 font-sans">Select Active Dispatch Case</h3>
            <span className="text-[10px] text-slate-400 font-sans">All active leads in progression loop.</span>
          </div>

          <div className="space-y-2.5 max-h-[580px] overflow-y-auto pr-1">
            {activeLeads.length > 0 ? (
              activeLeads.map((lead) => {
                const isSelected = selectedLeadId === lead.id;
                return (
                  <button
                    key={lead.id}
                    onClick={() => {
                      setSelectedLeadId(lead.id);
                      if (lead.survey?.panelPlacements) {
                        setPanelPlacements(lead.survey.panelPlacements);
                      }
                    }}
                    className={`w-full p-3.5 rounded-2xl border text-left cursor-pointer transition ${
                      isSelected
                        ? "bg-slate-950 border-amber-500/40 text-white shadow-lg"
                        : "bg-slate-950/70 border-slate-850 hover:bg-slate-800/50 text-slate-300"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1 font-sans">
                      <span className="font-bold text-neutral-100 block max-w-[130px] truncate">{lead.name}</span>
                      <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${
                        isSelected ? "bg-amber-400 text-slate-950 font-bold" : "bg-slate-800 text-slate-400"
                      }`}>
                        {lead.status}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-slate-400 mb-2 truncate"><MapPin className="h-3 w-3 inline mr-1 text-amber-500" /> {lead.address}</p>
                    
                    {/* Tiny Progress tracker indicators */}
                    <div className="flex justify-between text-[9px] font-mono text-slate-500">
                      <span>Utility: {lead.monthlyBill ? `${currencySymbol}${lead.monthlyBill}/mo` : "Sizing Request"}</span>
                      <span>{lead.roofSpace} Sq Ft available</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="text-center py-12 text-slate-500 font-mono">No relevant client leads.</div>
            )}
          </div>
        </div>

        {/* WORKSPACE DETAILED BODY */}
        <div className="lg:col-span-8 space-y-6">
          {activeLead ? (
            <div>
              {/* SEGMENT 1: SURVEY DETAILED CAD blueprints MAPS MAPPER */}
              {opSegment === 'survey' && (
                <div className="space-y-6">
                  {/* Lead information banner */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-2">
                    <span className="text-[10px] text-amber-400 font-bold tracking-wider font-mono bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20 inline-block mb-1">
                      STAGE: ON-SITE ASSESSMENT blue print
                    </span>
                    <h3 className="text-base font-bold text-white font-sans">{activeLead.name} Roof Site Survey</h3>
                    <p className="text-slate-400 leading-snug">
                      Map unshaded areas directly from high-resolution satellite. Clear obstructions, log rafters spacing, load capacity variables, and click rooftop to place 400W premium solar cell rows.
                    </p>
                  </div>

                  {/* Dynamic Click-to-Place Rooftop CAD Canvas layout */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                    
                    {/* CAD Drawing interactive Canvas */}
                    <div className="md:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow space-y-3">
                      <div className="flex justify-between items-center text-xs font-mono border-b border-slate-800 pb-2">
                        <span className="font-bold text-slate-300">Satellite Rooftop (Click area to mount solar panels)</span>
                        <div className="flex gap-2">
                          <button
                            onClick={clearCADPanels}
                            className="text-red-400 font-bold hover:text-red-300 transition cursor-pointer text-[10px] flex items-center gap-1"
                          >
                            <Trash2 className="h-3 w-3" /> Clear CAD Layout
                          </button>
                        </div>
                      </div>

                      {/* Canvas Container frame */}
                      <div 
                        onClick={handleRooftopCanvasClick}
                        className="relative w-full aspect-[4/3] bg-slate-950 border border-slate-850 rounded-2xl cursor-crosshair overflow-hidden group shadow-inner"
                        style={{
                          backgroundImage: `linear-gradient(rgba(38, 38, 38, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(38, 38, 38, 0.4) 1px, transparent 1px)`,
                          backgroundSize: '20px 20px'
                        }}
                      >
                        {/* Mock Satellite Imagery background overlay */}
                        <div className="absolute inset-0 bg-cover bg-center mix-blend-overlay opacity-60 pointer-events-none" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1625244724120-1fd1d34d00f6?w=800&auto=format&fit=crop&q=80')` }}></div>

                        {/* Center compass pointer */}
                        <div className="absolute top-4 right-4 bg-slate-900/80 border border-slate-700 w-12 h-12 rounded-full flex flex-col items-center justify-center text-[9px] font-mono font-bold text-amber-400 select-none shadow pointer-events-none">
                          <span>N ↑</span>
                          <span className="text-[7px] text-slate-500">35.9°</span>
                        </div>

                        {/* Interactive CAD instructions tooltip */}
                        <div className="absolute bottom-3 left-3 bg-slate-900/90 border border-slate-800 rounded-lg py-1 px-2.5 text-[9px] font-sans text-slate-400 pointer-events-none tracking-normal">
                          💡 Click crosshair bounds to stick panel columns.
                        </div>

                        {/* Array placements renders */}
                        {panelPlacements.map((panel, index) => (
                          <div
                            key={panel.id}
                            className="absolute bg-amber-400/90 border border-slate-950 font-mono text-[8px] font-bold text-slate-950 rounded py-1 px-1.5 shadow-md flex flex-col justify-center items-center cursor-pointer select-none ring-1 ring-amber-300 transform -translate-x-1/2 -translate-y-1/2"
                            style={{ left: panel.x, top: panel.y }}
                            onClick={(e) => removePanelAt(panel.id, e)}
                            title="Click to remove"
                          >
                            <span>#{index+1}</span>
                            <span>400W</span>
                          </div>
                        ))}
                      </div>

                      {/* CAD Math dynamic counts calculator footer */}
                      <div className="bg-slate-950/80 border border-slate-850 rounded-2xl p-4 grid grid-cols-3 gap-4 font-mono text-xs">
                        <div className="text-left border-r border-slate-800/80 pr-2">
                          <span className="text-slate-500 text-[10px] block uppercase">Mounted Panels</span>
                          <span className="text-base font-bold text-white tracking-tight">{panelPlacements.length} Units</span>
                        </div>
                        <div className="text-left border-r border-slate-800/80 pr-2">
                          <span className="text-slate-500 text-[10px] block uppercase">Total Size kW</span>
                          <span className="text-base font-bold text-amber-400 tracking-tight">{(panelPlacements.length * 0.4).toFixed(1)} kW</span>
                        </div>
                        <div className="text-left">
                          <span className="text-slate-500 text-[10px] block uppercase font-sans">Est. Roof Area</span>
                          <span className="text-base font-bold text-emerald-400 tracking-tight">{(panelPlacements.length * 17.5).toFixed(0)} sq ft</span>
                        </div>
                      </div>
                    </div>

                    {/* Structural auditing variables selectors inputs */}
                    <div className="md:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow space-y-5">
                      <div className="border-b border-slate-800 pb-2">
                        <h4 className="text-sm font-bold text-slate-201 font-sans">Structural Auditor Inputs</h4>
                        <span className="text-[10px] text-slate-400">Specify material and structural metrics.</span>
                      </div>

                      <form onSubmit={handleSurveyFormSubmit} className="space-y-4 font-mono text-xs">
                        <div className="space-y-1">
                          <label className="text-slate-400 block font-semibold">Home Roof Pitch Angle</label>
                          <select
                            value={surveyPitch}
                            onChange={(e) => setSurveyPitch(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                          >
                            <option value="15° Degrees">15° Degrees (Low slope)</option>
                            <option value="25° Degrees">25° Degrees (Medium slope)</option>
                            <option value="35° Degrees">35° Degrees (Steep slope)</option>
                            <option value="Flat Horizontal">Flat Horizontal (Flush layout)</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-400 block font-semibold">Building Rafter Spacing</label>
                          <select
                            value={surveyRafters}
                            onChange={(e) => setSurveyRafters(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                          >
                            <option value="16 inches OC">16" inches OC (Standard residential)</option>
                            <option value="24 inches OC">24" inches OC (Wide spacing)</option>
                            <option value="Commercial Steel framing">Commercial steel framing (Flush grid)</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-400 block font-semibold">Service Breaker panel rating</label>
                          <select
                            value={surveyServicePanel}
                            onChange={(e) => setSurveyServicePanel(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                          >
                            <option value="100A Amp Central">100A Service Board (Requires Upgrade)</option>
                            <option value="150A Amp Central">150A Service Board (Acceptable)</option>
                            <option value="200A Amp Central">200A Service Board (Perfect/Ideal)</option>
                            <option value="400A Premium service">400A Premium Service (Commercial standard)</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between font-bold">
                            <label className="text-slate-400 block font-semibold">Active Shading Index</label>
                            <span className="text-amber-400">{shadingPercent}% obstruction</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="60"
                            step="5"
                            value={shadingPercent}
                            onChange={(e) => setShadingPercent(Number(e.target.value))}
                            className="w-full text-amber-500 accent-amber-500 bg-slate-950 h-2 rounded-lg cursor-pointer"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-400 block font-semibold">Identified Obstructions list</label>
                          <input
                            type="text"
                            value={surveyObstructions}
                            onChange={(e) => setSurveyObstructions(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100"
                            placeholder="Chimneys, pipes, foliage overhang"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-400 block font-semibold">Survey audit field reports</label>
                          <textarea
                            rows={3}
                            value={reportNotes}
                            onChange={(e) => setReportNotes(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100"
                            placeholder="Enter site roof dimensions diagnostic notes here..."
                          />
                        </div>

                        {surveySavedConfirm && (
                          <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-3 rounded-2xl text-[11px] font-sans font-bold flex items-center gap-1.5 leading-snug">
                            <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400 animate-bounce" />
                            <span>Successfully saved layout schema on DB! Solar quote generated alerts triggered.</span>
                          </div>
                        )}

                        <button
                          type="submit"
                          className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm py-3 px-4 rounded-xl transition cursor-pointer font-sans shadow"
                        >
                          Submit survey report blueprint
                        </button>
                      </form>
                    </div>

                  </div>
                </div>
              )}

              {/* SEGMENT 2: INSTALLATION PROGRESS CHECKLIST */}
              {opSegment === 'installation' && (
                <div className="space-y-6">
                  {/* Installation header detail panel */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:align-middle md:items-center gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono text-amber-400 font-bold uppercase bg-amber-500/10 py-1 px-3 border border-amber-500/20 rounded-full">
                        ACTIVE PHYSICAL INTERACTION LAYER
                      </span>
                      <h3 className="text-base md:text-lg font-bold font-sans text-neutral-100 mt-1">Grid Deploy Task Deck: {activeLead.name}</h3>
                      <p className="text-slate-400 block tracking-normal leading-normal">
                        Site Installation: {activeLead.address}
                      </p>
                    </div>

                    <div className="font-mono text-right md:bg-slate-950 border border-slate-850 p-3 rounded-2xl">
                      <span className="text-slate-500 text-[10px] block font-sans">Active Deployment Base</span>
                      <span className="text-sm font-extrabold text-amber-400">{(activeLead.installation?.progress || 0)}% Completed</span>
                    </div>
                  </div>

                  {activeLead.installation ? (
                    <div className="space-y-6">
                      {/* Installation interactive checklist items */}
                      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-4">
                        <div className="border-b border-slate-800 pb-2">
                          <h4 className="text-xs font-mono font-bold text-slate-400 uppercase font-sans">Hardware Mount Staging Checklist</h4>
                        </div>

                        <div className="space-y-3 pt-2">
                          {activeLead.installation.tasks.map((task: InstallationTask) => (
                            <div
                              key={task.id}
                              onClick={() => toggleInstallerTask(task.id)}
                              className={`flex items-start gap-3.5 p-4 rounded-2xl border transition cursor-pointer ${
                                task.done
                                  ? "bg-amber-500/10 border-amber-500/20 text-slate-200 font-medium font-sans animate-fade-in"
                                  : "bg-slate-950 border-slate-850 hover:bg-slate-800/50 text-slate-400"
                              }`}
                            >
                              <button type="button" className="shrink-0 mt-0.5 cursor-pointer">
                                {task.done ? (
                                  <CheckSquare className="h-5 w-5 text-amber-500 fill-slate-950" />
                                ) : (
                                  <Square className="h-5 w-5 text-slate-600" />
                                )}
                              </button>
                              <div>
                                <span className={`text-xs block ${task.done ? 'text-white font-bold font-sans' : 'text-slate-305'}`}>{task.name}</span>
                                <span className="text-[10px] text-slate-500 block mt-0.5">Complies with safety codes, requires site signature update.</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Photo attachments simulation, report notes */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                        
                        {/* Attachments form box */}
                        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono mb-2">Deploy Photo compliance Vault</h4>
                          <p className="text-slate-400 text-xs text-left">
                            Drop structural rails seals, inverter connection blocks, or panel array views to verify compliance records.
                          </p>

                          <div className="space-y-4">
                            <button
                              type="button"
                              onClick={triggerUploadInstallerPhoto}
                              disabled={installerUploading}
                              className="w-full border-2 border-dashed border-slate-800 hover:border-amber-500 hover:bg-amber-500/5 py-8 text-center rounded-2xl flex flex-col items-center justify-center gap-2 transition focus:outline-none cursor-pointer"
                            >
                              <Upload className="h-6 w-6 text-slate-500" />
                              <span className="text-xs font-bold text-slate-300">Fast Upload Installation Photo</span>
                              <span className="text-[9px] text-slate-500">Auto-attaches directly to client deployment record</span>
                            </button>

                            {installerUploading && (
                              <div className="flex items-center gap-2 justify-center text-xs font-mono font-bold text-slate-400">
                                <Loader2 className="h-4 w-4 text-amber-500 animate-spin" /> Uploading image stream...
                              </div>
                            )}

                            {/* Images grid */}
                            {activeLead.installation.completionPhotos && activeLead.installation.completionPhotos.length > 0 && (
                              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/50">
                                {activeLead.installation.completionPhotos.map((p, idx) => (
                                  <div key={idx} className="relative aspect-square bg-slate-950 border border-slate-850 rounded-xl overflow-hidden group">
                                    <img src={p} className="w-full h-full object-cover" referrerpolicy="no-referrer" />
                                    <span className="absolute bottom-1 right-1 bg-slate-900/80 px-1 text-[8px] text-amber-400 font-mono rounded">Photo #{idx+1}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Report notes box submission */}
                        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-sm space-y-4 flex flex-col justify-between">
                          <div className="space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono mb-2">Final Commissioning Report</h4>
                            <p className="text-slate-400 text-xs">Specify diagnostic log readings of the Enphase microinverters or structural tension checks.</p>
                            
                            <form onSubmit={submitInstallerReportNotes} className="space-y-3.5 font-mono text-xs">
                              <textarea
                                rows={4}
                                required
                                value={installerReport}
                                onChange={(e) => setInstallerReport(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-amber-500"
                                placeholder="Write diagnostic report parameters..."
                              />
                              <button
                                type="submit"
                                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs py-2 px-3 rounded-xl transition cursor-pointer font-sans"
                              >
                                Save deployment report notes
                              </button>
                            </form>
                          </div>

                          {activeLead.installation.report && (
                            <div className="bg-slate-950 border border-slate-850 rounded-2xl p-3.5 relative overflow-hidden italic text-slate-350 text-xs font-serif leading-relaxed mt-4">
                              <span className="text-[9px] font-mono uppercase bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-slate-400 absolute top-2 right-2 flex items-center gap-1">
                                <ShieldCheck className="h-3 w-3 text-emerald-400 inline" /> CERTIFIED REPORT NOTES
                              </span>
                              <div className="pt-3 block">
                                &ldquo;{activeLead.installation.report}&rdquo;
                              </div>
                            </div>
                          )}
                        </div>

                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-400">
                      <Inbox className="h-10 w-10 text-slate-500 mx-auto" />
                      <span className="font-bold text-white block mt-2">No installer tasks loaded for client yet.</span>
                      <p className="text-xs text-slate-400 mt-1">Accept the designer quotation proposals on the Customer tab to provision standard installer checklists.</p>
                    </div>
                  )}
                </div>
              )}

              {/* SEGMENT 3: PROJECT STAGING AND CONTRACTED MILESTONES BILLINGS PAYMENTS */}
              {opSegment === 'contracts' && (
                <div className="space-y-6">
                  {/* Project milestone sequencing visual tracker */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
                    <div>
                      <h4 className="text-base font-bold text-white font-sans">Sunchaser Phased Staging tracker</h4>
                      <p className="text-slate-400">Sequenced development path coordinates required of utility and structural approvals.</p>
                    </div>

                    {activeProject ? (
                      <div className="space-y-4 text-xs font-mono">
                        <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div>
                            <span className="text-slate-500 text-[10px] uppercase">Project ID Token</span>
                            <span className="text-slate-200 block font-bold mt-0.5">{activeProject.id}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[10px] uppercase">Active Stage Tag</span>
                            <span className="text-amber-400 block font-bold mt-0.5">{activeProject.stage}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[10px] uppercase font-sans">System Sizing Sized</span>
                            <span className="text-slate-200 block font-bold mt-0.5">{activeProject.systemSizekW} kW Array</span>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[10px] uppercase font-sans">Operational Sync Date</span>
                            <span className="text-slate-200 block font-bold mt-0.5">{new Date(activeProject.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>

                        {/* Staging controls selections */}
                        <div className="space-y-2">
                          <label className="text-slate-400 block font-bold font-sans">Promote Project Stage Pipeline</label>
                          <div className="flex gap-2 flex-wrap">
                            {[
                              "Lead Won", "Advance Received", "Material Procurement", 
                              "Structure Installation", "Panel Installation", "Testing & Commissioning", 
                              "Net Metering Submitted", "Net Metering Approved", "Completed"
                            ].map((stg) => (
                              <button
                                key={stg}
                                onClick={() => onUpdateProjectStage?.(activeProject.id, stg)}
                                className={`py-1.5 px-3 rounded-lg text-[10px] font-bold cursor-pointer transition ${
                                  activeProject.stage === stg
                                    ? "bg-amber-400 text-slate-950 font-extrabold shadow"
                                    : "bg-slate-950 hover:bg-slate-800 text-slate-400 border border-slate-850"
                                }`}
                              >
                                {stg}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-950/40 p-6 rounded-2xl text-center border border-slate-850 text-slate-400">
                        No official project established on database state yet. Signed contract creates trackers automatically.
                      </div>
                    )}
                  </div>

                  {/* Net metering trackers & payments milestone items cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                    
                    {/* Interconnection regulatory tracker form */}
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
                      <div>
                        <h4 className="text-sm font-bold text-white font-sans flex items-center gap-1.5">
                          <Layers className="text-amber-500 w-4.5 h-4.5" /> DISCO Net Metering Compliance Tracker
                        </h4>
                        <p className="text-slate-400 text-xs">Official filings tracker with regional utility board.</p>
                      </div>

                      {activeTracker ? (
                        <div className="space-y-3 pt-2 text-xs font-mono">
                          {[
                            { key: "documentsCollected", label: "User engineering blueprints compiled" },
                            { key: "applicationSubmitted", label: "Interconnection filing logged to DISCO portal" },
                            { key: "discoInspection", label: "Utility engineer structural on-site diagnostics" },
                            { key: "demandNotice", label: "Security capacity demand notice paid" },
                            { key: "meterInstallation", label: "Bi-directional smart green meter installed" },
                            { key: "greenMeterActive", label: "Solar grid generation feeding live offsetting credits" }
                          ].map((item) => {
                            const isChecked = activeTracker[item.key];
                            return (
                              <div
                                key={item.key}
                                onClick={() => {
                                  onUpdateNetMetering?.(selectedLeadId!, { ...activeTracker, [item.key]: !isChecked });
                                }}
                                className={`p-3 rounded-xl border cursor-pointer transition flex justify-between items-center ${
                                  isChecked
                                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 font-bold"
                                    : "bg-slate-950 border-slate-850 text-slate-400 hover:bg-slate-800"
                                }`}
                              >
                                <span className="font-sans text-[11px] font-medium text-slate-200">{item.label}</span>
                                <span className={`text-[9px] font-bold py-0.5 px-2 rounded-lg font-mono ${
                                  isChecked ? "bg-emerald-500 text-slate-950" : "bg-slate-905 bg-slate-900 text-slate-505"
                                }`}>
                                  {isChecked ? "COMPLETED" : "PENDING"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="bg-slate-950 p-6 rounded-2xl text-center border border-slate-850 text-slate-500">
                          Net Metering tracker initiates once proposal quotes are finalized & accepted.
                        </div>
                      )}
                    </div>

                    {/* Milestone payments ledger items */}
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow shadow-amber-500/5 space-y-4">
                      <div>
                        <h4 className="text-sm font-bold text-white font-sans flex items-center gap-1.5">
                          <DollarSign className="text-amber-500 w-4.5 h-4.5" /> Project billing receipts log
                        </h4>
                        <p className="text-slate-400 text-xs">Verify financial advances and milestone payments checks.</p>
                      </div>

                      {activePayment ? (
                        <div className="space-y-3 pt-2 text-xs font-mono">
                          <div className="bg-slate-950 border border-slate-850 p-3.5 rounded-2xl flex justify-between text-xs leading-normal">
                            <div className="text-left">
                              <span className="text-[10px] text-slate-500">SECURED CONTRACT SUM</span>
                              <span className="text-sm font-extrabold text-white block">{currencySymbol}{activePayment.totalValue.toLocaleString()}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] text-slate-500">PENDING RECEIVABLE</span>
                              <span className="text-sm font-extrabold text-amber-500 block">{currencySymbol}{activePayment.pendingAmount.toLocaleString()}</span>
                            </div>
                          </div>

                          {/* Individual milestone checklists toggling */}
                          <div className="space-y-2.5">
                            {activePayment.milestones.map((mil: any) => {
                              const isPaid = mil.status === "Paid";
                              return (
                                <div
                                  key={mil.name}
                                  onClick={() => {
                                    onPayMilestone?.(selectedLeadId!, mil.name, isPaid ? 'Pending' : 'Paid');
                                  }}
                                  className={`p-3 rounded-xl border cursor-pointer transition flex justify-between items-center ${
                                    isPaid
                                      ? "bg-slate-950 border-emerald-900/60 text-slate-100"
                                      : "bg-slate-950 border-slate-850 text-slate-400 hover:bg-slate-800"
                                  }`}
                                >
                                  <div>
                                    <span className="text-[11px] font-sans font-bold text-slate-200 block leading-tight">{mil.name}</span>
                                    <span className="text-[9px] text-slate-500 font-mono">Due Amount: <strong className="text-slate-400">{currencySymbol}{mil.amount.toLocaleString()}</strong></span>
                                  </div>
                                  <span className={`text-[9.5px] font-bold py-1 px-2.5 rounded-lg ${
                                    isPaid ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-900 text-slate-500"
                                  }`}>
                                    {isPaid ? "RECEIVED" : "UNPAID"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                        </div>
                      ) : (
                        <div className="bg-slate-950 p-6 rounded-2xl text-center border border-slate-850 text-slate-500">
                          Billing profiles formulate dynamically upon client quote acceptance retainer.
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-400">
              <Inbox className="h-10 w-10 text-slate-500 mx-auto" />
              <span className="font-bold text-white block mt-2">No active clients assigned</span>
              <p className="text-xs text-slate-400">Ensure leads are booked or scheduled through the CRM to populate staff rosters.</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
