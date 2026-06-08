export interface BoqRow {
  id: string;
  type: 'heading' | 'item' | 'subtotal';
  srNo?: string;
  name: string;
  description: string;
  brand: string;
  unit: string;
  qty: number;
  rate: number;
  total: number;
}

export interface Quote {
  id: string;
  systemSizekW: number;
  panelCount: number;
  panelType: string;
  inverterType: string;
  batteryCapacity: string;
  totalCost: number;
  federalTaxCredit: number;
  netCost: number;
  estimatedAnnualSavings: number;
  paybackPeriodYears: number;
  status: 'Pending' | 'Accepted' | 'Declined';
  createdAt: string;

  // Custom Lahore/Pakistan quotation fields
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  clientAddress?: string;
  cnic?: string;
  cityArea?: string;
  bdmName?: string;
  quoteDate?: string;
  systemType?: 'On-grid' | 'Hybrid' | 'Off-grid';
  structureType?: 'Standard' | 'Elevated' | 'Girder';
  panelBrand?: string;
  panelWattage?: number;
  inverterBrand?: string;
  inverterCapacity?: string;
  batteryOption?: string;
  netMeteringRequired?: 'Yes' | 'No';
  discount?: number;
  discountType?: 'percentage' | 'fixed';
  discountValue?: number;
  paymentSchedule?: string;
  boqItems?: any[];

  // Redesigned Manual Builder fields
  lescoSettings?: {
    meterNo?: string;
    consumerNo?: string;
    sanctionedLoad?: string;
    phaseType?: 'Single Phase' | 'Three Phase';
  };
  societyCharges?: number;
  taxEnabled?: boolean;
  taxRate?: number;
  taxAmount?: number;
  selectedStructure?: 'standard' | 'elevated' | 'girder' | 'custom';
  customStructure?: {
    name?: string;
    descEn?: string;
    descUr?: string;
    rate?: number;
    weight?: string;
    materialType?: string;
    warranty?: string;
    windRating?: string;
    image?: string;
  };
  boqRows?: BoqRow[];
  customNotes?: string;
  grandTotal?: number;
  netTotal?: number;
}

export interface Survey {
  scheduledDate: string;
  status: 'Pending' | 'Completed';
  notes: string;
  shadingPercent: number;
  optimalPlacement: string;
  photos: string[];
  measurements?: {
    roofPitch?: string;
    rafterSpacing?: string;
    dimensions?: string;
    obstructions?: string;
  };
  structureRecommendation?: string;
  dbInverterLocation?: string;
  panelPlacements?: Array<{ x: number; y: number; id: number }>;
}

export interface InstallationTask {
  id: string;
  name: string;
  done: boolean;
}

export interface Installation {
  status: 'Not Started' | 'Scheduled' | 'In Progress' | 'Completed' | 'Maintenance';
  scheduledDate: string;
  progress: number;
  tasks: InstallationTask[];
  completionPhotos: string[];
  report: string;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  status: 'New' | 'Contacted' | 'Survey Scheduled' | 'Quoted' | 'Contracted' | 'Installed' | 'Negotiation' | 'Won' | 'Lost';
  monthlyBill: number;
  monthlyUnits?: number;
  sanctionedLoad?: number;
  backupRequirement?: string;
  location?: string;
  roofType?: string;
  roofSpace: number;
  shading: 'Low' | 'Medium' | 'High' | 'None';
  rating: number;
  assignedSalesperson: string;
  createdAt: string;
  notes: string;
  quotes: Quote[];
  survey?: Survey;
  installation?: Installation;
  
  // Scoring parameters with conversion calculation
  leadSource?: string;
  engagementLevel?: 'High' | 'Medium' | 'Low';
  conversionProbability?: number;
  conversionScore?: number;
  deletedAt?: string | null;
  deletedBy?: string | null;
}

export interface TicketMessage {
  sender: 'Customer' | 'Agent';
  text: string;
  time: string;
}

export interface Ticket {
  id: string;
  customerName: string;
  email: string;
  subject: string;
  description: string;
  status: 'Open' | 'In Progress' | 'Resolved' | 'New' | 'Under Review' | 'Technician Assigned' | 'Visit Scheduled' | 'Closed' | 'Rejected';
  priority: 'Low' | 'Medium' | 'High';
  createdAt: string;
  messages: TicketMessage[];
  
  // Advanced complaint attributes
  productSelection?: string;
  photos?: string[];
  videos?: string[];
  voiceNoteUrl?: string;
  location?: string;
  preferredVisitTime?: string;
  assignedTechnician?: string;
  internalNotes?: string;
  resolutionProofUrl?: string;
}

