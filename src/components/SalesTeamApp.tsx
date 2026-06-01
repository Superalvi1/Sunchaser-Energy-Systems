import React, { useState, useEffect } from "react";
import { 
  FileText, Sun, Battery, Settings2, ShieldCheck, Mail, Phone, MapPin, 
  Sparkles, Bot, Loader2, ArrowRight, ClipboardList, CheckCircle2, MessageCircle, Send, Download, Inbox,
  Upload, Coins, TrendingUp, Zap, HardDrive, ShieldAlert, Plus, Trash2, Copy, ArrowUp, ArrowDown, Eye, Layers, Settings, FileSpreadsheet, Tag,
  Printer, Save
} from "lucide-react";
import { Lead, Quote, InventoryItem, BoqRow } from "../types";
import { generateProposalDocument, sendWhatsAppReminder, generateSizingRecommendations, currencySymbol, API_BASE_URL } from "../services/api";

interface SalesTeamAppProps {
  leads: Lead[];
  inventory: InventoryItem[];
  products: any[];
  onUpdateLead: (id: string, updatedData: any) => void;
  on创造Quote: (id: string, quoteData: any) => void;
  on提交Survey: (id: string, surveyData: any) => void;
  onRefreshState?: () => void;
  settings?: any;
  quoteTemplates?: any[];
  quoteTemplatePages?: any[];
  bankAccounts?: any[];
  companyTerms?: any[];
  ceoMessages?: any[];
  socialLinks?: any[];
  structureDescriptions?: any[];
  quotePdfSettings?: any[];
  onDeleteQuote?: (leadId: string, quoteId: string) => Promise<void>;
}

