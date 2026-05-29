import React, { useState, useEffect } from "react";
import { 
  FileText, Sun, Battery, Settings2, ShieldCheck, Mail, Phone, MapPin, 
  Sparkles, Bot, Loader2, ArrowRight, ClipboardList, CheckCircle2, MessageCircle, Send, Download, Inbox,
  Upload, Coins, TrendingUp, Zap, HardDrive, ShieldAlert, Plus, Trash2, Copy, ArrowUp, ArrowDown
} from "lucide-react";
import { Lead, Quote, InventoryItem, BoqRow } from "../types";
import { generateProposalDocument, sendWhatsAppReminder, generateSizingRecommendations, currencySymbol, API_BASE_URL } from "../services/api";

interface SalesTeamAppProps {
  leads: Lead[];
  inventory: InventoryItem[];
  onUpdateLead: (id: string, updatedData: any) => void;
  on创造Quote: (id: string, quoteData: any) => void;
  on提交Survey: (id: string, surveyData: any) => void;
  settings?: any;
}

export default function SalesTeamApp({
  leads,
  inventory,
  onUpdateLead,
  on创造Quote,
  on提交Survey,
  settings
}: SalesTeamAppProps) {
  // Filter leads assigned to Sarah Connor or general unassigned ones
  const salesLeads = leads;
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    salesLeads.length > 0 ? salesLeads[0].id : null
  );

  const activeLead = salesLeads.find(l => l.id === selectedLeadId);

  // Quote formulator local state
  const [systemSizekW, setSystemSizekW] = useState<number>(activeLead?.monthlyBill ? Number((activeLead.monthlyBill / 26).toFixed(1)) : 8.5);
  const [panelType, setPanelType] = useState("Sunchaser Ultra 400W");
  const [inverterType, setInverterType] = useState("Enphase IQ8 Microinverter");
  const [batteryCapacity, setBatteryCapacity] = useState("Sunchaser Core 13.5kWh");
  const [totalCost, setTotalCost] = useState<number>(19500);

  // Advanced Quotation and terms
  const [structureType, setStructureType] = useState("Standard");
  const [accessories, setAccessories] = useState("Dual DC cables, PVC ducting & safety switches");
  const [installationCharges, setInstallationCharges] = useState<number>(75000);
  const [netMeteringCharges, setNetMeteringCharges] = useState<number>(90000);
  const [paymentTerms, setPaymentTerms] = useState("50% Advance, 40% Delivery, 10% Commissioning");
  const [warrantyTerms, setWarrantyTerms] = useState("25 year power degradation, 10 year inverter warranty");
  const [termsAndConditions, setTermsAndConditions] = useState("Quoted prices are valid for 3 days.");

  // Lahore/Pakistan custom quotation states
  const [clientName, setClientName] = useState(activeLead?.name || "");
  const [clientPhone, setClientPhone] = useState(activeLead?.phone || "");
  const [clientEmail, setClientEmail] = useState(activeLead?.email || "");
  const [clientAddress, setClientAddress] = useState(activeLead?.address || "");
  const [cnic, setCnic] = useState("");
  const [cityArea, setCityArea] = useState(activeLead?.location || "Lahore");
  const [bdmName, setBdmName] = useState(activeLead?.assignedSalesperson || "Sarah Connor");
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().split('T')[0]);
  const [systemType, setSystemType] = useState<'On-grid' | 'Hybrid' | 'Off-grid'>('Hybrid');
  const [panelBrand, setPanelBrand] = useState("Jinko");
  const [panelWattage, setPanelWattage] = useState<number>(580);
  const [inverterBrand, setInverterBrand] = useState("Knox");
  const [inverterCapacity, setInverterCapacity] = useState("10kW");
  const [batteryOption, setBatteryOption] = useState("None");
  const [netMeteringRequired, setNetMeteringRequired] = useState<'Yes' | 'No'>('Yes');
  const [discount, setDiscount] = useState<number>(0);
  const [paymentSchedule, setPaymentSchedule] = useState("50% Advance, 40% Delivery, 10% Commissioning");
  const [selectedTemplate, setSelectedTemplate] = useState("custom");
  const [boqItems, setBoqItems] = useState<any[]>([]);

  // LESCO net metering parameters
  const [lescoMeterNo, setLescoMeterNo] = useState("");
  const [lescoConsumerNo, setLescoConsumerNo] = useState("");
  const [lescoSanctionedLoad, setLescoSanctionedLoad] = useState("");
  const [lescoPhaseType, setLescoPhaseType] = useState<'Single Phase' | 'Three Phase'>('Three Phase');

  // Manual financial adjustments
  const [societyCharges, setSocietyCharges] = useState<number>(0);
  const [taxEnabled, setTaxEnabled] = useState<boolean>(false);
  const [taxRate, setTaxRate] = useState<number>(17);
  const [customNotes, setCustomNotes] = useState("");

  // Structure selection details
  const [selectedStructure, setSelectedStructure] = useState<'standard' | 'elevated' | 'girder' | 'custom'>('standard');
  const [customStructName, setCustomStructName] = useState("");
  const [customStructDescEn, setCustomStructDescEn] = useState("");
  const [customStructDescUr, setCustomStructDescUr] = useState("");
  const [customStructRate, setCustomStructRate] = useState<number>(0);
  const [customStructWeight, setCustomStructWeight] = useState("");
  const [customStructMaterial, setCustomStructMaterial] = useState("");
  const [customStructWarranty, setCustomStructWarranty] = useState("");
  const [customStructWind, setCustomStructWind] = useState("");

  // Excel-style BOQ grid rows
  const [boqRows, setBoqRows] = useState<BoqRow[]>([]);
  const [manualBoqItems, setManualBoqItems] = useState<any[]>([]);
  const [selectedPanelId, setSelectedPanelId] = useState<string>("");
  const [selectedInverterId, setSelectedInverterId] = useState<string>("");
  const [selectedBatteryId, setSelectedBatteryId] = useState<string>("");
  const [selectedMountId, setSelectedMountId] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const calculateRowTotalsAndSubtotals = (rows: BoqRow[]): BoqRow[] => {
    let currentSubtotalSum = 0;
    return rows.map((row) => {
      if (row.type === 'item') {
        const total = (row.qty || 0) * (row.rate || 0);
        currentSubtotalSum += total;
        return { ...row, total };
      } else if (row.type === 'heading') {
        currentSubtotalSum = 0;
        return { ...row, total: 0 };
      } else if (row.type === 'subtotal') {
        const total = currentSubtotalSum;
        currentSubtotalSum = 0;
        return { ...row, total };
      }
      return row;
    });
  };

  const generateDefaultBoqRows = (
    sizekW: number,
    sType: 'On-grid' | 'Hybrid' | 'Off-grid',
    struct: string,
    pBrand: string,
    pWattage: number,
    iBrand: string,
    iCapacity: string,
    batt: string,
    netMeter: 'Yes' | 'No'
  ): BoqRow[] => {
    const panelCount = Math.ceil((sizekW * 1000) / pWattage);
    const rows: BoqRow[] = [];
    
    // Section 1: Imported Equipment
    rows.push({ id: 'h-1', type: 'heading', name: 'Imported Equipment', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    let panelRate = 21000;
    if (pBrand === 'Longi') panelRate = 25215;
    else if (pBrand === 'Canadian Solar') panelRate = 23000;
    else if (pBrand === 'JA Solar') panelRate = 19500;
    
    rows.push({
      id: 'panel_row',
      type: 'item',
      srNo: '1',
      name: `${pBrand} ${pWattage}W Mono-PERC Solar Panels`,
      description: `Tier-1 high efficiency solar modules`,
      brand: pBrand,
      unit: 'Pcs',
      qty: panelCount,
      rate: panelRate,
      total: panelCount * panelRate
    });
    
    let inverterRate = 400000;
    if (sizekW > 15) inverterRate = 420000;
    if (sizekW > 25) inverterRate = 580000;
    
    rows.push({
      id: 'inverter_row',
      type: 'item',
      srNo: '2',
      name: `${iBrand} ${iCapacity} Smart Sync Inverter`,
      description: `Intelligent energy management inverter`,
      brand: iBrand,
      unit: 'Pcs',
      qty: 1,
      rate: inverterRate,
      total: inverterRate
    });
    
    if (sType !== 'On-grid' && batt !== 'None') {
      let batteryRate = 235000;
      if (batt.includes('10.24')) batteryRate = 480000;
      if (batt.includes('15.0')) batteryRate = 690000;
      
      rows.push({
        id: 'battery_row',
        type: 'item',
        srNo: '3',
        name: batt,
        description: `Lithium iron phosphate (LiFePO4) storage batteries`,
        brand: 'Soluna',
        unit: 'Pcs',
        qty: 1,
        rate: batteryRate,
        total: batteryRate
      });
    }
    
    rows.push({ id: 's-1', type: 'subtotal', name: 'Imported Equipment Subtotal', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    // Section 2: Cables & Conductors
    rows.push({ id: 'h-2', type: 'heading', name: 'Cables & Conductors', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    const dcQty = Math.round(sizekW * 15 + 40);
    rows.push({
      id: 'dc_cable_row',
      type: 'item',
      srNo: '4',
      name: 'DC Solar Cable 6mm',
      description: 'Double Insulated Tin Coated DC Solar Cable',
      brand: 'GM/FAST',
      unit: 'Meter',
      qty: dcQty,
      rate: 280,
      total: dcQty * 280
    });
    
    rows.push({
      id: 'ac_cable_row',
      type: 'item',
      srNo: '5',
      name: 'AC Connecting Cable 4-Core',
      description: 'AC copper flexible connection cable job',
      brand: 'GM/FAST',
      unit: 'Meter',
      qty: 40,
      rate: 250,
      total: 40 * 250
    });
    
    rows.push({
      id: 'earth_wire_row',
      type: 'item',
      srNo: '6',
      name: 'Earthing Bare Copper Wire',
      description: 'Bare copper conductor for system grounding',
      brand: 'GM/FAST',
      unit: 'Meter',
      qty: 50,
      rate: 380,
      total: 50 * 380
    });
    
    rows.push({ id: 's-2', type: 'subtotal', name: 'Cables & Conductors Subtotal', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    // Section 3: DB Boxes & Breakers
    rows.push({ id: 'h-3', type: 'heading', name: 'DB Boxes & Breakers', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    rows.push({
      id: 'db_box_row',
      type: 'item',
      srNo: '7',
      name: 'AC/DC Distribution DB Box Equipped',
      description: 'Miniature Circuit Breakers, SPDs, GADA/Chint switches',
      brand: 'GADA/Chint',
      unit: 'Job',
      qty: 1,
      rate: 32000,
      total: 32000
    });
    
    rows.push({ id: 's-3', type: 'subtotal', name: 'DB Boxes & Breakers Subtotal', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    // Section 4: Electrical & Mechanical Supplies
    rows.push({ id: 'h-4', type: 'heading', name: 'Electrical & Mechanical Supplies', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    rows.push({
      id: 'supplies_row',
      type: 'item',
      srNo: '8',
      name: 'PVC Pipes, Ducts & Conduits Job',
      description: 'Pipes, elbows, joints, PVC trunks/ducts for clean wiring routing',
      brand: 'Beta/Eq',
      unit: 'Job',
      qty: 1,
      rate: 18000,
      total: 18000
    });
    
    rows.push({ id: 's-4', type: 'subtotal', name: 'Supplies Subtotal', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    // Section 5: System Earthing Works
    rows.push({ id: 'h-5', type: 'heading', name: 'System Earthing Works', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    const boreQty = sizekW > 15 ? 3 : 2;
    rows.push({
      id: 'earthing_bore_row',
      type: 'item',
      srNo: '9',
      name: 'Chemical Earthing Bores',
      description: 'Copper rods with chemical enhancement compound filling',
      brand: 'Local',
      unit: 'Bores',
      qty: boreQty,
      rate: 48000,
      total: boreQty * 48000
    });
    
    rows.push({ id: 's-5', type: 'subtotal', name: 'System Earthing Works Subtotal', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    // Section 6: System Installation & Fabrication
    rows.push({ id: 'h-6', type: 'heading', name: 'System Installation & Fabrication', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    if (struct === 'Elevated') {
      rows.push({
        id: 'structure_row',
        type: 'item',
        srNo: '10',
        name: 'Elevated Mechanical Mounting Structure',
        description: 'Hot-Dip Galvanized C-Channel / H-Beam steel fabrication (10ft clearance)',
        brand: 'Mughal',
        unit: 'Job',
        qty: 1,
        rate: 147600,
        total: 147600
      });
    } else if (struct === 'Girder') {
      rows.push({
        id: 'structure_row',
        type: 'item',
        srNo: '10',
        name: 'Premium Mughal Girder Framing Structure',
        description: 'Heavy duty steel columns & girder frames for long span loads',
        brand: 'Mughal',
        unit: 'Job',
        qty: 1,
        rate: 180000,
        total: 180000
      });
    } else {
      // Standard A-Frame
      rows.push({
        id: 'structure_row',
        type: 'item',
        srNo: '10',
        name: 'Standard Galvanized L3 14 Gauge Structure',
        description: 'Galvanized iron mounting structure with Rawal bolts',
        brand: 'Mughal',
        unit: 'Pcs',
        qty: panelCount,
        rate: 4800,
        total: panelCount * 4800
      });
    }
    
    rows.push({
      id: 'civil_work_row',
      type: 'item',
      srNo: '11',
      name: 'Structure Pillars Foundations civil work',
      description: 'Concrete pillar foundation blocks for load stability',
      brand: 'Local',
      unit: 'Job',
      qty: 1,
      rate: 16000,
      total: 16000
    });
    
    let installRate = 80000;
    if (sizekW > 15) installRate = 120000;
    rows.push({
      id: 'install_service_row',
      type: 'item',
      srNo: '12',
      name: 'Complete Installation & Commissioning Service',
      description: 'Electrical wiring terminations, panel alignment, system tuning & start',
      brand: 'Sunchaser',
      unit: 'Job',
      qty: 1,
      rate: installRate,
      total: installRate
    });
    
    rows.push({ id: 's-6', type: 'subtotal', name: 'System Installation & Fabrication Subtotal', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    // Section 7: Transportation & Services
    rows.push({ id: 'h-7', type: 'heading', name: 'Transportation & Services', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    rows.push({
      id: 'freight_row',
      type: 'item',
      srNo: '13',
      name: 'Transportation, Logistics Freight & Manual Lifting',
      description: 'Equipment loading, delivery to site and manual roof shifting logistics',
      brand: 'Local',
      unit: 'Job',
      qty: 1,
      rate: 10000,
      total: 10000
    });
    
    if (netMeter === 'Yes') {
      rows.push({
        id: 'net_metering_row',
        type: 'item',
        srNo: '14',
        name: 'LESCO Net Metering Licensing Process',
        description: 'Document processing, demand notice payments & green meter commission',
        brand: 'LESCO',
        unit: 'Job',
        qty: 1,
        rate: 90000,
        total: 90000
      });
    }
    
    rows.push({
      id: 'survey_design_row',
      type: 'item',
      srNo: '15',
      name: 'Survey, Designing, Testing & Project Management Suite',
      description: 'Engineering site audit, CAD layouts, electrical simulations',
      brand: 'Helios',
      unit: 'Job',
      qty: 1,
      rate: 5000,
      total: 5000
    });
    
    rows.push({ id: 's-7', type: 'subtotal', name: 'Transportation & Services Subtotal', description: '', brand: '', unit: '', qty: 0, rate: 0, total: 0 });
    
    return calculateRowTotalsAndSubtotals(rows);
  };

  const generateDefaultBoqItems = (
    sizeOverride?: number,
    battOverride?: string,
    wattageOverride?: number,
    capacityOverride?: string
  ): BoqRow[] => {
    const size = sizeOverride !== undefined ? sizeOverride : (systemSizekW || 10);
    const type = systemType || 'Hybrid';
    const struct = selectedStructure || 'standard';
    const pBrand = panelBrand || 'Jinko';
    const pWattage = wattageOverride !== undefined ? wattageOverride : (panelWattage || 580);
    const iBrand = inverterBrand || 'Knox';
    const iCapacity = capacityOverride !== undefined ? capacityOverride : (inverterCapacity || '10kW');
    const batt = battOverride !== undefined ? battOverride : (batteryOption || 'None');
    const net = netMeteringRequired || 'Yes';
    
    return generateDefaultBoqRows(size, type, struct, pBrand, pWattage, iBrand, iCapacity, batt, net);
  };

  // AI Solar Design Engine Inputs
  const [billFile, setBillFile] = useState<File | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [billParsedData, setBillParsedData] = useState<{
    monthlyBill: number;
    monthlyUnits: number;
    location: string;
    width: number;
    length: number;
    area: number;
    backupReq: string;
    fileName: string;
  } | null>(null);

  const [formMonthlyUnits, setFormMonthlyUnits] = useState<number>(985);
  const [formRoofWidth, setFormRoofWidth] = useState<number>(30);
  const [formRoofLength, setFormRoofLength] = useState<number>(25);
  const [formBackupReq, setFormBackupReq] = useState<string>("Essential Loads");
  const [formLocation, setFormLocation] = useState<string>("Lahore");

  const [activeEngineTab, setActiveEngineTab] = useState<'ai_engine' | 'manual_config'>('ai_engine');
  
  // Custom AI Engineering assessment result
  const [aiReportMarkdown, setAiReportMarkdown] = useState<string | null>(null);
  const [aiReportLoading, setAiReportLoading] = useState<boolean>(false);

  // Proposal creator states
  const [proposalMarkdown, setProposalMarkdown] = useState<string | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [quoteCreatedConfirm, setQuoteCreatedConfirm] = useState(false);
  const [whatsappNotice, setWhatsappNotice] = useState<string | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(false);

  // Helper mapping functions
  const getSunHoursByLocation = (loc: string): number => {
    return 4.8; // Standard Pakistan insolation index
  };

  const getTariffByLocation = (loc: string): number => {
    return 35.0; // Default Rs 35 per unit standard PK tariff
  };

  // Synchronize inputs dynamically when activeLead selection shifts
  useEffect(() => {
    if (activeLead) {
      const assumedUnits = activeLead.monthlyUnits || (activeLead.monthlyBill ? Math.round(activeLead.monthlyBill / 35) : 980);
      setFormMonthlyUnits(assumedUnits);
      setFormLocation(activeLead.location || "Lahore");
      
      const rs = activeLead.roofSpace || 750;
      const width = Math.ceil(Math.sqrt(rs));
      setFormRoofWidth(width);
      setFormRoofLength(Math.round(rs / width));
      
      setFormBackupReq(activeLead.backupRequirement || "Essential Loads");
      setBillParsedData(null);
      setBillFile(null);
      setAiReportMarkdown(null);

      // Load latest quote if available
      const latestQuote = activeLead.quotes?.[0];
      if (latestQuote) {
        setClientName(latestQuote.clientName || activeLead.name || "");
        setClientPhone(latestQuote.clientPhone || activeLead.phone || "");
        setClientEmail(latestQuote.clientEmail || activeLead.email || "");
        setClientAddress(latestQuote.clientAddress || activeLead.address || "");
        setCnic(latestQuote.cnic || "");
        setCityArea(latestQuote.cityArea || activeLead.location || "Lahore");
        setBdmName(latestQuote.bdmName || activeLead.assignedSalesperson || "Sarah Connor");
        setQuoteDate(latestQuote.quoteDate || new Date().toISOString().split('T')[0]);
        setSystemSizekW(latestQuote.systemSizekW || 10);
        setSystemType(latestQuote.systemType || 'Hybrid');
        setPanelBrand(latestQuote.panelBrand || "Jinko");
        setPanelWattage(latestQuote.panelWattage || 580);
        setInverterBrand(latestQuote.inverterBrand || "Knox");
        setInverterCapacity(latestQuote.inverterCapacity || "10kW");
        setBatteryOption(latestQuote.batteryOption || "None");
        setStructureType(latestQuote.structureType || "Standard");
        setNetMeteringRequired(latestQuote.netMeteringRequired || "Yes");
        setDiscount(latestQuote.discount || 0);
        setPaymentSchedule(latestQuote.paymentSchedule || "50% Advance, 40% Delivery, 10% Commissioning");
        
        setLescoMeterNo(latestQuote.lescoSettings?.meterNo || "");
        setLescoConsumerNo(latestQuote.lescoSettings?.consumerNo || "");
        setLescoSanctionedLoad(latestQuote.lescoSettings?.sanctionedLoad || "");
        setLescoPhaseType(latestQuote.lescoSettings?.phaseType || 'Three Phase');
        setSocietyCharges(latestQuote.societyCharges || 0);
        setTaxEnabled(latestQuote.taxEnabled || false);
        setTaxRate(latestQuote.taxRate || 17);
        setCustomNotes(latestQuote.customNotes || "");
        const quoteItems = latestQuote.boqRows || latestQuote.boqItems || [];
        setBoqRows(quoteItems);
        setManualBoqItems(quoteItems);
        setSelectedStructure(latestQuote.selectedStructure || 'standard');
        
        if (latestQuote.customStructure) {
          setCustomStructName(latestQuote.customStructure.name || "");
          setCustomStructDescEn(latestQuote.customStructure.descEn || "");
          setCustomStructDescUr(latestQuote.customStructure.descUr || "");
          setCustomStructRate(latestQuote.customStructure.rate || 0);
          setCustomStructWeight(latestQuote.customStructure.weight || "");
          setCustomStructMaterial(latestQuote.customStructure.materialType || "");
          setCustomStructWarranty(latestQuote.customStructure.warranty || "");
          setCustomStructWind(latestQuote.customStructure.windRating || "");
        }
      } else {
        setClientName(activeLead.name || "");
        setClientPhone(activeLead.phone || "");
        setClientEmail(activeLead.email || "");
        setClientAddress(activeLead.address || "");
        setCnic("");
        setCityArea(activeLead.location || "Lahore");
        setBdmName(activeLead.assignedSalesperson || "Sarah Connor");
        setQuoteDate(new Date().toISOString().split('T')[0]);
        const calcSize = activeLead.monthlyBill ? Number((activeLead.monthlyBill / (26 * 35)).toFixed(1)) : 8.5;
        setSystemSizekW(calcSize);
        setSystemType('Hybrid');
        setPanelBrand("Jinko");
        setPanelWattage(580);
        setInverterBrand("Knox");
        setInverterCapacity("10kW");
        setBatteryOption("None");
        setStructureType("Standard");
        setNetMeteringRequired("Yes");
        setDiscount(0);
        setPaymentSchedule("50% Advance, 40% Delivery, 10% Commissioning");
        
        setLescoMeterNo("");
        setLescoConsumerNo("");
        setLescoSanctionedLoad("");
        setLescoPhaseType('Three Phase');
        setSocietyCharges(0);
        setTaxEnabled(false);
        setTaxRate(17);
        setCustomNotes("");
        setSelectedStructure('standard');
        
        // Generate default BOQ
        const defaultBoq = generateDefaultBoqRows(calcSize, 'Hybrid', 'Standard', 'Jinko', 580, 'Knox', '10kW', 'None', 'Yes');
        setBoqRows(defaultBoq);
        setManualBoqItems(defaultBoq);
      }
      setSelectedTemplate("custom");
    }
  }, [selectedLeadId]);

  // Excel Row Actions
  const addBoqRow = (type: 'heading' | 'item' | 'subtotal') => {
    const currentItems = Array.isArray(manualBoqItems) && manualBoqItems.length > 0 ? manualBoqItems : boqRows;
    const newRow: BoqRow = {
      id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      srNo: type === 'item' ? String(currentItems.filter(r => r && r.type === 'item').length + 1) : undefined,
      name: type === 'heading' ? 'New Section Heading' : type === 'subtotal' ? 'Section Subtotal' : 'New Item Name',
      description: '',
      brand: '',
      unit: type === 'item' ? 'Pcs' : '',
      qty: type === 'item' ? 1 : 0,
      rate: 0,
      total: 0
    };
    const updated = calculateRowTotalsAndSubtotals([...currentItems, newRow]);
    setManualBoqItems(updated);
    setBoqRows(updated);
  };

  const deleteBoqRow = (index: number) => {
    const currentItems = Array.isArray(manualBoqItems) && manualBoqItems.length > 0 ? manualBoqItems : boqRows;
    const updatedRows = currentItems.filter((_, i) => i !== index);
    // Re-index Sr No for items
    let itemCounter = 1;
    const reindexed = updatedRows.map(row => {
      if (row && row.type === 'item') {
        return { ...row, srNo: String(itemCounter++) };
      }
      return row;
    });
    const updated = calculateRowTotalsAndSubtotals(reindexed);
    setManualBoqItems(updated);
    setBoqRows(updated);
  };

  const duplicateBoqRow = (index: number) => {
    const currentItems = Array.isArray(manualBoqItems) && manualBoqItems.length > 0 ? manualBoqItems : boqRows;
    const rowToDuplicate = currentItems[index];
    if (!rowToDuplicate) return;
    const duplicatedRow: BoqRow = {
      ...rowToDuplicate,
      id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };
    const list = [...currentItems];
    list.splice(index + 1, 0, duplicatedRow);
    
    // Re-index Sr No for items
    let itemCounter = 1;
    const reindexed = list.map(row => {
      if (row && row.type === 'item') {
        return { ...row, srNo: String(itemCounter++) };
      }
      return row;
    });
    
    const updated = calculateRowTotalsAndSubtotals(reindexed);
    setManualBoqItems(updated);
    setBoqRows(updated);
  };

  const moveBoqRow = (index: number, direction: 'up' | 'down') => {
    const currentItems = Array.isArray(manualBoqItems) && manualBoqItems.length > 0 ? manualBoqItems : boqRows;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === currentItems.length - 1) return;
    
    const list = [...currentItems];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const temp = list[index];
    list[index] = list[targetIndex];
    list[targetIndex] = temp;
    
    // Re-index Sr No for items
    let itemCounter = 1;
    const reindexed = list.map(row => {
      if (row && row.type === 'item') {
        return { ...row, srNo: String(itemCounter++) };
      }
      return row;
    });
    
    const updated = calculateRowTotalsAndSubtotals(reindexed);
    setManualBoqItems(updated);
    setBoqRows(updated);
  };

  const handleLoadFromLibrary = (index: number, libraryItemId: string) => {
    if (!settings || !Array.isArray(settings.boqMasterLibrary)) return;
    const libItem = settings.boqMasterLibrary.find((item: any) => item && item.id === libraryItemId);
    if (!libItem) return;
    
    const currentItems = Array.isArray(manualBoqItems) && manualBoqItems.length > 0 ? manualBoqItems : boqRows;
    const updated = [...currentItems];
    if (!updated[index]) return;
    updated[index] = {
      ...updated[index],
      name: libItem.brand + " " + libItem.model,
      brand: libItem.brand,
      description: libItem.description || "",
      unit: libItem.unit || "Pcs",
      rate: libItem.salePrice || 0,
      total: (updated[index].qty || 1) * (libItem.salePrice || 0)
    };
    
    const calculated = calculateRowTotalsAndSubtotals(updated);
    setManualBoqItems(calculated);
    setBoqRows(calculated);
  };

  const handleLoadQuote = (quote: any) => {
    setClientName(quote.clientName || activeLead?.name || "");
    setClientPhone(quote.clientPhone || activeLead?.phone || "");
    setClientEmail(quote.clientEmail || activeLead?.email || "");
    setClientAddress(quote.clientAddress || activeLead?.address || "");
    setCnic(quote.cnic || "");
    setCityArea(quote.cityArea || activeLead?.location || "Lahore");
    setBdmName(quote.bdmName || activeLead?.assignedSalesperson || "Sarah Connor");
    setQuoteDate(quote.quoteDate || new Date().toISOString().split('T')[0]);
    setSystemSizekW(quote.systemSizekW || 10);
    setSystemType(quote.systemType || 'Hybrid');
    setPanelBrand(quote.panelBrand || "Jinko");
    setPanelWattage(quote.panelWattage || 580);
    setInverterBrand(quote.inverterBrand || "Knox");
    setInverterCapacity(quote.inverterCapacity || "10kW");
    setBatteryOption(quote.batteryOption || "None");
    setStructureType(quote.structureType || "Standard");
    setNetMeteringRequired(quote.netMeteringRequired || "Yes");
    setDiscount(quote.discount || 0);
    setPaymentSchedule(quote.paymentSchedule || "50% Advance, 40% Delivery, 10% Commissioning");
    
    setLescoMeterNo(quote.lescoSettings?.meterNo || "");
    setLescoConsumerNo(quote.lescoSettings?.consumerNo || "");
    setLescoSanctionedLoad(quote.lescoSettings?.sanctionedLoad || "");
    setLescoPhaseType(quote.lescoSettings?.phaseType || 'Three Phase');
    setSocietyCharges(quote.societyCharges || 0);
    setTaxEnabled(quote.taxEnabled || false);
    setTaxRate(quote.taxRate || 17);
    setCustomNotes(quote.customNotes || "");
    const loadedRows = quote.boqRows || quote.boqItems || [];
    setBoqRows(loadedRows);
    setManualBoqItems(loadedRows);
    setSelectedStructure(quote.selectedStructure || 'standard');
    
    if (quote.customStructure) {
      setCustomStructName(quote.customStructure.name || "");
      setCustomStructDescEn(quote.customStructure.descEn || "");
      setCustomStructDescUr(quote.customStructure.descUr || "");
      setCustomStructRate(quote.customStructure.rate || 0);
      setCustomStructWeight(quote.customStructure.weight || "");
      setCustomStructMaterial(quote.customStructure.materialType || "");
      setCustomStructWarranty(quote.customStructure.warranty || "");
      setCustomStructWind(quote.customStructure.windRating || "");
    }
    
    // Switch to manual tab
    setActiveEngineTab('manual_config');
  };

  const handleDuplicateQuote = async (quote: any) => {
    if (!activeLead) return;
    try {
      const dupQuote = {
        ...quote,
        id: undefined, // Let backend assign new ID
        createdAt: new Date().toISOString(),
        quoteDate: new Date().toISOString().split('T')[0],
      };
      
      await on创造Quote(activeLead.id, dupQuote);
      
      setQuoteCreatedConfirm(true);
      setTimeout(() => setQuoteCreatedConfirm(false), 8000);
    } catch (err: any) {
      console.error("Failed to duplicate quote:", err);
    }
  };

  // Template Quick Loader
  const loadTemplate = (tplKey: string) => {
    setSelectedTemplate(tplKey);
    if (tplKey === "custom") return;

    let size = 10;
    let type: 'On-grid' | 'Hybrid' | 'Off-grid' = 'Hybrid';
    let brand = "Jinko";
    let wattage = 580;
    let invBrand = "Knox";
    let invCap = "10kW";
    let batt = "Lithium Battery Pack 10.24kWh";
    let struct = "Standard";
    let net = 'Yes' as const;

    if (tplKey === "5kw_hybrid") {
      size = 5;
      type = "Hybrid";
      brand = "Longi";
      wattage = 580;
      invBrand = "Growatt";
      invCap = "5kW";
      batt = "Lithium Battery Pack 5.12kWh";
      struct = "Standard";
      net = "Yes";
    } else if (tplKey === "10kw_hybrid") {
      size = 10;
      type = "Hybrid";
      brand = "Jinko";
      wattage = 580;
      invBrand = "Knox";
      invCap = "10kW";
      batt = "Lithium Battery Pack 10.24kWh";
      struct = "Standard";
      net = "Yes";
    } else if (tplKey === "15kw_hybrid") {
      size = 15;
      type = "Hybrid";
      brand = "JA Solar";
      wattage = 580;
      invBrand = "Solis";
      invCap = "15kW";
      batt = "Lithium Battery Pack 15.0kWh";
      struct = "Elevated";
      net = "Yes";
    } else if (tplKey === "20kw_ongrid") {
      size = 20;
      type = "On-grid";
      brand = "Canadian Solar";
      wattage = 580;
      invBrand = "Goodwe";
      invCap = "20kW";
      batt = "None";
      struct = "Standard";
      net = "Yes";
    } else if (tplKey === "30kw_commercial") {
      size = 30;
      type = "On-grid";
      brand = "Longi";
      wattage = 580;
      invBrand = "Goodwe";
      invCap = "30kW";
      batt = "None";
      struct = "Girder";
      net = "Yes";
    }

    setSystemSizekW(size);
    setSystemType(type);
    setPanelBrand(brand);
    setPanelWattage(wattage);
    setInverterBrand(invBrand);
    setInverterCapacity(invCap);
    setBatteryOption(batt);
    setStructureType(struct);
    setNetMeteringRequired(net);
    setSelectedStructure(struct.toLowerCase() as any);

    const defaultBoq = generateDefaultBoqRows(size, type, struct, brand, wattage, invBrand, invCap, batt, net);
    setBoqRows(defaultBoq);
  };

  const handleQuoteFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLead) return;
    setSubmitError(null);

    try {
      const panelsCount = Math.ceil((systemSizekW * 1000) / panelWattage);
      
      // Structure details payload
      let customStructurePayload = undefined;
      if (selectedStructure === 'custom') {
        customStructurePayload = {
          name: customStructName,
          descEn: customStructDescEn,
          descUr: customStructDescUr,
          rate: Number(customStructRate) || 0,
          weight: customStructWeight,
          materialType: customStructMaterial,
          warranty: customStructWarranty,
          windRating: customStructWind,
          image: ""
        };
      }

      const calculatedGrandTotal = safeBoqItems
        .filter(r => r && r.type === 'item')
        .reduce((sum, r) => sum + (r.total || 0), 0);

      const calculatedTaxAmount = taxEnabled ? Math.round(calculatedGrandTotal * (taxRate / 100)) : 0;
      const calculatedNetTotal = calculatedGrandTotal + calculatedTaxAmount + (Number(societyCharges) || 0) - (Number(discount) || 0);

      const quoteData = {
        systemSizekW,
        panelCount: panelsCount,
        panelType: `${panelBrand} ${panelWattage}W Mono-PERC Panels`,
        inverterType: `${inverterBrand} ${inverterCapacity} Inverter`,
        batteryCapacity: batteryOption !== "None" ? batteryOption : "",
        totalCost: calculatedGrandTotal,
        structureType: selectedStructure === 'custom' ? 'Custom' : (selectedStructure.charAt(0).toUpperCase() + selectedStructure.slice(1)),
        accessories,
        installationCharges: Number(safeBoqItems.find(i => i && i.id === 'install_service_row')?.rate) || 80000,
        netMeteringCharges: netMeteringRequired === "Yes" ? (Number(safeBoqItems.find(i => i && i.id === 'net_metering_row')?.rate) || 90000) : 0,
        paymentTerms: paymentSchedule,
        warrantyTerms,
        termsAndConditions,

        // Custom Lahore/Pakistan quotation fields
        clientName,
        clientPhone,
        clientEmail,
        clientAddress,
        cnic,
        cityArea,
        bdmName,
        quoteDate,
        systemType,
        panelBrand,
        panelWattage,
        inverterBrand,
        inverterCapacity,
        batteryOption,
        netMeteringRequired,
        discount: Number(discount) || 0,
        paymentSchedule,
        boqItems: safeBoqItems,

        // Redesigned Manual Builder fields
        lescoSettings: {
          meterNo: lescoMeterNo,
          consumerNo: lescoConsumerNo,
          sanctionedLoad: lescoSanctionedLoad,
          phaseType: lescoPhaseType
        },
        societyCharges: Number(societyCharges) || 0,
        taxEnabled,
        taxRate: Number(taxRate) || 0,
        taxAmount: calculatedTaxAmount,
        selectedStructure,
        customStructure: customStructurePayload,
        boqRows: safeBoqItems,
        customNotes,
        grandTotal: calculatedGrandTotal,
        netTotal: calculatedNetTotal
      };

      if (typeof on创造Quote === 'function') {
        await on创造Quote(activeLead.id, quoteData);
      }
      setQuoteCreatedConfirm(true);
      setTimeout(() => setQuoteCreatedConfirm(false), 8000);

      // Open PDF in a new tab
      window.open(`${API_BASE_URL}/api/export/pdf/${activeLead.id}`, "_blank");
    } catch (err: any) {
      console.error("Quote creation failed:", err);
      setSubmitError(err.message || "Failed to compile quotation on database.");
    }
  };

  // Call server-side Gemini endpoint to write customized proposal document
  const triggerAIProposalGeneration = async () => {
    if (!activeLead) return;
    setProposalLoading(true);
    setProposalMarkdown(null);
    try {
      const res = await generateProposalDocument({
        customerName: activeLead.name,
        address: activeLead.address,
        systemSizekW: systemSizekW,
        batteryUpgrade: !!batteryCapacity,
        totalCost: totalCost,
        notes: `Bill context: ${currencySymbol}${activeLead.monthlyBill}/mo, Roof pitch context: unshaded ${activeLead.roofSpace} sq ft.`
      });
      setProposalMarkdown(res.proposalMarkdown);
    } catch (err: any) {
      console.error(err);
      setProposalMarkdown("Unstable AI channel. Sunchaser standard draft is saved.");
    } finally {
      setProposalLoading(false);
    }
  };

  // 1. AI Sizing Calculations computation block
  const sunHours = getSunHoursByLocation(formLocation);
  const tariffRate = getTariffByLocation(formLocation);
  const calculatedRoofArea = formRoofWidth * formRoofLength;

  const dailyKwhNeeded = formMonthlyUnits / 30;
  const calculatedSystemSizekW = Number(Math.max(3.0, Math.min(30.0, Math.round((dailyKwhNeeded / sunHours) * 1.25 * 10) / 10)).toFixed(1));

  const maxPanelsByRoof = Math.floor(calculatedRoofArea / 20);
  const maxKwByRoof = Number(((maxPanelsByRoof * 400) / 1000).toFixed(1));
  
  const isRoofConstrained = calculatedSystemSizekW > maxKwByRoof;
  const actualSystemSizekW = isRoofConstrained ? maxKwByRoof : calculatedSystemSizekW;

  const actualPanelCount = Math.ceil((actualSystemSizekW * 1000) / 400);
  const inverterRec = `${actualPanelCount}x Enphase IQ8 Microinverters (Dual frequency-lock grid tied module)`;

  let batteryCapacityRec = "";
  let batteryCostValue = 0;
  if (formBackupReq.includes("13.5kWh") || formBackupReq.includes("Essential")) {
    batteryCapacityRec = "Sunchaser Core 13.5kWh Stack";
    batteryCostValue = 6200;
  } else if (formBackupReq.includes("27kWh") || formBackupReq.includes("Whole")) {
    batteryCapacityRec = "2x Sunchaser Core 27.0kWh Storage Array";
    batteryCostValue = 11800;
  } else if (formBackupReq.includes("40.5kWh") || formBackupReq.includes("Off-Grid")) {
    batteryCapacityRec = "3x Sunchaser Core 40.5kWh Power Independence Pack";
    batteryCostValue = 16900;
  } else {
    batteryCapacityRec = "";
    batteryCostValue = 0;
  }

  const monthlyGeneration = Math.round(actualSystemSizekW * sunHours * 30 * 0.82);
  const monthlySavingsAmt = Math.round(monthlyGeneration * tariffRate);

  const calculatedTotalCost = Math.round((actualSystemSizekW * 1550) + (actualSystemSizekW * 450) + batteryCostValue + 1200 + installationCharges + netMeteringCharges);
  const calculatedFederalTaxCredit = Math.round(calculatedTotalCost * 0.3);
  const calculatedNetCost = calculatedTotalCost - calculatedFederalTaxCredit;

  const annualSavingsAmt = monthlySavingsAmt * 12;
  const calculatedROI = calculatedNetCost > 0 ? Number(((annualSavingsAmt / calculatedNetCost) * 100).toFixed(1)) : 0;
  const calculatedPayback = annualSavingsAmt > 0 ? Number((calculatedNetCost / annualSavingsAmt).toFixed(1)) : 0;

  // Dynamic manual BOQ calculations with safe defaults and null checks
  const grandTotal = (manualBoqItems || [])
    .filter(r => r && r.type === 'item')
    .reduce((sum, r) => sum + (r.total || 0), 0);
  const calculatedTaxAmount = taxEnabled ? Math.round(grandTotal * (taxRate / 100)) : 0;
  const netTotal = grandTotal + calculatedTaxAmount + (Number(societyCharges) || 0) - (Number(discount) || 0);

  // Safe checks for sizer properties
  const safeBoqItems = Array.isArray(manualBoqItems) ? manualBoqItems : [];
  const safeSelectedPanelId = selectedPanelId || "";
  const safeSelectedInverterId = selectedInverterId || "";
  const safeSelectedBatteryId = selectedBatteryId || "";
  const safeSelectedMountId = selectedMountId || "";

  return (
    <div id="sales-team-workspace" className="space-y-6 text-xs">
      
      {/* Information Header Banner Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:align-middle md:items-center gap-4 shadow-sm">
        <div>
          <span className="text-[10px] text-amber-400 font-bold tracking-wider font-mono bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            SOLAR GENERATIVE PROPOSAL STUDIO
          </span>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white font-sans mt-2">
            Advisor Quotation & Design Deck
          </h2>
          <p className="text-slate-400 mt-1 text-xs">
            Formulate custom panel grid cost plans, configure storage accessories, model ROI curves, and compile AI-generated contract agreements.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* SIDE BAR: SELECT MY CRM SALES ASSIGNMENTS */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-md">
          <div className="border-b border-slate-800 pb-2">
            <h3 className="text-sm font-bold text-slate-105 font-sans">Active Target Clients</h3>
            <span className="text-[10px] text-slate-400 font-sans">All available candidates needing pricing layouts.</span>
          </div>

          <div className="space-y-2.5 max-h-[580px] overflow-y-auto pr-1">
            {salesLeads.length > 0 ? (
              salesLeads.map((lead) => {
                const isSelected = selectedLeadId === lead.id;
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => {
                      setSelectedLeadId(lead.id);
                      setSystemSizekW(lead.monthlyBill ? Number((lead.monthlyBill / 26).toFixed(1)) : 8.5);
                    }}
                    className={`w-full p-4 rounded-2xl border text-left cursor-pointer transition ${
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
                    
                    {/* Small layout tags */}
                    <div className="flex justify-between text-[9px] font-mono text-slate-500 pt-1.5 border-t border-slate-800/50">
                      <span>Monthly Bill: {currencySymbol}{lead.monthlyBill}</span>
                      <span className="text-amber-550 text-amber-500 font-bold">AI Probability: {lead.conversionProbability || 50}%</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="text-center py-12 text-slate-500 font-mono">No relevant client leads.</div>
            )}
          </div>
        </div>

        {/* STUDY CONFIGURATION WORKSPACE */}
        <div className="lg:col-span-8 space-y-6">
          {activeLead ? (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              
              {/* QUOTATION PROPOSAL INVOICING BUILDER */}
              <div className="xl:col-span-7 bg-slate-900 border border-slate-850 rounded-3xl p-5 md:p-6 shadow space-y-6">
                
                {/* Mode Selector Tabs */}
                <div className="flex bg-slate-950 p-1 rounded-2xl border border-slate-850">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveEngineTab('ai_engine');
                      // Sync calculated values to manual quotes state
                      setSystemSizekW(actualSystemSizekW);
                      setBatteryCapacity(batteryCapacityRec);
                      setTotalCost(calculatedTotalCost);
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl font-sans font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      activeEngineTab === 'ai_engine'
                        ? 'bg-amber-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>AI Solar Design Engine</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      let items: any[] = [];
                      const latestQuote = activeLead?.quotes?.[0];
                      if (latestQuote && ((latestQuote.boqRows && latestQuote.boqRows.length > 0) || (latestQuote.boqItems && latestQuote.boqItems.length > 0))) {
                        handleLoadQuote(latestQuote);
                        items = latestQuote.boqRows || latestQuote.boqItems || [];
                      } else {
                        // Sync calculated values from AI engine to states
                        setSystemSizekW(actualSystemSizekW);
                        setPanelBrand('Jinko');
                        setPanelWattage(400);
                        setInverterBrand('Knox');
                        setInverterCapacity(`${actualSystemSizekW}kW`);
                        const finalBattery = batteryCapacityRec || 'None';
                        setBatteryOption(finalBattery);
                        setNetMeteringRequired('Yes');
                        
                        items = generateDefaultBoqItems(actualSystemSizekW, finalBattery, 400, `${actualSystemSizekW}kW`);
                      }
                      
                      setManualBoqItems(items);
                      setBoqRows(items);
                      setActiveEngineTab('manual_config');
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl font-sans font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      activeEngineTab === 'manual_config'
                        ? 'bg-amber-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
                    }`}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    <span>Manual Override Sizer</span>
                  </button>
                </div>

                {activeEngineTab === 'ai_engine' ? (
                  <div className="space-y-6 text-left">
                    {/* 1. INPUTS SECTION */}
                    <div className="bg-slate-950/60 rounded-2xl p-4 border border-slate-850/60 space-y-4">
                      <div className="flex items-center gap-1.5 border-b border-slate-800/60 pb-2">
                        <Upload className="h-4 w-4 text-amber-500" />
                        <h4 className="text-[10px] font-bold text-slate-100 uppercase tracking-wider font-sans">1. Sunchaser Sizing Inputs</h4>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Drag and Drop / OCR bill Upload with manual backup */}
                        <div className="space-y-2 text-left">
                          <label className="text-[10px] text-slate-400 uppercase font-mono font-bold block">Electricity Bill Upload (OCR Scan)</label>
                          <div className="border border-dashed border-slate-800 rounded-xl p-3 bg-slate-950/90 text-center hover:border-amber-500/50 transition relative group cursor-pointer">
                            <input
                              type="file"
                              accept=".pdf,.png,.jpg,.jpeg"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;

                                setBillFile(file);
                                setBillLoading(true);
                                setBillParsedData(null);

                                setTimeout(() => {
                                  const parsed = {
                                    monthlyBill: 312,
                                    monthlyUnits: 1120,
                                    location: activeLead ? activeLead.address.split(",").slice(-2).join(",").trim() || "Austin, TX" : "Austin, TX",
                                    width: 35,
                                    length: 26,
                                    area: 910,
                                    backupReq: "Essential Loads (Sunchaser Core 13.5kWh)",
                                    fileName: file.name
                                  };

                                  setBillParsedData(parsed);
                                  setFormMonthlyUnits(parsed.monthlyUnits);
                                  setFormLocation(parsed.location);
                                  setFormRoofWidth(parsed.width);
                                  setFormRoofLength(parsed.length);
                                  setFormBackupReq(parsed.backupReq);
                                  setBillLoading(false);

                                  // Sync values
                                  setSystemSizekW(Number((parsed.monthlyUnits / 30 / 5.0 * 1.2).toFixed(1)));
                                }, 1500);
                              }}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                              disabled={billLoading}
                            />
                            {billLoading ? (
                              <div className="py-2 flex flex-col items-center justify-center gap-1.5">
                                <Loader2 className="h-6 w-6 text-amber-400 animate-spin" />
                                <span className="text-[10px] text-slate-400 font-sans">Scanning meter rates & history...</span>
                              </div>
                            ) : billParsedData ? (
                              <div className="py-1 flex flex-col items-center justify-center">
                                <CheckCircle2 className="h-6 w-6 text-emerald-400 animate-bounce" />
                                <span className="text-[10px] text-slate-100 font-bold font-sans mt-0.5">OCR Scan Completed</span>
                                <span className="text-[9px] text-slate-400 font-mono truncate max-w-[160px]">{billFile?.name || "energy-invoice.pdf"}</span>
                              </div>
                            ) : (
                              <div className="py-2 flex flex-col items-center justify-center gap-1">
                                <Upload className="h-5 w-5 text-slate-500 group-hover:text-amber-500 transition" />
                                <span className="text-[10px] text-slate-300 font-sans block">Drag bill PDF or click here</span>
                                <span className="text-[8px] text-slate-500 font-mono block">Supports PDF, JPEG, PNG (Max 5MB)</span>
                              </div>
                            )}
                          </div>
                          {billParsedData && (
                            <div className="bg-emerald-950/30 border border-emerald-900/50 rounded-xl p-2.5 text-[9px] font-mono leading-normal text-emerald-400">
                              ⚡ Scanned: <strong className="text-emerald-300">{billParsedData.monthlyUnits} kWh/mo</strong> &amp; <strong className="text-emerald-300">{currencySymbol}{billParsedData.monthlyBill}/mo</strong> at <strong className="text-emerald-300">{billParsedData.location}</strong>.
                            </div>
                          )}
                        </div>

                        {/* Interactive fields list */}
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 uppercase font-mono font-semibold block">Monthly Units Consumed (kWh/mo)</label>
                            <input
                              type="number"
                              min="100"
                              max="10000"
                              value={formMonthlyUnits}
                              onChange={(e) => setFormMonthlyUnits(Number(e.target.value))}
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                            />
                          </div>
                          
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 uppercase font-mono font-semibold block">Geographic Location (City, State)</label>
                            <input
                              type="text"
                              value={formLocation}
                              onChange={(e) => setFormLocation(e.target.value)}
                              placeholder="e.g. Austin, TX"
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-sans"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                        {/* Roof layout and dimensions */}
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 uppercase font-mono font-bold block">Available Roof Dimensions (Width x Length)</label>
                          <div className="flex items-center gap-2 font-mono">
                            <div className="relative flex-1">
                              <input
                                type="number"
                                min="10"
                                max="100"
                                value={formRoofWidth}
                                onChange={(e) => setFormRoofWidth(Number(e.target.value))}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                              />
                              <span className="absolute right-2.5 top-1.5 text-[9px] text-slate-500 font-sans">W ft</span>
                            </div>
                            <span className="text-slate-500 text-xs">×</span>
                            <div className="relative flex-1">
                              <input
                                type="number"
                                min="10"
                                max="100"
                                value={formRoofLength}
                                onChange={(e) => setFormRoofLength(Number(e.target.value))}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                              />
                              <span className="absolute right-2.5 top-1.5 text-[9px] text-slate-500 font-sans">L ft</span>
                            </div>
                          </div>
                          <div className="flex justify-between items-center pt-1 text-[9px] font-mono">
                            <span className="text-slate-500 font-sans">Total Available Area:</span>
                            <span className="text-slate-300 font-bold">{calculatedRoofArea} sq ft</span>
                          </div>
                        </div>

                        {/* Backup selection options */}
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 uppercase font-mono font-bold block">Backup Battery Requirement</label>
                          <select
                            value={formBackupReq}
                            onChange={(e) => setFormBackupReq(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none cursor-pointer font-sans"
                          >
                            <option value="None (Standard Grid-tied)">None (Standard Grid-tied Only)</option>
                            <option value="Essential Loads (Sunchaser Core 13.5kWh)">Essential Loads (1x Sunchaser Core 13.5kWh)</option>
                            <option value="Whole Home Backup (2x Sunchaser Core 27kWh)">Whole Home Backup (2x Sunchaser Core 27kWh)</option>
                            <option value="Off-Grid Prep (3x Sunchaser Core 40.5kWh)">Off-Grid Prep (3x Sunchaser Core 40.5kWh)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* 2. OUTPUTS PREVIEW DASHBOARD SECTION */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-sm text-left">
                      <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-1.5">
                          <Zap className="h-4 w-4 text-emerald-400 animate-pulse" />
                          <h4 className="text-[10px] font-bold text-slate-100 uppercase tracking-wide font-sans">2. Sizing Engine Output Results</h4>
                        </div>
                        <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[8px] font-mono font-sans font-bold">
                          Calculated Real-Time
                        </span>
                      </div>

                      {isRoofConstrained && (
                        <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-3 text-[10px] text-amber-300 font-sans leading-relaxed text-left">
                          ⚠️ <strong>Roof Spatial Constraint Alert:</strong> Offset requirement warrants a {calculatedSystemSizekW} kW system. Roof area ({calculatedRoofArea} sq ft) restricts layouts to high-capacity 400W panels capped at <strong>{actualSystemSizekW} kW</strong> ({actualPanelCount} panels).
                        </div>
                      )}

                      {/* Technical specifications grid output */}
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 text-left">
                          <span className="text-[9px] uppercase font-mono text-slate-500 block">System Sizing Requirement</span>
                          <span className="text-xs font-extrabold text-white font-sans">{actualSystemSizekW} kW DC Array</span>
                        </div>
                        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 text-left">
                          <span className="text-[9px] uppercase font-mono text-slate-500 block">Calculated Panel Count</span>
                          <span className="text-xs font-extrabold text-slate-100 font-sans">{actualPanelCount} Premium Panels (400W)</span>
                        </div>
                        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 col-span-2 text-left">
                          <span className="text-[9px] uppercase font-mono text-slate-500 block">Recommended Inverter</span>
                          <span className="text-[11px] font-medium text-slate-300 font-sans font-semibold leading-relaxed">{inverterRec}</span>
                        </div>
                        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 col-span-2 text-left">
                          <span className="text-[9px] uppercase font-mono text-slate-500 block">Recommended Storage Battery</span>
                          <span className="text-[11px] font-medium text-slate-300 font-sans font-semibold">
                            {batteryCapacityRec ? batteryCapacityRec : "Grid-tied (Online backfeed, standard net metering, zero storage backup)"}
                          </span>
                        </div>
                      </div>

                      {/* Calculations & ROI metrics output grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 text-center font-mono">
                        <div className="bg-slate-950/50 p-2.5 rounded-xl border border-slate-850">
                          <span className="text-[8px] uppercase text-slate-500 block">Monthly Generation est</span>
                          <span className="text-[10px] font-bold text-white block mt-0.5">{monthlyGeneration.toLocaleString()} kWh</span>
                          <span className="text-[8px] text-slate-500">({(monthlyGeneration * 12).toLocaleString()} kWh/yr)</span>
                        </div>
                        <div className="bg-slate-950/50 p-2.5 rounded-xl border border-slate-850">
                          <span className="text-[8px] uppercase text-slate-500 block">Monthly Savings est</span>
                          <span className="text-[10px] font-bold text-emerald-400 block mt-0.5">{currencySymbol}{monthlySavingsAmt}/mo</span>
                          <span className="text-[8px] text-slate-550 text-slate-500">at {currencySymbol}{tariffRate.toFixed(2)}/kWh</span>
                        </div>
                        <div className="bg-slate-950/50 p-2.5 rounded-xl border border-slate-850">
                          <span className="text-[8px] uppercase text-slate-500 block">System RIO</span>
                          <span className="text-[10px] font-bold text-amber-500 block mt-0.5 flex justify-center items-center gap-1">
                            <TrendingUp className="h-3 w-3 shrink-0 text-amber-500" /> {calculatedROI}% /yr
                          </span>
                          <span className="text-[8px] text-slate-500">tax-free equity</span>
                        </div>
                        <div className="bg-slate-950/50 p-2.5 rounded-xl border border-slate-850">
                          <span className="text-[8px] uppercase text-slate-500 block">Payback Period</span>
                          <span className="text-[10px] font-bold text-sky-400 block mt-0.5">{calculatedPayback} Years</span>
                          <span className="text-[8px] text-slate-500">break-even point</span>
                        </div>
                      </div>
                    </div>

                    {/* 3. GEMINI AI INTEL ENGINEERING BRIEFING */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-left">
                      <div className="flex justify-between items-center bg-slate-900">
                        <div className="flex items-center gap-1">
                          <Bot className="h-4 w-4 text-amber-500" />
                          <span className="text-xs font-bold text-slate-200 font-sans">Gemini Technical Assessment Briefing</span>
                        </div>
                        <button
                          type="button"
                          disabled={aiReportLoading}
                          onClick={async () => {
                            setAiReportLoading(true);
                            setAiReportMarkdown(null);
                            try {
                              const res = await generateSizingRecommendations({
                                monthlyBill: Math.round(formMonthlyUnits * tariffRate),
                                roofSpace: calculatedRoofArea,
                                shading: activeLead.shading || "None",
                                stateLocation: formLocation,
                                notes: formBackupReq
                              });
                              setAiReportMarkdown(res.recommendations);
                            } catch (err: any) {
                              setAiReportMarkdown("### AI Sunchaser Engineering Sizing Checklist\nFailed to download analysis details.");
                            } finally {
                              setAiReportLoading(false);
                            }
                          }}
                          className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[10px] font-sans px-2.5 py-1 rounded-lg cursor-pointer flex items-center gap-1 transition"
                        >
                          {aiReportLoading ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                              <span>Analyzing Sizing...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-3 w-3 text-amber-500" />
                              <span>Retrieve Gemini Tech Report</span>
                            </>
                          )}
                        </button>
                      </div>

                      {aiReportMarkdown && (
                        <div className="bg-slate-950 p-3.5 rounded-xl text-[10px] text-slate-300 border border-slate-850 leading-relaxed font-sans max-h-[170px] overflow-y-auto pr-1 text-left">
                          <div className="whitespace-pre-wrap text-left antialiased">
                            {aiReportMarkdown}
                          </div>
                        </div>
                      )}
                    </div>

                    {quoteCreatedConfirm && activeLead && (
                      <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-3.5 rounded-2xl text-[11px] font-sans font-bold flex flex-col gap-1.5 leading-snug">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 animate-bounce" />
                          <span>Solar quotation compiled &amp; saved! Dispatched to client home portal.</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => window.open(`${API_BASE_URL}/api/export/pdf/${activeLead.id}`, "_blank")}
                          className="underline text-amber-400 hover:text-amber-300 font-mono mt-1 text-[10px] self-start bg-transparent border-0 cursor-pointer p-0 text-left"
                        >
                          📥 Download Official Sunchaser Quote PDF
                        </button>
                      </div>
                    )}

                    {/* Submit Section button */}
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          // 1. First, save updated lead parameters back to the server
                          await onUpdateLead(activeLead.id, {
                            monthlyUnits: formMonthlyUnits,
                            location: formLocation,
                            roofSpace: calculatedRoofArea,
                            backupRequirement: formBackupReq,
                            monthlyBill: Math.round(formMonthlyUnits * tariffRate)
                          });

                          // 2. Prepare the complete finalized Quote payload
                          const defaultBoq = generateDefaultBoqRows(
                            actualSystemSizekW,
                            (formBackupReq.includes("None") ? 'On-grid' : 'Hybrid'),
                            structureType,
                            "Jinko", 
                            400, 
                            "Enphase", 
                            "IQ8",
                            batteryCapacityRec || "None",
                            "Yes"
                          );

                          const quotePayload = {
                            systemSizekW: actualSystemSizekW,
                            panelCount: actualPanelCount,
                            panelType: "Sunchaser Ultra 400W Monocrystalline",
                            inverterType: inverterRec,
                            batteryCapacity: batteryCapacityRec,
                            totalCost: calculatedTotalCost,
                            structureType,
                            accessories,
                            installationCharges,
                            netMeteringCharges,
                            paymentTerms,
                            warrantyTerms,
                            termsAndConditions,
                            netCost: calculatedNetCost,
                            paybackPeriodYears: calculatedPayback,
                            boqRows: defaultBoq,
                            boqItems: defaultBoq,
                            selectedStructure: structureType.toLowerCase(),
                            lescoSettings: {
                              meterNo: lescoMeterNo || "",
                              consumerNo: lescoConsumerNo || "",
                              sanctionedLoad: lescoSanctionedLoad || "",
                              phaseType: lescoPhaseType || 'Three Phase'
                            },
                            societyCharges: 0,
                            taxEnabled: false,
                            taxRate: 17,
                            taxAmount: 0,
                            grandTotal: calculatedTotalCost,
                            netTotal: calculatedTotalCost
                          };

                          // 3. Save Quote to database
                          await on创造Quote(activeLead.id, quotePayload);
                          
                          // 4. Highlight confirmation layout and triggers
                          setSystemSizekW(actualSystemSizekW);
                          setBatteryCapacity(batteryCapacityRec);
                          setTotalCost(calculatedTotalCost);
                          
                          setQuoteCreatedConfirm(true);
                          setTimeout(() => setQuoteCreatedConfirm(false), 8000);
                        } catch (err: any) {
                          console.error(err);
                        }
                      }}
                      className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-sans font-extrabold text-sm py-3 px-4 rounded-xl shadow cursor-pointer transition flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Apply Sizing & Save Sunchaser Quote</span>
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleQuoteFormSubmit} className="space-y-6 font-mono text-xs text-left">
                    {/* Drafted Quotes List */}
                    {activeLead.quotes && activeLead.quotes.length > 0 && (
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
                        <label className="text-amber-400 font-bold uppercase tracking-wider text-[10px] block border-b border-slate-800 pb-1.5">Drafted Sunchaser Proposals ({activeLead.quotes.length})</label>
                        <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                          {activeLead.quotes.map((q: any) => (
                            <div key={q.id} className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 flex justify-between items-center text-xs">
                              <div>
                                <span className="font-bold text-white block">Quote {q.id} ({q.systemSizekW}kW {q.systemType})</span>
                                <span className="text-[9px] text-slate-400 block font-mono">
                                  Created: {new Date(q.createdAt).toLocaleDateString()} | Net: Rs. {q.netTotal?.toLocaleString() || q.netCost?.toLocaleString() || q.totalCost?.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex gap-1.5">
                                <button 
                                   type="button"
                                   onClick={() => window.open(`${API_BASE_URL}/api/export/pdf/${activeLead.id}?quoteId=${q.id}`, "_blank")}
                                   className="bg-slate-900 hover:bg-slate-850 text-slate-300 text-[10px] font-sans font-bold px-2 py-1 rounded-lg border border-slate-800 transition flex items-center gap-1 cursor-pointer"
                                 >
                                   <Download className="h-3 w-3 text-amber-500" /> PDF
                                 </button>
                                <button 
                                  type="button"
                                  onClick={() => handleDuplicateQuote(q)}
                                  className="bg-slate-900 hover:bg-slate-850 text-slate-350 text-[10px] font-sans font-bold px-2 py-1 rounded-lg border border-slate-800 transition flex items-center gap-1 cursor-pointer"
                                >
                                  <Copy className="h-3 w-3" /> Copy
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => handleLoadQuote(q)}
                                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-sans font-bold px-2 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer"
                                >
                                  Edit
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Template Loader Dropdown */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
                      <label className="text-amber-400 font-bold uppercase tracking-wider text-[10px] block">Quick Template Configuration Loaders</label>
                      <select 
                        value={selectedTemplate} 
                        onChange={(e) => loadTemplate(e.target.value)} 
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white cursor-pointer font-sans"
                      >
                        <option value="custom">-- Custom Sizing & Details --</option>
                        <option value="5kw_hybrid">5kW Hybrid Suite (Longi / Growatt / 5.12kWh Battery)</option>
                        <option value="10kw_hybrid">10kW Hybrid Suite (Jinko / Knox / 10.24kWh Battery)</option>
                        <option value="15kw_hybrid">15kW Hybrid Suite (JA Solar / Solis / 15kWh Battery)</option>
                        <option value="20kw_ongrid">20kW On-grid Suite (Canadian Solar / Goodwe / No Battery)</option>
                        <option value="30kw_commercial">30kW Commercial Suite (Longi / Goodwe / Mughal Girder)</option>
                      </select>
                    </div>

                    {/* Client Demographics */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                      <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider block border-b border-slate-800 pb-1.5">Client & BDM Demographics</span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-slate-400">Client Name</label>
                          <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" required />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Contact Number</label>
                          <input type="text" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" required />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">CNIC Number</label>
                          <input type="text" value={cnic} placeholder="e.g. 35201-1234567-9" onChange={(e) => setCnic(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Email Address</label>
                          <input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" />
                        </div>
                        <div className="md:col-span-2 space-y-1">
                          <label className="text-slate-400">House Number / Address</label>
                          <input type="text" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" required />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">City / Area</label>
                          <input type="text" value={cityArea} onChange={(e) => setCityArea(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" required />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">BDM / Salesperson</label>
                          <input type="text" value={bdmName} onChange={(e) => setBdmName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" required />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Quotation Date</label>
                          <input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" required />
                        </div>
                      </div>
                    </div>

                    {/* LESCO Net Metering Settings */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                      <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider block border-b border-slate-800 pb-1.5">LESCO Net Metering connection Parameters</span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-slate-400">Meter Number</label>
                          <input type="text" value={lescoMeterNo} onChange={(e) => setLescoMeterNo(e.target.value)} placeholder="e.g. 15-11524-123456" className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Consumer Number</label>
                          <input type="text" value={lescoConsumerNo} onChange={(e) => setLescoConsumerNo(e.target.value)} placeholder="e.g. 12-11524-1234567 U" className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Sanctioned Load (kW)</label>
                          <input type="text" value={lescoSanctionedLoad} onChange={(e) => setLescoSanctionedLoad(e.target.value)} placeholder="e.g. 15 kW" className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Phase Type</label>
                          <select value={lescoPhaseType} onChange={(e) => setLescoPhaseType(e.target.value as any)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white cursor-pointer font-sans">
                            <option value="Three Phase">Three Phase</option>
                            <option value="Single Phase">Single Phase</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Technical Sizing Specs */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                      <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider block border-b border-slate-800 pb-1.5">Technical Sizing Specs</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-slate-400">System Size (kW DC)</label>
                          <input type="number" step="0.1" value={systemSizekW} onChange={(e) => setSystemSizekW(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-mono" required />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">System Type</label>
                          <select value={systemType} onChange={(e) => setSystemType(e.target.value as any)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white cursor-pointer font-sans">
                            <option value="Hybrid">Hybrid (Storage & Grid Sync)</option>
                            <option value="On-grid">On-Grid (Direct Sync only)</option>
                            <option value="Off-grid">Off-Grid (Storage Standalone)</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Net Metering Required</label>
                          <select value={netMeteringRequired} onChange={(e) => setNetMeteringRequired(e.target.value as any)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white cursor-pointer font-sans">
                            <option value="Yes">Yes (NEPRA Facilitation)</option>
                            <option value="No">No</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Structure Type Selection</label>
                          <select 
                            value={selectedStructure} 
                            onChange={(e) => {
                              const val = e.target.value as any;
                              setSelectedStructure(val);
                              if (val === 'custom') setStructureType('Custom');
                              else setStructureType(val.charAt(0).toUpperCase() + val.slice(1));
                            }} 
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white cursor-pointer font-sans"
                          >
                            <option value="standard">Standard A-Frame (Roof Mount)</option>
                            <option value="elevated">Elevated Steel Frame (10ft clearance)</option>
                            <option value="girder">Mughal Girder Heavy Duty Structure</option>
                            <option value="custom">-- Custom Structural Design Spec --</option>
                          </select>
                        </div>
                      </div>

                      {/* Custom structure variables editor */}
                      {selectedStructure === 'custom' && (
                        <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl space-y-3 mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-left">
                          <span className="col-span-2 text-amber-500 font-bold uppercase text-[9px] block">Custom Mounting Design Details</span>
                          <div className="space-y-1 col-span-2">
                            <label className="text-slate-400">Custom Structure Name</label>
                            <input type="text" value={customStructName} onChange={(e) => setCustomStructName(e.target.value)} placeholder="e.g. Custom Double-Pitched Ground Mount" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-sans" />
                          </div>
                          <div className="space-y-1 col-span-2">
                            <label className="text-slate-400">English Specifications Description</label>
                            <textarea rows={2} value={customStructDescEn} onChange={(e) => setCustomStructDescEn(e.target.value)} placeholder="Premium custom structure columns 4x4inch, wind resistant up to 130 km/h." className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 font-sans" />
                          </div>
                          <div className="space-y-1 col-span-2">
                            <label className="text-slate-400">Urdu Specifications Description (اردو تفصیل)</label>
                            <textarea rows={2} value={customStructDescUr} onChange={(e) => setCustomStructDescUr(e.target.value)} placeholder="پریمیم کسٹم ڈیزائن ماونٹنگ سٹرکچر..." className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 font-sans text-right" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-slate-400">Default Rate (Rs)</label>
                            <input type="number" value={customStructRate} onChange={(e) => setCustomStructRate(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-slate-400">Weight (kg / span)</label>
                            <input type="text" value={customStructWeight} onChange={(e) => setCustomStructWeight(e.target.value)} placeholder="e.g. 450 kg total weight" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-sans" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-slate-400">Material Type</label>
                            <input type="text" value={customStructMaterial} onChange={(e) => setCustomStructMaterial(e.target.value)} placeholder="e.g. Hot-Dip Galvanized Truss Structure" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-sans" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-slate-400">Structural Warranty</label>
                            <input type="text" value={customStructWarranty} onChange={(e) => setCustomStructWarranty(e.target.value)} placeholder="e.g. 10 Years Warranty" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-sans" />
                          </div>
                          <div className="space-y-1 col-span-2">
                            <label className="text-slate-400">Wind Shear Rating</label>
                            <input type="text" value={customStructWind} onChange={(e) => setCustomStructWind(e.target.value)} placeholder="e.g. 140 km/h wind shear certified" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-sans" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Equipment Hardware Configuration */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                      <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider block border-b border-slate-800 pb-1.5">Equipment Hardware Specs</span>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <label className="text-slate-400">Panel Brand</label>
                          <select value={panelBrand} onChange={(e) => setPanelBrand(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white cursor-pointer font-sans">
                            <option value="Jinko">Jinko Solar</option>
                            <option value="Longi">Longi Solar</option>
                            <option value="JA Solar">JA Solar</option>
                            <option value="Canadian Solar">Canadian Solar</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Panel Wattage</label>
                          <input type="number" value={panelWattage} onChange={(e) => setPanelWattage(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-mono" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Panel Cells Count</label>
                          <div className="w-full bg-slate-950 border border-slate-850 rounded-xl p-2 text-xs text-slate-400 text-center font-bold font-sans">
                            {Math.ceil((systemSizekW * 1000) / panelWattage)} cells
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Inverter Brand</label>
                          <select value={inverterBrand} onChange={(e) => setInverterBrand(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white cursor-pointer font-sans">
                            <option value="Knox">Knox Smart Sync</option>
                            <option value="Solis">Solis Inverters</option>
                            <option value="Growatt">Growatt Inverters</option>
                            <option value="Goodwe">Goodwe Industrial</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Inverter Capacity</label>
                          <input type="text" value={inverterCapacity} onChange={(e) => setInverterCapacity(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-sans" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">Battery Option</label>
                          <select value={batteryOption} onChange={(e) => setBatteryOption(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white cursor-pointer font-sans">
                            <option value="None">None</option>
                            <option value="Lithium Battery Pack 5.12kWh">Lithium 5.12kWh pack</option>
                            <option value="Lithium Battery Pack 10.24kWh">Lithium 10.24kWh pack</option>
                            <option value="Lithium Battery Pack 15.0kWh">Lithium 15.0kWh pack</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 overflow-hidden">
                      <div className="flex justify-between items-center border-b border-slate-800 pb-1.5">
                        <span className="text-amber-400 font-bold uppercase text-[10px] tracking-wider block">Excel-Style Manual BOQ Builder</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm("This will overwrite your manually edited BOQ rows. Proceed?")) {
                                const defaultBoq = generateDefaultBoqRows(systemSizekW, systemType, selectedStructure, panelBrand, panelWattage, inverterBrand, inverterCapacity, batteryOption, netMeteringRequired);
                                setManualBoqItems(defaultBoq);
                                setBoqRows(defaultBoq);
                              }
                            }}
                            className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[10px] font-sans px-2.5 py-1 rounded cursor-pointer transition"
                          >
                            Reset to Defaults
                          </button>
                        </div>
                      </div>
                      
                      <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-1">
                        {safeBoqItems.length === 0 ? (
                          <div className="text-center py-10 border border-dashed border-slate-800 rounded-2xl bg-slate-950/40 space-y-3">
                            <p className="text-slate-400 font-sans text-xs">No BOQ items loaded</p>
                            <button
                              type="button"
                              onClick={() => {
                                const defaultBoq = generateDefaultBoqItems();
                                setManualBoqItems(defaultBoq);
                                setBoqRows(defaultBoq);
                              }}
                              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-sans font-bold text-[11px] py-1.5 px-3.5 rounded-lg cursor-pointer transition"
                            >
                              Generate Default BOQ
                            </button>
                          </div>
                        ) : (
                          <table className="w-full border-collapse text-left text-[10px]">
                            <thead>
                              <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono font-bold text-[9px] tracking-wider">
                                <th className="py-2 pr-2 w-8 text-center">Sr</th>
                                <th className="py-2 px-1 w-20">Type</th>
                                <th className="py-2 px-2 w-72">Item Name & Specifications</th>
                                <th className="py-2 px-1 w-24">Brand</th>
                                <th className="py-2 px-1 w-16 text-center">Unit</th>
                                <th className="py-2 px-1 w-16 text-center">Qty</th>
                                <th className="py-2 px-1 w-24 text-right">Rate (Rs)</th>
                                <th className="py-2 pl-2 w-24 text-right">Total (Rs)</th>
                                <th className="py-2 pl-2 text-center w-28">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800 text-slate-300">
                              {safeBoqItems.map((row, idx) => {
                                const isHeading = row.type === 'heading';
                                const isSubtotal = row.type === 'subtotal';
                                return (
                                  <tr key={row.id} className={`hover:bg-slate-950/40 ${isHeading ? 'bg-slate-950/60 font-bold' : isSubtotal ? 'bg-slate-950/20 font-bold' : ''}`}>
                                    {isHeading ? (
                                      <td colSpan={3} className="py-2 pr-2">
                                        <input
                                          type="text"
                                          value={row.name}
                                          onChange={(e) => {
                                            const updated = [...safeBoqItems];
                                            updated[idx].name = e.target.value;
                                            setManualBoqItems(updated);
                                            setBoqRows(updated);
                                          }}
                                          className="w-full bg-transparent border-b border-dashed border-slate-700 focus:border-amber-500 focus:outline-none py-0.5 font-sans text-amber-400 uppercase font-bold text-xs"
                                          placeholder="Section Heading (e.g. Imported Equipment)"
                                        />
                                      </td>
                                    ) : isSubtotal ? (
                                      <td colSpan={3} className="py-2 pr-2">
                                        <input
                                          type="text"
                                          value={row.name}
                                          onChange={(e) => {
                                            const updated = [...safeBoqItems];
                                            updated[idx].name = e.target.value;
                                            setManualBoqItems(updated);
                                            setBoqRows(updated);
                                          }}
                                          className="w-full bg-transparent border-b border-dashed border-slate-700 focus:border-amber-500 focus:outline-none py-0.5 font-sans text-slate-200 font-bold text-xs"
                                          placeholder="Subtotal Label"
                                        />
                                      </td>
                                    ) : (
                                      <>
                                        <td className="py-2 text-center text-slate-500 font-mono">{row.srNo || '-'}</td>
                                        <td className="py-2 px-1">
                                          <select
                                            value={row.type}
                                            onChange={(e) => {
                                              const updated = [...safeBoqItems];
                                              updated[idx].type = e.target.value as any;
                                              const calculated = calculateRowTotalsAndSubtotals(updated);
                                              setManualBoqItems(calculated);
                                              setBoqRows(calculated);
                                            }}
                                            className="bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[9px] text-slate-300"
                                          >
                                            <option value="item">Item</option>
                                            <option value="heading">Heading</option>
                                            <option value="subtotal">Subtotal</option>
                                          </select>
                                        </td>
                                        <td className="py-2 px-2 space-y-1">
                                          {/* Autofill library drop selector */}
                                          <select
                                            onChange={(e) => {
                                              if (e.target.value !== "") {
                                                handleLoadFromLibrary(idx, e.target.value);
                                                e.target.value = "";
                                              }
                                            }}
                                            className="w-full bg-slate-950 border border-slate-850 rounded px-1.5 py-0.5 text-[9px] text-slate-400 font-sans"
                                          >
                                            <option value="">-- Load catalog item values --</option>
                                            {((settings && settings.boqMasterLibrary) || []).map((lib: any) => (
                                              <option key={lib.id} value={lib.id}>{lib.category} - {lib.brand} {lib.model}</option>
                                            ))}
                                          </select>
                                          <input
                                            type="text"
                                            value={row.name}
                                            onChange={(e) => {
                                              const updated = [...safeBoqItems];
                                              updated[idx].name = e.target.value;
                                              setManualBoqItems(updated);
                                              setBoqRows(updated);
                                            }}
                                            className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-xs text-white font-sans"
                                            placeholder="Item Name"
                                          />
                                          <textarea
                                            value={row.description}
                                            rows={1}
                                            onChange={(e) => {
                                              const updated = [...safeBoqItems];
                                              updated[idx].description = e.target.value;
                                              setManualBoqItems(updated);
                                              setBoqRows(updated);
                                            }}
                                            className="w-full bg-slate-950 border border-slate-850 rounded px-1.5 py-0.5 text-[9px] text-slate-450 text-slate-400 font-sans"
                                            placeholder="Item specs"
                                          />
                                        </td>
                                      </>
                                    )}
                                    
                                    {isHeading || isSubtotal ? (
                                      <td colSpan={4} className="py-2 px-1 text-right font-mono text-slate-100 font-bold text-xs">
                                        {isSubtotal && `Rs. ${row.total?.toLocaleString()}`}
                                      </td>
                                    ) : (
                                      <>
                                        <td className="py-2 px-1">
                                          <input
                                            type="text"
                                            value={row.brand}
                                            onChange={(e) => {
                                              const updated = [...safeBoqItems];
                                              updated[idx].brand = e.target.value;
                                              setManualBoqItems(updated);
                                              setBoqRows(updated);
                                            }}
                                            className="w-full bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-xs text-slate-300 font-sans"
                                            placeholder="Brand"
                                          />
                                        </td>
                                        <td className="py-2 px-1">
                                          <input
                                            type="text"
                                            value={row.unit}
                                            onChange={(e) => {
                                              const updated = [...safeBoqItems];
                                              updated[idx].unit = e.target.value;
                                              setManualBoqItems(updated);
                                              setBoqRows(updated);
                                            }}
                                            className="w-full bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-xs text-center text-slate-400 font-sans"
                                            placeholder="Unit"
                                          />
                                        </td>
                                        <td className="py-2 px-1">
                                          <input
                                            type="number"
                                            value={row.qty}
                                            min="0"
                                            step="any"
                                            onChange={(e) => {
                                              const updated = [...safeBoqItems];
                                              updated[idx].qty = Number(e.target.value);
                                              const calculated = calculateRowTotalsAndSubtotals(updated);
                                              setManualBoqItems(calculated);
                                              setBoqRows(calculated);
                                            }}
                                            className="w-full bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-xs text-center text-white font-mono font-bold"
                                          />
                                        </td>
                                        <td className="py-2 px-1">
                                          <input
                                            type="number"
                                            value={row.rate}
                                            min="0"
                                            onChange={(e) => {
                                              const updated = [...safeBoqItems];
                                              updated[idx].rate = Number(e.target.value);
                                              const calculated = calculateRowTotalsAndSubtotals(updated);
                                              setManualBoqItems(calculated);
                                              setBoqRows(calculated);
                                            }}
                                            className="w-full bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-xs text-right text-amber-400 font-mono font-bold"
                                          />
                                        </td>
                                        <td className="py-2 pl-2 text-right font-mono font-bold text-slate-100">
                                          Rs. {row.total?.toLocaleString()}
                                        </td>
                                      </>
                                    )}
                                    
                                    <td className="py-2 pl-2 text-center">
                                      <div className="flex gap-1 justify-center">
                                        <button
                                          type="button"
                                          onClick={() => moveBoqRow(idx, 'up')}
                                          disabled={idx === 0}
                                          className="p-1 hover:bg-slate-850 hover:text-white rounded disabled:opacity-30 cursor-pointer"
                                          title="Move Up"
                                        >
                                          <ArrowUp className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => moveBoqRow(idx, 'down')}
                                          disabled={idx === safeBoqItems.length - 1}
                                          className="p-1 hover:bg-slate-850 hover:text-white rounded disabled:opacity-30 cursor-pointer"
                                          title="Move Down"
                                        >
                                          <ArrowDown className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => duplicateBoqRow(idx)}
                                          className="p-1 hover:bg-slate-850 hover:text-amber-400 rounded cursor-pointer"
                                          title="Duplicate"
                                        >
                                          <Copy className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => deleteBoqRow(idx)}
                                          className="p-1 hover:bg-slate-850 hover:text-rose-500 rounded cursor-pointer"
                                          title="Delete"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                      
                      {/* Grid control actions bar */}
                      <div className="flex flex-wrap gap-2.5 pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => addBoqRow('item')}
                          className="bg-slate-950 border border-slate-850 hover:bg-slate-800 text-[10.5px] font-sans font-bold py-1.5 px-3 rounded-lg text-emerald-400 flex items-center gap-1 cursor-pointer transition"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add Item Row
                        </button>
                        <button
                          type="button"
                          onClick={() => addBoqRow('heading')}
                          className="bg-slate-950 border border-slate-850 hover:bg-slate-800 text-[10.5px] font-sans font-bold py-1.5 px-3 rounded-lg text-amber-400 flex items-center gap-1 cursor-pointer transition"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add Section Heading
                        </button>
                        <button
                          type="button"
                          onClick={() => addBoqRow('subtotal')}
                          className="bg-slate-950 border border-slate-850 hover:bg-slate-800 text-[10.5px] font-sans font-bold py-1.5 px-3 rounded-lg text-sky-450 text-sky-400 flex items-center gap-1 cursor-pointer transition"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add Subtotal Row
                        </button>
                      </div>
                    </div>

                    {/* Commercial Terms & Validity */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                      <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider block border-b border-slate-800 pb-1.5">Commercial Adjustments & Payments</span>
                      <div className="space-y-3 font-sans text-xs">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <label className="text-slate-400 block font-bold">Society / Association Dues (Rs)</label>
                            <input 
                              type="number" 
                              value={societyCharges} 
                              onChange={(e) => setSocietyCharges(Number(e.target.value))} 
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-mono font-bold" 
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-slate-400 block font-bold">Discount Amount (Rs)</label>
                            <input 
                              type="number" 
                              value={discount} 
                              onChange={(e) => setDiscount(Number(e.target.value))} 
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-rose-455 text-rose-500 font-mono font-bold" 
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-slate-400 block font-bold">Quotation Validity</label>
                            <div className="w-full bg-slate-950 border border-slate-850 rounded-xl p-2 text-xs text-slate-400 font-bold text-center">
                              3 Days
                            </div>
                          </div>
                        </div>

                        {/* Tax Settings grid block */}
                        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-850/60 space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-slate-200 font-bold font-sans">Apply Lahore / Pakistan Tax Addition</label>
                            <input
                              type="checkbox"
                              checked={taxEnabled}
                              onChange={(e) => setTaxEnabled(e.target.checked)}
                              className="w-4 h-4 text-amber-500 focus:ring-amber-500 border-slate-800 rounded bg-slate-950 cursor-pointer"
                            />
                          </div>
                          {taxEnabled && (
                            <div className="grid grid-cols-2 gap-3 text-left">
                              <div className="space-y-1">
                                <label className="text-[10px] text-slate-400">Sales Tax Rate (%)</label>
                                <input
                                  type="number"
                                  value={taxRate}
                                  onChange={(e) => setTaxRate(Number(e.target.value))}
                                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs text-white font-mono"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] text-slate-400 block">Calculated Tax Amount</label>
                                <div className="text-xs font-bold text-amber-400 font-mono pt-2">
                                  Rs. {calculatedTaxAmount.toLocaleString()}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-400 block font-bold">Payment Schedule Clause</label>
                          <textarea 
                            rows={2} 
                            value={paymentSchedule} 
                            onChange={(e) => setPaymentSchedule(e.target.value)} 
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-300 font-sans" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400 block font-bold">Special Custom Notes (Appears on BOQ page)</label>
                          <textarea 
                            rows={2} 
                            value={customNotes} 
                            placeholder="Add additional remarks e.g. Earthing wire route length custom calculations..."
                            onChange={(e) => setCustomNotes(e.target.value)} 
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-300 font-sans" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400 block font-bold">Quotation Terms &amp; Clauses</label>
                          <textarea 
                            rows={2} 
                            value={termsAndConditions} 
                            onChange={(e) => setTermsAndConditions(e.target.value)} 
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-300 font-sans" 
                          />
                        </div>
                      </div>
                    </div>

                    {/* Net Financial Receipt summary */}
                    <div className="bg-slate-950 border border-slate-850 rounded-3xl p-5 shadow-inner shadow-black/80 space-y-3 text-xs">
                      <span className="text-[10px] font-mono tracking-wider text-slate-500 uppercase font-bold block">Grand Financial Proposal Summary</span>
                      <div className="space-y-2 font-mono">
                        <div className="flex justify-between text-slate-400">
                          <span>BOQ Gross Subtotal:</span>
                          <span className="text-slate-200">Rs. {grandTotal.toLocaleString()}</span>
                        </div>
                        {taxEnabled && (
                          <div className="flex justify-between text-slate-400">
                            <span>Sales Tax Dues ({taxRate}%):</span>
                            <span className="text-amber-500">Rs. {calculatedTaxAmount.toLocaleString()}</span>
                          </div>
                        )}
                        {societyCharges > 0 && (
                          <div className="flex justify-between text-slate-400">
                            <span>Society Association Dues:</span>
                            <span className="text-slate-200">Rs. {societyCharges.toLocaleString()}</span>
                          </div>
                        )}
                        {discount > 0 && (
                          <div className="flex justify-between text-slate-400">
                            <span>Executive Promo Discount:</span>
                            <span className="text-emerald-400 font-bold">-Rs. {discount.toLocaleString()}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-base border-t border-slate-800 pt-2 font-extrabold">
                          <span className="text-white">Net Turnkey Investment Dues:</span>
                          <span className="text-amber-400">Rs. {netTotal.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    {quoteCreatedConfirm && activeLead && (
                      <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-3.5 rounded-2xl text-[11px] font-sans font-bold flex flex-col gap-1.5 leading-snug">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 animate-bounce" />
                          <span>Quotation created successfully! Sync sent to Customer Home Portal. WhatsApp message dispatched to client.</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => window.open(`${API_BASE_URL}/api/export/pdf/${activeLead.id}`, "_blank")}
                          className="underline text-amber-400 hover:text-amber-300 font-mono mt-1 text-[10px] self-start bg-transparent border-0 cursor-pointer p-0 text-left"
                        >
                          📥 Download Official Sunchaser Quote PDF
                        </button>
                      </div>
                    )}

                    {submitError && (
                      <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 p-3.5 rounded-2xl text-[11px] font-sans font-bold flex flex-col gap-1.5 leading-snug">
                        <div className="flex items-center gap-1.5">
                          <span>❌ Error: {submitError}</span>
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-sans font-extrabold text-sm py-3 px-4 rounded-xl shadow cursor-pointer transition flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Compile solar quotation on database</span>
                    </button>
                  </form>
                )}
              </div>

              {/* GENERATE AI SALES PROPOSAL blueprint WITH GEMINI */}
              <div className="xl:col-span-5 space-y-6">
                
                {/* Visual Invoice Cost Receipt calculator */}
                <div className="bg-slate-950 border border-slate-850 rounded-3xl p-5 shadow-inner shadow-black/80 space-y-4">
                  <h4 className="text-[10px] font-mono tracking-wider text-slate-500 uppercase font-bold">Pricing Breakdown Receipt</h4>
                  
                  <div className="space-y-2 text-xs font-mono">
                    {activeEngineTab === 'manual_config' ? (
                      <>
                        <div className="max-h-[140px] overflow-y-auto pr-1 space-y-1.5 border-b border-slate-900 pb-2 text-left">
                          {safeBoqItems.filter(r => r && r.type === 'item').map((r) => (
                            <div key={r.id} className="flex justify-between text-slate-400 text-[10px]">
                              <span className="truncate max-w-[170px]">{r.name} (x{r.qty})</span>
                              <span className="text-slate-200">Rs. {r.total?.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>BOQ Gross:</span>
                          <span className="text-slate-200">Rs. {grandTotal.toLocaleString()}</span>
                        </div>
                        {taxEnabled && (
                          <div className="flex justify-between text-slate-400">
                            <span>Sales Tax ({taxRate}%):</span>
                            <span className="text-amber-500">Rs. {calculatedTaxAmount.toLocaleString()}</span>
                          </div>
                        )}
                        {societyCharges > 0 && (
                          <div className="flex justify-between text-slate-400">
                            <span>Society Charges:</span>
                            <span className="text-slate-200">Rs. {societyCharges.toLocaleString()}</span>
                          </div>
                        )}
                        {discount > 0 && (
                          <div className="flex justify-between text-slate-400">
                            <span>Discount:</span>
                            <span className="text-rose-500">-Rs. {discount.toLocaleString()}</span>
                          </div>
                        )}
                        <div className="pt-2 border-t border-slate-800 flex justify-between font-bold text-white text-xs">
                          <span className="font-sans text-[11px] font-bold">TOTAL CONTRACT VALUE</span>
                          <span className="font-mono text-amber-500 text-sm font-extrabold">Rs. {netTotal.toLocaleString()}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between text-slate-400">
                          <span>Solar Modules (x{Math.round((systemSizekW * 1000) / 400)})</span>
                          <span className="text-slate-200">{currencySymbol}{(systemSizekW * 1550).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Smart Micro-Inverters</span>
                          <span className="text-slate-200">{currencySymbol}{(systemSizekW * 450).toLocaleString()}</span>
                        </div>
                        {batteryCapacity && (
                          <div className="flex justify-between text-slate-400">
                            <span>Sunchaser Storage Core</span>
                            <span className="text-slate-200">{currencySymbol}6,200</span>
                          </div>
                        )}
                        <div className="flex justify-between text-slate-400">
                          <span>Mount rails structural brackets</span>
                          <span className="text-slate-200">{currencySymbol}1,200</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>System assembly & wiring services</span>
                          <span className="text-slate-200">{currencySymbol}{installationCharges.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Net meter filing dues</span>
                          <span className="text-slate-200">{currencySymbol}{netMeteringCharges.toLocaleString()}</span>
                        </div>

                        <div className="pt-2 border-t border-slate-800 flex justify-between font-bold text-white text-xs">
                          <span className="font-sans text-[11px] font-bold">TOTAL CONTRACT VALUE</span>
                          <span className="font-mono text-emerald-400 text-sm font-extrabold">{currencySymbol}{totalCost.toLocaleString()}</span>
                        </div>

                        <p className="bg-emerald-500/10 border border-emerald-500/10 p-2.5 rounded-xl text-emerald-400 text-[10px] font-sans font-light leading-normal leading-relaxed text-left mt-2">
                          💰 <strong>State Tax Rebates:</strong> Client unlocks is eligible for 30% Solar ITC credit, deducting <strong>-{currencySymbol}{Math.round(totalCost * 0.3).toLocaleString()}</strong> on federal tax liability, reducing cost weight to <strong>{currencySymbol}{Math.round(totalCost * 0.7).toLocaleString()}</strong>!
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* Proposal generator trigger */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6 shadow space-y-4 text-left">
                  <div className="flex gap-2 items-center">
                    <div className="bg-amber-500/10 p-2 rounded-xl text-amber-500">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold font-sans text-slate-201 leading-tight">AI Proposal contract creator</h4>
                      <p className="text-[10px] text-slate-500 font-sans">Synthesize signed clean energy guarantees using server-side Gemini intelligence.</p>
                    </div>
                  </div>

                  <p className="text-slate-400 text-xs">
                    Produces a signed Sunchaser assurances contract containing system layouts and financial ROI curves to display instantly under their customer portal.
                  </p>

                  <button
                    type="button"
                    onClick={triggerAIProposalGeneration}
                    disabled={proposalLoading}
                    className="w-full bg-slate-950 border border-slate-800 hover:bg-slate-850 disabled:bg-slate-800 text-neutral-200 hover:text-white font-bold font-sans text-xs py-2.5 px-3.5 rounded-xl transition cursor-pointer flex items-center justify-center gap-2 shadow"
                  >
                    {proposalLoading ? (
                      <>
                        <Loader2 className="h-4.5 w-4.5 text-amber-500 animate-spin" />
                        <span>Compiling AI Assurances...</span>
                      </>
                    ) : (
                      <>
                        <Bot className="h-4 w-4" />
                        <span>Generate AI Solar Proposal Blueprint</span>
                      </>
                    )}
                  </button>

                  {/* Proposal Markdown Preview modal */}
                  {proposalMarkdown && (
                    <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4 space-y-3 overflow-y-auto max-h-[300px]">
                      <div className="flex justify-between items-center bg-slate-900 px-3 py-1 rounded-lg border border-slate-800 text-[10px] font-mono select-all">
                        <span className="text-slate-400 font-bold block">Blueprint Contract finalized</span>
                        <span className="text-emerald-400">Ready on portal</span>
                      </div>
                      
                      {/* Formatted Markdown text area */}
                      <pre className="text-slate-400 leading-relaxed font-sans text-[11px] whitespace-pre-wrap italic">
                        {proposalMarkdown}
                      </pre>
                    </div>
                  )}
                </div>

                {/* CRM ENGAGEMENT & WHATSAPP LOGISTICS */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6 shadow space-y-4 text-left">
                  <div className="flex gap-2 items-center">
                    <div className="bg-emerald-500/10 p-2 rounded-xl text-emerald-400">
                      <MessageCircle className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold font-sans text-slate-100 leading-tight">Customer CRM WhatsApp Actions</h4>
                      <p className="text-[10px] text-slate-500 font-sans">Trigger instant, simulated mobile notifications and status briefs.</p>
                    </div>
                  </div>

                  {whatsappNotice && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl text-[10px] font-mono leading-relaxed">
                      ✓ {whatsappNotice}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-sans">
                    <button
                      type="button"
                      disabled={whatsappLoading}
                      onClick={async () => {
                        setWhatsappLoading(true);
                        setWhatsappNotice(null);
                        try {
                          await sendWhatsAppReminder(activeLead.id);
                          setWhatsappNotice(`Dispatched Sunchaser Sizing follow-up reminder to ${activeLead.name}! Check SMS logs.`);
                          setTimeout(() => setWhatsappNotice(null), 5000);
                        } catch (err: any) {
                          setWhatsappNotice(`Error: ${err.message}`);
                        } finally {
                          setWhatsappLoading(false);
                        }
                      }}
                      className="bg-slate-950 border border-slate-850 hover:bg-slate-800 text-slate-200 py-2.5 rounded-xl font-bold transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <Send className="h-3 w-3 text-emerald-400" />
                      <span>Follow-up Alert</span>
                    </button>

                    <button
                      type="button"
                      disabled={whatsappLoading}
                      onClick={async () => {
                        setWhatsappLoading(true);
                        setWhatsappNotice(null);
                        try {
                          // Trigger customized PDF quotation message
                          const res = await fetch(`${API_BASE_URL}/api/leads/${activeLead.id}/whatsapp-reminder`, {
                            method: "POST"
                          });
                          if (!res.ok) throw new Error("Could not wire quotation check.");
                          setWhatsappNotice(`Official Sunchaser Contract Quotation link and backup PDF generated and delivered to ${activeLead.name}!`);
                          setTimeout(() => setWhatsappNotice(null), 5000);
                        } catch (err: any) {
                          setWhatsappNotice(`Error: ${err.message}`);
                        } finally {
                          setWhatsappLoading(false);
                        }
                      }}
                      className="bg-slate-950 border border-slate-850 hover:bg-slate-800 text-slate-200 py-2.5 rounded-xl font-bold transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <MessageCircle className="h-3 w-3 text-amber-500" />
                      <span>Transmit PDF Sizer</span>
                    </button>
                  </div>
                </div>

              </div>
              
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-400">
              <Inbox className="h-10 w-10 text-slate-500 mx-auto" />
              <strong className="block text-white mt-1">Select an active client in the menu</strong>
              <span className="text-xs text-slate-400">Complete task layouts or draft pricing blueprint proposal plans.</span>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