export interface ProductCategory {
  id: string;
  name: string;
  description?: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  brand: string;
  model: string;
  sku: string;
  serialNumber?: string;
  price: number;
  discount: number;
  stock: number;
  images: string[];
  videos?: string[];
  warrantyPeriod: string; // e.g. "25 Years", "2 Years"
  specifications: Record<string, string>;
  installationRequired: boolean;
  serviceRequired: boolean;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  orderType: 'Product' | 'Service' | 'Solar Project';
  status: 'Pending' | 'Confirmed' | 'Payment Pending' | 'Processing' | 'Dispatched' | 'Delivered' | 'Installed' | 'Cancelled' | 'Returned';
  items: OrderItem[];
  totalCost: number;
  createdAt: string;
  installationRequired?: boolean;
}

export interface Warranty {
  id: string;
  customerName: string;
  email: string;
  productName: string;
  productSku: string;
  serialNumber: string;
  startDate: string;
  endDate: string;
  installationDate?: string;
  warrantyDocumentUrl?: string;
  status: 'Active' | 'Expired';
  claimHistory: Array<{
    claimId: string;
    claimDate: string;
    issueTitle: string;
    description: string;
    status: 'Pending' | 'Approved' | 'Rejected';
    resolutionNotes?: string;
  }>;
}

export interface AppNotification {
  id: string;
  customerName: string;
  message: string;
  type: 'new_order' | 'new_complaint' | 'quotation_created' | 'payment_pending' | 'technician_assigned' | 'warranty_expiring' | 'order_delivered' | 'project_stage_updated';
  createdAt: string;
  read: boolean;
}

export interface NetMeteringLog {
  month: string;
  consumption: number;
  generation: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  desc: string;
  stock: number;
  cost: number;
}

export interface DashboardStats {
  totalRevenue: number;
  pendingRevenue: number;
  totalLeads: number;
  installedCount: number;
  contractedCount: number;
  pipelineCount: number;
  leadsByStatus: Record<string, number>;
}

export type AccountStatus = "Pending" | "Approved" | "Suspended" | "Rejected";

export interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  role: UserRole;
  customerId?: string;
  accountStatus?: AccountStatus;
  emailVerified?: boolean;
  onboardingCompleted?: boolean;
  onboardingCompletedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedReason?: string;
}

export interface Project {
  id: string;
  leadId: string;
  customerName: string;
  address: string;
  systemSizekW: number;
  stage: 'Lead Won' | 'Advance Received' | 'Material Procurement' | 'Structure Installation' | 'Panel Installation' | 'Inverter Installation' | 'Testing & Commissioning' | 'Net Metering Submitted' | 'Net Metering Approved' | 'Completed';
  createdAt: string;
  updatedAt: string;
}

export interface NetMeteringTracker {
  leadId: string;
  documentsCollected: boolean;
  applicationSubmitted: boolean;
  discoInspection: boolean;
  demandNotice: boolean;
  meterInstallation: boolean;
  greenMeterActive: boolean;
}

export interface PaymentMilestone {
  name: string;
  amount: number;
  status: 'Pending' | 'Paid';
  dueDate?: string;
}

export interface PaymentTrack {
  leadId: string;
  totalValue: number;
  advanceReceived: number;
  pendingAmount: number;
  reminderSent: boolean;
  invoiceStatus: 'Paid' | 'Pending' | 'Overdue';
  milestones: PaymentMilestone[];
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  role: string;
  action: string;
  details: string;
}

export interface WhatsAppLog {
  id: string;
  timestamp: string;
  customerName: string;
  phone: string;
  eventType: 'survey_confirmation' | 'quote_generation' | 'ticket_update' | 'contract_signed';
  messageText: string;
  status: 'Sent' | 'Delivered';
}

export interface AppState {
  leads: Lead[];
  tickets: Ticket[];
  netMeteringHistory: NetMeteringLog[];
  inventory: InventoryItem[];
  stats: DashboardStats;
  users?: User[];
  
  // Real enterprise models
  currentUser: User | null;
  projects: Project[];
  netMeteringTrackers: Record<string, NetMeteringTracker>;
  paymentTracks: Record<string, PaymentTrack>;
  activityLogs: ActivityLog[];
  whatsAppLogs: WhatsAppLog[];
  purchaseOrders?: any[];

  // Multi-business catalog and operations
  categories: ProductCategory[];
  products: Product[];
  orders: Order[];
  warranties: Warranty[];
  notifications: AppNotification[];
  solarPackages?: any[];
  settings?: any;
  websiteContent?: any;
  quotations?: any[];
  quoteTemplates?: any[];
  quoteTemplatePages?: any[];
  bankAccounts?: any[];
  companyTerms?: any[];
  ceoMessages?: any[];
  socialLinks?: any[];
  structureDescriptions?: any[];
  quotePdfSettings?: any[];
}

export type UserRole =
  | "Super Admin"
  | "Director"
  | "Technical CEO"
  | "Admin"
  | "Accounts Manager"
  | "Sales Manager"
  | "Sales Executive"
  | "Sales Advisor"
  | "Inventory Manager"
  | "Support Agent"
  | "Technician"
  | "Service Technician"
  | "Survey Engineer"
  | "Installation Team"
  | "Customer";