export default function SalesTeamApp({
  leads,
  inventory,
  products = [],
  onUpdateLead,
  on创造Quote,
  on提交Survey,
  onRefreshState,
  settings,
  quoteTemplates = [],
  quoteTemplatePages = [],
  bankAccounts = [],
  companyTerms = [],
  ceoMessages = [],
  socialLinks = [],
  structureDescriptions = [],
  quotePdfSettings = [],
  onDeleteQuote
}: SalesTeamAppProps) {
  
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    leads.length > 0 ? leads[0].id : null
  );

  const activeLead = leads.find(l => l.id === selectedLeadId);

  // Modular routing tab selector
  const [activeModule, setActiveModule] = useState<'sizer' | 'boq_builder' | 'templates' | 'quotes' | 'products'>('sizer');
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);

  // Quote formulator local state
  const [systemSizekW, setSystemSizekW] = useState<number>(8.5);
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
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [cnic, setCnic] = useState("");
  const [cityArea, setCityArea] = useState("Lahore");
  const [bdmName, setBdmName] = useState("Sarah Connor");
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
  const [includedPages, setIncludedPages] = useState<Record<string, boolean>>({
    cover: true,
    profile: true,
    qr: true,
    ceo: true,
    structure: true,
    boq: true,
    terms: true,
    signoff: true,
    bank: true,
    final: true
  });
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
  const [submitError, setSubmitError] = useState<string | null>(null);

  // State for Quote Templates Print Preview & Save enhancements
  const [localPageStates, setLocalPageStates] = useState<Record<string, {
    title?: string;
    body_text?: string;
    image_url?: string;
    bg_image_url?: string;
    is_enabled?: boolean;
    saveStatus?: 'Saved' | 'Unsaved' | 'Saving...';
  }>>({});
  const [previewPage, setPreviewPage] = useState<any | null>(null);
  const [printPageData, setPrintPageData] = useState<any | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("tmpl-1");
  const [includeSizerItems, setIncludeSizerItems] = useState<boolean>(false);
  const [showProposalPreview, setShowProposalPreview] = useState<boolean>(false);
  const [proposalPreviewHtml, setProposalPreviewHtml] = useState<string>("");
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [globalHeaderEnabled, setGlobalHeaderEnabled] = useState<boolean>(true);
  const [globalHeaderText, setGlobalHeaderText] = useState<string>("☀️ SUNCHASER ENERGY");
  const [globalHeaderLogoUrl, setGlobalHeaderLogoUrl] = useState<string>("");
  const [globalHeaderLogoSize, setGlobalHeaderLogoSize] = useState<string>("25px");
  const [globalHeaderLineColor, setGlobalHeaderLineColor] = useState<string>("#f59e0b");
  const [globalHeaderAlignment, setGlobalHeaderAlignment] = useState<string>("left");
  const [globalFooterEnabled, setGlobalFooterEnabled] = useState<boolean>(true);
  const [globalFooterText, setGlobalFooterText] = useState<string>("Sunchaser Energy Systems Proposal");
  const [globalFooterLineColor, setGlobalFooterLineColor] = useState<string>("#cbd5e1");
  const [globalFooterAlignment, setGlobalFooterAlignment] = useState<string>("left");

  const isDefaultAutoSizerRow = (row: any) => {
    const defaultIds = [
      'h-1', 'panel_row', 'inverter_row', 'battery_row', 's-1',
      'h-2', 'dc_cable_row', 'ac_cable_row', 'earth_wire_row', 's-2',
      'h-3', 'db_box_row', 's-3',
      'h-4', 'supplies_row', 's-4',
      'h-5', 'earthing_bore_row', 's-5',
      'h-6', 'structure_row', 'civil_work_row', 'install_service_row', 's-6',
      'h-7', 'freight_row', 'net_metering_row', 'survey_design_row', 's-7'
    ];
    return defaultIds.includes(row.id);
  };

  useEffect(() => {
    if (printPageData) {
      const timer = setTimeout(() => {
        window.print();
      }, 250);
      
      const handleAfterPrint = () => {
        setPrintPageData(null);
      };
      
      window.addEventListener('afterprint', handleAfterPrint);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('afterprint', handleAfterPrint);
      };
    }
  }, [printPageData]);

  useEffect(() => {
    if (settings) {
      if (settings.globalPdfHeader) {
        setGlobalHeaderEnabled(settings.globalPdfHeader.enabled !== false);
        setGlobalHeaderText(settings.globalPdfHeader.text || "☀️ SUNCHASER ENERGY");
        setGlobalHeaderLogoUrl(settings.globalPdfHeader.logoUrl || "");
        setGlobalHeaderLogoSize(settings.globalPdfHeader.logoSize || "25px");
        setGlobalHeaderLineColor(settings.globalPdfHeader.lineColor || "#f59e0b");
        setGlobalHeaderAlignment(settings.globalPdfHeader.alignment || "left");
      }
      if (settings.globalPdfFooter) {
        setGlobalFooterEnabled(settings.globalPdfFooter.enabled !== false);
        setGlobalFooterText(settings.globalPdfFooter.text || "Sunchaser Energy Systems Proposal");
        setGlobalFooterLineColor(settings.globalPdfFooter.lineColor || "#cbd5e1");
        setGlobalFooterAlignment(settings.globalPdfFooter.alignment || "left");
      }
    }
  }, [settings]);

  const handleSaveGlobalPdfSettings = async () => {
    try {
      const updatedSettings = {
        ...settings,
        globalPdfHeader: {
          enabled: globalHeaderEnabled,
          text: globalHeaderText,
          logoUrl: globalHeaderLogoUrl,
          logoSize: globalHeaderLogoSize,
          lineColor: globalHeaderLineColor,
          alignment: globalHeaderAlignment
        },
        globalPdfFooter: {
          enabled: globalFooterEnabled,
          text: globalFooterText,
          lineColor: globalFooterLineColor,
          alignment: globalFooterAlignment
        }
      };

      const response = await fetch(`${API_BASE_URL}/api/db/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          table: "settings",
          data: updatedSettings
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      alert("Global PDF Header & Footer settings saved successfully!");
      if (onRefreshState) onRefreshState();
    } catch (err: any) {
      console.error("Save global settings error:", err);
      alert("Failed to save global PDF settings: " + (err.message || err.toString()));
    }
  };

  const uploadImageFile = async (file: File, isBg: boolean): Promise<string> => {
    if (!file.type.startsWith('image/')) {
      throw new Error("Please select a valid image file.");
    }
    const reader = new FileReader();
    const dataUrl: string = await new Promise((resolve, reject) => {
      reader.onerror = () => reject(new Error("FileReader error."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Image element error."));
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxWidth = isBg ? 800 : 400;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error("Canvas context error.")); return; }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });

    const response = await fetch(`${API_BASE_URL}/api/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Data: dataUrl, filename: file.name })
    });
    if (!response.ok) throw new Error("Server upload failure.");
    const resData = await response.json();
    return resData.dataUrl || resData.url || dataUrl;
  };

  const handleGlobalHeaderLogoUpload = async (file: File) => {
    try {
      const url = await uploadImageFile(file, false);
      setGlobalHeaderLogoUrl(url);
    } catch (err: any) {
      console.error("Global logo upload error:", err);
      alert("Upload failed: " + (err.message || err.toString()));
    }
  };

  // Sizing inputs and options
  const [formMonthlyUnits, setFormMonthlyUnits] = useState<number>(985);
  const [formRoofWidth, setFormRoofWidth] = useState<number>(30);
  const [formRoofLength, setFormRoofLength] = useState<number>(25);
  const [formBackupReq, setFormBackupReq] = useState<string>("Essential Loads (Sunchaser Core 13.5kWh)");
  const [formLocation, setFormLocation] = useState<string>("Lahore");
  const [systemSector, setSystemSector] = useState<'residential' | 'commercial'>('residential');
  const [confirmHighUnits, setConfirmHighUnits] = useState<boolean>(false);
  const [savingQuote, setSavingQuote] = useState<boolean>(false);

  // OCR Bill scanner mock state
  const [billFile, setBillFile] = useState<File | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [billParsedData, setBillParsedData] = useState<any | null>(null);

  // Gemini technical assessment report
  const [aiReportMarkdown, setAiReportMarkdown] = useState<string | null>(null);
  const [aiReportLoading, setAiReportLoading] = useState<boolean>(false);

  // Proposal contract creator state
  const [proposalMarkdown, setProposalMarkdown] = useState<string | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [quoteCreatedConfirm, setQuoteCreatedConfirm] = useState(false);
  const [whatsappNotice, setWhatsappNotice] = useState<string | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(false);

  // View state for quote detail
  const [selectedQuoteDetail, setSelectedQuoteDetail] = useState<Quote | null>(null);

  // Product CRUD forms modal states
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [productFormBrand, setProductFormBrand] = useState("");
  const [productFormModel, setProductFormModel] = useState("");
  const [productFormCategory, setProductFormCategory] = useState("Solar Panels");
  const [productFormSku, setProductFormSku] = useState("");
  const [productFormPrice, setProductFormPrice] = useState(0);
  const [productFormCostPrice, setProductFormCostPrice] = useState(0);
  const [productFormStock, setProductFormStock] = useState(10);
  const [productFormWarranty, setProductFormWarranty] = useState("");
  const [productFormWattage, setProductFormWattage] = useState(0);
  const [productFormDesc, setProductFormDesc] = useState("");

  // Product Category selection tab in library
  const [selectedProductCategory, setSelectedProductCategory] = useState("Solar Panels");
  const [productSearchQuery, setProductSearchQuery] = useState("");

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
    if (sizekW >= 50) inverterRate = 800000;
    if (sizekW >= 100) inverterRate = 1400000;
    
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
    if (sizekW >= 50) installRate = 200000;
    if (sizekW >= 100) installRate = 350000;

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
      let nmRate = 90000;
      if (sizekW >= 30) nmRate = 100000;
      if (sizekW >= 50) nmRate = 120000;
      if (sizekW >= 100) nmRate = 150000;
      rows.push({
        id: 'net_metering_row',
        type: 'item',
        srNo: '14',
        name: 'LESCO Net Metering Licensing Process',
        description: 'Document processing, demand notice payments & green meter commission',
        brand: 'LESCO',
        unit: 'Job',
        qty: 1,
        rate: nmRate,
        total: nmRate
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

  // Quick package loader mapping
  const applyPackage = (kwSize: number) => {
    let type: 'On-grid' | 'Hybrid' | 'Off-grid' = 'Hybrid';
    let brand = "Jinko";
    let wattage = 580;
    let invBrand = "Knox";
    let invCap = `${kwSize}kW`;
    let batt = "Lithium Battery Pack 5.12kWh";
    let struct = "Standard";
    let net: 'Yes' | 'No' = "Yes";
    let instCharges = 50000;
    let netCharges = 90000;

    if (kwSize === 3) {
      brand = "Jinko";
      wattage = 580;
      invBrand = "Solis";
      invCap = "3kW";
      batt = "Lithium Battery Pack 5.12kWh";
      struct = "Standard";
      net = "No";
      instCharges = 40000;
      netCharges = 0;
    } else if (kwSize === 5) {
      brand = "Jinko";
      wattage = 580;
      invBrand = "Knox";
      invCap = "5kW";
      batt = "Lithium Battery Pack 5.12kWh";
      struct = "Standard";
      net = "Yes";
      instCharges = 50000;
      netCharges = 90000;
    } else if (kwSize === 7) {
      brand = "Longi";
      wattage = 575;
      invBrand = "Knox";
      invCap = "7kW";
      batt = "Lithium Battery Pack 5.12kWh";
      struct = "Standard";
      net = "Yes";
      instCharges = 60000;
      netCharges = 90000;
    } else if (kwSize === 10) {
      brand = "Jinko";
      wattage = 580;
      invBrand = "Knox";
      invCap = "10kW";
      batt = "Lithium Battery Pack 10.24kWh";
      struct = "Standard";
      net = "Yes";
      instCharges = 80000;
      netCharges = 90000;
    } else if (kwSize === 12) {
      brand = "Jinko";
      wattage = 580;
      invBrand = "Knox";
      invCap = "12kW";
      batt = "Lithium Battery Pack 10.24kWh";
      struct = "Standard";
      net = "Yes";
      instCharges = 90000;
      netCharges = 90000;
    } else if (kwSize === 15) {
      brand = "JA Solar";
      wattage = 550;
      invBrand = "Solis";
      invCap = "15kW";
      batt = "Lithium Battery Pack 15.0kWh";
      struct = "Elevated";
      net = "Yes";
      instCharges = 100000;
      netCharges = 90000;
    } else if (kwSize === 20) {
      type = "On-grid";
      brand = "Canadian Solar";
      wattage = 580;
      invBrand = "Goodwe";
      invCap = "20kW";
      batt = "None";
      struct = "Standard";
      net = "Yes";
      instCharges = 120000;
      netCharges = 90000;
    } else if (kwSize === 25) {
      type = "On-grid";
      brand = "Canadian Solar";
      wattage = 580;
      invBrand = "Goodwe";
      invCap = "25kW";
      batt = "None";
      struct = "Standard";
      net = "Yes";
      instCharges = 130000;
      netCharges = 95000;
    } else if (kwSize === 30) {
      type = "On-grid";
      brand = "JA Solar";
      wattage = 550;
      invBrand = "Solis";
      invCap = "30kW";
      batt = "None";
      struct = "Girder";
      net = "Yes";
      instCharges = 150000;
      netCharges = 100000;
    } else if (kwSize === 50) {
      type = "On-grid";
      brand = "Jinko";
      wattage = 580;
      invBrand = "Goodwe";
      invCap = "50kW";
      batt = "None";
      struct = "Girder";
      net = "Yes";
      instCharges = 200000;
      netCharges = 120000;
    } else if (kwSize === 100) {
      type = "On-grid";
      brand = "Jinko";
      wattage = 580;
      invBrand = "Solis";
      invCap = "100kW";
      batt = "None";
      struct = "Girder";
      net = "Yes";
      instCharges = 350000;
      netCharges = 150000;
    }

    const sector = kwSize >= 50 ? 'commercial' : 'residential';
    setSystemSector(sector);
    setSystemSizekW(kwSize);
    setSystemType(type);
    setPanelBrand(brand);
    setPanelWattage(wattage);
    setInverterBrand(invBrand);
    setInverterCapacity(invCap);
    setBatteryOption(batt);
    setStructureType(struct);
    setSelectedStructure(struct.toLowerCase() as any);
    setNetMeteringRequired(net);
    setInstallationCharges(instCharges);
    setNetMeteringCharges(netCharges);

    const defaultBoq = generateDefaultBoqRows(kwSize, type, struct, brand, wattage, invBrand, invCap, batt, net);
    // Rewrite all IDs to prevent them from being identified as default auto-sizer rows
    const packageRows = defaultBoq.map(row => ({
      ...row,
      id: row.id.startsWith('h-') 
        ? `row-heading-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        : row.id.startsWith('s-')
          ? `row-subtotal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          : `row-item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }));
    setBoqRows(packageRows);
    setManualBoqItems(packageRows);
    triggerAutosave(packageRows);
  };

  const handleCopyAutoSizerToManualBoq = () => {
    if (!activeLead) return;
    
    // Find latest auto sizer quote, or generate defaults if none
    const latestAutoSizerQuote = activeLead.quotes?.find((q: any) => q.quote_type === 'auto_sizer');
    let rowsToCopy: any[] = [];
    
    if (latestAutoSizerQuote) {
      rowsToCopy = latestAutoSizerQuote.boqRows || latestAutoSizerQuote.boqItems || [];
    } else {
      // Generate default auto sizer rows as fallback
      rowsToCopy = generateDefaultBoqRows(
        systemSizekW,
        systemType,
        'Standard',
        panelBrand,
        panelWattage,
        inverterBrand,
        inverterCapacity,
        batteryOption,
        netMeteringRequired
      );
    }
    
    // Rewrite row IDs to ensure they act as manual rows and don't match default IDs
    const copiedRows = rowsToCopy.map((row: any) => ({
      ...row,
      id: row.id.startsWith('h-') 
        ? `row-heading-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        : row.id.startsWith('s-')
          ? `row-subtotal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          : `row-item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }));
    
    setBoqRows(copiedRows);
    setManualBoqItems(copiedRows);
    triggerAutosave(copiedRows);
    console.log(`[Manual BOQ Builder] Copied ${copiedRows.length} rows from Auto Sizer, rewritten IDs to manual.`);
  };

  // Sync client details and BOQ rows when activeLead changes
  useEffect(() => {
    if (activeLead) {
      setClientName(activeLead.name || "");
      setClientPhone(activeLead.phone || "");
      setClientEmail(activeLead.email || "");
      setClientAddress(activeLead.address || "");
      setCityArea(activeLead.location || "Lahore");
      setBdmName(activeLead.assignedSalesperson || "Sarah Connor");
      setQuoteDate(new Date().toISOString().split('T')[0]);
      
      // 1. Reset all quote editor states to standard defaults to prevent state leakage
      setEditingQuoteId(null);
      setCnic("");
      setSystemSizekW(8.5);
      setSystemType('Hybrid');
      setPanelBrand("Jinko");
      setPanelWattage(580);
      setInverterBrand("Knox");
      setInverterCapacity("10kW");
      setBatteryOption("None");
      setSelectedStructure('standard');
      setNetMeteringRequired('Yes');
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
      setIncludeSizerItems(false);
      setSelectedTemplateId("tmpl-1");
      setIncludedPages({
        cover: true, profile: true, qr: true, ceo: true, structure: true, boq: true, terms: true, signoff: true, bank: true, final: true
      });
      setCustomStructName("");
      setCustomStructDescEn("");
      setCustomStructDescUr("");
      setCustomStructRate(0);
      setCustomStructWeight("");
      setCustomStructMaterial("");
      setCustomStructWarranty("");
      setCustomStructWind("");
      setAccessories("Dual DC cables, PVC ducting & safety switches");
      setWarrantyTerms("25 year power degradation, 10 year inverter warranty");
      setTermsAndConditions("Quoted prices are valid for 3 days.");

      // 2. Load latest quote details or lead details
      const latestQuote = activeLead.quotes?.find((q: any) => q.quote_type === 'manual_boq');
      if (latestQuote) {
        setSystemSizekW(latestQuote.systemSizekW || 10);
        setSystemType(latestQuote.systemType || 'Hybrid');
        setPanelBrand(latestQuote.panelBrand || "Jinko");
        setPanelWattage(latestQuote.panelWattage || 580);
        setInverterBrand(latestQuote.inverterBrand || "Knox");
        setInverterCapacity(latestQuote.inverterCapacity || "10kW");
        setBatteryOption(latestQuote.batteryOption || "None");
        setSelectedStructure(latestQuote.selectedStructure || 'standard');
        setNetMeteringRequired(latestQuote.netMeteringRequired || 'Yes');
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
        setIncludeSizerItems(latestQuote.includeSizerItems === true);
        setSelectedTemplateId(latestQuote.templateId || "tmpl-1");
        setAccessories(latestQuote.accessories || "Dual DC cables, PVC ducting & safety switches");
        setWarrantyTerms(latestQuote.warrantyTerms || "25 year power degradation, 10 year inverter warranty");
        setTermsAndConditions(latestQuote.termsAndConditions || "Quoted prices are valid for 3 days.");
        
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

        if (latestQuote.includedPages && Array.isArray(latestQuote.includedPages)) {
          const pageMapping: Record<string, boolean> = {
            cover: false, profile: false, qr: false, ceo: false, structure: false, boq: false, terms: false, signoff: false, bank: false, final: false
          };
          latestQuote.includedPages.forEach((p: string) => {
            pageMapping[p] = true;
          });
          setIncludedPages(pageMapping);
        }
      } else {
        // Default system size calculation
        const assumedUnits = activeLead.monthlyUnits || (activeLead.monthlyBill ? Math.round(activeLead.monthlyBill / 35) : 980);
        setFormMonthlyUnits(assumedUnits);
        const calcSize = activeLead.monthlyBill && activeLead.monthlyBill > 1000 ? Number((activeLead.monthlyBill / (26 * 35)).toFixed(1)) : 8.5;
        setSystemSizekW(calcSize);
      }

      // 3. Load BOQ rows (prioritizing localStorage autosave cache)
      const cachedBoq = localStorage.getItem(`sunchaser_boq_${activeLead.id}`);
      if (cachedBoq) {
        try {
          const parsed = JSON.parse(cachedBoq);
          setBoqRows(parsed);
          setManualBoqItems(parsed);
        } catch (e) {
          console.error("Failed to parse cached BOQ", e);
        }
      } else if (latestQuote) {
        const qRows = latestQuote.boqRows || latestQuote.boqItems || [];
        setBoqRows(qRows);
        setManualBoqItems(qRows);
      } else {
        setBoqRows([]);
        setManualBoqItems([]);
      }
    }
  }, [selectedLeadId, leads]);

  // Console debugger tracking Manual BOQ Builder events
  useEffect(() => {
    if (activeModule === 'boq_builder' && activeLead) {
      const defaultIds = [
        'h-1', 'panel_row', 'inverter_row', 'battery_row', 's-1',
        'h-2', 'dc_cable_row', 'ac_cable_row', 'earth_wire_row', 's-2',
        'h-3', 'db_box_row', 's-3',
        'h-4', 'supplies_row', 's-4',
        'h-5', 'earthing_bore_row', 's-5',
        'h-6', 'structure_row', 'civil_work_row', 'install_service_row', 's-6',
        'h-7', 'freight_row', 'net_metering_row', 'survey_design_row', 's-7'
      ];
      
      const allRows = boqRows || [];
      const autoCount = allRows.filter(r => defaultIds.includes(r.id)).length;
      const manualCount = allRows.filter(r => !defaultIds.includes(r.id)).length;
      
      const isPackageRow = (r: any) => r.id && (r.id.startsWith('row-heading') || r.id.startsWith('row-item') || r.id.startsWith('row-subtotal'));
      const sourceUsed = allRows.some(isPackageRow) ? 'package_loaded' : (autoCount > 0 ? 'auto_sizer' : 'manual_only');
      
      console.log("[Manual BOQ Debug Log] Frontend opened/updated:", {
        leadId: activeLead.id,
        selectedQuoteId: editingQuoteId || "N/A",
        quote_type: editingQuoteId ? (activeLead.quotes?.find((q: any) => q.id === editingQuoteId)?.quote_type || "manual_boq") : "manual_boq",
        manualBoqRowsCount: manualCount,
        autoSizerRowsCount: autoCount,
        defaultRowsInjected: autoCount > 0,
        source: sourceUsed
      });
    }
  }, [activeModule, boqRows, activeLead, editingQuoteId]);

  // Sync rows to localStorage on edit
  const triggerAutosave = (updatedRows: BoqRow[]) => {
    if (activeLead) {
      localStorage.setItem(`sunchaser_boq_${activeLead.id}`, JSON.stringify(updatedRows));
    }
  };

  // Excel Manual Builder Cell Handlers
  const handleCellChange = (index: number, field: keyof BoqRow, value: any) => {
    const updated = [...manualBoqItems];
    if (!updated[index]) return;
    
    updated[index] = {
      ...updated[index],
      [field]: value
    };

    if (field === 'qty' || field === 'rate') {
      const q = Number(updated[index].qty) || 0;
      const r = Number(updated[index].rate) || 0;
      updated[index].total = q * r;
    }

    const calculated = calculateRowTotalsAndSubtotals(updated);
    setManualBoqItems(calculated);
    setBoqRows(calculated);
    triggerAutosave(calculated);
  };

  const addBoqRow = (type: 'heading' | 'item' | 'subtotal') => {
    const currentItems = manualBoqItems.length > 0 ? manualBoqItems : boqRows;
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
    triggerAutosave(updated);
  };

  const deleteBoqRow = (index: number) => {
    const currentItems = manualBoqItems.length > 0 ? manualBoqItems : boqRows;
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
    triggerAutosave(updated);
  };

  const duplicateBoqRow = (index: number) => {
    const currentItems = manualBoqItems.length > 0 ? manualBoqItems : boqRows;
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
    triggerAutosave(updated);
  };

  const moveBoqRow = (index: number, direction: 'up' | 'down') => {
    const currentItems = manualBoqItems.length > 0 ? manualBoqItems : boqRows;
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
    triggerAutosave(updated);
  };

  const handleLoadFromLibrary = (index: number, libraryItemId: string) => {
    const libItem = products.find((item: any) => item && item.id === libraryItemId);
    if (!libItem) return;
    
    const currentItems = manualBoqItems.length > 0 ? manualBoqItems : boqRows;
    const updated = [...currentItems];
    if (!updated[index]) return;
    
    const qtyVal = updated[index].qty || 1;
    const saleRate = Number(libItem.price) || 0;
    
    updated[index] = {
      ...updated[index],
      name: libItem.brand + " " + libItem.model,
      brand: libItem.brand,
      description: libItem.specifications?.description || libItem.name || "",
      unit: "Pcs",
      rate: saleRate,
      total: qtyVal * saleRate
    };
    
    const calculated = calculateRowTotalsAndSubtotals(updated);
    setManualBoqItems(calculated);
    setBoqRows(calculated);
    triggerAutosave(calculated);
  };

  // Compile Quote Payload & Send to API
  const handleSaveQuote = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeLead) return;
    if (savingQuote) return;
    setSubmitError(null);

    // Validate size limits
    const sMin = systemSector === 'residential' ? 3.0 : 30.0;
    const sMax = systemSector === 'residential' ? 30.0 : 500.0;
    if (systemSizekW < sMin || systemSizekW > sMax) {
      setSubmitError(`Impossible system size for ${systemSector} sector. Must be between ${sMin}kW and ${sMax}kW.`);
      return;
    }

    setSavingQuote(true);

    try {
      const panelsCount = Math.ceil((systemSizekW * 1000) / panelWattage);
      
      // Structure specs payload
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

      const calculatedGrandTotal = boqRows
        .filter(r => r && r.type === 'item')
        .reduce((sum, r) => sum + (r.total || 0), 0);

      const calculatedTaxAmount = taxEnabled ? Math.round(calculatedGrandTotal * (taxRate / 100)) : 0;
      const calculatedNetTotal = calculatedGrandTotal + calculatedTaxAmount + (Number(societyCharges) || 0) - (Number(discount) || 0);

      // Generate client-side idempotencyKey
      const idempotencyKey = `ik-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const quoteData = {
        idempotencyKey,
        systemSizekW,
        panelCount: panelsCount,
        panelType: `${panelBrand} ${panelWattage}W Mono-PERC Panels`,
        inverterType: `${inverterBrand} ${inverterCapacity} Inverter`,
        batteryCapacity: batteryOption !== "None" ? batteryOption : "",
        totalCost: calculatedGrandTotal,
        structureType: selectedStructure === 'custom' ? 'Custom' : (selectedStructure.charAt(0).toUpperCase() + selectedStructure.slice(1)),
        accessories,
        installationCharges: Number(boqRows.find(i => i && i.id === 'install_service_row')?.rate) || installationCharges,
        netMeteringCharges: netMeteringRequired === "Yes" ? (Number(boqRows.find(i => i && i.id === 'net_metering_row')?.rate) || netMeteringCharges) : 0,
        paymentTerms: paymentSchedule,
        warrantyTerms,
        termsAndConditions,

        // Custom Lahore/Pakistan fields
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
        boqItems: includeSizerItems ? boqRows : boqRows.filter(r => !isDefaultAutoSizerRow(r)),

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
        boqRows: includeSizerItems ? boqRows : boqRows.filter(r => !isDefaultAutoSizerRow(r)),
        customNotes,
        grandTotal: calculatedGrandTotal,
        netTotal: calculatedNetTotal,
        templateId: selectedTemplateId,
        includeSizerItems,
        includedPages: Object.keys(includedPages).filter(k => includedPages[k]),
        quote_type: activeModule === 'sizer' ? 'auto_sizer' : 'manual_boq'
      };

      if (editingQuoteId) {
        // Overwrite existing quote record
        const res = await fetch(`${API_BASE_URL}/api/leads/${activeLead.id}/update-quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteId: editingQuoteId, quoteData })
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed to overwrite quote.");
        }
        setEditingQuoteId(null);
      } else {
        // Create new quote version
        await on创造Quote(activeLead.id, quoteData);
      }

      setQuoteCreatedConfirm(true);
      setTimeout(() => setQuoteCreatedConfirm(false), 8000);

      // Clean local storage cache
      localStorage.removeItem(`sunchaser_boq_${activeLead.id}`);

      // Refresh global state
      if (onRefreshState) onRefreshState();

      // Open PDF in a new tab
      window.open(`${API_BASE_URL}/api/export/pdf/manual-quote/${activeLead.id}`, "_blank");
    } catch (err: any) {
      console.error("Quote save failed:", err);
      setSubmitError(err.message || "Failed to save quotation on server.");
    } finally {
      setSavingQuote(false);
    }
  };

  const handleDownloadManualQuotePDF = () => {
    if (!activeLead) return;

    const panelsCount = Math.ceil((systemSizekW * 1000) / panelWattage);

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

    const calculatedGrandTotal = boqRows
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
      installationCharges: Number(boqRows.find(i => i && i.id === 'install_service_row')?.rate) || installationCharges,
      netMeteringCharges: netMeteringRequired === "Yes" ? (Number(boqRows.find(i => i && i.id === 'net_metering_row')?.rate) || netMeteringCharges) : 0,
      paymentTerms: paymentSchedule,
      warrantyTerms,
      termsAndConditions,
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
      boqItems: includeSizerItems ? boqRows : boqRows.filter(r => !isDefaultAutoSizerRow(r)),
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
      boqRows: includeSizerItems ? boqRows : boqRows.filter(r => !isDefaultAutoSizerRow(r)),
      customNotes,
      grandTotal: calculatedGrandTotal,
      netTotal: calculatedNetTotal,
      leadId: activeLead.id,
      includedPages: Object.keys(includedPages).filter(k => includedPages[k]),
      templateId: selectedTemplateId,
      includeSizerItems
    };

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `${API_BASE_URL}/api/export/pdf/manual-quote`;
    form.target = '_blank';

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.name = 'payload';
    hiddenInput.value = JSON.stringify(quoteData);
    form.appendChild(hiddenInput);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  };

  const handlePreviewProposalDeck = async () => {
    if (!activeLead) return;

    const panelsCount = Math.ceil((systemSizekW * 1000) / panelWattage);

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

    const calculatedGrandTotal = boqRows
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
      installationCharges: Number(boqRows.find(i => i && i.id === 'install_service_row')?.rate) || installationCharges,
      netMeteringCharges: netMeteringRequired === "Yes" ? (Number(boqRows.find(i => i && i.id === 'net_metering_row')?.rate) || netMeteringCharges) : 0,
      paymentTerms: paymentSchedule,
      warrantyTerms,
      termsAndConditions,
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
      boqItems: includeSizerItems ? boqRows : boqRows.filter(r => !isDefaultAutoSizerRow(r)),
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
      boqRows: includeSizerItems ? boqRows : boqRows.filter(r => !isDefaultAutoSizerRow(r)),
      customNotes,
      grandTotal: calculatedGrandTotal,
      netTotal: calculatedNetTotal,
      leadId: activeLead.id,
      includedPages: Object.keys(includedPages).filter(k => includedPages[k]),
      templateId: selectedTemplateId,
      includeSizerItems
    };

    try {
      setLoadingPreview(true);
      setShowProposalPreview(true);
      
      const response = await fetch(`${API_BASE_URL}/api/export/pdf/manual-quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(quoteData)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to compile proposal preview layout: ${response.statusText}`);
      }
      
      const html = await response.text();
      setProposalPreviewHtml(html);
    } catch (err: any) {
      console.error(err);
      setProposalPreviewHtml(`<div style="padding: 20px; color: #ef4444; font-weight: bold; font-family: sans-serif;">Error loading preview: ${err.message}</div>`);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleDuplicateQuote = async (quote: any) => {
    if (!activeLead) return;
    try {
      const dupQuote = {
        ...quote,
        id: undefined,
        createdAt: new Date().toISOString(),
        quoteDate: new Date().toISOString().split('T')[0],
      };
      await on创造Quote(activeLead.id, dupQuote);
      if (onRefreshState) onRefreshState();
    } catch (err: any) {
      console.error("Failed to duplicate quote:", err);
    }
  };

  const handleLoadQuoteForEditing = (quote: any) => {
    setEditingQuoteId(quote.id);
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
    
    setSelectedTemplateId(quote.templateId || "tmpl-1");

    if (quote.includedPages && Array.isArray(quote.includedPages)) {
      const pageMapping: Record<string, boolean> = {
        cover: false, profile: false, qr: false, ceo: false, structure: false, boq: false, terms: false, signoff: false, bank: false, final: false
      };
      quote.includedPages.forEach((p: string) => {
        pageMapping[p] = true;
      });
      setIncludedPages(pageMapping);
    }
    setIncludeSizerItems(quote.includeSizerItems === true);
    
    // Switch to manual BOQ tab
    setActiveModule('boq_builder');
  };

  const getPageState = (page: any) => {
    const local = localPageStates[page.id];
    
    // Parse JSON settings from DB record if present
    const rawBody = page.body_text || page.bodyText || "";
    let parsed: any = {};
    if (typeof rawBody === 'string' && rawBody.trim().startsWith('{')) {
      try {
        parsed = JSON.parse(rawBody);
      } catch (e) {
        parsed = { bodyText: rawBody };
      }
    } else {
      parsed = { bodyText: rawBody };
    }

    return {
      title: local?.title !== undefined ? local.title : (page.title || ""),
      body_text: local?.body_text !== undefined ? local.body_text : (parsed.bodyText || ""),
      image_url: local?.image_url !== undefined ? local.image_url : (page.image_url || page.imageUrl || ""),
      bg_image_url: local?.bg_image_url !== undefined ? local.bg_image_url : (page.bg_image_url || page.bgImageUrl || ""),
      is_enabled: local?.is_enabled !== undefined ? local.is_enabled : (page.is_enabled !== false),
      
      // Extended fields
      layoutMode: local?.layoutMode !== undefined ? local.layoutMode : (parsed.layoutMode || "standard"),
      headerMode: local?.headerMode !== undefined ? local.headerMode : (parsed.header?.mode || "inherit"),
      headerText: local?.headerText !== undefined ? local.headerText : (parsed.header?.text || ""),
      headerLogoUrl: local?.headerLogoUrl !== undefined ? local.headerLogoUrl : (parsed.header?.logoUrl || ""),
      headerLogoSize: local?.headerLogoSize !== undefined ? local.headerLogoSize : (parsed.header?.logoSize || "25px"),
      headerLineColor: local?.headerLineColor !== undefined ? local.headerLineColor : (parsed.header?.lineColor || "#cbd5e1"),
      headerAlignment: local?.headerAlignment !== undefined ? local.headerAlignment : (parsed.header?.alignment || "left"),
      
      footerMode: local?.footerMode !== undefined ? local.footerMode : (parsed.footer?.mode || "inherit"),
      footerText: local?.footerText !== undefined ? local.footerText : (parsed.footer?.text || ""),
      footerLineColor: local?.footerLineColor !== undefined ? local.footerLineColor : (parsed.footer?.lineColor || "#cbd5e1"),
      footerAlignment: local?.footerAlignment !== undefined ? local.footerAlignment : (parsed.footer?.alignment || "left"),
      
      bodyImages: local?.bodyImages !== undefined ? local.bodyImages : (parsed.bodyImages || []),
      
      saveStatus: local?.saveStatus || 'Saved'
    };
  };

  const handleFieldChange = (pageId: string, field: string, value: any) => {
    setLocalPageStates(prev => {
      const existing = prev[pageId] || {};
      const page = quoteTemplatePages.find(p => p.id === pageId);
      
      let originalVal: any = "";
      if (page) {
        const rawBody = page.body_text || page.bodyText || "";
        let parsed: any = {};
        if (typeof rawBody === 'string' && rawBody.trim().startsWith('{')) {
          try { parsed = JSON.parse(rawBody); } catch (e) { parsed = { bodyText: rawBody }; }
        } else {
          parsed = { bodyText: rawBody };
        }

        if (field === 'title') originalVal = page.title || "";
        else if (field === 'body_text') originalVal = parsed.bodyText || "";
        else if (field === 'is_enabled') originalVal = page.is_enabled !== false;
        else if (field === 'image_url') originalVal = page.image_url || page.imageUrl || "";
        else if (field === 'bg_image_url') originalVal = page.bg_image_url || page.bgImageUrl || "";
        else if (field === 'layoutMode') originalVal = parsed.layoutMode || "standard";
        else if (field === 'headerMode') originalVal = parsed.header?.mode || "inherit";
        else if (field === 'headerText') originalVal = parsed.header?.text || "";
        else if (field === 'headerLogoUrl') originalVal = parsed.header?.logoUrl || "";
        else if (field === 'headerLogoSize') originalVal = parsed.header?.logoSize || "25px";
        else if (field === 'headerLineColor') originalVal = parsed.header?.lineColor || "#cbd5e1";
        else if (field === 'headerAlignment') originalVal = parsed.header?.alignment || "left";
        else if (field === 'footerMode') originalVal = parsed.footer?.mode || "inherit";
        else if (field === 'footerText') originalVal = parsed.footer?.text || "";
        else if (field === 'footerLineColor') originalVal = parsed.footer?.lineColor || "#cbd5e1";
        else if (field === 'footerAlignment') originalVal = parsed.footer?.alignment || "left";
        else if (field === 'bodyImages') originalVal = parsed.bodyImages || [];
      }
      
      const isDifferent = originalVal !== value;
      const saveStatus = isDifferent ? 'Unsaved' : 'Saved';
      
      return {
        ...prev,
        [pageId]: {
          ...existing,
          [field]: value,
          saveStatus
        }
      };
    });
  };

  const handleSavePage = async (pageId: string) => {
    const page = quoteTemplatePages.find(p => p.id === pageId);
    if (!page) return;

    const state = getPageState(page);

    setLocalPageStates(prev => ({
      ...prev,
      [pageId]: {
        ...prev[pageId],
        saveStatus: 'Saving...'
      }
    }));

    try {
      const response = await fetch(`${API_BASE_URL}/api/db/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          table: "quoteTemplatePages",
          id: pageId,
          data: {
            ...page,
            title: state.title,
            body_text: JSON.stringify({
              bodyText: state.body_text,
              layoutMode: state.layoutMode,
              header: {
                mode: state.headerMode,
                text: state.headerText,
                logoUrl: state.headerLogoUrl,
                logoSize: state.headerLogoSize,
                lineColor: state.headerLineColor,
                alignment: state.headerAlignment
              },
              footer: {
                mode: state.footerMode,
                text: state.footerText,
                lineColor: state.footerLineColor,
                alignment: state.footerAlignment
              },
              bodyImages: state.bodyImages
            }),
            image_url: state.image_url,
            bg_image_url: state.bg_image_url,
            is_enabled: state.is_enabled
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `HTTP error ${response.status}`);
      }

      setLocalPageStates(prev => ({
        ...prev,
        [pageId]: {
          ...prev[pageId],
          saveStatus: 'Saved'
        }
      }));

      alert("Page configuration saved successfully!");
      if (onRefreshState) onRefreshState();
    } catch (err: any) {
      console.error("Save error:", err);
      alert("Failed to save template page changes: " + (err.message || err.toString()));
      setLocalPageStates(prev => ({
        ...prev,
        [pageId]: {
          ...prev[pageId],
          saveStatus: 'Unsaved'
        }
      }));
    }
  };

  const handleImageUpload = async (pageId: string, file: File, type: 'image' | 'bg') => {
    try {
      if (!file.type.startsWith('image/')) {
        alert("Please select a valid image file.");
        return;
      }

      const compressImage = (file: File, maxWidth: number = 800, quality: number = 0.7): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("Failed to read file."));
          reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error("Failed to load image."));
            img.onload = () => {
              const canvas = document.createElement('canvas');
              let width = img.width;
              let height = img.height;
              
              if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
              }
              
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (!ctx) { reject(new Error("Canvas not supported.")); return; }
              ctx.drawImage(img, 0, 0, width, height);
              
              const dataUrl = canvas.toDataURL('image/jpeg', quality);
              resolve(dataUrl);
            };
            img.src = reader.result as string;
          };
          reader.readAsDataURL(file);
        });
      };

      const maxW = type === 'bg' ? 800 : 400;
      let dataUrl = await compressImage(file, maxW, 0.7);
      
      let sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024);
      if (sizeKB > 500) {
        dataUrl = await compressImage(file, type === 'bg' ? 600 : 300, 0.5);
        sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024);
        if (sizeKB > 500) {
          alert(`Image is still too large (${sizeKB}KB) after compression. Please use a smaller image.`);
          return;
        }
      }

      const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Data: dataUrl,
          filename: file.name
        })
      });

      if (!response.ok) {
        let errMsg = `HTTP error ${response.status}`;
        try {
          const errData = await response.json();
          errMsg = errData.error || errData.message || errMsg;
        } catch {
          const errText = await response.text();
          if (errText) errMsg = errText;
        }
        throw new Error(errMsg);
      }

      const resData = await response.json();
      const finalUrl = resData.dataUrl || resData.url || dataUrl;

      const fieldKey = type === 'image' ? 'image_url' : 'bg_image_url';
      handleFieldChange(pageId, fieldKey, finalUrl);
    } catch (err: any) {
      console.error("Upload error:", err);
      alert("Upload failed: " + (err.message || err.toString()));
    }
  };

  const handleUpdatePageSortOrder = async (pageId: string, currentOrder: number, direction: 'up' | 'down') => {
    const list = [...quoteTemplatePages].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const idx = list.findIndex(p => p.id === pageId);
    if (idx === -1) return;
    
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    
    const tempOrder = list[idx].sort_order;
    list[idx].sort_order = list[targetIdx].sort_order;
    list[targetIdx].sort_order = tempOrder;

    try {
      // Save both pages updates
      await fetch(`${API_BASE_URL}/api/db/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", table: "quoteTemplatePages", id: list[idx].id, data: { sort_order: list[idx].sort_order } })
      });
      await fetch(`${API_BASE_URL}/api/db/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", table: "quoteTemplatePages", id: list[targetIdx].id, data: { sort_order: list[targetIdx].sort_order } })
      });

      if (onRefreshState) onRefreshState();
    } catch (e) {
      console.error(e);
    }
  };

  // Product library CRUD helpers
  const handleOpenAddProduct = () => {
    setEditingProduct(null);
    setProductFormBrand("");
    setProductFormModel("");
    setProductFormCategory("Solar Panels");
    setProductFormSku("");
    setProductFormPrice(0);
    setProductFormCostPrice(0);
    setProductFormStock(10);
    setProductFormWarranty("");
    setProductFormWattage(0);
    setProductFormDesc("");
    setIsProductModalOpen(true);
  };

  const handleOpenEditProduct = (prod: any) => {
    setEditingProduct(prod);
    setProductFormBrand(prod.brand || "");
    setProductFormModel(prod.model || "");
    setProductFormCategory(prod.category || "Solar Panels");
    setProductFormSku(prod.sku || "");
    setProductFormPrice(prod.price || 0);
    setProductFormCostPrice(prod.specifications?.costPrice || 0);
    setProductFormStock(prod.stock || 0);
    setProductFormWarranty(prod.warrantyPeriod || "");
    setProductFormWattage(prod.specifications?.wattage || 0);
    setProductFormDesc(prod.specifications?.description || "");
    setIsProductModalOpen(true);
  };

  const handleSaveProductForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      id: editingProduct ? editingProduct.id : `prod-${Date.now()}`,
      name: `${productFormBrand} ${productFormModel}`,
      category: productFormCategory,
      brand: productFormBrand,
      model: productFormModel,
      sku: productFormSku || `SKU-${Date.now().toString().slice(-6)}`,
      price: Number(productFormPrice),
      stock: Number(productFormStock),
      warrantyPeriod: productFormWarranty,
      images: editingProduct?.images || ["https://images.unsplash.com/photo-1509391366360-2e959784a276?w=800&auto=format&fit=crop&q=60"],
      specifications: {
        wattage: Number(productFormWattage),
        costPrice: Number(productFormCostPrice),
        description: productFormDesc
      }
    };

    try {
      const response = await fetch(`${API_BASE_URL}/api/db/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editingProduct ? "edit" : "add",
          table: "products",
          id: payload.id,
          data: payload
        })
      });
      if (!response.ok) throw new Error("Catalog synchronization failed.");
      
      setIsProductModalOpen(false);
      if (onRefreshState) onRefreshState();
      alert("Product catalog updated successfully!");
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to update product library.");
    }
  };

  const handleDeleteProduct = async (prodId: string) => {
    if (!window.confirm("Are you sure you want to delete this product from database?")) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/db/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          table: "products",
          id: prodId
        })
      });
      if (!response.ok) throw new Error("Failed to delete product from database.");
      if (onRefreshState) onRefreshState();
      alert("Product deleted.");
    } catch (e) {
      console.error(e);
      alert("Error deleting product.");
    }
  };

  // Math Sizer calculations preview
  const sunHours = 4.8;
  const tariffRate = 35.0;
  const calculatedRoofArea = formRoofWidth * formRoofLength;
  const dailyKwhNeeded = formMonthlyUnits / 30;
  
  const minKw = systemSector === 'residential' ? 3.0 : 30.0;
  const maxKw = systemSector === 'residential' ? 30.0 : 500.0;
  const calculatedSystemSizekW = Number(Math.max(minKw, Math.min(maxKw, Math.round((dailyKwhNeeded / sunHours) * 1.25 * 10) / 10)).toFixed(1));

  const maxPanelsByRoof = Math.floor(calculatedRoofArea / 20);
  const maxKwByRoof = Number(((maxPanelsByRoof * 400) / 1000).toFixed(1));
  const isRoofConstrained = calculatedSystemSizekW > maxKwByRoof;
  const actualSystemSizekW = Math.max(minKw, Math.min(maxKw, isRoofConstrained ? maxKwByRoof : calculatedSystemSizekW));

  const isHighUnits = systemSector === 'residential'
    ? formMonthlyUnits > 3500
    : formMonthlyUnits > 60000;

  const actualPanelCount = Math.ceil((actualSystemSizekW * 1000) / 580);
  const inverterRec = `${inverterBrand} ${inverterCapacity} Inverter`;
  const monthlyGeneration = Math.round(actualSystemSizekW * sunHours * 30 * 0.82);
  const monthlySavingsAmt = Math.round(monthlyGeneration * tariffRate);
  
  const calculatedTotalCost = Math.round((actualSystemSizekW * 1550) + (actualSystemSizekW * 450) + 1200 + installationCharges + netMeteringCharges);
  const calculatedROI = Number(((monthlySavingsAmt * 12 / calculatedTotalCost) * 100).toFixed(1));
  const calculatedPayback = Number((calculatedTotalCost / (monthlySavingsAmt * 12)).toFixed(1));

  // Dynamic manual BOQ calculations
  const grandTotal = boqRows
    .filter(r => r && r.type === 'item')
    .reduce((sum, r) => sum + (r.total || 0), 0);
  const calculatedTaxAmount = taxEnabled ? Math.round(grandTotal * (taxRate / 100)) : 0;
  const netTotal = grandTotal + calculatedTaxAmount + (Number(societyCharges) || 0) - (Number(discount) || 0);

  // Format helper for PKR currency representation
  const formatPKR = (num: number) => {
    return "Rs. " + (num || 0).toLocaleString('en-PK');
  };

  // Filter products by search and category
  const filteredProducts = products.filter(p => {
    const matchesCat = p.category === selectedProductCategory;
    const matchesSearch = !productSearchQuery ? true : (
      (p.brand || "").toLowerCase().includes(productSearchQuery.toLowerCase()) ||
      (p.model || "").toLowerCase().includes(productSearchQuery.toLowerCase()) ||
      (p.name || "").toLowerCase().includes(productSearchQuery.toLowerCase())
    );
    return matchesCat && matchesSearch;
  });

  return (
    <div id="sales-team-workspace" className="space-y-6 text-xs text-slate-200">
      
      {/* Information Header Banner Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm">
        <div>
          <span className="text-[10px] text-amber-400 font-bold tracking-wider font-mono bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            SUNCHASER CRM &amp; GENERATIVE PROPOSAL DECK
          </span>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white font-sans mt-2">
            Quotation RESTUCTURE workspace
          </h2>
          <p className="text-slate-400 mt-1 text-xs">
            Calculate system offsets, compile custom spreadsheet bills of quantities, audit PDF template layouts, and inventory real Pakistan solar parts.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* SIDE BAR: CRM TARGET CLIENT SELECTION */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-md text-left">
          <div className="border-b border-slate-800 pb-2 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-slate-100 font-sans">Target Clients</h3>
              <span className="text-[10px] text-slate-500 font-sans">Active sales assignments.</span>
            </div>
            <span className="bg-slate-850 px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 font-bold">
              {leads.length}
            </span>
          </div>

          <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
            {leads.length > 0 ? (
              leads.map((lead) => {
                const isSelected = selectedLeadId === lead.id;
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => {
                      setSelectedLeadId(lead.id);
                      setEditingQuoteId(null);
                    }}
                    className={`w-full p-4 rounded-2xl border text-left cursor-pointer transition ${
                      isSelected
                        ? "bg-slate-950 border-amber-500/40 text-white shadow-lg"
                        : "bg-slate-950/70 border-slate-850 hover:bg-slate-800/50 text-slate-350"
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
                    <p className="text-[10px] font-mono text-slate-400 mb-2 truncate"><MapPin className="h-3 w-3 inline mr-1 text-amber-500" /> {lead.address || "Lahore, Pakistan"}</p>
                    
                    <div className="flex justify-between text-[9px] font-mono text-slate-500 pt-1.5 border-t border-slate-800/50">
                      <span>Units: {lead.monthlyUnits || Math.round(lead.monthlyBill / 35)} kWh</span>
                      <span className="text-amber-500 font-bold">Prob: {lead.conversionProbability || 50}%</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="text-center py-12 text-slate-500 font-mono">No target clients available.</div>
            )}
          </div>
        </div>

        {/* MAIN CONFIGURATION AREA */}
        <div className="lg:col-span-9 space-y-6">
          {activeLead ? (
            <div className="space-y-6">
              
              {/* Client Briefing Profile summary card */}
              <div className="bg-slate-900 border border-slate-850 p-5 rounded-3xl flex flex-col md:flex-row justify-between gap-4 text-left shadow-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white font-sans">{activeLead.name}</h3>
                    <span className="text-[10px] bg-slate-800 text-slate-400 font-mono px-2 py-0.5 rounded-full">
                      ID: {activeLead.id}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 mt-2.5 text-xs text-slate-400 font-mono">
                    <span className="truncate"><Mail className="h-3 w-3 inline mr-1 text-slate-500" /> {activeLead.email || "No Email"}</span>
                    <span><Phone className="h-3 w-3 inline mr-1 text-slate-500" /> {activeLead.phone}</span>
                    <span><MapPin className="h-3 w-3 inline mr-1 text-slate-500" /> {activeLead.location || "Lahore"}</span>
                    <span><ClipboardList className="h-3 w-3 inline mr-1 text-slate-500" /> Assigned: {activeLead.assignedSalesperson || "Unassigned"}</span>
                  </div>
                </div>

                <div className="flex gap-2 self-start md:self-center">
                  <button
                    type="button"
                    onClick={() => window.open(`${API_BASE_URL}/api/export/pdf/auto-sizer/${activeLead.id}`, "_blank")}
                    className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 font-sans font-bold px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 text-amber-500" /> Download Auto Sizer PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(`${API_BASE_URL}/api/export/pdf/manual-quote/${activeLead.id}`, "_blank")}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-sans font-bold px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer animate-pulse"
                  >
                    <Download className="h-3.5 w-3.5" /> Download Saved Quote PDF
                  </button>
                </div>
              </div>

              {/* MODULE SELECTOR ROUTING TAB BAR */}
              <div className="flex flex-wrap bg-slate-950 p-1.5 rounded-2xl border border-slate-850 gap-1.5">
                {[
                  { id: 'sizer', label: 'Auto Sizer', icon: Sparkles },
                  { id: 'boq_builder', label: 'Manual BOQ Builder', icon: FileSpreadsheet },
                  { id: 'templates', label: 'Quote Templates', icon: Layers },
                  { id: 'quotes', label: 'Generated Quotes', icon: FileText },
                  { id: 'products', label: 'Product Library', icon: Settings }
                ].map((mod) => {
                  const Icon = mod.icon;
                  const isCurrent = activeModule === mod.id;
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => setActiveModule(mod.id as any)}
                      className={`flex-1 min-w-[120px] py-2 px-3 rounded-xl font-sans font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        isCurrent
                          ? 'bg-amber-500 text-slate-950 shadow'
                          : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{mod.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Editing active banner notice */}
              {editingQuoteId && (
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 p-3 rounded-2xl flex justify-between items-center text-left">
                  <div>
                    <strong className="block font-bold">⚠️ EDITING MODE ACTIVE: Quote #{editingQuoteId}</strong>
                    <span className="text-[10px] font-mono">Any save or submit operations will overwrite this version instead of duplicating.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingQuoteId(null);
                      // reload defaults
                      applyPackage(10);
                    }}
                    className="bg-amber-500 text-slate-950 px-3 py-1 rounded-xl text-[10px] font-sans font-bold hover:bg-amber-400 cursor-pointer"
                  >
                    Cancel Edit
                  </button>
                </div>
              )}

              {/* MODULE 1: AUTO SIZER VIEW */}
              {activeModule === 'sizer' && (
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 text-left">
                  
                  {/* Left config form inputs */}
                  <div className="xl:col-span-7 bg-slate-900 border border-slate-850 p-5 md:p-6 rounded-3xl space-y-6">
                    
                    <div className="space-y-3.5">
                      <div className="flex items-center gap-1.5 border-b border-slate-800 pb-2">
                        <Upload className="h-4 w-4 text-amber-500" />
                        <h4 className="text-[10px] font-bold text-slate-100 uppercase tracking-wider font-mono">1. LESCO Bill Scanner &amp; Inputs</h4>
                      </div>

                      {/* OCR Scanner upload box */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-[10px] text-slate-400 uppercase font-mono font-bold block">LESCO Electric bill scan (OCR)</label>
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
                                    monthlyBill: 48000,
                                    monthlyUnits: 1370,
                                    location: activeLead ? activeLead.address.split(",").slice(-2).join(",").trim() || "Lahore, Pakistan" : "Lahore, Pakistan",
                                    width: 32,
                                    length: 28,
                                    area: 896,
                                    backupReq: "Essential Loads (Sunchaser Core 13.5kWh)",
                                    fileName: file.name
                                  };

                                  const detectedSector = parsed.monthlyUnits > 3500 ? 'commercial' : 'residential';
                                  setSystemSector(detectedSector);
                                  const rawSize = parsed.monthlyUnits / 30 / 4.8 * 1.25;
                                  const sectorMin = detectedSector === 'residential' ? 3.0 : 30.0;
                                  const sectorMax = detectedSector === 'residential' ? 30.0 : 500.0;
                                  const cappedSize = Number(Math.max(sectorMin, Math.min(sectorMax, rawSize)).toFixed(1));

                                  setBillParsedData(parsed);
                                  setFormMonthlyUnits(parsed.monthlyUnits);
                                  setFormLocation(parsed.location);
                                  setFormRoofWidth(parsed.width);
                                  setFormRoofLength(parsed.length);
                                  setBillLoading(false);

                                  // Sync values
                                  setSystemSizekW(cappedSize);
                                }, 1500);
                              }}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                              disabled={billLoading}
                            />
                            {billLoading ? (
                              <div className="py-2 flex flex-col items-center justify-center gap-1.5">
                                <Loader2 className="h-6 w-6 text-amber-400 animate-spin" />
                                <span className="text-[10px] text-slate-400">Scanning meter rates & history...</span>
                              </div>
                            ) : billParsedData ? (
                              <div className="py-1 flex flex-col items-center justify-center">
                                <CheckCircle2 className="h-6 w-6 text-emerald-400 animate-bounce" />
                                <span className="text-[10px] text-slate-100 font-bold mt-0.5">OCR Scan Completed</span>
                                <span className="text-[9px] text-slate-400 truncate max-w-[160px]">{billFile?.name}</span>
                              </div>
                            ) : (
                              <div className="py-2 flex flex-col items-center justify-center gap-1">
                                <Upload className="h-5 w-5 text-slate-500 group-hover:text-amber-500 transition" />
                                <span className="text-[10px] text-slate-300 block">Drag bill PDF or click here</span>
                                <span className="text-[8px] text-slate-500 font-mono block font-sans">Max file size 5MB</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 uppercase font-mono font-bold block">Sector Type</label>
                            <select
                              value={systemSector}
                              onChange={(e) => setSystemSector(e.target.value as any)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white cursor-pointer focus:outline-none focus:border-amber-500"
                            >
                              <option value="residential">Residential (3.0kW - 30.0kW)</option>
                              <option value="commercial">Commercial (30.0kW - 500.0kW)</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 uppercase font-mono font-bold block">Monthly Units (kWh)</label>
                            <input
                              type="number"
                              value={formMonthlyUnits}
                              onChange={(e) => setFormMonthlyUnits(Number(e.target.value))}
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 uppercase font-mono font-bold block">Roof Space (W x L ft)</label>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              value={formRoofWidth}
                              onChange={(e) => setFormRoofWidth(Number(e.target.value))}
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                            />
                            <span className="text-slate-500 self-center">×</span>
                            <input
                              type="number"
                              value={formRoofLength}
                              onChange={(e) => setFormRoofLength(Number(e.target.value))}
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 uppercase font-mono font-bold block">Backup battery Pack</label>
                          <select
                            value={formBackupReq}
                            onChange={(e) => setFormBackupReq(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white cursor-pointer focus:outline-none"
                          >
                            <option value="None">None (Standard Grid-tied)</option>
                            <option value="Essential Loads (Sunchaser Core 13.5kWh)">Essential Loads (1x Sunchaser Core 13.5kWh)</option>
                            <option value="Whole Home Backup (2x Sunchaser Core 27kWh)">Whole Home Backup (2x Sunchaser Core 27kWh)</option>
                            <option value="Off-Grid Prep (3x Sunchaser Core 40.5kWh)">Off-Grid Prep (3x Sunchaser Core 40.5kWh)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* QUICK PACKAGE BUILDER */}
                    <div className="space-y-3.5 pt-3 border-t border-slate-800">
                      <div className="flex items-center gap-1.5">
                        <Tag className="h-4 w-4 text-amber-500" />
                        <h4 className="text-[10px] font-bold text-slate-100 uppercase tracking-wider font-mono">2. Quick Solar Packages (Pakistan Standards)</h4>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {[3, 5, 7, 10, 12, 15, 20, 25, 30, 50, 100].map((kw) => (
                          <button
                            key={kw}
                            type="button"
                            onClick={() => applyPackage(kw)}
                            className="bg-slate-950 hover:bg-slate-800 hover:text-amber-400 border border-slate-800 hover:border-amber-500/30 text-white font-mono py-2 rounded-xl text-xs font-bold transition duration-200 cursor-pointer"
                          >
                            {kw}kW
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* SIZER ACTIONS AND VALIDATIONS */}
                    <div className="space-y-4 pt-3 border-t border-slate-800">
                      {isHighUnits && (
                        <div className="bg-amber-950/40 border border-amber-900/50 rounded-2xl p-4 space-y-3 text-left">
                          <div className="flex items-start gap-2.5">
                            <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                            <div className="space-y-1 text-xs">
                              <h5 className="font-extrabold text-amber-400">High Consumption Warning</h5>
                              <p className="text-slate-300 font-sans leading-relaxed">
                                Monthly units entered ({formMonthlyUnits.toLocaleString()} kWh/mo) are exceptionally high for the {systemSector} sector.
                                Please verify if this consumption is correct.
                              </p>
                            </div>
                          </div>
                          <label className="flex items-center gap-2 cursor-pointer select-none border-t border-amber-900/40 pt-2.5">
                            <input
                              type="checkbox"
                              checked={confirmHighUnits}
                              onChange={(e) => setConfirmHighUnits(e.target.checked)}
                              className="rounded border-amber-900 text-amber-500 focus:ring-amber-500 bg-slate-950 h-4 w-4"
                            />
                            <span className="text-[11px] text-amber-400 font-bold font-sans">I confirm this high usage is correct</span>
                          </label>
                        </div>
                      )}

                      {submitError && (
                        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 p-3.5 rounded-2xl text-[11px] font-sans font-bold">
                          ❌ Error: {submitError}
                        </div>
                      )}

                      {quoteCreatedConfirm && (
                        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-3.5 rounded-2xl text-[11px] font-sans font-bold flex flex-col gap-1.5 leading-snug">
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 animate-bounce" />
                            <span>Solar proposal compiled &amp; synced! PDF created successfully.</span>
                          </div>
                        </div>
                      )}

                      <button
                        type="button"
                        disabled={savingQuote || (isHighUnits && !confirmHighUnits)}
                        onClick={async () => {
                          if (savingQuote) return;
                          
                          // 1. Sync sizer settings to lead
                          try {
                            await onUpdateLead(activeLead.id, {
                              monthlyUnits: formMonthlyUnits,
                              location: formLocation,
                              roofSpace: calculatedRoofArea,
                              backupRequirement: formBackupReq,
                              monthlyBill: Math.round(formMonthlyUnits * tariffRate)
                            });
                            
                            // 2. Compile proposal quote
                            await handleSaveQuote();
                          } catch (e: any) {
                            console.error(e);
                            setSubmitError(e.message || "Failed to sync sizer.");
                          }
                        }}
                        className={`w-full font-sans font-extrabold text-sm py-3 px-4 rounded-xl shadow cursor-pointer transition flex items-center justify-center gap-2 ${
                          (savingQuote || (isHighUnits && !confirmHighUnits))
                            ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-750"
                            : "bg-amber-500 hover:bg-amber-400 text-slate-950"
                        }`}
                      >
                        {savingQuote ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin text-slate-550" />
                            <span>Compiling Sunchaser Proposal...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Compile &amp; Save Sizer Quotation</span>
                          </>
                        )}
                      </button>
                    </div>

                  </div>

                  {/* Right Column: Calculations Preview & AI briefing */}
                  <div className="xl:col-span-5 space-y-6">
                    
                    {/* Technical values preview */}
                    <div className="bg-slate-950 border border-slate-850 p-5 rounded-3xl space-y-4">
                      <div className="flex justify-between items-center border-b border-slate-900 pb-2">
                        <div className="flex items-center gap-1.5">
                          <Zap className="h-4 w-4 text-emerald-400" />
                          <h4 className="text-[10px] font-bold text-slate-100 uppercase tracking-wider font-mono">Sizing Calculation Preview</h4>
                        </div>
                        <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[8px] font-mono font-bold">
                          calculated
                        </span>
                      </div>

                      {isRoofConstrained && (
                        <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-3 text-[10px] text-amber-300 leading-relaxed">
                          ⚠️ <strong>Space Constrained:</strong> Consumption requires {calculatedSystemSizekW}kW but roof area limits panel array layout to <strong>{actualSystemSizekW}kW</strong> ({actualPanelCount} panels).
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                        <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-850">
                          <span className="text-[8px] text-slate-500 uppercase block">Offset Requirement</span>
                          <span className="text-xs font-bold text-white block mt-0.5">{actualSystemSizekW} kW Array</span>
                        </div>
                        <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-850">
                          <span className="text-[8px] text-slate-500 uppercase block">Solar Panel Count</span>
                          <span className="text-xs font-bold text-slate-200 block mt-0.5">{actualPanelCount}x (580W panels)</span>
                        </div>
                        <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-850 col-span-2">
                          <span className="text-[8px] text-slate-500 uppercase block">Inverter Specification</span>
                          <span className="text-[11px] font-bold text-slate-300 block mt-0.5">{inverterRec}</span>
                        </div>
                        <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-850 col-span-2">
                          <span className="text-[8px] text-slate-500 uppercase block">Storage Battery Option</span>
                          <span className="text-[11px] font-bold text-slate-300 block mt-0.5">
                            {formBackupReq.includes("None") ? "On-Grid (No Battery Backup)" : formBackupReq}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-center pt-1 font-mono text-[11px]">
                        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-850/60">
                          <span className="text-[8px] text-slate-500 uppercase block">Monthly Generation</span>
                          <span className="text-white font-bold block mt-0.5">{monthlyGeneration.toLocaleString()} kWh</span>
                        </div>
                        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-850/60">
                          <span className="text-[8px] text-slate-500 uppercase block">Savings Estimate</span>
                          <span className="text-emerald-400 font-bold block mt-0.5">{formatPKR(monthlySavingsAmt)}/mo</span>
                        </div>
                        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-850/60">
                          <span className="text-[8px] text-slate-500 uppercase block">Estimated ROI</span>
                          <span className="text-amber-500 font-bold block mt-0.5">{calculatedROI}% /yr</span>
                        </div>
                        <div className="bg-slate-900/50 p-2 rounded-xl border border-slate-850/60">
                          <span className="text-[8px] text-slate-500 uppercase block">Payback Duration</span>
                          <span className="text-sky-400 font-bold block mt-0.5">{calculatedPayback} Years</span>
                        </div>
                      </div>

                    </div>

                    {/* Gemini report card block */}
                    <div className="bg-slate-905 bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
                      <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-1.5">
                          <Bot className="h-4 w-4 text-amber-500" />
                          <h4 className="text-xs font-bold text-slate-200 font-sans">Gemini Technical Audit Briefing</h4>
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
                            } catch (e: any) {
                              setAiReportMarkdown("### AI Technical Sizing Checklist\nFailed to sync sizing recommendation report.");
                            } finally {
                              setAiReportLoading(false);
                            }
                          }}
                          className="bg-slate-950 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/30 text-slate-300 text-[10px] font-sans font-bold px-2 py-1 rounded-lg cursor-pointer flex items-center gap-1 transition"
                        >
                          {aiReportLoading ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                              <span>Analyzing...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-3 w-3 text-amber-500" />
                              <span>Audit Sizing</span>
                            </>
                          )}
                        </button>
                      </div>

                      {aiReportMarkdown ? (
                        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850 text-slate-350 text-[10px] leading-relaxed max-h-[220px] overflow-y-auto font-sans text-left">
                          <div className="whitespace-pre-wrap">{aiReportMarkdown}</div>
                        </div>
                      ) : (
                        <p className="text-slate-500 text-[10px] text-center py-6 font-mono">
                          Click "Audit Sizing" to generate deep structural feasibility details.
                        </p>
                      )}
                    </div>

                  </div>

                </div>
              )}

              {/* MODULE 2: MANUAL BOQ BUILDER */}
              {activeModule === 'boq_builder' && (
                <div className="bg-slate-900 border border-slate-850 p-5 md:p-6 rounded-3xl space-y-6 text-left">
                  
                  {/* Action Bar */}
                  <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-800 pb-4">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => addBoqRow('item')}
                        className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-bold px-3 py-1.5 rounded-xl cursor-pointer flex items-center gap-1"
                      >
                        <Plus className="h-3.5 w-3.5 text-amber-500" /> Add Item
                      </button>
                      <button
                        type="button"
                        onClick={() => addBoqRow('heading')}
                        className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-bold px-3 py-1.5 rounded-xl cursor-pointer flex items-center gap-1"
                      >
                        <Plus className="h-3.5 w-3.5 text-blue-400" /> Add Heading
                      </button>
                      <button
                        type="button"
                        onClick={() => addBoqRow('subtotal')}
                        className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-bold px-3 py-1.5 rounded-xl cursor-pointer flex items-center gap-1"
                      >
                        <Plus className="h-3.5 w-3.5 text-emerald-400" /> Add Subtotal
                      </button>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            if (window.confirm(`Overwrite BOQ rows with calculated ${e.target.value}kW package layout?`)) {
                              applyPackage(Number(e.target.value));
                            }
                            e.target.value = "";
                          }
                        }}
                        className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-xl cursor-pointer font-sans"
                      >
                        <option value="">🎁 Load Package...</option>
                        <option value="3">3 kW Package</option>
                        <option value="5">5 kW Package</option>
                        <option value="7">7 kW Package</option>
                        <option value="10">10 kW Package</option>
                        <option value="12">12 kW Package</option>
                        <option value="15">15 kW Package</option>
                        <option value="20">20 kW Package</option>
                        <option value="25">25 kW Package</option>
                        <option value="30">30 kW Package</option>
                        <option value="50">50 kW Package</option>
                        <option value="100">100 kW Package</option>
                      </select>

                      <button
                        type="button"
                        onClick={handleCopyAutoSizerToManualBoq}
                        className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs px-3 py-1.5 rounded-xl cursor-pointer flex items-center gap-1 font-sans"
                        title="Copy latest auto sizer quote rows to this manual builder"
                      >
                        📋 Copy Auto Sizer
                      </button>

                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            const q = activeLead?.quotes?.find((quote: any) => quote.id === e.target.value);
                            if (q) {
                              if (window.confirm(`Load saved quote ${q.id} into Manual BOQ builder? This will overwrite current rows.`)) {
                                handleLoadQuoteForEditing(q);
                              }
                            }
                            e.target.value = "";
                          }
                        }}
                        className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-xl cursor-pointer font-sans"
                      >
                        <option value="">📂 Load Saved Quote...</option>
                        {(activeLead?.quotes || []).map((q: any) => (
                          <option key={q.id} value={q.id}>
                            Quote {q.id} ({q.quote_type === 'auto_sizer' ? 'Auto Sizer' : 'Manual BOQ'} - {q.systemSizekW}kW)
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("Overwrite BOQ rows with calculated sizer default layout?")) {
                            applyPackage(systemSizekW || 10);
                          }
                        }}
                        className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white text-xs px-3 py-1.5 rounded-xl cursor-pointer font-sans"
                      >
                        Reset to Defaults
                      </button>
                    </div>
                  </div>

                  {/* Excel Spreadsheet Table */}
                  <div className="overflow-x-auto border border-slate-800 rounded-2xl bg-slate-950/60 max-h-[500px]">
                    {boqRows.length === 0 ? (
                      <div className="text-center py-12 text-slate-500 font-mono">
                        No rows found. Add items or click reset.
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse text-[10px] font-mono">
                        <thead>
                          <tr className="bg-slate-950 text-slate-450 border-b border-slate-800 text-[9px] uppercase font-bold tracking-wider">
                            <th className="py-2.5 px-2 text-center w-8">Sr</th>
                            <th className="py-2.5 px-1.5 w-16">Type</th>
                            <th className="py-2.5 px-2 w-72">Item Name & Specs</th>
                            <th className="py-2.5 px-2 w-20">Brand</th>
                            <th className="py-2.5 px-1.5 w-12 text-center">Unit</th>
                            <th className="py-2.5 px-1.5 w-12 text-center">Qty</th>
                            <th className="py-2.5 px-2 w-28 text-right">Rate</th>
                            <th className="py-2.5 px-2 w-28 text-right">Total</th>
                            <th className="py-2.5 px-2 text-center w-28">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 text-slate-300">
                          {boqRows.map((row, idx) => {
                            const isHeading = row.type === 'heading';
                            const isSubtotal = row.type === 'subtotal';
                            return (
                              <tr key={row.id} className={`hover:bg-slate-900/25 ${isHeading ? 'bg-slate-900/40 font-bold' : isSubtotal ? 'bg-slate-900/10 font-bold' : ''}`}>
                                {isHeading ? (
                                  <td colSpan={3} className="py-2 px-2">
                                    <input
                                      type="text"
                                      value={row.name}
                                      onChange={(e) => handleCellChange(idx, 'name', e.target.value)}
                                      className="w-full bg-transparent focus:bg-slate-950 focus:ring-1 focus:ring-amber-500 rounded px-1.5 py-0.5 border-0 focus:outline-none font-sans text-amber-400 font-bold text-xs uppercase"
                                      placeholder="Section Heading Label..."
                                    />
                                  </td>
                                ) : isSubtotal ? (
                                  <td colSpan={3} className="py-2 px-2">
                                    <input
                                      type="text"
                                      value={row.name}
                                      onChange={(e) => handleCellChange(idx, 'name', e.target.value)}
                                      className="w-full bg-transparent focus:bg-slate-950 focus:ring-1 focus:ring-amber-500 rounded px-1.5 py-0.5 border-0 focus:outline-none font-sans text-slate-200 font-bold text-xs"
                                      placeholder="Subtotal Label..."
                                    />
                                  </td>
                                ) : (
                                  <>
                                    <td className="py-2 text-center text-slate-500">{row.srNo || '-'}</td>
                                    <td className="py-2 px-1.5">
                                      <select
                                        value={row.type}
                                        onChange={(e) => handleCellChange(idx, 'type', e.target.value)}
                                        className="bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[9px] text-slate-350"
                                      >
                                        <option value="item">Item</option>
                                        <option value="heading">Heading</option>
                                        <option value="subtotal">Subtotal</option>
                                      </select>
                                    </td>
                                    <td className="py-2 px-2 space-y-1.5">
                                      <select
                                        onChange={(e) => {
                                          if (e.target.value !== "") {
                                            handleLoadFromLibrary(idx, e.target.value);
                                            e.target.value = "";
                                          }
                                        }}
                                        className="w-full bg-slate-950 border border-slate-850 rounded px-1.5 py-0.5 text-[9px] text-slate-400 font-sans cursor-pointer"
                                      >
                                        <option value="">-- Catalog Quick-fill --</option>
                                        {products.map((lib: any) => (
                                          <option key={lib.id} value={lib.id}>{lib.category} - {lib.brand} {lib.model}</option>
                                        ))}
                                      </select>
                                      <input
                                        type="text"
                                        value={row.name}
                                        onChange={(e) => handleCellChange(idx, 'name', e.target.value)}
                                        className="w-full bg-transparent focus:bg-slate-950 focus:ring-1 focus:ring-amber-500 rounded px-1.5 py-0.5 border-0 focus:outline-none font-sans text-white text-xs font-semibold"
                                        placeholder="Item Name"
                                      />
                                      <textarea
                                        value={row.description}
                                        rows={1}
                                        onChange={(e) => handleCellChange(idx, 'description', e.target.value)}
                                        className="w-full bg-transparent focus:bg-slate-950 focus:ring-1 focus:ring-amber-500 rounded px-1.5 py-0.5 border-0 focus:outline-none text-[9px] text-slate-400 font-sans"
                                        placeholder="Item Specifications..."
                                      />
                                    </td>
                                  </>
                                )}

                                {isHeading || isSubtotal ? (
                                  <td colSpan={4} className="py-2 px-2 text-right text-slate-100 font-bold text-xs">
                                    {isSubtotal && formatPKR(row.total || 0)}
                                  </td>
                                ) : (
                                  <>
                                    <td className="py-2 px-2">
                                      <input
                                        type="text"
                                        value={row.brand}
                                        onChange={(e) => handleCellChange(idx, 'brand', e.target.value)}
                                        className="w-full bg-transparent focus:bg-slate-950 focus:ring-1 focus:ring-amber-500 rounded px-1.5 py-0.5 border-0 focus:outline-none text-xs text-slate-300 font-sans"
                                        placeholder="Brand"
                                      />
                                    </td>
                                    <td className="py-2 px-1.5">
                                      <input
                                        type="text"
                                        value={row.unit}
                                        onChange={(e) => handleCellChange(idx, 'unit', e.target.value)}
                                        className="w-full bg-transparent focus:bg-slate-950 focus:ring-1 focus:ring-amber-500 rounded px-1 py-0.5 border-0 focus:outline-none text-xs text-center text-slate-400 font-sans"
                                        placeholder="Pcs"
                                      />
                                    </td>
                                    <td className="py-2 px-1.5">
                                      <input
                                        type="number"
                                        value={row.qty}
                                        onChange={(e) => handleCellChange(idx, 'qty', Number(e.target.value))}
                                        className="w-full bg-transparent focus:bg-slate-950 focus:ring-1 focus:ring-amber-500 rounded px-1 py-0.5 border-0 focus:outline-none text-xs text-center text-white"
                                      />
                                    </td>
                                    <td className="py-2 px-2 text-right">
                                      <input
                                        type="number"
                                        value={row.rate}
                                        onChange={(e) => handleCellChange(idx, 'rate', Number(e.target.value))}
                                        className="w-full bg-transparent focus:bg-slate-950 focus:ring-1 focus:ring-amber-500 rounded px-1.5 py-0.5 border-0 focus:outline-none text-xs text-right text-emerald-400 font-bold"
                                      />
                                    </td>
                                    <td className="py-2 px-2 text-right text-xs font-bold text-white">
                                      {formatPKR(row.total || 0)}
                                    </td>
                                  </>
                                )}

                                <td className="py-2 px-2 text-center space-x-1 whitespace-nowrap">
                                  <button type="button" onClick={() => moveBoqRow(idx, 'up')} className="bg-slate-900 border border-slate-800 p-1 rounded hover:text-amber-400 cursor-pointer inline-flex"><ArrowUp className="h-3 w-3" /></button>
                                  <button type="button" onClick={() => moveBoqRow(idx, 'down')} className="bg-slate-900 border border-slate-800 p-1 rounded hover:text-amber-400 cursor-pointer inline-flex"><ArrowDown className="h-3 w-3" /></button>
                                  <button type="button" onClick={() => duplicateBoqRow(idx)} className="bg-slate-900 border border-slate-800 p-1 rounded hover:text-amber-400 cursor-pointer inline-flex"><Copy className="h-3 w-3" /></button>
                                  <button type="button" onClick={() => deleteBoqRow(idx)} className="bg-slate-900 border border-slate-800 p-1 rounded hover:text-rose-400 cursor-pointer inline-flex"><Trash2 className="h-3 w-3" /></button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Financial Receipt Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                    
                    {/* Columns left - details inputs */}
                    <div className="md:col-span-7 space-y-4">
                      
                      {/* Structure and notes settings */}
                      <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl grid grid-cols-2 gap-3 text-left">
                        <div className="col-span-2 border-b border-slate-900 pb-1 flex justify-between items-center">
                          <label className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Mounting Frame Settings</label>
                        </div>
                        <div className="col-span-2">
                          <select 
                            value={selectedStructure} 
                            onChange={(e) => {
                              const val = e.target.value as any;
                              setSelectedStructure(val);
                              if (val === 'custom') setStructureType('Custom');
                              else setStructureType(val.charAt(0).toUpperCase() + val.slice(1));
                            }} 
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white cursor-pointer"
                          >
                            <option value="standard">Standard A-Frame (Roof Mount)</option>
                            <option value="elevated">Elevated Steel Frame (10ft clearance)</option>
                            <option value="girder">Mughal Girder Heavy Duty Structure</option>
                            <option value="custom">-- Custom Structural Design Spec --</option>
                          </select>
                        </div>

                        {selectedStructure === 'custom' && (
                          <div className="col-span-2 space-y-3 pt-2">
                            <div className="space-y-1">
                              <label className="text-slate-400">Custom Structure Name</label>
                              <input type="text" value={customStructName} onChange={(e) => setCustomStructName(e.target.value)} placeholder="e.g. Custom Double-Pitched Ground Mount" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-slate-400">English Specifications Description</label>
                              <textarea rows={2} value={customStructDescEn} onChange={(e) => setCustomStructDescEn(e.target.value)} placeholder="Premium custom structure columns 4x4inch, wind resistant..." className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-200" />
                            </div>
                            <div className="space-y-1 text-right">
                              <label className="text-slate-400 block">Urdu Specifications Description (اردو تفصیل)</label>
                              <textarea rows={2} value={customStructDescUr} onChange={(e) => setCustomStructDescUr(e.target.value)} placeholder="پریمیم کسٹم ڈیزائن ماونٹنگ سٹرکچر..." className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 text-right" />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <label className="text-slate-400">Default Rate (Rs)</label>
                                <input type="number" value={customStructRate} onChange={(e) => setCustomStructRate(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white" />
                              </div>
                              <div className="space-y-1">
                                <label className="text-slate-400">Weight (kg / span)</label>
                                <input type="text" value={customStructWeight} onChange={(e) => setCustomStructWeight(e.target.value)} placeholder="e.g. 450 kg" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white" />
                              </div>
                              <div className="space-y-1">
                                <label className="text-slate-400">Material Type</label>
                                <input type="text" value={customStructMaterial} onChange={(e) => setProductFormDesc(e.target.value)} placeholder="e.g. Hot-Dip Galvanized" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white" />
                              </div>
                              <div className="space-y-1">
                                <label className="text-slate-400">Warranty / Wind</label>
                                <input type="text" value={customStructWarranty} onChange={(e) => setCustomStructWarranty(e.target.value)} placeholder="e.g. 10 Years / 140km/h" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white" />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* LESCO settings inputs */}
                      <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl grid grid-cols-2 gap-3 text-left">
                        <span className="col-span-2 border-b border-slate-900 pb-1 text-[10px] font-bold text-amber-500 uppercase tracking-wider block">LESCO connection Parameters</span>
                        <div className="space-y-1">
                          <label className="text-slate-450 block">Meter Number</label>
                          <input type="text" value={lescoMeterNo} onChange={(e) => setLescoMeterNo(e.target.value)} placeholder="e.g. 15-11524-123456" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-450 block">Consumer Number</label>
                          <input type="text" value={lescoConsumerNo} onChange={(e) => setLescoConsumerNo(e.target.value)} placeholder="e.g. 12-11524-1234567 U" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-450 block">Sanctioned Load</label>
                          <input type="text" value={lescoSanctionedLoad} onChange={(e) => setLescoSanctionedLoad(e.target.value)} placeholder="e.g. 15 kW" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-450 block">Phase Type</label>
                          <select value={lescoPhaseType} onChange={(e) => setLescoPhaseType(e.target.value as any)} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white cursor-pointer focus:outline-none">
                            <option value="Three Phase">Three Phase</option>
                            <option value="Single Phase">Single Phase</option>
                          </select>
                        </div>
                      </div>

                      <div className="space-y-1 text-left">
                        <label className="text-slate-400 block font-bold">Special Custom Notes (Appears on BOQ page)</label>
                        <textarea 
                          rows={2} 
                          value={customNotes} 
                          placeholder="e.g. Earthing wire route length custom calculations..."
                          onChange={(e) => setCustomNotes(e.target.value)} 
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-300" 
                        />
                      </div>
                    </div>

                    {/* Columns right - receipt calculations and submit */}
                    <div className="md:col-span-5 space-y-4">
                      
                      {/* Financial totals breakdown */}
                      <div className="bg-slate-950 border border-slate-850 p-5 rounded-3xl space-y-4 text-xs font-mono">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-bold">Turnkey Contract Investment</span>
                        
                        <div className="space-y-2 border-b border-slate-900 pb-3">
                          <div className="flex justify-between text-slate-450">
                            <span>Gross BOQ Subtotal:</span>
                            <span className="text-slate-200">{formatPKR(grandTotal)}</span>
                          </div>
                          
                          {/* Tax input */}
                          <div className="space-y-1.5 pt-1">
                            <div className="flex justify-between items-center text-slate-450">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={taxEnabled}
                                  onChange={(e) => setTaxEnabled(e.target.checked)}
                                  className="w-3.5 h-3.5 text-amber-500 rounded bg-slate-900 border-slate-800 focus:ring-0 cursor-pointer"
                                />
                                <span>Apply Sales Tax:</span>
                              </label>
                              {taxEnabled ? (
                                <span className="text-amber-550 font-bold text-amber-500">{formatPKR(calculatedTaxAmount)}</span>
                              ) : (
                                <span className="text-slate-600">Disabled</span>
                              )}
                            </div>
                            {taxEnabled && (
                              <div className="flex items-center gap-2 pl-5">
                                <span className="text-[10px] text-slate-500">Tax Rate (%):</span>
                                <input
                                  type="number"
                                  value={taxRate}
                                  onChange={(e) => setTaxRate(Number(e.target.value))}
                                  className="w-16 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-center text-xs text-white"
                                />
                              </div>
                            )}
                          </div>

                          <div className="flex justify-between items-center text-slate-450">
                            <span>Society Charges (Rs):</span>
                            <input
                              type="number"
                              value={societyCharges}
                              onChange={(e) => setSocietyCharges(Number(e.target.value))}
                              className="w-28 bg-slate-900 border border-slate-800 rounded text-right px-1.5 py-0.5 text-xs text-white"
                            />
                          </div>

                          <div className="flex justify-between items-center text-slate-450">
                            <span>Promo Discount (Rs):</span>
                            <input
                              type="number"
                              value={discount}
                              onChange={(e) => setDiscount(Number(e.target.value))}
                              className="w-28 bg-slate-900 border border-slate-800 rounded text-right px-1.5 py-0.5 text-xs text-emerald-400 font-bold"
                            />
                          </div>
                        </div>

                        <div className="flex justify-between text-sm font-extrabold border-t border-slate-900 pt-2.5">
                          <span className="text-white font-sans">NET INVESTMENT:</span>
                          <span className="text-amber-500 text-[15px]">{formatPKR(netTotal)}</span>
                        </div>
                      </div>

                      {/* Select Quote Template */}
                      <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-2.5 text-left">
                        <span className="text-[10px] font-bold text-amber-550 text-amber-500 uppercase tracking-wider block border-b border-slate-900 pb-1.5 font-sans">
                          Select Quote Template
                        </span>
                        <select
                          value={selectedTemplateId}
                          onChange={(e) => setSelectedTemplateId(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500 font-sans"
                        >
                          {quoteTemplates && quoteTemplates.map((t: any) => (
                            <option key={t.id} value={t.id}>{t.name || t.id}</option>
                          ))}
                          {(!quoteTemplates || quoteTemplates.length === 0) && (
                            <option value="tmpl-1">Sunchaser Official Proposal Template</option>
                          )}
                        </select>

                        {/* Include Auto Sizer Items Checkbox */}
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="checkbox"
                            id="includeSizerItemsCheckbox"
                            checked={includeSizerItems}
                            onChange={(e) => setIncludeSizerItems(e.target.checked)}
                            className="rounded border-slate-800 bg-slate-900 text-amber-550 text-amber-500 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                          />
                          <label htmlFor="includeSizerItemsCheckbox" className="text-xs text-slate-400 select-none cursor-pointer font-sans">
                            Include Auto Sizer Items in Manual BOQ
                          </label>
                        </div>
                      </div>

                      {/* PDF page selector checklist */}
                      <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
                        <span className="text-[10px] font-bold text-amber-550 text-amber-500 uppercase tracking-wider block border-b border-slate-900 pb-1.5">
                          PDF Page Inclusion checklist
                        </span>
                        <div className="grid grid-cols-2 gap-2 text-left text-xs font-sans text-slate-400">
                          {Object.entries({
                            cover: "Cover Page",
                            profile: "Group Profile",
                            qr: "Benefits QR Page",
                            ceo: "CEO Assurances",
                            structure: "Structure Config",
                            boq: "BOQ Price Sheet",
                            terms: "Terms & Conditions",
                            signoff: "Verification Sign",
                            bank: "Official Banks",
                            final: "Final Closing"
                          }).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-1.5 cursor-pointer hover:text-white select-none">
                              <input
                                type="checkbox"
                                checked={includedPages[key]}
                                onChange={(e) => setIncludedPages(prev => ({ ...prev, [key]: e.target.checked }))}
                                className="rounded border-slate-800 text-amber-500 focus:ring-amber-500 bg-slate-950 h-3.5 w-3.5"
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Save BOQ trigger */}
                      <div className="space-y-3">
                        {submitError && (
                          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 p-3 text-xs font-bold rounded-xl text-left">
                            ❌ {submitError}
                          </div>
                        )}

                        {quoteCreatedConfirm && (
                          <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-3 text-xs font-bold rounded-xl text-left flex items-center gap-1">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 animate-bounce" />
                            <span>Quotation successfully compiled &amp; saved!</span>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => handleSaveQuote()}
                          disabled={savingQuote}
                          className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-sans font-extrabold py-3 px-4 rounded-xl shadow cursor-pointer transition flex items-center justify-center gap-2 text-sm"
                        >
                          {savingQuote ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin text-slate-650" />
                              <span>Saving BOQ Quote Version...</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-4 w-4" />
                              <span>{editingQuoteId ? 'Update Edited Quote' : 'Save & Compile BOQ Quote'}</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handlePreviewProposalDeck()}
                          disabled={loadingPreview}
                          className="w-full bg-slate-950 hover:bg-slate-800 text-slate-200 font-sans font-extrabold py-3 px-4 rounded-xl shadow cursor-pointer transition flex items-center justify-center gap-2 text-sm border border-slate-850 mt-3"
                        >
                          {loadingPreview ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                              <span>Compiling Live Preview...</span>
                            </>
                          ) : (
                            <>
                              <Eye className="h-4 w-4 text-amber-500" />
                              <span>Preview Proposal Deck Layout</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDownloadManualQuotePDF()}
                          className="w-full bg-slate-800 hover:bg-slate-700 text-amber-500 font-sans font-extrabold py-3 px-4 rounded-xl shadow cursor-pointer transition flex items-center justify-center gap-2 text-sm border border-slate-700 mt-3"
                        >
                          <Download className="h-4 w-4" />
                          <span>Download Manual BOQ Quote PDF</span>
                        </button>
                      </div>

                    </div>

                  </div>

                </div>
              )}

              {/* MODULE 3: QUOTE TEMPLATES */}
              {activeModule === 'templates' && (
                <div className="bg-slate-900 border border-slate-850 p-5 md:p-6 rounded-3xl space-y-6 text-left">
                  <div className="border-b border-slate-800 pb-2">
                    <h3 className="text-sm font-bold text-slate-100 font-sans">Visual Proposal Template Pages</h3>
                    <span className="text-[10px] text-slate-500 font-sans">Reorder pages, configure text bodies, and upload base64 asset files.</span>
                  </div>

                  {/* Global Header & Footer Settings Card (BUG 5) */}
                  <div className="bg-slate-950 border border-slate-850 p-5 rounded-2xl space-y-4">
                    <div className="border-b border-slate-900 pb-2 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <div>
                        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-sans">Global PDF Header & Footer Settings</h4>
                        <p className="text-[9px] text-slate-500 font-sans">These settings apply to all proposal pages unless explicitly overridden at the page level.</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleSaveGlobalPdfSettings}
                        className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-3 py-1.5 text-xs rounded-lg transition shrink-0"
                      >
                        Save Global Settings
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {/* Global Header */}
                      <div className="space-y-3 bg-slate-900/50 p-3 rounded-xl border border-slate-900">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] uppercase font-mono text-amber-500 font-bold">Global Header</label>
                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-slate-400">
                            <input
                              type="checkbox"
                              checked={globalHeaderEnabled}
                              onChange={(e) => setGlobalHeaderEnabled(e.target.checked)}
                              className="rounded border-slate-800 text-amber-500 bg-slate-900 h-3.5 w-3.5 focus:ring-0"
                            />
                            <span>Enabled</span>
                          </label>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[9px] uppercase font-mono text-slate-500 font-bold block">Header Company Name Text</label>
                          <input
                            type="text"
                            value={globalHeaderText}
                            onChange={(e) => setGlobalHeaderText(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1 text-xs text-white"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <label className="text-[9px] uppercase font-mono text-slate-500 font-bold block">Logo Alignment</label>
                            <select
                              value={globalHeaderAlignment}
                              onChange={(e) => setGlobalHeaderAlignment(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1 text-xs text-white"
                            >
                              <option value="left">Left</option>
                              <option value="center">Center</option>
                              <option value="right">Right</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] uppercase font-mono text-slate-500 font-bold block">Line Color</label>
                            <input
                              type="text"
                              value={globalHeaderLineColor}
                              onChange={(e) => setGlobalHeaderLineColor(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1 text-xs text-white font-mono"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[9px] uppercase font-mono text-slate-500 font-bold block">Logo Max Height</label>
                          <input
                            type="text"
                            value={globalHeaderLogoSize}
                            onChange={(e) => setGlobalHeaderLogoSize(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1 text-xs text-white font-mono"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[9px] uppercase font-mono text-slate-500 font-bold block">Global Header Logo Image</label>
                          {globalHeaderLogoUrl ? (
                            <div className="relative group rounded-lg overflow-hidden border border-slate-800 h-10 bg-slate-950 flex items-center justify-center">
                              <img src={globalHeaderLogoUrl} style={{ maxHeight: globalHeaderLogoSize }} className="object-contain" alt="global logo preview" />
                              <button
                                type="button"
                                onClick={() => setGlobalHeaderLogoUrl("")}
                                className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-rose-400 font-bold uppercase text-[9px] transition cursor-pointer"
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <label className="border border-dashed border-slate-800 hover:border-slate-700 rounded-lg h-10 bg-slate-950 flex flex-col items-center justify-center text-slate-500 hover:text-slate-350 cursor-pointer transition">
                              <Upload className="h-3 w-3 mb-0.5" />
                              <span className="text-[9px]">Upload Header Logo</span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    try {
                                      const url = await uploadImageFile(file, false);
                                      setGlobalHeaderLogoUrl(url);
                                    } catch (err: any) {
                                      alert("Upload failed: " + err.message);
                                    }
                                  }
                                }}
                                className="hidden"
                              />
                            </label>
                          )}
                        </div>
                      </div>

                      {/* Global Footer */}
                      <div className="space-y-3 bg-slate-900/50 p-3 rounded-xl border border-slate-900">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] uppercase font-mono text-amber-500 font-bold">Global Footer</label>
                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-slate-400">
                            <input
                              type="checkbox"
                              checked={globalFooterEnabled}
                              onChange={(e) => setGlobalFooterEnabled(e.target.checked)}
                              className="rounded border-slate-800 text-amber-500 bg-slate-900 h-3.5 w-3.5 focus:ring-0"
                            />
                            <span>Enabled</span>
                          </label>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[9px] uppercase font-mono text-slate-500 font-bold block">Footer Text</label>
                          <input
                            type="text"
                            value={globalFooterText}
                            onChange={(e) => setGlobalFooterText(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1 text-xs text-white"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <label className="text-[9px] uppercase font-mono text-slate-500 font-bold block">Alignment</label>
                            <select
                              value={globalFooterAlignment}
                              onChange={(e) => setGlobalFooterAlignment(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1 text-xs text-white"
                            >
                              <option value="left">Left</option>
                              <option value="center">Center</option>
                              <option value="right">Right</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] uppercase font-mono text-slate-500 font-bold block">Line Color</label>
                            <input
                              type="text"
                              value={globalFooterLineColor}
                              onChange={(e) => setGlobalFooterLineColor(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1 text-xs text-white font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {quoteTemplatePages
                      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
                      .map((page, idx) => {
                        const pageState = getPageState(page);
                        return (
                          <div key={page.id} className="bg-slate-950 border border-slate-850 rounded-2xl p-4 flex flex-col justify-between space-y-4 shadow hover:border-slate-800 transition">
                            <div className="space-y-3">
                              
                              {/* Page Title header */}
                              <div className="flex justify-between items-center border-b border-slate-900 pb-2">
                                <div className="flex items-center gap-2">
                                  <span className="bg-slate-900 text-amber-500 border border-slate-800 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
                                    #{page.sort_order || idx + 1}
                                  </span>
                                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px] font-mono">
                                    {page.page_type || page.pageType}
                                  </span>
                                  {/* Save status indicator */}
                                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-mono font-bold ${
                                    pageState.saveStatus === 'Saved' 
                                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' 
                                      : pageState.saveStatus === 'Saving...'
                                        ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20 animate-pulse'
                                        : 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                                  }`}>
                                    {pageState.saveStatus}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2">
                                  <label className="flex items-center gap-1 cursor-pointer text-[10px] text-slate-400">
                                    <input
                                      type="checkbox"
                                      checked={pageState.is_enabled}
                                      onChange={(e) => handleFieldChange(page.id, 'is_enabled', e.target.checked)}
                                      className="rounded border-slate-800 text-amber-500 bg-slate-900 h-3.5 w-3.5 focus:ring-0"
                                    />
                                    <span>Enabled</span>
                                  </label>
                                  <button type="button" onClick={() => handleUpdatePageSortOrder(page.id, page.sort_order, 'up')} className="bg-slate-900 border border-slate-800 p-1 rounded hover:text-amber-500 cursor-pointer inline-flex"><ArrowUp className="h-3 w-3" /></button>
                                  <button type="button" onClick={() => handleUpdatePageSortOrder(page.id, page.sort_order, 'down')} className="bg-slate-900 border border-slate-800 p-1 rounded hover:text-amber-500 cursor-pointer inline-flex"><ArrowDown className="h-3 w-3" /></button>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <label className="text-[9px] uppercase font-mono text-slate-500 font-bold">Page Header Title</label>
                                <input
                                  type="text"
                                  value={pageState.title}
                                  onChange={(e) => handleFieldChange(page.id, 'title', e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                                />
                              </div>

                              <div className="space-y-2">
                                <label className="text-[9px] uppercase font-mono text-slate-500 font-bold">Body Text Content</label>
                                <textarea
                                  rows={4}
                                  value={pageState.body_text}
                                  onChange={(e) => handleFieldChange(page.id, 'body_text', e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300"
                                />
                              </div>

                              {/* Layout Mode Selector (BUG 4) */}
                              <div className="space-y-2">
                                <label className="text-[9px] uppercase font-mono text-slate-500 font-bold block">Page Layout Mode</label>
                                <select
                                  value={pageState.layoutMode}
                                  onChange={(e) => handleFieldChange(page.id, 'layoutMode', e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-sans focus:outline-none focus:border-amber-500"
                                >
                                  <option value="standard">Standard (Header, Title, Text, Footer)</option>
                                  <option value="image_only">IMAGE ONLY PAGE (Render background image only)</option>
                                  <option value="full_page_image">Full Page Image Only (Hides text & headers)</option>
                                </select>
                              </div>

                              {pageState.layoutMode !== 'full_page_image' && pageState.layoutMode !== 'image_only' && (
                                <>
                                  {/* Page Header Customizations (BUG 2) */}
                                  <div className="space-y-2 bg-slate-900/40 p-2.5 rounded-xl border border-slate-900/80">
                                    <div className="flex justify-between items-center">
                                      <label className="text-[9px] uppercase font-mono text-amber-500 font-bold">Page Header Override</label>
                                      <select
                                        value={pageState.headerMode}
                                        onChange={(e) => handleFieldChange(page.id, 'headerMode', e.target.value)}
                                        className="bg-slate-950 border border-slate-850 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none"
                                      >
                                        <option value="inherit">Inherit Global</option>
                                        <option value="custom">Custom Header</option>
                                        <option value="disabled">Hide Header</option>
                                      </select>
                                    </div>
                                    {pageState.headerMode === 'custom' && (
                                      <div className="space-y-2.5 pt-1">
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <label className="text-[8px] text-slate-500 uppercase font-mono block">Header Text</label>
                                            <input
                                              type="text"
                                              value={pageState.headerText}
                                              onChange={(e) => handleFieldChange(page.id, 'headerText', e.target.value)}
                                              className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white"
                                            />
                                          </div>
                                          <div>
                                            <label className="text-[8px] text-slate-500 uppercase font-mono block">Line Color</label>
                                            <input
                                              type="text"
                                              value={pageState.headerLineColor}
                                              onChange={(e) => handleFieldChange(page.id, 'headerLineColor', e.target.value)}
                                              className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white font-mono"
                                            />
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <label className="text-[8px] text-slate-500 uppercase font-mono block">Logo Align</label>
                                            <select
                                              value={pageState.headerAlignment}
                                              onChange={(e) => handleFieldChange(page.id, 'headerAlignment', e.target.value)}
                                              className="w-full bg-slate-950 border border-slate-850 rounded px-1.5 py-1 text-[11px] text-white"
                                            >
                                              <option value="left">Left</option>
                                              <option value="center">Center</option>
                                              <option value="right">Right</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-[8px] text-slate-500 uppercase font-mono block">Logo Max Height</label>
                                            <input
                                              type="text"
                                              value={pageState.headerLogoSize}
                                              onChange={(e) => handleFieldChange(page.id, 'headerLogoSize', e.target.value)}
                                              className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white font-mono"
                                            />
                                          </div>
                                        </div>
                                        <div>
                                          <label className="text-[8px] text-slate-500 uppercase font-mono block mb-1">Header Custom Logo</label>
                                          {pageState.headerLogoUrl ? (
                                            <div className="relative group rounded border border-slate-850 h-8 bg-slate-950 flex items-center justify-center">
                                              <img src={pageState.headerLogoUrl} style={{ maxHeight: pageState.headerLogoSize }} className="object-contain" alt="custom header logo preview" />
                                              <button
                                                type="button"
                                                onClick={() => handleFieldChange(page.id, 'headerLogoUrl', "")}
                                                className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-rose-400 font-bold uppercase text-[8px] transition cursor-pointer"
                                              >
                                                Remove
                                              </button>
                                            </div>
                                          ) : (
                                            <label className="border border-dashed border-slate-850 hover:border-slate-800 rounded h-8 bg-slate-950 flex flex-col items-center justify-center text-slate-500 cursor-pointer transition text-[9px]">
                                              <span>Upload Custom Logo</span>
                                              <input
                                                type="file"
                                                accept="image/*"
                                                onChange={async (e) => {
                                                  const file = e.target.files?.[0];
                                                  if (file) {
                                                    try {
                                                      const url = await uploadImageFile(file, false);
                                                      handleFieldChange(page.id, 'headerLogoUrl', url);
                                                    } catch (err: any) {
                                                      alert("Logo upload failed: " + err.message);
                                                    }
                                                  }
                                                }}
                                                className="hidden"
                                              />
                                            </label>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Page Footer Customizations (BUG 2) */}
                                  <div className="space-y-2 bg-slate-900/40 p-2.5 rounded-xl border border-slate-900/80">
                                    <div className="flex justify-between items-center">
                                      <label className="text-[9px] uppercase font-mono text-amber-500 font-bold">Page Footer Override</label>
                                      <select
                                        value={pageState.footerMode}
                                        onChange={(e) => handleFieldChange(page.id, 'footerMode', e.target.value)}
                                        className="bg-slate-950 border border-slate-850 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none"
                                      >
                                        <option value="inherit">Inherit Global</option>
                                        <option value="custom">Custom Footer</option>
                                        <option value="disabled">Hide Footer</option>
                                      </select>
                                    </div>
                                    {pageState.footerMode === 'custom' && (
                                      <div className="space-y-2 pt-1">
                                        <div>
                                          <label className="text-[8px] text-slate-500 uppercase font-mono block">Footer Text</label>
                                          <input
                                            type="text"
                                            value={pageState.footerText}
                                            onChange={(e) => handleFieldChange(page.id, 'footerText', e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white"
                                          />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <label className="text-[8px] text-slate-500 uppercase font-mono block">Alignment</label>
                                            <select
                                              value={pageState.footerAlignment}
                                              onChange={(e) => handleFieldChange(page.id, 'footerAlignment', e.target.value)}
                                              className="w-full bg-slate-950 border border-slate-850 rounded px-1.5 py-1 text-[11px] text-white"
                                            >
                                              <option value="left">Left</option>
                                              <option value="center">Center</option>
                                              <option value="right">Right</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-[8px] text-slate-500 uppercase font-mono block">Line Color</label>
                                            <input
                                              type="text"
                                              value={pageState.footerLineColor}
                                              onChange={(e) => handleFieldChange(page.id, 'footerLineColor', e.target.value)}
                                              className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white font-mono"
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}

                              {/* Body Images list (BUG 2) */}
                              <div className="space-y-2 bg-slate-900/40 p-2.5 rounded-xl border border-slate-900/80 text-left">
                                <div className="flex justify-between items-center">
                                  <label className="text-[9px] uppercase font-mono text-amber-500 font-bold">Body Content Images</label>
                                  <label className="bg-slate-950 border border-slate-850 hover:border-slate-800 text-slate-350 hover:text-slate-100 font-semibold px-2 py-0.5 rounded text-[10px] cursor-pointer inline-flex items-center gap-1 transition">
                                    <Plus className="h-3 w-3" /> Add Image
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                          try {
                                            const url = await uploadImageFile(file, false);
                                            const newImg = {
                                              url,
                                              title: "",
                                              position: "middle",
                                              alignment: "center",
                                              width: "50%",
                                              opacity: 1,
                                              order: pageState.bodyImages.length + 1
                                            };
                                            handleFieldChange(page.id, 'bodyImages', [...pageState.bodyImages, newImg]);
                                          } catch (err: any) {
                                            alert("Body image upload failed: " + err.message);
                                          }
                                        }
                                      }}
                                      className="hidden"
                                    />
                                  </label>
                                </div>

                                {pageState.bodyImages && pageState.bodyImages.length > 0 ? (
                                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                    {pageState.bodyImages.map((img: any, imgIdx: number) => (
                                      <div key={imgIdx} className="bg-slate-950 border border-slate-900 rounded p-2 text-[10px] space-y-1.5">
                                        <div className="flex justify-between items-center gap-2">
                                          <div className="flex items-center gap-2 overflow-hidden flex-1">
                                            <img src={img.url} className="w-8 h-8 rounded border border-slate-850 object-cover" alt="body image preview" />
                                            <input
                                              type="text"
                                              value={img.title || ""}
                                              placeholder="Image label (optional)"
                                              onChange={(e) => {
                                                const updatedList = [...pageState.bodyImages];
                                                updatedList[imgIdx] = { ...updatedList[imgIdx], title: e.target.value };
                                                handleFieldChange(page.id, 'bodyImages', updatedList);
                                              }}
                                              className="bg-slate-900 border border-slate-850 rounded px-1.5 py-0.5 text-[10.5px] text-white flex-1 min-w-0"
                                            />
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const updatedList = pageState.bodyImages.filter((_: any, i: number) => i !== imgIdx);
                                              handleFieldChange(page.id, 'bodyImages', updatedList);
                                            }}
                                            className="text-rose-400 hover:text-rose-300 font-bold px-1 py-0.5"
                                          >
                                            Delete
                                          </button>
                                        </div>
                                        <div className="grid grid-cols-3 gap-1.5 text-[9px] text-slate-400">
                                          <div>
                                            <label className="block text-[8px] text-slate-500 uppercase">Position</label>
                                            <select
                                              value={img.position || 'middle'}
                                              onChange={(e) => {
                                                const updatedList = [...pageState.bodyImages];
                                                updatedList[imgIdx] = { ...updatedList[imgIdx], position: e.target.value };
                                                handleFieldChange(page.id, 'bodyImages', updatedList);
                                              }}
                                              className="w-full bg-slate-900 border border-slate-850 rounded px-1 py-0.5 text-white focus:outline-none"
                                            >
                                              <option value="top">Top</option>
                                              <option value="middle">Middle</option>
                                              <option value="bottom">Bottom</option>
                                              <option value="absolute">Absolute</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label className="block text-[8px] text-slate-500 uppercase">Alignment</label>
                                            <select
                                              value={img.alignment || 'center'}
                                              onChange={(e) => {
                                                const updatedList = [...pageState.bodyImages];
                                                updatedList[imgIdx] = { ...updatedList[imgIdx], alignment: e.target.value };
                                                handleFieldChange(page.id, 'bodyImages', updatedList);
                                              }}
                                              className="w-full bg-slate-900 border border-slate-850 rounded px-1 py-0.5 text-white focus:outline-none"
                                            >
                                              <option value="left">Left</option>
                                              <option value="center">Center</option>
                                              <option value="right">Right</option>
                                              <option value="full_width">Full Width</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label className="block text-[8px] text-slate-500 uppercase">Width</label>
                                            <select
                                              value={img.width || '50%'}
                                              onChange={(e) => {
                                                const updatedList = [...pageState.bodyImages];
                                                updatedList[imgIdx] = { ...updatedList[imgIdx], width: e.target.value };
                                                handleFieldChange(page.id, 'bodyImages', updatedList);
                                              }}
                                              className="w-full bg-slate-900 border border-slate-850 rounded px-1 py-0.5 text-white focus:outline-none"
                                            >
                                              <option value="25%">25%</option>
                                              <option value="50%">50%</option>
                                              <option value="75%">75%</option>
                                              <option value="100%">100%</option>
                                            </select>
                                          </div>
                                        </div>
                                        {img.position === 'absolute' && (
                                          <div className="grid grid-cols-4 gap-1 text-[8.5px]">
                                            <div>
                                              <label className="block text-[7.5px] text-slate-500 uppercase">Top</label>
                                              <input
                                                type="text"
                                                placeholder="auto"
                                                value={img.top || ""}
                                                onChange={(e) => {
                                                  const updatedList = [...pageState.bodyImages];
                                                  updatedList[imgIdx] = { ...updatedList[imgIdx], top: e.target.value };
                                                  handleFieldChange(page.id, 'bodyImages', updatedList);
                                                }}
                                                className="w-full bg-slate-900 border border-slate-850 rounded px-1 py-0.5 text-white font-mono text-center"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[7.5px] text-slate-500 uppercase">Bottom</label>
                                              <input
                                                type="text"
                                                placeholder="auto"
                                                value={img.bottom || ""}
                                                onChange={(e) => {
                                                  const updatedList = [...pageState.bodyImages];
                                                  updatedList[imgIdx] = { ...updatedList[imgIdx], bottom: e.target.value };
                                                  handleFieldChange(page.id, 'bodyImages', updatedList);
                                                }}
                                                className="w-full bg-slate-900 border border-slate-850 rounded px-1 py-0.5 text-white font-mono text-center"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[7.5px] text-slate-500 uppercase">Left</label>
                                              <input
                                                type="text"
                                                placeholder="auto"
                                                value={img.left || ""}
                                                onChange={(e) => {
                                                  const updatedList = [...pageState.bodyImages];
                                                  updatedList[imgIdx] = { ...updatedList[imgIdx], left: e.target.value };
                                                  handleFieldChange(page.id, 'bodyImages', updatedList);
                                                }}
                                                className="w-full bg-slate-900 border border-slate-850 rounded px-1 py-0.5 text-white font-mono text-center"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[7.5px] text-slate-500 uppercase">Right</label>
                                              <input
                                                type="text"
                                                placeholder="auto"
                                                value={img.right || ""}
                                                onChange={(e) => {
                                                  const updatedList = [...pageState.bodyImages];
                                                  updatedList[imgIdx] = { ...updatedList[imgIdx], right: e.target.value };
                                                  handleFieldChange(page.id, 'bodyImages', updatedList);
                                                }}
                                                className="w-full bg-slate-900 border border-slate-850 rounded px-1 py-0.5 text-white font-mono text-center"
                                              />
                                            </div>
                                          </div>
                                        )}
                                        <div className="grid grid-cols-2 gap-3 text-[9px] text-slate-400">
                                          <div>
                                            <label className="block text-[8px] text-slate-500 uppercase">Opacity ({img.opacity !== undefined ? img.opacity : 1})</label>
                                            <input
                                              type="range"
                                              min="0.1"
                                              max="1.0"
                                              step="0.1"
                                              value={img.opacity !== undefined ? img.opacity : 1}
                                              onChange={(e) => {
                                                const updatedList = [...pageState.bodyImages];
                                                updatedList[imgIdx] = { ...updatedList[imgIdx], opacity: parseFloat(e.target.value) };
                                                handleFieldChange(page.id, 'bodyImages', updatedList);
                                              }}
                                              className="w-full accent-amber-500"
                                            />
                                          </div>
                                          <div>
                                            <label className="block text-[8px] text-slate-500 uppercase">Order</label>
                                            <input
                                              type="number"
                                              value={img.order || 1}
                                              onChange={(e) => {
                                                const updatedList = [...pageState.bodyImages];
                                                updatedList[imgIdx] = { ...updatedList[imgIdx], order: parseInt(e.target.value) || 1 };
                                                handleFieldChange(page.id, 'bodyImages', updatedList);
                                              }}
                                              className="w-full bg-slate-900 border border-slate-850 rounded px-1.5 py-0.5 text-white font-mono focus:outline-none"
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-slate-650 text-slate-600 italic">No body content images added.</div>
                                )}
                              </div>

                              {/* Asset images upload preview */}
                              <div className="grid grid-cols-2 gap-3 pt-1 text-[9px] font-sans">
                                
                                {/* Background Image */}
                                <div className="space-y-1.5 text-left">
                                  <label className="text-[9px] text-slate-500 font-bold block uppercase">Background Graphic</label>
                                  {pageState.bg_image_url ? (
                                    <div className="relative group rounded-lg overflow-hidden border border-slate-800 h-16 bg-slate-900 flex items-center justify-center">
                                      <img src={pageState.bg_image_url} className="h-full w-full object-cover opacity-60" alt="bg preview" />
                                      <button
                                        type="button"
                                        onClick={() => handleFieldChange(page.id, 'bg_image_url', "")}
                                        className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-rose-400 font-bold uppercase text-[9px] transition cursor-pointer"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ) : (
                                    <label className="border border-dashed border-slate-800 hover:border-slate-700 rounded-lg h-16 bg-slate-900 flex flex-col items-center justify-center text-slate-500 hover:text-slate-350 cursor-pointer transition">
                                      <Upload className="h-4 w-4 mb-0.5" />
                                      <span>Upload BG</span>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) handleImageUpload(page.id, file, 'bg');
                                        }}
                                        className="hidden"
                                      />
                                    </label>
                                  )}
                                </div>

                                {/* Main/Logo Image */}
                                <div className="space-y-1.5 text-left">
                                  <label className="text-[9px] text-slate-500 font-bold block uppercase">Foreground Logo/Photo</label>
                                  {pageState.image_url ? (
                                    <div className="relative group rounded-lg overflow-hidden border border-slate-800 h-16 bg-slate-900 flex items-center justify-center">
                                      <img src={pageState.image_url} className="max-h-[85%] max-w-[85%] object-contain" alt="logo preview" />
                                      <button
                                        type="button"
                                        onClick={() => handleFieldChange(page.id, 'image_url', "")}
                                        className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-rose-400 font-bold uppercase text-[9px] transition cursor-pointer"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ) : (
                                    <label className="border border-dashed border-slate-800 hover:border-slate-700 rounded-lg h-16 bg-slate-900 flex flex-col items-center justify-center text-slate-500 hover:text-slate-350 cursor-pointer transition">
                                      <Upload className="h-4 w-4 mb-0.5" />
                                      <span>Upload Asset</span>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) handleImageUpload(page.id, file, 'image');
                                        }}
                                        className="hidden"
                                      />
                                    </label>
                                  )}
                                </div>

                              </div>

                            </div>

                            {/* Action buttons footer */}
                            <div className="flex gap-2 pt-2 border-t border-slate-900 text-xs">
                              <button
                                type="button"
                                onClick={() => setPreviewPage(pageState)}
                                className="flex-1 bg-slate-900 border border-slate-800 text-slate-350 hover:text-slate-100 hover:border-slate-700 py-1.5 px-2 rounded-xl transition cursor-pointer flex items-center justify-center gap-1 font-bold font-sans"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>Preview</span>
                              </button>
                              
                              <button
                                type="button"
                                onClick={() => setPrintPageData(pageState)}
                                className="flex-1 bg-slate-900 border border-slate-800 text-slate-350 hover:text-slate-100 hover:border-slate-700 py-1.5 px-2 rounded-xl transition cursor-pointer flex items-center justify-center gap-1 font-bold font-sans"
                              >
                                <Printer className="h-3.5 w-3.5" />
                                <span>Print</span>
                              </button>
                              
                              <button
                                type="button"
                                onClick={() => handleSavePage(page.id)}
                                disabled={pageState.saveStatus === 'Saved' || pageState.saveStatus === 'Saving...'}
                                className="flex-1 bg-amber-500/10 hover:bg-amber-500/20 disabled:bg-slate-900 text-amber-400 disabled:text-slate-600 border border-amber-500/20 disabled:border-slate-850 py-1.5 px-2 rounded-xl transition cursor-pointer flex items-center justify-center gap-1 font-bold font-sans"
                              >
                                <Save className="h-3.5 w-3.5" />
                                <span>Save</span>
                              </button>
                            </div>

                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              {/* MODULE 4: GENERATED QUOTES & VERSION HISTORY */}
              {activeModule === 'quotes' && (
                <div className="bg-slate-900 border border-slate-850 p-5 md:p-6 rounded-3xl space-y-6 text-left">
                  <div className="border-b border-slate-800 pb-2">
                    <h3 className="text-sm font-bold text-slate-100 font-sans">Lead Proposal Versions History</h3>
                    <span className="text-[10px] text-slate-500 font-sans">Open details, duplicate, download specific PDF versions, and trigger simulated reminders.</span>
                  </div>

                  {activeLead.quotes && activeLead.quotes.length > 0 ? (
                    <div className="overflow-x-auto border border-slate-800 rounded-2xl bg-slate-950/60">
                      <table className="w-full text-left border-collapse text-xs font-sans">
                        <thead>
                          <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 font-bold uppercase text-[10px] tracking-wider">
                            <th className="py-3.5 px-4">Quote Type</th>
                            <th className="py-3.5 px-4">Client Name</th>
                            <th className="py-3.5 px-4">System Size</th>
                            <th className="py-3.5 px-4 text-right">Net Value</th>
                            <th className="py-3.5 px-4">Created Date</th>
                            <th className="py-3.5 px-4">Source</th>
                            <th className="py-3.5 px-4 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 text-slate-350 font-mono">
                          {activeLead.quotes.map((q: any) => {
                            const dateString = q.createdAt ? new Date(q.createdAt).toLocaleString() : new Date().toLocaleDateString();
                            const quoteNetVal = q.netTotal || q.netCost || q.totalCost || 0;
                            const isSizer = q.quote_type === 'auto_sizer';
                            return (
                              <tr key={q.id} className="hover:bg-slate-900/40 transition-colors">
                                <td className="py-3 px-4 font-sans">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                    isSizer ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                                  }`}>
                                    {isSizer ? 'Auto Sizer' : 'Manual BOQ'}
                                  </span>
                                </td>
                                <td className="py-3 px-4 font-sans text-white font-medium">{q.clientName || activeLead.name}</td>
                                <td className="py-3 px-4">{q.systemSizekW} kW</td>
                                <td className="py-3 px-4 text-right text-amber-500 font-bold">{formatPKR(quoteNetVal)}</td>
                                <td className="py-3 px-4 text-[10px] text-slate-500">{dateString}</td>
                                <td className="py-3 px-4 font-sans">
                                  <span className="text-[10px] text-slate-400 bg-slate-800/60 px-1.5 py-0.5 rounded font-mono">
                                    {q.id}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex justify-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedQuoteDetail(q)}
                                      className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-sans font-bold text-[10px] px-2.5 py-1 rounded-lg cursor-pointer transition"
                                    >
                                      Inspect
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleLoadQuoteForEditing(q)}
                                      className="bg-amber-550 hover:bg-amber-450 text-slate-950 font-sans font-bold text-[10px] px-2.5 py-1 rounded-lg cursor-pointer transition"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDuplicateQuote(q)}
                                      className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-350 p-1.5 rounded-lg cursor-pointer transition"
                                      title="Duplicate version"
                                    >
                                      <Copy className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => window.open(`${API_BASE_URL}/api/export/pdf/manual-quote/${activeLead.id}?quoteId=${q.id}`, "_blank")}
                                      className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-amber-500 p-1.5 rounded-lg cursor-pointer transition"
                                      title="Download Version PDF"
                                    >
                                      <Download className="h-3 w-3" />
                                    </button>
                                    {onDeleteQuote && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          if (window.confirm("Are you sure you want to delete this quote version? This action cannot be undone.")) {
                                            await onDeleteQuote(activeLead.id, q.id);
                                          }
                                        }}
                                        className="bg-red-950/40 hover:bg-red-900/60 border border-red-900/40 hover:border-red-500/50 text-red-400 p-1.5 rounded-lg cursor-pointer transition flex items-center justify-center"
                                        title="Delete Quote Version"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-slate-500 font-mono">No proposal versions have been compiled for this client yet.</div>
                  )}

                  {/* Summary inspect panel details */}
                  {selectedQuoteDetail && (
                    <div className="border-t border-slate-800 pt-6 space-y-4">
                      <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-xl border border-slate-850">
                        <span className="font-bold text-white text-xs">Inspect Details: Quote {selectedQuoteDetail.id}</span>
                        <button
                          type="button"
                          onClick={() => setSelectedQuoteDetail(null)}
                          className="text-slate-400 hover:text-white font-mono text-[10px] bg-slate-900 border-0 px-2 py-0.5 rounded cursor-pointer"
                        >
                          Close Preview
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2 text-xs font-sans text-slate-400 text-left bg-slate-950 p-4 rounded-xl border border-slate-900">
                          <span className="text-[10px] font-bold text-amber-550 uppercase tracking-wider block border-b border-slate-900 pb-1.5">Quote Specifications</span>
                          <p><strong>System Size:</strong> {selectedQuoteDetail.systemSizekW} kW DC</p>
                          <p><strong>System Type:</strong> {selectedQuoteDetail.systemType || "Hybrid"}</p>
                          <p><strong>Panels Brand:</strong> {selectedQuoteDetail.panelBrand || "Jinko"}</p>
                          <p><strong>Inverter capacity:</strong> {selectedQuoteDetail.inverterBrand} {selectedQuoteDetail.inverterCapacity}</p>
                          <p><strong>Battery Type:</strong> {selectedQuoteDetail.batteryOption || "None"}</p>
                          <p><strong>LESCO net-metering connection:</strong> {selectedQuoteDetail.netMeteringRequired}</p>
                          <p><strong>Structure Type:</strong> {selectedQuoteDetail.structureType || "Standard"}</p>
                          {selectedQuoteDetail.lescoSettings?.meterNo && (
                            <p><strong>Meter No / Consumer No:</strong> {selectedQuoteDetail.lescoSettings?.meterNo} / {selectedQuoteDetail.lescoSettings?.consumerNo}</p>
                          )}
                        </div>

                        <div className="space-y-2 text-xs font-sans text-slate-400 text-left bg-slate-950 p-4 rounded-xl border border-slate-900">
                          <span className="text-[10px] font-bold text-amber-550 uppercase tracking-wider block border-b border-slate-900 pb-1.5">Financial Summary</span>
                          <p><strong>Gross BOQ Subtotal:</strong> {formatPKR(selectedQuoteDetail.grandTotal || selectedQuoteDetail.totalCost)}</p>
                          <p><strong>Lahore Sales Tax:</strong> {selectedQuoteDetail.taxEnabled ? `${selectedQuoteDetail.taxRate}% (${formatPKR(selectedQuoteDetail.taxAmount || 0)})` : "Disabled"}</p>
                          <p><strong>Society connection Dues:</strong> {formatPKR(selectedQuoteDetail.societyCharges || 0)}</p>
                          <p><strong>Promo Executive discount:</strong> -{formatPKR(selectedQuoteDetail.discount || 0)}</p>
                          <p className="text-white text-sm font-extrabold border-t border-slate-900 pt-2 mt-2">
                            <strong>Net Turnkey value:</strong> {formatPKR(selectedQuoteDetail.netTotal || selectedQuoteDetail.netCost || selectedQuoteDetail.totalCost)}
                          </p>
                        </div>
                      </div>

                      {/* Display BOQ list */}
                      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                        <table className="w-full text-left border-collapse text-[10px] font-mono">
                          <thead className="bg-slate-950 text-slate-500 text-[9px] uppercase border-b border-slate-800">
                            <tr>
                              <th className="py-2 px-2 text-center w-8">Sr</th>
                              <th className="py-2 px-2">Item Name & Specifications</th>
                              <th className="py-2 px-2 w-20">Brand</th>
                              <th className="py-2 px-1.5 w-12 text-center">Qty</th>
                              <th className="py-2 px-2 w-24 text-right">Rate</th>
                              <th className="py-2 px-2 w-24 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/50 text-slate-350">
                            {(selectedQuoteDetail.boqRows || selectedQuoteDetail.boqItems || []).map((row: any) => {
                              const isHeading = row.type === 'heading';
                              const isSubtotal = row.type === 'subtotal';
                              return (
                                <tr key={row.id} className={`${isHeading ? 'bg-slate-900/30 text-amber-400 font-bold' : isSubtotal ? 'bg-slate-900/10 font-bold' : ''}`}>
                                  {isHeading ? (
                                    <td colSpan={6} className="py-1.5 px-2 uppercase font-bold text-xs">{row.name}</td>
                                  ) : isSubtotal ? (
                                    <td colSpan={5} className="py-1.5 px-2 text-right font-bold text-slate-200">
                                      {row.name}:
                                    </td>
                                  ) : (
                                    <>
                                      <td className="py-1.5 text-center text-slate-550">{row.srNo || '-'}</td>
                                      <td className="py-1.5 px-2 font-sans text-xs">
                                        <span className="block font-bold text-white">{row.name}</span>
                                        <span className="block text-[9px] text-slate-500">{row.description}</span>
                                      </td>
                                      <td className="py-1.5 px-2 font-sans">{row.brand}</td>
                                      <td className="py-1.5 px-1.5 text-center">{row.qty}</td>
                                      <td className="py-1.5 px-2 text-right">{row.rate?.toLocaleString()}</td>
                                    </>
                                  )}
                                  <td className="py-1.5 px-2 text-right text-white font-bold">{row.total?.toLocaleString()}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* MODULE 5: PRODUCT LIBRARY */}
              {activeModule === 'products' && (
                <div className="bg-slate-900 border border-slate-850 p-5 md:p-6 rounded-3xl space-y-6 text-left">
                  
                  {/* Category Selection Tabs & search bar */}
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-100 font-sans">Pakistan Solar Hardware Catalog</h3>
                      <span className="text-[10px] text-slate-500 font-sans">Add, Edit, and Manage master solar products records syncing to Supabase.</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleOpenAddProduct}
                      className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-sans font-bold text-xs px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1 shadow"
                    >
                      <Plus className="h-4 w-4" /> Add Product
                    </button>
                  </div>

                  <div className="flex flex-col md:flex-row gap-4 items-center">
                    {/* Categories tabs */}
                    <div className="flex flex-wrap gap-1.5 bg-slate-950 p-1 rounded-2xl border border-slate-850 w-full md:w-auto">
                      {[
                        "Solar Panels", "Inverters", "Batteries", "Structure", "Cables", "Protection", "Accessories", "Net Metering", "Civil Works"
                      ].map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setSelectedProductCategory(cat)}
                          className={`px-3 py-1.5 rounded-xl font-sans font-bold text-[10px] transition cursor-pointer ${
                            selectedProductCategory === cat ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>

                    {/* Search query input */}
                    <input
                      type="text"
                      placeholder="Search brand or model..."
                      value={productSearchQuery}
                      onChange={(e) => setProductSearchQuery(e.target.value)}
                      className="w-full md:w-48 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
                    />
                  </div>

                  {/* Products Grid */}
                  {filteredProducts.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {filteredProducts.map((p) => (
                        <div key={p.id} className="bg-slate-950 border border-slate-850 hover:border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-4 shadow transition text-left">
                          <div className="space-y-2">
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="font-extrabold text-white text-xs block">{p.brand}</span>
                                <span className="text-[10px] text-slate-400 font-bold block">{p.model}</span>
                              </div>
                              <span className="text-[9px] font-mono text-slate-550 text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-full font-bold">
                                {p.sku}
                              </span>
                            </div>

                            <p className="text-[10px] text-slate-400 font-sans line-clamp-2 leading-relaxed">
                              {p.specifications?.description || p.name}
                            </p>

                            <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[9px] text-slate-500">
                              <span>Stock: <strong className="text-white">{p.stock || 0}</strong></span>
                              <span>Warranty: <strong className="text-white">{p.warrantyPeriod || "N/A"}</strong></span>
                              {p.specifications?.wattage > 0 && (
                                <span className="col-span-2">Capacity/Wattage: <strong className="text-white">{p.specifications.wattage}W</strong></span>
                              )}
                            </div>
                          </div>

                          <div className="flex justify-between items-center border-t border-slate-900 pt-3">
                            <div className="font-mono text-left">
                              <span className="text-[8px] text-slate-500 block uppercase">Cost / Sale:</span>
                              <span className="text-slate-400 text-[10px] line-through block">
                                {formatPKR(p.specifications?.costPrice || 0)}
                              </span>
                              <span className="text-emerald-400 font-bold text-xs">
                                {formatPKR(p.price || 0)}
                              </span>
                            </div>

                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => handleOpenEditProduct(p)}
                                className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-350 p-1.5 rounded-lg cursor-pointer transition"
                                title="Edit Product details"
                              >
                                <Settings className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(p.id)}
                                className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-rose-400 p-1.5 rounded-lg cursor-pointer transition"
                                title="Delete Product"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-slate-500 font-mono">No equipment items found in category tab.</div>
                  )}

                  {/* Add/Edit Product Modal panel */}
                  {isProductModalOpen && (
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 overflow-y-auto">
                      <div className="bg-slate-950 border border-slate-850 rounded-3xl p-5 md:p-6 w-full max-w-md space-y-4">
                        <div className="flex justify-between items-center border-b border-slate-900 pb-2.5">
                          <h4 className="text-sm font-bold font-sans text-white">
                            {editingProduct ? 'Edit Catalog Product details' : 'Add New Pakistan solar Hardware'}
                          </h4>
                          <button
                            type="button"
                            onClick={() => setIsProductModalOpen(false)}
                            className="text-slate-500 hover:text-white font-bold font-mono text-xs border-0 bg-transparent cursor-pointer"
                          >
                            ×
                          </button>
                        </div>

                        <form onSubmit={handleSaveProductForm} className="space-y-3.5 text-xs text-left">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-slate-400 font-bold block">Brand Name</label>
                              <input type="text" value={productFormBrand} onChange={(e) => setProductFormBrand(e.target.value)} placeholder="e.g. Jinko" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white" required />
                            </div>
                            <div className="space-y-1">
                              <label className="text-slate-400 font-bold block">Model Name</label>
                              <input type="text" value={productFormModel} onChange={(e) => setProductFormModel(e.target.value)} placeholder="e.g. Tiger Neo 580" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white" required />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-slate-400 font-bold block">Category</label>
                              <select
                                value={productFormCategory}
                                onChange={(e) => setProductFormCategory(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white cursor-pointer focus:outline-none"
                              >
                                {["Solar Panels", "Inverters", "Batteries", "Structure", "Cables", "Protection", "Accessories", "Net Metering", "Civil Works"].map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-slate-400 block">SKU Code</label>
                              <input type="text" value={productFormSku} onChange={(e) => setProductFormSku(e.target.value)} placeholder="e.g. JK-PAN-580N" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono" />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-slate-400 font-bold block">Cost Price (Rs)</label>
                              <input type="number" value={productFormCostPrice} onChange={(e) => setProductFormCostPrice(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono" required />
                            </div>
                            <div className="space-y-1">
                              <label className="text-slate-400 font-bold block">Sale Price (Rs)</label>
                              <input type="number" value={productFormPrice} onChange={(e) => setProductFormPrice(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono" required />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <label className="text-slate-450 block font-bold">Stock Qty</label>
                              <input type="number" value={productFormStock} onChange={(e) => setProductFormStock(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white text-center" required />
                            </div>
                            <div className="space-y-1 col-span-2">
                              <label className="text-slate-450 block font-bold">Warranty Period</label>
                              <input type="text" value={productFormWarranty} onChange={(e) => setProductFormWarranty(e.target.value)} placeholder="e.g. 25 Years" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white" />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-slate-400 block font-bold">Wattage / Power Capacity (W)</label>
                            <input type="number" value={productFormWattage} onChange={(e) => setProductFormWattage(Number(e.target.value))} placeholder="e.g. 580" className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono" />
                          </div>

                          <div className="space-y-1">
                            <label className="text-slate-400 block font-bold">Specifications description</label>
                            <textarea rows={3} value={productFormDesc} onChange={(e) => setProductFormDesc(e.target.value)} placeholder="Enter details..." className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300" />
                          </div>

                          <div className="flex gap-3 pt-3">
                            <button
                              type="button"
                              onClick={() => setIsProductModalOpen(false)}
                              className="flex-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-350 py-2.5 rounded-xl font-sans font-bold cursor-pointer transition"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 py-2.5 rounded-xl font-sans font-bold cursor-pointer transition"
                            >
                              Save Product
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                </div>
              )}

            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-500">
              <Inbox className="h-10 w-10 mx-auto" />
              <strong className="block text-white mt-1.5 font-sans">Select a client on the left pane</strong>
              <span className="text-xs">Configure layouts, preview quotes history, and sync product inventories.</span>
            </div>
          )}
        </div>

        {/* Preview Page Modal */}
        {previewPage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm overflow-y-auto p-4 md:p-6 text-slate-800">
            <div className="relative bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6 w-full max-w-4xl shadow-2xl flex flex-col my-8">
              
              {/* Modal Header */}
              <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
                <div>
                  <h3 className="text-sm md:text-base font-bold text-white font-sans flex items-center gap-2">
                    <Eye className="h-4 w-4 text-amber-500" />
                    <span>A4 Proposal Page Preview</span>
                  </h3>
                  <span className="text-[10px] text-slate-500 font-sans block mt-0.5">
                    Accurate visualization of the template page compiled layout.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewPage(null)}
                  className="text-slate-400 hover:text-white transition cursor-pointer text-xs font-bold bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl border-0"
                >
                  Close Preview
                </button>
              </div>

              {/* A4 Page viewport wrapper */}
              <div className="flex justify-center items-center bg-slate-950 p-4 md:p-8 rounded-2xl overflow-auto max-h-[70vh]">
                {/* Scaled preview matching A4 aspect ratio */}
                <div 
                  className="relative bg-white shadow-2xl font-sans text-left flex flex-col justify-between overflow-hidden"
                  style={{
                    width: '210mm',
                    height: '297mm',
                    minWidth: '210mm',
                    minHeight: '297mm',
                    padding: (previewPage.layoutMode === 'full_page_image' || previewPage.layoutMode === 'image_only' || previewPage.layout_mode === 'full_page_image' || previewPage.layout_mode === 'image_only') ? '0mm' : '20mm',
                    boxSizing: 'border-box',
                    backgroundImage: previewPage.bg_image_url ? `url(${previewPage.bg_image_url})` : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat'
                  }}
                >
                  {/* Background Dimmer Overlay */}
                  {previewPage.bg_image_url && 
                   previewPage.layoutMode !== 'full_page_image' && 
                   previewPage.layoutMode !== 'image_only' && 
                   previewPage.layout_mode !== 'full_page_image' && 
                   previewPage.layout_mode !== 'image_only' && (
                    <div className="absolute inset-0 bg-white/70 pointer-events-none z-0" />
                  )}

                  {previewPage.layoutMode !== 'full_page_image' && 
                   previewPage.layoutMode !== 'image_only' && 
                   previewPage.layout_mode !== 'full_page_image' && 
                   previewPage.layout_mode !== 'image_only' ? (
                    <div className="relative z-10 flex flex-col justify-between h-full">
                      {/* Header */}
                      <div className="flex justify-between items-center border-b-2 border-amber-500 pb-4 mb-6">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">☀️</span>
                          <div>
                            <div className="font-extrabold text-base tracking-tight text-slate-900 leading-none">SUNCHASER ENERGY</div>
                            <div className="text-[8px] uppercase tracking-wider text-amber-600 font-bold mt-1">Generational Infrastructure</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] uppercase font-mono text-slate-500 font-bold tracking-wider">
                            Page: {previewPage.page_type || previewPage.pageType}
                          </span>
                        </div>
                      </div>

                      {/* Main Content Body */}
                      <div className="flex-1 flex flex-col justify-start">
                        {/* Logo / Foreground Photo Preview if present */}
                        {previewPage.image_url && (
                          <div className="mb-6 flex justify-center">
                            <img 
                              src={previewPage.image_url} 
                              alt="Foreground asset" 
                              className="max-h-48 object-contain rounded-lg border border-slate-100 p-2 bg-slate-50/50" 
                            />
                          </div>
                        )}

                        {/* Title */}
                        <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 tracking-tight mb-4">
                          {previewPage.title}
                        </h1>

                        {/* Body Text */}
                        <p className="text-xs md:text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                          {previewPage.body_text}
                        </p>
                      </div>

                      {/* Footer */}
                      <div className="border-t border-slate-200 pt-4 flex justify-between items-end text-[9px] text-slate-500 font-mono mt-auto">
                        <div>
                          <span className="font-bold text-slate-800">Sunchaser Energy Systems</span>
                        </div>
                        <div>
                          <span>Official Client Proposal Deck</span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                </div>
              </div>
              
            </div>
          </div>
        )}

        {/* Proposal Deck Layout Preview Modal */}
        {showProposalPreview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 md:p-6 text-slate-800">
            <div className="relative bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6 w-full max-w-5xl shadow-2xl flex flex-col my-8 h-[90vh]">
              
              {/* Modal Header */}
              <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4 flex-shrink-0">
                <div>
                  <h3 className="text-sm md:text-base font-bold text-white font-sans flex items-center gap-2">
                    <Eye className="h-4 w-4 text-amber-500" />
                    <span>Live Proposal Deck PDF Preview</span>
                  </h3>
                  <span className="text-[10px] text-slate-500 font-sans block mt-0.5">
                    Live layout rendering showing exactly how the exported PDF pages will print.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const iframe = document.getElementById('proposal-preview-iframe') as HTMLIFrameElement;
                      if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.print();
                      }
                    }}
                    disabled={loadingPreview || !proposalPreviewHtml}
                    className="text-amber-500 hover:text-amber-400 disabled:text-slate-650 transition cursor-pointer text-xs font-bold bg-slate-850 hover:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-800 flex items-center gap-1"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Print Deck
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowProposalPreview(false);
                      setProposalPreviewHtml("");
                    }}
                    className="text-slate-400 hover:text-white transition cursor-pointer text-xs font-bold bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl border-0"
                  >
                    Close Preview
                  </button>
                </div>
              </div>

              {/* iframe viewport */}
              <div className="flex-1 bg-slate-950 rounded-2xl overflow-hidden relative border border-slate-950/80">
                {loadingPreview ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400 bg-slate-950/90 font-mono text-xs">
                    <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
                    <span>Compiling proposal database templates...</span>
                  </div>
                ) : (
                  <iframe 
                    id="proposal-preview-iframe"
                    srcDoc={proposalPreviewHtml} 
                    className="w-full h-full border-0 bg-slate-950" 
                    title="Live PDF HTML Layout Preview"
                  />
                )}
              </div>
              
            </div>
          </div>
        )}

        {/* Print Preview Container (only active when printing) */}
        {printPageData && (
          <div 
            id="print-preview-container"
            style={{
              padding: (printPageData.layoutMode === 'full_page_image' || printPageData.layoutMode === 'image_only' || printPageData.layout_mode === 'full_page_image' || printPageData.layout_mode === 'image_only') ? '0mm' : undefined,
              backgroundImage: printPageData.bg_image_url ? `url(${printPageData.bg_image_url})` : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat'
            }}
          >
            {printPageData.bg_image_url && 
             printPageData.layoutMode !== 'full_page_image' && 
             printPageData.layoutMode !== 'image_only' && 
             printPageData.layout_mode !== 'full_page_image' && 
             printPageData.layout_mode !== 'image_only' && (
              <div className="absolute inset-0 bg-white/70 pointer-events-none z-0" />
            )}
            
            {printPageData.layoutMode !== 'full_page_image' && 
             printPageData.layoutMode !== 'image_only' && 
             printPageData.layout_mode !== 'full_page_image' && 
             printPageData.layout_mode !== 'image_only' ? (
              <div className="relative z-10 flex flex-col justify-between h-full">
                {/* Header */}
                <div className="flex justify-between items-center border-b-2 border-amber-500 pb-4 mb-6">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">☀️</span>
                    <div>
                      <div className="font-extrabold text-base tracking-tight text-slate-900 leading-none">SUNCHASER ENERGY</div>
                      <div className="text-[8px] uppercase tracking-wider text-amber-600 font-bold mt-1">Generational Infrastructure</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] uppercase font-mono text-slate-500 font-bold tracking-wider">
                      Page: {printPageData.page_type || printPageData.pageType}
                    </span>
                  </div>
                </div>

                {/* Main Content Body */}
                <div className="flex-1 flex flex-col justify-start">
                  {printPageData.image_url && (
                    <div className="mb-6 flex justify-center">
                      <img 
                        src={printPageData.image_url} 
                        alt="Foreground asset" 
                        className="max-h-48 object-contain rounded-lg" 
                      />
                    </div>
                  )}

                  <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight mb-4">
                    {printPageData.title}
                  </h1>

                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {printPageData.body_text}
                  </p>
                </div>

                {/* Footer */}
                <div className="border-t border-slate-200 pt-4 flex justify-between items-end text-[9px] text-slate-500 font-mono mt-auto">
                  <div>
                    <span className="font-bold text-slate-800">Sunchaser Energy Systems</span>
                  </div>
                  <div>
                    <span>Official Client Proposal Deck</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

    </div>
  );
}
