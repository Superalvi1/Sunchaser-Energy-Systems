import React, { useState } from "react";
import { 
  Sparkles, Bot, Settings, Send, Calendar, CheckCircle2, 
  ArrowRight, FileText, Loader2, RefreshCw, Clipboard 
} from "lucide-react";
import { askGeminiAssistant, generateSizingRecommendations, generateProposalDocument, currencySymbol } from "../services/api";

interface AIAssistantProps {
  onAddLead: (data: any) => void;
}

export default function AIAssistant({ onAddLead }: AIAssistantProps) {
  // Sizing assistant variables
  const [bill, setBill] = useState<number>(200);
  const [space, setSpace] = useState<number>(850);
  const [shading, setShading] = useState("Low");
  const [location, setLocation] = useState("California, USA");
  const [additionalNotes, setWithNotes] = useState("");

  const [sizingResult, setSizingResult] = useState("");
  const [sizingLoading, setSizingLoading] = useState(false);

  // Proposal creator variables
  const [customerName, setCustomerName] = useState("John Miller");
  const [customerAddress, setCustomerAddress] = useState("742 Evergreen Terrace, Springfield");
  const [sizekW, setSizekW] = useState<number>(8.5);
  const [batteryUpgrade, setBatteryUpgrade] = useState(true);
  const [totalCost, setTotalCost] = useState<number>(19500);
  const [proposalResult, setProposalResult] = useState("");
  const [proposalLoading, setProposalLoading] = useState(false);

  // Chat interface variables
  const [chatMessages, setChatMessages] = useState<Array<{ sender: 'Customer' | 'Agent'; text: string }>>([
    { sender: "Agent", text: "Hello! I am Sunchaser AI, Sunchaser's virtual advisor. I can output structural hardware specs, detail Federal 30% solar tax equations, or size your batteries. How can we clean up your electricity grid today?" }
  ]);
  const [userQuery, setUserQuery] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Tab selections inside Assistant
  const [activeTab, setActiveTab ] = useState<'chat' | 'size' | 'proposal'>('chat');

  // Trigger Chat response
  const handleChatSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userQuery.trim() || chatLoading) return;

    const userMsg = userQuery;
    setUserQuery("");
    setChatMessages((prev) => [...prev, { sender: "Customer", text: userMsg }]);
    setChatLoading(true);

    try {
      const chatHistory = chatMessages.slice(-6); // feed last 6 exchanges for context
      const response = await askGeminiAssistant(userMsg, chatHistory);
      setChatMessages((prev) => [...prev, { sender: "Agent", text: response.text }]);
    } catch (err: any) {
      console.error(err);
      setChatMessages((prev) => [...prev, { sender: "Agent", text: "I apologize, my clean-grid communication arrays are currently syncing. Please try again! (Local Sunchaser Core system online)" }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Trigger Sizing Analysis
  const handleSizingTrigger = async () => {
    setSizingLoading(true);
    setSizingResult("");
    try {
      const response = await generateSizingRecommendations({
        monthlyBill: bill,
        roofSpace: space,
        shading,
        stateLocation: location,
        notes: additionalNotes
      });
      setSizingResult(response.recommendations);
    } catch (err) {
      console.error(err);
      setSizingResult("Sizing simulation returned standard load defaults due to net-balancing. System size requested: 7.2kW.");
    } finally {
      setSizingLoading(false);
    }
  };

  // Trigger proposal draft builder
  const handleProposalTrigger = async () => {
    setProposalLoading(true);
    setProposalResult("");
    try {
      const response = await generateProposalDocument({
        customerName,
        address: customerAddress,
        systemSizekW: sizekW,
        batteryUpgrade,
        totalCost,
        notes: additionalNotes
      });
      setProposalResult(response.proposalMarkdown);
    } catch (err) {
      console.error(err);
      setProposalResult("# SUNCHASER CONTRACT PROPOSAL DRAFT\n\nFailed to draft proposal due to cloud synchronization vectors. Primary Sunchaser offline reserves active.");
    } finally {
      setProposalLoading(false);
    }
  };

  return (
    <div id="ai-assistant-view" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-fade-in">
      {/* Tab select menu controller */}
      <div className="lg:col-span-3 bg-neutral-900 rounded-3xl border border-neutral-800 p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-bold text-neutral-100 font-sans">Sunchaser AI Workspace</h3>
          <span className="text-[10px] font-mono tracking-wider font-bold text-amber-500 block uppercase">Powered by Gemini 3.5</span>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => setActiveTab('chat')}
            className={`w-full py-3 px-4 rounded-2xl text-xs font-semibold text-left transition flex items-center gap-2.5 cursor-pointer ${
              activeTab === 'chat'
                ? "bg-neutral-950 border border-amber-500/40 text-neutral-100 font-bold"
                : "bg-neutral-955 text-neutral-400 border border-neutral-850 hover:bg-neutral-800"
            }`}
          >
            <Bot className="h-4.5 w-4.5 text-amber-500" /> Sunchaser Support Chat
          </button>
          <button
            onClick={() => setActiveTab('size')}
            className={`w-full py-3 px-4 rounded-2xl text-xs font-semibold text-left transition flex items-center gap-2.5 cursor-pointer ${
              activeTab === 'size'
                ? "bg-neutral-950 border border-amber-500/40 text-neutral-100 font-bold"
                : "bg-neutral-955 text-neutral-400 border border-neutral-850 hover:bg-neutral-800"
            }`}
          >
            <Sparkles className="h-4.5 w-4.5 text-amber-500 animate-pulse" /> Sizing recommendation
          </button>
          <button
            onClick={() => setActiveTab('proposal')}
            className={`w-full py-3 px-4 rounded-2xl text-xs font-semibold text-left transition flex items-center gap-2.5 cursor-pointer ${
              activeTab === 'proposal'
                ? "bg-neutral-950 border border-amber-500/40 text-neutral-100 font-bold"
                : "bg-neutral-955 text-neutral-400 border border-neutral-850 hover:bg-neutral-800"
            }`}
          >
            <FileText className="h-4.5 w-4.5 text-indigo-405" /> Contract proposal creator
          </button>
        </div>

        <div className="pt-2 border-t border-neutral-800 text-[11px] leading-relaxed text-neutral-500 font-sans">
          Sunchaser AI queries active engineering data layers to craft compliant proposals, size stackable lithium storage cores, and resolve customer support chats.
        </div>
      </div>

      {/* Main interactive panel */}
      <div className="lg:col-span-9 bg-neutral-900 border border-neutral-800 rounded-3xl p-6 md:p-8 shadow-sm minimum-height-pane">
        {activeTab === 'chat' && (
          <div className="space-y-6 flex flex-col justify-between h-full">
            <div>
              <h3 className="text-base font-bold text-neutral-100 flex items-center gap-1.5 font-sans">
                <Bot className="h-5 w-5 text-amber-500 animate-bounce" /> Sunchaser AI Support Chatbot
              </h3>
              <p className="text-neutral-400 text-xs mt-1">Query technical components, calculate physical azimuth grids, or inspect tax-offsets.</p>
            </div>

            {/* Chat list block */}
            <div className="bg-neutral-950 rounded-2xl p-4 h-96 overflow-y-auto space-y-4 border border-neutral-850">
              {chatMessages.map((msg, index) => {
                const isUser = msg.sender === 'Customer';
                return (
                  <div key={index} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                      isUser 
                        ? 'bg-neutral-900 text-white rounded-tr-none border border-neutral-800' 
                        : 'bg-neutral-905 text-neutral-200 rounded-tl-none border border-neutral-800 shadow-sm'
                    }`}>
                      <strong className="block text-[8px] uppercase tracking-wider text-neutral-500 font-mono mb-1">
                        {isUser ? "Customer User" : "Sunchaser Virtual Agent"}
                      </strong>
                      <span className="whitespace-pre-line">{msg.text}</span>
                    </div>
                  </div>
                );
              })}
              {chatLoading && (
                <div className="flex gap-2 items-center text-xs text-neutral-400 font-mono animate-pulse">
                  <Loader2 className="h-4.5 w-4.5 animate-spin text-amber-500" /> Sunchaser AI thinking...
                </div>
              )}
            </div>

            {/* Prompt input Form */}
            <form onSubmit={handleChatSend} className="flex gap-2">
              <input
                type="text"
                required
                placeholder="Ask about Federal Solar ITC 30%, Sunchaser Core Battery spec, mounting..."
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-4 text-neutral-100 text-xs py-3 focus:outline-none focus:border-amber-500 font-sans"
              />
              <button
                type="submit"
                className="bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold px-5 rounded-xl transition cursor-pointer"
              >
                <Send className="h-4.5 w-4.5" />
              </button>
            </form>
          </div>
        )}

        {activeTab === 'size' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-base font-bold text-neutral-100 flex items-center gap-1.5 font-sans">
                <Sparkles className="h-5 w-5 text-amber-500" /> Sunchaser Solar Sizing Optimization
              </h3>
              <p className="text-neutral-400 text-xs mt-1">Simulate precise energy grids matching monthly electricity usage profiles.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
              <div className="space-y-1">
                <label className="font-semibold text-neutral-450 text-neutral-400 block font-sans">Avg Electricity Bill ({currencySymbol.trim()})</label>
                <input
                  type="number"
                  value={bill}
                  onChange={(e) => setBill(Number(e.target.value))}
                  className="w-full bg-neutral-955 border border-neutral-850 hover:bg-neutral-900 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-neutral-400 block font-sans">Unshaded Roof Space (sq ft)</label>
                <input
                  type="number"
                  value={space}
                  onChange={(e) => setSpace(Number(e.target.value))}
                  className="w-full bg-neutral-955 border border-neutral-850 hover:bg-neutral-900 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-neutral-400 block font-sans">Level of shading</label>
                <select
                  value={shading}
                  onChange={(e) => setShading(e.target.value)}
                  className="w-full bg-neutral-955 border border-neutral-850 hover:bg-neutral-900 rounded-xl px-3 py-2 text-neutral-150 focus:outline-none focus:border-amber-500 font-sans cursor-pointer"
                >
                  <option className="bg-neutral-950 text-neutral-100" value="None">None - South Southern exposure</option>
                  <option className="bg-neutral-950 text-neutral-100" value="Low">Low - Minor trees far segment</option>
                  <option className="bg-neutral-950 text-neutral-100" value="Medium">Medium - Heavy foliage right face</option>
                  <option className="bg-neutral-950 text-neutral-100" value="High">High - High obstruction / heavy coverage</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-neutral-400 block font-sans">Geographic Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full bg-neutral-955 border border-neutral-850 hover:bg-neutral-900 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <label className="font-semibold text-neutral-400 block font-sans">Additional requirements / obstacles</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Roof shingles are asphalt but sturdily constructed in 2021. Prefer premium black frame design panels..."
                  value={additionalNotes}
                  onChange={(e) => setWithNotes(e.target.value)}
                  className="w-full bg-neutral-955 border border-neutral-850 hover:bg-neutral-900 rounded-xl p-3 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSizingTrigger}
                disabled={sizingLoading}
                className="bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold px-5 py-2.5 rounded-xl text-xs transition cursor-pointer"
              >
                {sizingLoading ? "Compiling Sunchaser vectors..." : "Run AI Sizing Model"}
              </button>
            </div>

            {sizingLoading && (
              <div className="flex items-center gap-3 justify-center text-xs font-mono text-neutral-500 py-6">
                <Loader2 className="h-5 w-5 text-amber-500 animate-spin" /> Finalizing high-resolution shadow grids...
              </div>
            )}

            {sizingResult && !sizingLoading && (
              <div className="bg-neutral-950 rounded-3xl p-6 border border-neutral-800 text-xs space-y-4">
                <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-neutral-550 block">Solar Sizing Output Report</span>
                <div className="prose text-neutral-300 leading-relaxed max-w-none text-left">
                  <pre className="whitespace-pre-wrap font-sans">{sizingResult}</pre>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'proposal' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-base font-bold text-neutral-100 flex items-center gap-1.5 font-sans">
                <FileText className="h-5 w-5 text-indigo-400" /> Solar Contract Proposal Creator
              </h3>
              <p className="text-neutral-400 text-xs mt-1">Generate formalized legal Sunchaser contracts including physical layouts, payback years details and terms of service warranty rules.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-neutral-450 block font-sans">Client Full Name</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full bg-neutral-955 border border-neutral-850 hover:bg-neutral-900 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-neutral-455 block font-sans">Property Site Address</label>
                <input
                  type="text"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  className="w-full bg-neutral-955 border border-neutral-850 hover:bg-neutral-900 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-neutral-450 block font-sans">Solar Array Capacity (kW)</label>
                <input
                  type="number"
                  step="0.5"
                  value={sizekW}
                  onChange={(e) => setSizekW(Number(e.target.value))}
                  className="w-full bg-neutral-955 border border-neutral-850 hover:bg-neutral-900 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-neutral-450 block font-sans">Investment Cost Estimate ({currencySymbol.trim()})</label>
                <input
                  type="number"
                  value={totalCost}
                  onChange={(e) => setTotalCost(Number(e.target.value))}
                  className="w-full bg-neutral-955 border border-neutral-850 hover:bg-neutral-900 rounded-xl px-3 py-2 text-neutral-100 focus:outline-none focus:border-amber-500 font-sans"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <label className="font-semibold text-neutral-450 block font-sans">Sunchaser Core Stackable storage Options</label>
                <div className="flex flex-col sm:flex-row gap-4 pt-1 text-neutral-300">
                  <label className="flex items-center gap-1.5 font-medium cursor-pointer">
                    <input 
                      type="radio" 
                      checked={batteryUpgrade} 
                      onChange={() => setBatteryUpgrade(true)} 
                      className="accent-amber-500" 
                    />
                    <span>1x Sunchaser Core Backup (13.5 kWh battery option)</span>
                  </label>
                  <label className="flex items-center gap-1.5 font-medium cursor-pointer">
                    <input 
                      type="radio" 
                      checked={!batteryUpgrade} 
                      onChange={() => setBatteryUpgrade(false)} 
                      className="accent-amber-500" 
                    />
                    <span>No Storage backup (Pure solar dynamic grid)</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleProposalTrigger}
                disabled={proposalLoading}
                className="bg-indigo-650 hover:bg-indigo-500 text-white font-bold px-5 py-2.5 rounded-xl text-xs transition cursor-pointer"
              >
                {proposalLoading ? "Constructing proposal draft..." : "Draft Contract Proposal"}
              </button>
            </div>

            {proposalLoading && (
              <div className="flex items-center gap-3 justify-center text-xs font-mono text-neutral-500 py-6">
                <Loader2 className="h-5 w-5 text-indigo-400 animate-spin" /> Drafting Executive Assurances and hardware spec sections...
              </div>
            )}

            {proposalResult && !proposalLoading && (
              <div className="bg-neutral-950 text-neutral-100 rounded-3xl p-6 md:p-8 font-mono text-xs space-y-4 shadow relative overflow-hidden border border-neutral-800">
                <div className="absolute right-3 top-3">
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(proposalResult);
                    }} 
                    className="bg-neutral-900 border border-neutral-800 text-neutral-400 hover:bg-neutral-800 hover:text-white p-2 rounded-lg cursor-pointer transition"
                    title="Copy to Clipboard"
                  >
                    <Clipboard className="h-4.5 w-4.5 text-slate-350" />
                  </button>
                </div>
                <div className="space-y-4 text-left whitespace-pre-wrap">
                  {proposalResult}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
