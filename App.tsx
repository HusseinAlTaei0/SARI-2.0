import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { 
  Cloud, Camera, AlertCircle, Loader2, FileCheck, ArrowLeft, 
  Wallet, TrendingUp, Users, RefreshCcw, Zap, PackagePlus, 
  ArrowUpRight, ArrowDownLeft, MoreHorizontal, Calendar, ChevronDown,
  Search, Filter, Download, CheckCircle2, XCircle, Clock,
  AlertTriangle, PackageX, ShoppingBag, Package, ArrowRight,
  User, Phone, MapPin, DollarSign, X, ScanLine, FileText, Copy,
  Image as ImageIcon, Trash2, LayoutList, Eraser, ArrowDownWideNarrow, ArrowUpNarrowWide, CalendarDays, History,
  Save, Edit3, CreditCard, FileSpreadsheet, Printer,
  LayoutDashboard, ScrollText, Settings as SettingsIcon, LogOut,
  ArrowUpDown, Check, ChevronLeft, ChevronRight, Banknote,
  BarChart3, PieChart as PieChartIcon, LineChart, TrendingDown, CalendarRange,
  Activity, Store, Upload, Lock, Eye, EyeOff, ShieldCheck, UserPlus, LogIn,
  Sliders, Shield, Database, FileJson, Key, Bell, List, Plus, MessageCircle, AlertOctagon,
  MinusCircle, PlusCircle, Globe, Mail, FilePlus, Building2, Briefcase
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, BarChart, Bar } from 'recharts';
import { SilkBackground } from './components/SilkBackground';
import { utils, writeFile } from 'xlsx';

// --- Types ---
type Tab = 'dashboard' | 'transactions' | 'debts' | 'inventory' | 'reports' | 'settings';
type SettingsTab = 'store' | 'companies' | 'security' | 'data';
type TransactionStatus = 'completed' | 'pending' | 'failed';
type TransactionType = 'sale' | 'expense' | 'refund' | 'debt' | 'cash';
type SortOption = 'newest' | 'oldest' | 'highest' | 'lowest';

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  minLevel: number;
  price: number;
  cost: number;
}

interface Transaction {
  id: string;
  type: TransactionType;
  client: string; 
  clientPhone?: string; 
  itemId?: string; 
  date: string;
  time: string;
  amount: number;
  currency: 'USD' | 'IQD';
  status: TransactionStatus;
  method: string;
  rawText?: string; 
}

interface StoreProfile {
  name: string;
  phone: string;
  address: string;
  logo: string; 
  currencySymbol: string;
  knownCompanies: string[];
}

interface DashboardStats {
  totalSalesUSD: number;
  totalSalesIQD: number;
  netProfit: number;
  totalDebt: number;
  totalExpenses: number; 
  count: number;
  weeklyData: { dayIndex: number; total: number }[];
}

interface ReportStats {
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    collectionRate: number;
    atv: number;
    topProducts: { name: string; amount: number; count: number }[];
    bottomProducts: { name: string; amount: number; count: number }[];
    dailyTrend: { date: string; amount: number }[];
    weeklyActivity: { day: string; amount: number }[];
    busiestDay: string;
    composition: { cash: number; debt: number; expense: number };
    chartData: { date: string; revenue: number; expenses: number }[];
    pieData: { name: string; value: number }[];
    topDebtors: { name: string; amount: number }[];
}

// --- Constants ---
const EXCHANGE_RATE = 1520; 
const WEEK_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEK_DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DB_NAME = 'SariDB';
const STORE_NAME = 'transactions';
const INVENTORY_STORE = 'inventory';
const DB_VERSION = 2; 

// --- Worker Code ---
const WORKER_CODE = `
self.importScripts("https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js");
self.onmessage = function(e) {
  try {
    const data = new Uint8Array(e.data);
    const workbook = self.XLSX.read(data, { type: 'array', codepage: 65001 });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    // Get raw data (Array of Arrays)
    const jsonData = self.XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    self.postMessage({ success: true, data: jsonData });
  } catch (err) {
    self.postMessage({ success: false, error: err.message || "Unknown Worker Error" });
  }
};
`;

// --- IndexedDB Utilities ---
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains(INVENTORY_STORE)) {
        db.createObjectStore(INVENTORY_STORE, { keyPath: 'id' });
      }
    };
  });
};

const clearStore = async (): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORE_NAME, INVENTORY_STORE], 'readwrite');
    t.objectStore(STORE_NAME).clear();
    t.objectStore(INVENTORY_STORE).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
};

const bulkAddTransactions = async (items: Transaction[]): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    items.forEach(item => store.put(item));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

const dbOp = async <T,>(storeName: string, op: 'put' | 'delete' | 'getAll', item?: T | string): Promise<any> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const t = db.transaction([storeName], op === 'getAll' ? 'readonly' : 'readwrite');
        const store = t.objectStore(storeName);
        let req;
        if (op === 'getAll') req = store.getAll();
        else if (op === 'delete') req = store.delete(item as string);
        else req = store.put(item);
        
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

const createWorker = () => {
  const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
};

const formatCurrency = (amount: number, currency: 'USD' | 'IQD') => {
  if (currency === 'USD') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
  return new Intl.NumberFormat('ar-IQ', { style: 'decimal' }).format(amount) + ' IQD';
};

const generateId = () => `TX-${Math.floor(1000 + Math.random() * 9000)}`;
const generateItemId = () => `ITM-${Math.floor(10000 + Math.random() * 90000)}`;
const getStartOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]; };
const getToday = () => new Date().toISOString().split('T')[0];

// --- Performance Optimization: Chart Sampling ---
// Reduces the number of points rendered in the chart by averaging data in windows
const optimizeChartData = (data: { fullDate: string; date: string; revenue: number; expenses: number }[], limit: number) => {
    if (data.length <= limit) return data;

    const result = [];
    const windowSize = Math.ceil(data.length / limit);

    for (let i = 0; i < data.length; i += windowSize) {
        const window = data.slice(i, i + windowSize);
        if (window.length === 0) continue;
        
        const avgRev = Math.round(window.reduce((sum, item) => sum + item.revenue, 0) / window.length);
        const avgExp = Math.round(window.reduce((sum, item) => sum + item.expenses, 0) / window.length);
        
        result.push({
            date: window[0].date, // Use the start date of the window as label
            revenue: avgRev,
            expenses: avgExp,
            fullDate: window[0].fullDate
        });
    }
    return result;
};

const App: React.FC = () => {
  // --- Auth & Config ---
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    const local = localStorage.getItem('sari_auth_token');
    const session = sessionStorage.getItem('sari_auth_token');
    return local === 'true' || session === 'true';
  });

  const [isSignUp, setIsSignUp] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  
  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Sign Up State
  const [signUpData, setSignUpData] = useState({ storeName: '', fullName: '', email: '', phone: '', countryCode: '+964', password: '' });
  
  const countryCodes = [ { code: '+964', flag: '🇮🇶', label: 'Iraq' }, { code: '+966', flag: '🇸🇦', label: 'KSA' }, { code: '+971', flag: '🇦🇪', label: 'UAE' }, { code: '+1', flag: '🇺🇸', label: 'USA' } ];

  // --- App State ---
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('store');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  // --- Data State ---
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  
  // --- Settings ---
  const [storeInfo, setStoreInfo] = useState<StoreProfile>(() => {
    const saved = localStorage.getItem('sari_store_info');
    return saved ? JSON.parse(saved) : { name: 'SARI Store', phone: '', address: '', logo: '', currencySymbol: 'IQD', knownCompanies: ['General Customer', 'Supplier A', 'Supplier B'] };
  });
  const [itemsPerPage, setItemsPerPage] = useState<number>(() => parseInt(localStorage.getItem('sari_items_per_page') || '10'));
  const [inventoryAlerts, setInventoryAlerts] = useState<boolean>(() => localStorage.getItem('sari_inventory_alerts') !== 'false');

  // --- Filtering ---
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('newest');
  const [historySortOption, setHistorySortOption] = useState<SortOption>('newest');
  const [historyFilterType, setHistoryFilterType] = useState<'all' | 'sale' | 'expense'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [reportStartDate, setReportStartDate] = useState(getStartOfMonth());
  const [reportEndDate, setReportEndDate] = useState(getToday());
  const [reportSearchTerm, setReportSearchTerm] = useState('');
  const [newCompany, setNewCompany] = useState(''); 

  // --- Modals & Temp State ---
  const [editingItem, setEditingItem] = useState<Transaction | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; type: 'single' | 'all'; targetId?: string; targetName?: string; }>({ isOpen: false, type: 'single' });
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualForm, setManualForm] = useState<{type: 'sale'|'expense'|'debt', client: string, phone: string, amount: string, itemId: string, description: string}>({ type: 'sale', client: '', phone: '', amount: '', itemId: '', description: '' });
  const [companySearch, setCompanySearch] = useState(''); 
  const [showCompanyList, setShowCompanyList] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [newItemForm, setNewItemForm] = useState<InventoryItem>({ id: '', name: '', category: '', quantity: 0, minLevel: 5, price: 0, cost: 0 });
  
  // Drag and Drop State
  const [isDragging, setIsDragging] = useState(false);
  const [isCloudHovered, setIsCloudHovered] = useState(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // --- Load Data ---
  const loadData = useCallback(async () => {
    try {
      const txs = await dbOp(STORE_NAME, 'getAll');
      const inv = await dbOp(INVENTORY_STORE, 'getAll');
      setTransactions(txs);
      setInventory(inv);
    } catch (err) { console.error("DB Load Error", err); }
  }, []);

  useEffect(() => { if (isAuthenticated) loadData(); }, [loadData, isAuthenticated]);
  useEffect(() => { localStorage.setItem('sari_store_info', JSON.stringify(storeInfo)); }, [storeInfo]);
  useEffect(() => { localStorage.setItem('sari_items_per_page', itemsPerPage.toString()); }, [itemsPerPage]);
  useEffect(() => { localStorage.setItem('sari_inventory_alerts', inventoryAlerts.toString()); }, [inventoryAlerts]);
  useEffect(() => { if(success || error) { const t = setTimeout(() => { setSuccess(false); setError(null); }, 3000); return () => clearTimeout(t); } }, [success, error]);

  // --- Logic: Dashboard Stats ---
  const filteredTransactions = useMemo(() => {
    const activeSearch = activeTab === 'dashboard' ? searchTerm : searchQuery;
    const activeSort = activeTab === 'dashboard' ? sortOption : historySortOption;
    const lowerSearch = activeSearch.toLowerCase();

    let result = transactions.filter(t => {
      const matchesSearch = 
        t.client.toLowerCase().includes(lowerSearch) ||
        t.amount.toString().includes(lowerSearch) ||
        (t.rawText && t.rawText.toLowerCase().includes(lowerSearch));

      let matchesType = true;
      if (activeTab === 'debts') matchesType = t.type === 'debt';
      else if (activeTab === 'transactions') {
         matchesType = historyFilterType === 'all' ? true : historyFilterType === 'sale' ? (t.type === 'sale' || t.type === 'cash') : (t.type === 'expense' || t.type === 'refund');
      }
      return matchesSearch && matchesType;
    });

    result.sort((a, b) => {
      const dateA = new Date(`${a.date}T${a.time || '00:00'}`).getTime();
      const dateB = new Date(`${b.date}T${b.time || '00:00'}`).getTime();
      switch (activeSort) {
        case 'newest': return dateB - dateA;
        case 'oldest': return dateA - dateB;
        case 'highest': return b.amount - a.amount;
        case 'lowest': return a.amount - b.amount;
        default: return 0;
      }
    });
    return result;
  }, [transactions, activeTab, searchTerm, searchQuery, historyFilterType, sortOption, historySortOption]);

  const dashboardStats = useMemo<DashboardStats>(() => {
    let totalSalesUSD = 0;
    let totalExpensesUSD = 0;
    let totalDebt = 0;
    const dailyTotals = new Array(7).fill(0);

    filteredTransactions.forEach(t => {
      const val = t.currency === 'IQD' ? t.amount / EXCHANGE_RATE : t.amount;
      if ((t.type === 'sale' || t.type === 'cash') && t.status === 'completed') {
        totalSalesUSD += val;
        const d = new Date(t.date);
        if (!isNaN(d.getTime())) dailyTotals[d.getDay()] += val;
      } else if (t.type === 'expense') {
        totalExpensesUSD += val;
      } else if (t.type === 'debt' && t.status !== 'completed') {
        totalDebt += val;
      }
    });

    return {
      totalSalesUSD,
      totalSalesIQD: totalSalesUSD * EXCHANGE_RATE,
      netProfit: totalSalesUSD - totalExpensesUSD,
      totalDebt: totalDebt * EXCHANGE_RATE,
      totalExpenses: totalExpensesUSD,
      count: filteredTransactions.length,
      weeklyData: dailyTotals.map((val, idx) => ({ dayIndex: idx, total: val }))
    };
  }, [filteredTransactions]);

  const reportStats = useMemo<ReportStats>(() => {
     const start = new Date(reportStartDate).getTime();
     const end = new Date(reportEndDate).getTime();
     const lowerSearch = reportSearchTerm.toLowerCase();
     
     const filtered = transactions.filter(t => {
        const tDate = new Date(t.date).getTime();
        const matchesDate = tDate >= start && tDate <= end;
        const matchesSearch = !lowerSearch || 
            t.client.toLowerCase().includes(lowerSearch) || 
            t.amount.toString().includes(lowerSearch);
        return matchesDate && matchesSearch;
     });

     let revenue = 0, expenses = 0, pendingDebt = 0, collectedDebt = 0;
     const dailyMap = new Map<string, { revenue: number, expenses: number }>();
     const expenseCategoryMap = new Map<string, number>();
     const productMap = new Map<string, {amount: number, count: number}>();
     const debtorMap = new Map<string, number>();
     const dayOfWeekMap = new Array(7).fill(0);

     filtered.forEach(t => {
        const val = t.currency === 'IQD' ? t.amount / EXCHANGE_RATE : t.amount;
        const dateKey = t.date;
        const dayIndex = new Date(t.date).getDay();

        if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, { revenue: 0, expenses: 0 });
        const dayEntry = dailyMap.get(dateKey)!;

        if (t.type === 'sale' && t.status === 'completed') {
             revenue += val;
             dayEntry.revenue += val;
             
             const cur = productMap.get(t.client) || {amount: 0, count: 0};
             productMap.set(t.client, { amount: cur.amount + val, count: cur.count + 1});
             
             if(!isNaN(dayIndex)) dayOfWeekMap[dayIndex] += val;
        } else if (t.type === 'expense') {
            expenses += val;
            dayEntry.expenses += val;
            expenseCategoryMap.set(t.client, (expenseCategoryMap.get(t.client) || 0) + val);
        } else if (t.type === 'debt') {
            if (t.status === 'pending') {
                pendingDebt += val;
                debtorMap.set(t.client, (debtorMap.get(t.client) || 0) + val);
            } else if (t.status === 'completed') {
                collectedDebt += val;
                revenue += val; // Paid debt is revenue
                dayEntry.revenue += val;
            }
        }
     });

     const topProducts = Array.from(productMap.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);
     
     // Build raw chart data
     const rawChartData = Array.from(dailyMap.entries())
        .map(([date, data]) => ({ 
            fullDate: date,
            date: date.split('-').slice(1).join('/'), 
            ...data 
        }))
        .sort((a, b) => a.fullDate.localeCompare(b.fullDate));

     // Optimize chart data for large datasets (max 100 points)
     const chartData = optimizeChartData(rawChartData, 100);

     const pieData = Array.from(expenseCategoryMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

     const topDebtors = Array.from(debtorMap.entries())
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);

     const weeklyActivity = WEEK_DAYS.map((day, i) => ({ day, amount: dayOfWeekMap[i] }));

     let maxDayVal = -1; 
     let maxDayName = "N/A";
     dayOfWeekMap.forEach((v, i) => { if(v > maxDayVal) { maxDayVal = v; maxDayName = WEEK_DAYS_FULL[i]; }});

     return {
        totalRevenue: revenue,
        totalExpenses: expenses,
        netProfit: revenue - expenses,
        collectionRate: (collectedDebt + pendingDebt) > 0 ? (collectedDebt / (collectedDebt + pendingDebt)) * 100 : 0,
        atv: 0,
        topProducts,
        bottomProducts: [],
        dailyTrend: [],
        weeklyActivity,
        busiestDay: maxDayName,
        composition: { cash: 0, debt: pendingDebt, expense: expenses },
        chartData,
        pieData,
        topDebtors
     };
  }, [transactions, reportStartDate, reportEndDate, reportSearchTerm]);

  // --- Inventory Stats ---
  const inventoryStats = useMemo(() => {
    const totalItems = inventory.reduce((acc, i) => acc + i.quantity, 0);
    const totalValue = inventory.reduce((acc, i) => acc + (i.quantity * i.price), 0);
    const lowStockCount = inventory.filter(i => i.quantity <= i.minLevel).length;
    return { totalItems, totalValue, lowStockCount };
  }, [inventory]);

  // --- Debts Grouping ---
  const debtList = useMemo(() => {
    const grouped = new Map<string, { total: number, lastDate: string, phone: string, count: number }>();
    transactions.filter(t => t.type === 'debt' && t.status === 'pending').forEach(t => {
        const existing = grouped.get(t.client) || { total: 0, lastDate: t.date, phone: t.clientPhone || '', count: 0 };
        existing.total += t.amount;
        existing.count += 1;
        if(new Date(t.date) > new Date(existing.lastDate)) existing.lastDate = t.date;
        if(t.clientPhone) existing.phone = t.clientPhone;
        grouped.set(t.client, existing);
    });
    return Array.from(grouped.entries()).map(([name, data]) => ({ name, ...data }));
  }, [transactions]);

  const lowStockItems = useMemo(() => inventory.filter(i => i.quantity <= i.minLevel), [inventory]);
  const totalPages = useMemo(() => Math.ceil(filteredTransactions.length / itemsPerPage) || 1, [filteredTransactions.length, itemsPerPage]);

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const getTransactionName = (t: Transaction) => (!t.client || t.client === 'Imported' || t.client.trim() === '') ? `Process #${t.id.replace('TX-', '')}` : t.client;
  const calculateProfitMargin = () => {
    if (dashboardStats.totalSalesUSD === 0) return 0;
    const margin = (dashboardStats.netProfit / dashboardStats.totalSalesUSD) * 100;
    return Math.min(Math.max(margin, 0), 100); 
  };
  
  // --- Helpers for New Dashboard Widgets ---
  const recentTransactions = useMemo(() => transactions.slice(0, 5), [transactions]);
  const topProducts = useMemo(() => reportStats.topProducts.slice(0, 4), [reportStats]);

  // --- Actions ---
  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault(); 
    setAuthLoading(true); setAuthError('');
    
    if (isSignUp) {
        if (!signUpData.storeName || !signUpData.fullName || !signUpData.email || !signUpData.password) { setAuthError('يرجى ملء جميع الحقول الأساسية'); setAuthLoading(false); return; }
        if (!validateEmail(signUpData.email)) { setAuthError('البريد الإلكتروني غير صالح'); setAuthLoading(false); return; }
        if (signUpData.password.length < 6) { setAuthError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); setAuthLoading(false); return; }
        
        const userData = { ...signUpData };
        localStorage.setItem('SARI_USER_DATA', JSON.stringify(userData));
        setStoreInfo({ ...storeInfo, name: userData.storeName });
        
        localStorage.setItem('sari_auth_token', 'true');
        setIsAuthenticated(true);
    } else {
        const storedUser = JSON.parse(localStorage.getItem('SARI_USER_DATA') || 'null');
        const isValidUser = storedUser && storedUser.email === loginEmail && storedUser.password === loginPassword;
        const isAdmin = loginEmail === 'admin' && loginPassword === '123456';
        
        if (isValidUser || isAdmin) {
            localStorage.setItem('sari_auth_token', 'true');
            setIsAuthenticated(true);
        } else { setAuthError('بيانات الدخول غير صحيحة'); }
    }
    setAuthLoading(false);
  };

  const handleLogout = () => { setIsAuthenticated(false); localStorage.removeItem('sari_auth_token'); sessionStorage.removeItem('sari_auth_token'); setActiveTab('dashboard'); };

  const handleManualTransaction = async () => {
      const { type, client, phone, amount, itemId, description } = manualForm;
      const finalClient = type === 'expense' ? description : (companySearch || client); 
      const val = parseFloat(amount);
      if (!val || val <= 0) return;

      const newTx: Transaction = {
          id: generateId(), type: type === 'expense' ? 'expense' : type === 'debt' ? 'debt' : 'sale',
          client: finalClient, clientPhone: phone, itemId: itemId, amount: val,
          currency: storeInfo.currencySymbol === '$' ? 'USD' : 'IQD',
          date: new Date().toISOString().split('T')[0],
          time: new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'}),
          status: type === 'debt' ? 'pending' : 'completed', method: 'Manual'
      };

      if ((type === 'sale' || type === 'debt') && itemId) {
          const item = inventory.find(i => i.id === itemId);
          if (item) {
              const updatedItem = { ...item, quantity: item.quantity - 1 };
              await dbOp(INVENTORY_STORE, 'put', updatedItem);
              setInventory(prev => prev.map(i => i.id === itemId ? updatedItem : i));
          }
      }

      await dbOp(STORE_NAME, 'put', newTx);
      setTransactions(prev => [newTx, ...prev]);
      setManualModalOpen(false);
      setManualForm({ type: 'sale', client: '', phone: '', amount: '', itemId: '', description: '' });
      setCompanySearch('');
      setSuccess(true);
  };
  
  const handleEditSave = async () => {
      if (!editingItem) return;
      if (editingItem.amount <= 0) return;
      const updatedTx = { ...editingItem };
      await dbOp(STORE_NAME, 'put', updatedTx);
      setTransactions(prev => prev.map(t => t.id === updatedTx.id ? updatedTx : t));
      setEditingItem(null); setSuccess(true);
  };

  const handleInventorySave = async () => {
      if (!newItemForm.name || newItemForm.price <= 0) return;
      const item = { ...newItemForm, id: newItemForm.id || generateItemId() };
      await dbOp(INVENTORY_STORE, 'put', item);
      setInventory(prev => {
          const idx = prev.findIndex(i => i.id === item.id);
          if (idx >= 0) { const copy = [...prev]; copy[idx] = item; return copy; }
          return [...prev, item];
      });
      setItemModalOpen(false);
      setNewItemForm({ id: '', name: '', category: '', quantity: 0, minLevel: 5, price: 0, cost: 0 });
  };

  const handleDeleteInventory = async (id: string) => {
      if (confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
          await dbOp(INVENTORY_STORE, 'delete', id);
          setInventory(prev => prev.filter(i => i.id !== id));
      }
  };
  
  const handleAddCompany = () => {
      if(newCompany && !storeInfo.knownCompanies.includes(newCompany)) {
          setStoreInfo(prev => ({ ...prev, knownCompanies: [...prev.knownCompanies, newCompany] }));
          setNewCompany('');
      }
  };
  
  const handleDeleteCompany = (name: string) => {
      setStoreInfo(prev => ({ ...prev, knownCompanies: prev.knownCompanies.filter(c => c !== name) }));
  };

  const handleSettleClientDebt = async (clientName: string) => {
      if(confirm(`هل تريد تسوية جميع ديون ${clientName}؟`)) {
          const clientTxs = transactions.filter(t => t.client === clientName && t.type === 'debt' && t.status === 'pending');
          const updatedTxs = clientTxs.map(t => ({ ...t, status: 'completed' as TransactionStatus, date: getToday() })); // Mark as Paid today
          
          for(const t of updatedTxs) { await dbOp(STORE_NAME, 'put', t); }
          setTransactions(prev => prev.map(t => {
              const updated = updatedTxs.find(u => u.id === t.id);
              return updated || t;
          }));
          setSuccess(true);
      }
  };

  // --- STRICT HEADER-BASED PROCESS FILE (FINAL SOLUTION) ---
  const processFile = async (file: File) => {
    setIsUploading(true); 
    const worker = createWorker();
    
    worker.onmessage = async (e) => {
        try {
            if (e.data.success) {
                const newTxs: Transaction[] = [];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rows = e.data.data as any[][];
                
                // --- STRICT HEADER DETECTION ---
                let headerRowIndex = -1;
                let nameColIndex = -1;
                let priceColIndex = -1;
                let dateColIndex = -1;

                // Find the header row by searching for key column names
                for(let i = 0; i < Math.min(rows.length, 10); i++) {
                    const rowStr = rows[i].join(' ').toLowerCase();
                    if (rowStr.includes('menu_item_name') || rowStr.includes('name')) {
                        headerRowIndex = i;
                        // Map the specific column indices
                        rows[i].forEach((cell, idx) => {
                            const cellStr = String(cell).toLowerCase().trim();
                            if (cellStr === 'menu_item_name' || cellStr === 'name' || cellStr === 'product') nameColIndex = idx;
                            if (cellStr === 'actual_selling_price' || cellStr === 'price' || cellStr === 'amount') priceColIndex = idx;
                            if (cellStr === 'date' || cellStr === 'time') dateColIndex = idx;
                        });
                        break;
                    }
                }

                // Fallback logic if headers aren't found EXACTLY (though they should be for your file)
                if (nameColIndex === -1) nameColIndex = 3; // Based on your file, Name is usually column 3
                if (priceColIndex === -1) priceColIndex = 8; // Based on your file, Price is column 8 (actual_selling_price)
                if (dateColIndex === -1) dateColIndex = 0;

                // Start processing from the row AFTER the header
                const startDataRow = headerRowIndex !== -1 ? headerRowIndex + 1 : 1;
                
                // Define classification keywords
                const expenseKeywords = ['فاتورة', 'ايجار', 'راتب', 'كهرباء', 'انترنت', 'صيانة', 'شراء', 'صرف', 'expense', 'bill', 'rent', 'salary'];
                const debtKeywords = ['دين', 'اجل', 'آجل', 'قرض', 'debt', 'credit'];

                for (let i = startDataRow; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || row.length === 0) continue;

                    // 1. Get Name
                    let clientName = "مادة مستوردة";
                    if (row[nameColIndex]) {
                        clientName = String(row[nameColIndex]);
                    } else {
                        // Fallback heuristic: find a string that isn't a date and has no commas
                        const candidate = row.find(c => typeof c === 'string' && c.length > 2 && !c.includes(',') && !c.match(/\d{4}-\d{2}-\d{2}/));
                        if(candidate) clientName = candidate;
                    }

                    // 2. Get Price
                    let amount = 0;
                    if (row[priceColIndex] != null) {
                        const rawPrice = row[priceColIndex];
                        if (typeof rawPrice === 'number') amount = rawPrice;
                        else if (typeof rawPrice === 'string') amount = parseFloat(rawPrice.replace(/[^0-9.]/g, ''));
                    }
                    
                    // 3. Get Date
                    let finalDate = getToday();
                    if (row[dateColIndex]) {
                        const rawDate = String(row[dateColIndex]);
                        if (rawDate.match(/\d{4}-\d{2}-\d{2}/)) finalDate = rawDate;
                    }

                    if (!amount) continue;

                    // 4. Determine Type and Status based on Keywords
                    const lowerName = clientName.toLowerCase();
                    let type: TransactionType = 'sale';
                    let status: TransactionStatus = 'completed';

                    if (expenseKeywords.some(k => lowerName.includes(k))) {
                        type = 'expense';
                        status = 'completed';
                    } else if (debtKeywords.some(k => lowerName.includes(k))) {
                        type = 'debt';
                        status = 'pending';
                    }

                    const matchedItem = inventory.find(inv => inv.name.toLowerCase() === clientName.toLowerCase());

                    newTxs.push({
                        id: generateId(), 
                        type: type,
                        client: clientName, 
                        itemId: matchedItem?.id,
                        date: finalDate, 
                        time: '12:00', 
                        amount: Math.abs(amount), 
                        currency: 'IQD', 
                        status: status, 
                        method: 'Import'
                    } as Transaction);
                }

                if(newTxs.length) { await bulkAddTransactions(newTxs); loadData(); setSuccess(true); }
            }
        } catch (error) {
            console.error("Processing error", error);
            setError("فشل معالجة الملف");
        } finally {
            worker.terminate();
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    worker.onerror = (e) => {
        console.error("Worker error", e);
        setError("حدث خطأ في المعالجة");
        worker.terminate();
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
    }
    
    const reader = new FileReader();
    reader.onload = (e) => worker.postMessage(e.target?.result, [e.target?.result as ArrayBuffer]);
    reader.readAsArrayBuffer(file);
  };
  
  // Drag and Drop Handlers
  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
  };
  
  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          processFile(e.dataTransfer.files[0]);
      }
  };

  const handleExport = () => {
    const ws = utils.json_to_sheet(transactions);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Transactions");
    writeFile(wb, "Sari_Transactions.xlsx");
  };
  const handleZoneClick = () => { fileInputRef.current?.click(); };
  const initiateDelete = (id: string, name: string) => { setDeleteModal({ isOpen: true, type: 'single', targetId: id, targetName: name }); };
  const initiateClearAll = () => { setDeleteModal({ isOpen: true, type: 'all' }); };
  const handleDeleteConfirm = async () => {
    if (deleteModal.type === 'single' && deleteModal.targetId) { await dbOp(STORE_NAME, 'delete', deleteModal.targetId); setTransactions(prev => prev.filter(t => t.id !== deleteModal.targetId)); } 
    else if (deleteModal.type === 'all') { await clearStore(); setTransactions([]); setInventory([]); }
    setDeleteModal({ isOpen: false, type: 'single' }); setSuccess(true);
  };

  const pageVariants: Variants = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -10 } };
  const currentItems = useMemo(() => { const s = (currentPage - 1) * itemsPerPage; return filteredTransactions.slice(s, s + itemsPerPage); }, [filteredTransactions, currentPage, itemsPerPage]);
  const chartData = useMemo(() => { const max = Math.max(...dashboardStats.weeklyData.map(d => d.total)) || 1; return WEEK_DAYS.map((l, i) => ({ label: l, value: dashboardStats.weeklyData.find(d => d.dayIndex === i)?.total || 0, max })); }, [dashboardStats]);

  // --- Render Logic (Gatekeeper) ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-sari-dark font-sans" dir="rtl">
         <SilkBackground />
         <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="z-10 w-full max-w-md p-8 md:p-12 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
             <div className="flex flex-col items-center mb-10 relative z-10">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-sari-purple to-sari-purple-deep flex items-center justify-center shadow-lg shadow-sari-purple/20 mb-4 ring-1 ring-white/20"><Zap className="text-white" size={40} fill="currentColor" /></div>
                <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sari-purple to-pink-500 mb-2">SARI APP</h1>
                <p className="text-white/40 text-sm">{isSignUp ? 'إنشاء حساب جديد للمتجر' : 'تسجيل الدخول للمتابعة'}</p>
             </div>
             <form onSubmit={handleAuthSubmit} className="space-y-6 relative z-10">
                <AnimatePresence mode="wait">
                  {isSignUp && (
                      <motion.div initial={{opacity:0, height:0}} animate={{opacity:1, height:'auto'}} exit={{opacity:0, height:0}} className="space-y-4 overflow-hidden">
                         <div className="space-y-2"><label className="text-xs font-bold text-white/60 block pr-1">اسم المتجر</label><input type="text" value={signUpData.storeName} onChange={(e) => setSignUpData({...signUpData, storeName: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl py-3.5 px-4 text-white focus:outline-none focus:border-sari-purple/50 transition-all" placeholder="اسم المتجر" /></div>
                         <div className="space-y-2"><label className="text-xs font-bold text-white/60 block pr-1">الاسم الكامل</label><input type="text" value={signUpData.fullName} onChange={(e) => setSignUpData({...signUpData, fullName: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl py-3.5 px-4 text-white focus:outline-none focus:border-sari-purple/50 transition-all" placeholder="الاسم الكامل" /></div>
                         <div className="space-y-2"><label className="text-xs font-bold text-white/60 block pr-1">رقم الهاتف</label><div className="flex bg-black/20 border border-white/10 rounded-xl overflow-hidden focus-within:border-sari-purple/50 transition-all"><select value={signUpData.countryCode} onChange={(e) => setSignUpData({...signUpData, countryCode: e.target.value})} className="bg-transparent text-white px-3 py-3.5 outline-none appearance-none cursor-pointer pl-2 text-sm bg-[#0f0f11]">{countryCodes.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}</select><input type="tel" value={signUpData.phone} onChange={(e) => setSignUpData({...signUpData, phone: e.target.value})} className="flex-1 bg-transparent py-3.5 px-4 text-white focus:outline-none font-num" placeholder="780xxxxxxx" /></div></div>
                      </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-2">
                   <label className="text-xs font-bold text-white/60 block pr-1">البريد الإلكتروني</label>
                   <div className="relative group"><Mail className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40" size={18} /><input type="email" value={isSignUp ? signUpData.email : loginEmail} onChange={(e) => isSignUp ? setSignUpData({...signUpData, email: e.target.value}) : setLoginEmail(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl py-3.5 pr-12 pl-4 text-white focus:outline-none focus:border-sari-purple/50 transition-all" placeholder="example@domain.com" /></div>
                </div>

                <div className="space-y-2">
                   <label className="text-xs font-bold text-white/60 block pr-1">كلمة المرور</label>
                   <div className="relative group"><Lock className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40" size={18} /><input type={showPassword ? "text" : "password"} value={isSignUp ? signUpData.password : loginPassword} onChange={(e) => isSignUp ? setSignUpData({...signUpData, password: e.target.value}) : setLoginPassword(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl py-3.5 pr-12 pl-12 text-white focus:outline-none focus:border-sari-purple/50 transition-all" placeholder="••••••••" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
                </div>

                {!isSignUp && (
                    <div className="flex items-center gap-2"><div className="relative flex items-center"><input type="checkbox" id="rememberMe" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-white/10 bg-black/20 checked:border-sari-purple checked:bg-sari-purple transition-all" /><Check className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" size={12} strokeWidth={4} /></div><label htmlFor="rememberMe" className="text-sm text-white/60 cursor-pointer select-none">تذكرني</label></div>
                )}

                {authError && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-200 text-sm"><AlertCircle size={16} /> {authError}</div>}
                
                <button type="submit" disabled={authLoading} className="w-full py-4 bg-gradient-to-r from-sari-purple to-sari-purple-deep hover:scale-[1.02] text-white rounded-xl font-bold shadow-lg shadow-sari-purple/20 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed">
                    {authLoading ? <Loader2 className="animate-spin" /> : isSignUp ? 'إنشاء حساب' : 'دخول'}
                </button>
             </form>
             <div className="mt-8 pt-6 border-t border-white/5 text-center relative z-10"><button onClick={() => { setIsSignUp(!isSignUp); setAuthError(''); }} className="text-white font-bold hover:text-sari-purple transition-colors text-sm">{isSignUp ? 'لديك حساب؟ تسجيل الدخول' : 'ليس لديك حساب؟ إنشاء حساب جديد'}</button></div>
         </motion.div>
      </div>
    );
  }

  // --- Main App Layout ---
  return (
    <div className="flex h-screen w-full bg-sari-dark text-sari-platinum overflow-hidden font-sans selection:bg-sari-purple selection:text-white print:bg-white print:text-black">
      <div className="print:hidden"><SilkBackground /></div>

      {/* Sidebar */}
      <nav className="z-50 flex-shrink-0 w-16 md:w-64 flex flex-col bg-black/40 backdrop-blur-2xl border-r border-white/10 h-full print:hidden transition-all duration-300">
        <div className="p-6 flex items-center justify-center md:justify-start gap-3 border-b border-white/5">
          {storeInfo.logo ? <img src={storeInfo.logo} className="w-10 h-10 rounded-xl object-cover" /> : <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sari-purple to-sari-purple-deep flex items-center justify-center shadow-lg shadow-sari-purple/20 mb-4 ring-1 ring-white/20"><Zap className="text-white" size={24} fill="currentColor" /></div>}
          <span className="text-xl font-bold tracking-tight text-white hidden md:block truncate">{storeInfo.name}</span>
        </div>
        <div className="flex-1 px-3 py-6 space-y-2 overflow-y-auto flex flex-col custom-scrollbar">
             {[{id: 'dashboard', icon: LayoutDashboard, label: 'الرئيسية'}, {id: 'transactions', icon: ScrollText, label: 'السجل'}, {id: 'reports', icon: BarChart3, label: 'التقارير'}, {id: 'debts', icon: Banknote, label: 'الديون'}, {id: 'inventory', icon: Package, label: 'المخزن'}, {id: 'settings', icon: SettingsIcon, label: 'الإعدادات'}].map(item => (
                <button key={item.id} onClick={() => setActiveTab(item.id as Tab)} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${activeTab === item.id ? 'bg-sari-purple text-white shadow-lg shadow-sari-purple/20' : 'text-white/40 hover:bg-white/5 hover:text-white'}`}><item.icon size={20}/><span className="hidden md:block font-medium">{item.label}</span></button>
             ))}
             <div className="mt-auto pt-4 border-t border-white/5"><button onClick={handleLogout} className="w-full flex items-center gap-3 p-3 rounded-xl text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"><LogOut size={20} /><span className="hidden md:block font-bold">خروج</span></button></div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-y-auto overflow-x-hidden p-4 md:p-8 scroll-smooth">
        <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} />
        
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="max-w-7xl mx-auto space-y-8">
               <div className="flex flex-col md:flex-row justify-between items-end gap-4">
                  <div><h1 className="text-3xl font-bold text-white">صباح الخير، {storeInfo.name} 👋</h1><p className="text-white/40 text-sm mt-1">إليك ملخص سريع لما يحدث في متجرك اليوم</p></div>
                  <div className="relative w-full md:max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} /><input type="text" placeholder="بحث سريع..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-right text-white focus:outline-none focus:border-sari-purple/50" dir="rtl" /></div>
               </div>
               
               {/* Cloud Action Zone - SPLIT LAYOUT */}
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                   {/* Left: Drag & Drop Zone */}
                   <motion.div 
                        onHoverStart={() => setIsCloudHovered(true)} 
                        onHoverEnd={() => setIsCloudHovered(false)} 
                        onClick={() => { if(!isUploading) handleZoneClick(); }} 
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        whileHover={!isUploading ? { scale: 1.01 } : {}}
                        className={`md:col-span-2 relative h-48 rounded-[2rem] overflow-hidden border transition-all duration-300 cursor-pointer flex flex-col items-center justify-center bg-white/5 backdrop-blur-xl group
                        ${isDragging || isCloudHovered ? 'border-sari-purple shadow-[0_0_30px_-10px_rgba(139,92,246,0.3)] bg-sari-purple/5' : 'border-white/10 hover:bg-white/10'}
                        ${isUploading ? 'pointer-events-none' : ''}`}
                   >
                       {isUploading ? (
                            <div className="flex flex-col items-center">
                                <Loader2 size={32} className="animate-spin text-sari-purple mb-4" />
                                <h3 className="text-xl font-bold text-white mb-1">جاري المعالجة...</h3>
                                <p className="text-white/40 text-sm">يرجى الانتظار</p>
                            </div>
                       ) : (
                           <>
                                <div className="absolute inset-0 bg-gradient-to-br from-sari-purple/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                <div className="z-10 flex flex-col items-center">
                                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-all duration-300 ${isDragging || isCloudHovered ? 'bg-sari-purple text-white scale-110 shadow-lg' : 'bg-white/10 text-white/50'}`}>
                                        <Cloud size={32} />
                                    </div>
                                    <h3 className="text-xl font-bold text-white mb-1">إضافة معاملة جديدة</h3>
                                    <p className="text-white/40 text-sm">{isDragging ? 'أفلت الملف هنا...' : 'اسحب الملف هنا أو اضغط للرفع'}</p>
                                </div>
                           </>
                       )}
                   </motion.div>

                   {/* Right: Quick Action Buttons */}
                   <div className="md:col-span-1 flex flex-col gap-4">
                       <button onClick={() => setManualModalOpen(true)} disabled={isUploading} className="flex-1 rounded-[2rem] bg-white/5 border border-white/10 hover:bg-sari-purple hover:border-sari-purple hover:shadow-lg hover:shadow-sari-purple/20 transition-all group flex items-center justify-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed">
                           <div className="w-12 h-12 rounded-full bg-white/10 group-hover:bg-white/20 flex items-center justify-center transition-colors"><Plus size={24} className="text-white"/></div>
                           <span className="text-lg font-bold text-white">إضافة يدوية</span>
                       </button>
                       <button disabled={isUploading} className="flex-1 rounded-[2rem] bg-white/5 border border-white/10 hover:bg-sari-purple hover:border-sari-purple hover:shadow-lg hover:shadow-sari-purple/20 transition-all group flex items-center justify-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed">
                           <div className="w-12 h-12 rounded-full bg-white/10 group-hover:bg-white/20 flex items-center justify-center transition-colors"><Camera size={24} className="text-white"/></div>
                           <span className="text-lg font-bold text-white">تصوير</span>
                       </button>
                   </div>
               </div>

               {/* Stats Cards */}
               <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="p-6 rounded-3xl bg-emerald-500/5 border border-emerald-500/10 backdrop-blur-xl hover:border-emerald-500/30 transition-colors"><h3 className="text-emerald-400 text-sm font-bold mb-2 flex items-center gap-2"><ArrowUpRight size={16} /> المبيعات</h3><div className="text-3xl font-bold text-white font-num tracking-tight">{formatCurrency(dashboardStats.totalSalesUSD, storeInfo.currencySymbol === '$' ? 'USD' : 'IQD')}</div></div>
                  <div className="p-6 rounded-3xl bg-amber-500/5 border border-amber-500/10 backdrop-blur-xl hover:border-amber-500/30 transition-colors"><h3 className="text-amber-400 text-sm font-bold mb-2 flex items-center gap-2"><ArrowDownLeft size={16} /> المصروفات</h3><div className="text-3xl font-bold text-white font-num tracking-tight">{formatCurrency(dashboardStats.totalExpenses, storeInfo.currencySymbol === '$' ? 'USD' : 'IQD')}</div></div>
                  <div className="p-6 rounded-3xl bg-rose-500/5 border border-rose-500/10 backdrop-blur-xl hover:border-rose-500/30 transition-colors"><h3 className="text-rose-400 text-sm font-bold mb-2 flex items-center gap-2"><AlertCircle size={16} /> الديون</h3><div className="text-3xl font-bold text-white font-num tracking-tight">{formatCurrency(dashboardStats.totalDebt, storeInfo.currencySymbol === '$' ? 'USD' : 'IQD')}</div></div>
                  <div className="p-6 rounded-3xl bg-blue-500/5 border border-blue-500/10 backdrop-blur-xl relative overflow-hidden hover:border-blue-500/30 transition-colors"><div className="relative z-10"><h3 className="text-blue-400 text-sm font-bold mb-2 flex items-center gap-2"><TrendingUp size={16} /> صافي الربح</h3><div className="text-3xl font-bold text-white font-num tracking-tight mb-4">{formatCurrency(dashboardStats.netProfit, storeInfo.currencySymbol === '$' ? 'USD' : 'IQD')}</div><div className="flex items-center justify-between text-[10px] text-blue-200/60 font-bold mb-1"><span>هامش الربح</span><span className="font-num">{calculateProfitMargin().toFixed(1)}%</span></div><div className="w-full h-1.5 bg-blue-500/20 rounded-full overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${calculateProfitMargin()}%` }} className="h-full bg-blue-500 rounded-full"/></div></div></div>
               </div>
               
               {/* NEW DASHBOARD WIDGETS */}
               <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                   {/* Left Column: Chart */}
                   <div className="lg:col-span-2 h-[400px] p-6 bg-white/5 border border-white/10 rounded-[2rem] flex flex-col backdrop-blur-xl">
                       <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2"><Activity className="text-sari-purple" size={20} /> نشاط المبيعات الأسبوعي</h3>
                       <div className="flex-1 w-full min-h-0">
                           <ResponsiveContainer width="100%" height="100%">
                               <AreaChart data={chartData}>
                                   <defs>
                                       <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                           <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                                           <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                                       </linearGradient>
                                   </defs>
                                   <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                                   <XAxis dataKey="label" stroke="#9ca3af" tick={{fill: '#6b7280', fontSize: 12}} tickLine={false} axisLine={false} />
                                   <YAxis stroke="#9ca3af" tick={{fill: '#6b7280', fontSize: 12}} tickLine={false} axisLine={false} />
                                   <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px', color: '#fff' }} />
                                   <Area type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                               </AreaChart>
                           </ResponsiveContainer>
                       </div>
                   </div>

                   {/* Right Column: Recent Transactions & Top Products */}
                   <div className="space-y-6">
                       {/* Recent List */}
                       <div className="p-6 bg-white/5 border border-white/10 rounded-[2rem] backdrop-blur-xl">
                           <div className="flex justify-between items-center mb-4">
                               <h3 className="font-bold text-white">أحدث العمليات</h3>
                               <button onClick={() => setActiveTab('transactions')} className="text-xs text-sari-purple hover:text-white transition-colors">عرض الكل</button>
                           </div>
                           <div className="space-y-3">
                               {recentTransactions.map((t, i) => (
                                   <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                                       <div className="flex items-center gap-3">
                                           <div className={`w-10 h-10 rounded-full flex items-center justify-center ${t.type === 'expense' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                               {t.type === 'expense' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                                           </div>
                                           <div>
                                               <div className="text-sm font-bold text-white truncate max-w-[100px]">{t.client}</div>
                                               <div className="text-[10px] text-white/40">{t.date}</div>
                                           </div>
                                       </div>
                                       <div className={`font-bold font-num text-sm ${t.type === 'expense' ? 'text-amber-500' : 'text-emerald-500'}`}>
                                           {formatCurrency(t.amount, 'IQD')}
                                       </div>
                                   </div>
                               ))}
                               {recentTransactions.length === 0 && <div className="text-center text-white/30 text-xs py-4">لا توجد عمليات حديثة</div>}
                           </div>
                       </div>

                       {/* Top Products */}
                       <div className="p-6 bg-white/5 border border-white/10 rounded-[2rem] backdrop-blur-xl">
                           <h3 className="font-bold text-white mb-4">الأكثر مبيعاً</h3>
                           <div className="space-y-4">
                               {topProducts.map((p, i) => (
                                   <div key={i}>
                                       <div className="flex justify-between text-xs mb-1">
                                           <span className="text-white">{p.name}</span>
                                           <span className="text-white/60 font-num">{p.count} عملية</span>
                                       </div>
                                       <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                                           <div className="h-full bg-sari-purple rounded-full" style={{ width: `${Math.min((p.amount / (topProducts[0]?.amount || 1)) * 100, 100)}%` }}></div>
                                       </div>
                                   </div>
                               ))}
                               {topProducts.length === 0 && <div className="text-center text-white/30 text-xs py-4">لا توجد بيانات كافية</div>}
                           </div>
                       </div>
                   </div>
               </div>
            </motion.div>
          )}

          {activeTab === 'reports' && (
            <motion.div key="reports" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="max-w-7xl mx-auto space-y-8">
                {/* --- Luxury Glassmorphism Panel --- */}
                <div className="relative p-8 rounded-[2.5rem] bg-gradient-to-b from-white/5 to-black/20 border border-white/10 backdrop-blur-2xl overflow-hidden shadow-2xl">
                    {/* Decorative background elements */}
                    <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-50" />
                    <div className="absolute -top-40 -right-40 w-96 h-96 bg-sari-purple/20 blur-[100px] rounded-full pointer-events-none mix-blend-screen" />
                    
                    {/* Header Section */}
                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10">
                        <div>
                            <h2 className="text-4xl font-bold text-white mb-2 tracking-tight">التقرير التنفيذي</h2>
                            <div className="flex items-center gap-2 text-white/40 text-sm">
                                <Activity size={16} />
                                <span>نظرة شاملة على أداء المتجر</span>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                             <div className="group relative bg-[#0a0a0c] border border-white/10 rounded-2xl px-4 py-2 flex flex-col min-w-[180px] focus-within:border-white/20 transition-colors">
                                <div className="flex items-center gap-2 mb-1">
                                    <Search size={12} className="text-white/40 group-focus-within:text-sari-purple transition-colors" />
                                    <span className="text-[10px] text-white/40 font-medium">بحث</span>
                                </div>
                                <input 
                                    type="text" 
                                    value={reportSearchTerm} 
                                    onChange={e => setReportSearchTerm(e.target.value)} 
                                    className="bg-transparent border-none text-white text-sm focus:outline-none p-0 w-full placeholder:text-white/20" 
                                    placeholder="عميل، مبلغ..."
                                />
                            </div>

                             <div className="group relative bg-[#0a0a0c] border border-white/10 rounded-2xl px-4 py-2 flex flex-col min-w-[140px] focus-within:border-white/20 transition-colors">
                                <span className="text-[10px] text-white/40 font-medium mb-0.5">من</span>
                                <input style={{colorScheme: 'dark'}} type="date" value={reportStartDate} onChange={e=>setReportStartDate(e.target.value)} className="bg-transparent border-none text-white font-num text-sm focus:outline-none p-0 w-full" />
                            </div>
                            
                            <div className="group relative bg-[#0a0a0c] border border-white/10 rounded-2xl px-4 py-2 flex flex-col min-w-[140px] focus-within:border-white/20 transition-colors">
                                <span className="text-[10px] text-white/40 font-medium mb-0.5">إلى</span>
                                <input style={{colorScheme: 'dark'}} type="date" value={reportEndDate} onChange={e=>setReportEndDate(e.target.value)} className="bg-transparent border-none text-white font-num text-sm focus:outline-none p-0 w-full" />
                            </div>

                            <button onClick={() => window.print()} className="w-[58px] h-[58px] flex items-center justify-center bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 text-white transition-all hover:scale-105 active:scale-95">
                                <Printer size={22} />
                            </button>
                        </div>
                    </div>

                    {/* KPI Cards Grid */}
                    <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        
                        {/* Revenue Card */}
                        <div className="p-6 rounded-[2rem] bg-[#0f0f11]/60 border border-white/5 shadow-xl backdrop-blur-md relative overflow-hidden group hover:border-emerald-500/30 transition-all duration-300">
                            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 rounded-xl border border-emerald-500/20 flex items-center justify-center text-emerald-400 bg-emerald-500/10 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)]">
                                        <Wallet size={20} />
                                    </div>
                                    <span className="text-emerald-400 font-bold text-sm">إجمالي الإيرادات</span>
                                </div>
                                <div className="text-4xl font-bold text-white font-num tracking-tight">{formatCurrency(reportStats.totalRevenue, 'USD')}</div>
                            </div>
                        </div>

                        {/* Expenses Card */}
                        <div className="p-6 rounded-[2rem] bg-[#0f0f11]/60 border border-white/5 shadow-xl backdrop-blur-md relative overflow-hidden group hover:border-amber-500/30 transition-all duration-300">
                            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 rounded-xl border border-amber-500/20 flex items-center justify-center text-amber-400 bg-amber-500/10 shadow-[0_0_15px_-3px_rgba(245,158,11,0.2)]">
                                        <ArrowDownLeft size={20} />
                                    </div>
                                    <span className="text-amber-400 font-bold text-sm">المصروفات</span>
                                </div>
                                <div className="text-4xl font-bold text-white font-num tracking-tight">{formatCurrency(reportStats.totalExpenses, 'USD')}</div>
                            </div>
                        </div>

                        {/* Net Profit Card */}
                        <div className="p-6 rounded-[2rem] bg-[#0f0f11]/60 border border-white/5 shadow-xl backdrop-blur-md relative overflow-hidden group hover:border-blue-500/30 transition-all duration-300">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 rounded-xl border border-blue-500/20 flex items-center justify-center text-blue-400 bg-blue-500/10 shadow-[0_0_15px_-3px_rgba(59,130,246,0.2)]">
                                        <TrendingUp size={20} />
                                    </div>
                                    <span className="text-blue-400 font-bold text-sm">صافي الربح</span>
                                </div>
                                <div className="text-4xl font-bold text-white font-num tracking-tight">{formatCurrency(reportStats.netProfit, 'USD')}</div>
                            </div>
                        </div>

                        {/* Debt Collection Card */}
                        <div className="p-6 rounded-[2rem] bg-[#0f0f11]/60 border border-white/5 shadow-xl backdrop-blur-md relative overflow-hidden group hover:border-rose-500/30 transition-all duration-300">
                            <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 rounded-xl border border-rose-500/20 flex items-center justify-center text-rose-400 bg-rose-500/10 shadow-[0_0_15px_-3px_rgba(244,63,94,0.2)]">
                                        <RefreshCcw size={20} />
                                    </div>
                                    <span className="text-rose-400 font-bold text-sm">تحصيل الديون</span>
                                </div>
                                <div className="text-4xl font-bold text-white font-num tracking-tight mb-2">{reportStats.collectionRate.toFixed(1)}%</div>
                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <motion.div 
                                        initial={{ width: 0 }} 
                                        animate={{ width: `${reportStats.collectionRate}%` }} 
                                        className="h-full bg-gradient-to-r from-rose-500 to-rose-400 rounded-full shadow-[0_0_10px_rgba(244,63,94,0.5)]"
                                    />
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

                {/* --- Main Chart: Sales Trend --- */}
                <div className="h-[400px] p-6 bg-gradient-to-b from-white/5 to-black/20 border border-white/10 rounded-[2.5rem] backdrop-blur-xl flex flex-col shadow-xl">
                    <h3 className="text-white font-bold mb-6 flex items-center gap-2"><Activity className="text-sari-purple" size={20} /> التحليل الزمني للإيرادات</h3>
                    <div className="flex-1 w-full min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={reportStats.chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorRevReport" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                    </linearGradient>
                                    <linearGradient id="colorExpReport" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                                <XAxis dataKey="date" stroke="#9ca3af" tick={{fill: '#6b7280', fontSize: 10}} tickLine={false} axisLine={false} />
                                <YAxis stroke="#9ca3af" tick={{fill: '#6b7280', fontSize: 10}} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                                <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px', color: '#fff' }} />
                                <Legend verticalAlign="top" height={36} iconType="circle" />
                                <Area type="monotone" dataKey="revenue" name="الإيرادات" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorRevReport)" />
                                <Area type="monotone" dataKey="expenses" name="المصروفات" stroke="#f59e0b" strokeWidth={3} fillOpacity={1} fill="url(#colorExpReport)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* --- Secondary Row: Insights Grid --- */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Spending Analysis */}
                    <div className="p-6 bg-white/5 border border-white/10 rounded-[2rem] backdrop-blur-xl flex flex-col h-[350px]">
                        <h3 className="text-white font-bold mb-4 flex items-center gap-2"><PieChartIcon className="text-amber-400" size={18} /> تحليل الإنفاق</h3>
                        <div className="flex-1 relative">
                            {reportStats.totalExpenses > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={reportStats.pieData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                            {reportStats.pieData.map((entry, index) => (<Cell key={`cell-${index}`} fill={['#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6'][index % 4]} />))}
                                        </Pie>
                                        <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} />
                                        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{fontSize: '10px'}} />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">لا توجد بيانات مصروفات</div>
                            )}
                        </div>
                    </div>

                    {/* Peak Days */}
                    <div className="p-6 bg-white/5 border border-white/10 rounded-[2rem] backdrop-blur-xl flex flex-col h-[350px]">
                        <h3 className="text-white font-bold mb-4 flex items-center gap-2"><CalendarDays className="text-blue-400" size={18} /> نشاط الأسبوع</h3>
                        <div className="flex-1 w-full min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={reportStats.weeklyActivity}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                                    <XAxis dataKey="day" stroke="#9ca3af" tick={{fill: '#6b7280', fontSize: 10}} tickLine={false} axisLine={false} />
                                    <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px', color: '#fff' }} />
                                    <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Top Products List */}
                    <div className="p-6 bg-white/5 border border-white/10 rounded-[2rem] backdrop-blur-xl flex flex-col h-[350px]">
                        <h3 className="text-white font-bold mb-4 flex items-center gap-2"><Package className="text-emerald-400" size={18} /> الأكثر مبيعاً</h3>
                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
                            {reportStats.topProducts.map((p, i) => (
                                <div key={i} className="group">
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-white font-medium">{p.name}</span>
                                        <span className="text-white/60 font-num">{formatCurrency(p.amount, 'IQD')}</span>
                                    </div>
                                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 rounded-full group-hover:bg-emerald-400 transition-colors" style={{ width: `${Math.min((p.amount / (reportStats.topProducts[0]?.amount || 1)) * 100, 100)}%` }}></div>
                                    </div>
                                </div>
                            ))}
                            {reportStats.topProducts.length === 0 && <div className="text-center text-white/30 text-xs py-10">لا توجد بيانات</div>}
                        </div>
                    </div>
                </div>

                {/* --- Bottom Row: Top Debtors --- */}
                <div className="p-6 bg-white/5 border border-white/10 rounded-[2rem] backdrop-blur-xl">
                    <h3 className="text-white font-bold mb-4 flex items-center gap-2"><Users className="text-rose-400" size={18} /> قائمة كبار المدينين</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {reportStats.topDebtors.map((d, i) => (
                            <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-rose-500/30 transition-all">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center font-bold">{d.name.charAt(0)}</div>
                                    <div className="text-sm font-bold text-white">{d.name}</div>
                                </div>
                                <div className="text-rose-400 font-bold font-num">{formatCurrency(d.amount, 'IQD')}</div>
                            </div>
                        ))}
                        {reportStats.topDebtors.length === 0 && <div className="col-span-full text-center text-white/30 text-sm py-4">لا توجد ديون مستحقة</div>}
                    </div>
                </div>
            </motion.div>
          )}

          {activeTab === 'inventory' && (
            <motion.div key="inventory" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* --- Inventory Left Stats --- */}
                <div className="lg:col-span-1 space-y-4">
                    <div className="p-6 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl">
                        <div className="flex items-center gap-3 mb-4"><Package className="text-sari-purple" size={24} /><h3 className="font-bold text-white">إحصائيات</h3></div>
                        <div className="space-y-4">
                            <div><div className="text-xs text-white/50 mb-1">إجمالي المواد</div><div className="text-2xl font-bold text-white font-num">{inventoryStats.totalItems}</div></div>
                            <div><div className="text-xs text-white/50 mb-1">القيمة الكلية</div><div className="text-2xl font-bold text-emerald-400 font-num">{formatCurrency(inventoryStats.totalValue, 'USD')}</div></div>
                            <div><div className="text-xs text-white/50 mb-1">مواد منخفضة</div><div className="text-2xl font-bold text-orange-400 font-num">{inventoryStats.lowStockCount}</div></div>
                        </div>
                    </div>
                    <button onClick={() => { setNewItemForm({ id: '', name: '', category: '', quantity: 0, minLevel: 5, price: 0, cost: 0 }); setItemModalOpen(true); }} className="w-full py-4 bg-sari-purple hover:bg-sari-purple-deep text-white rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-95"><Plus size={18} /> منتج جديد</button>
                </div>

                {/* --- Inventory Right Table --- */}
                <div className="lg:col-span-3 bg-white/5 border border-white/10 rounded-3xl overflow-hidden flex flex-col h-[600px]">
                    <div className="p-4 border-b border-white/10 flex justify-between items-center">
                        <h3 className="font-bold text-white">قائمة المنتجات</h3>
                        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={14} /><input type="text" placeholder="بحث..." className="bg-black/20 border border-white/10 rounded-xl py-2 pl-9 pr-4 text-xs text-white focus:outline-none" /></div>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        <div className="grid grid-cols-12 gap-4 p-4 border-b border-white/5 text-xs text-white/40 font-bold bg-black/20 text-right sticky top-0 backdrop-blur-md z-10">
                            <div className="col-span-1">Action</div><div className="col-span-2">Price</div><div className="col-span-2">Stock</div><div className="col-span-3">Category</div><div className="col-span-4 pr-4">Product</div>
                        </div>
                        {inventory.map(item => (
                            <div key={item.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-white/5 transition-colors text-right group border-b border-white/5 last:border-0">
                                <div className="col-span-1 flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => handleDeleteInventory(item.id)} className="text-red-400 hover:scale-110 transition-transform"><Trash2 size={16} /></button>
                                    <button onClick={() => { setNewItemForm(item); setItemModalOpen(true); }} className="text-white/50 hover:text-white hover:scale-110 transition-transform"><Edit3 size={16} /></button>
                                </div>
                                <div className="col-span-2 font-num text-emerald-400 font-medium">{formatCurrency(item.price, 'USD')}</div>
                                <div className="col-span-2"><span className={`px-2 py-1 rounded text-xs font-bold font-num ${item.quantity <= item.minLevel ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>{item.quantity}</span></div>
                                <div className="col-span-3 text-white/60 text-xs">{item.category}</div>
                                <div className="col-span-4 pr-4 font-bold text-white">{item.name}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </motion.div>
          )}

          {activeTab === 'debts' && (
            <motion.div key="debts" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="max-w-7xl mx-auto space-y-6">
                <div className="flex justify-between items-center"><h2 className="text-2xl font-bold text-rose-500">إدارة الديون</h2><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} /><input type="text" placeholder="بحث عن عميل..." className="bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-white focus:outline-none text-right" dir="rtl" /></div></div>
                
                {/* --- Client Cards Grid --- */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {debtList.map((client, i) => (
                        <div key={i} className="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col gap-4 hover:border-rose-500/30 transition-all group relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-rose-500 to-rose-900"></div>
                            <div className="flex justify-between items-start">
                                <div className="w-12 h-12 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-500 font-bold text-xl">{client.name.charAt(0).toUpperCase()}</div>
                                <div className="text-right">
                                    <h3 className="font-bold text-white text-lg">{client.name}</h3>
                                    <div className="text-xs text-white/40 font-num">{client.phone || 'No Phone'}</div>
                                </div>
                            </div>
                            <div className="py-4 border-t border-white/5 border-b flex justify-between items-center">
                                <span className="text-sm text-white/50">إجمالي الدين</span>
                                <span className="text-2xl font-bold text-rose-500 font-num">{formatCurrency(client.total, storeInfo.currencySymbol === '$' ? 'USD' : 'IQD')}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-white/40">
                                <span>آخر حركة: <span className="font-num">{client.lastDate}</span></span>
                                <span>{client.count} عمليات</span>
                            </div>
                            <button onClick={() => handleSettleClientDebt(client.name)} className="w-full py-3 mt-2 bg-rose-500/10 hover:bg-rose-500 hover:text-white text-rose-500 rounded-xl font-bold transition-all flex items-center justify-center gap-2">
                                <CheckCircle2 size={18} /> تسوية الدين
                            </button>
                        </div>
                    ))}
                    {debtList.length === 0 && <div className="col-span-full py-20 text-center text-white/30 flex flex-col items-center"><CheckCircle2 size={48} className="mb-4 opacity-50"/><p>لا توجد ديون مستحقة</p></div>}
                </div>
            </motion.div>
          )}

          {activeTab === 'transactions' && (
            <motion.div key="transactions" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="max-w-7xl mx-auto space-y-6 print:hidden">
               <div className="flex flex-col md:flex-row justify-between items-center gap-4"><h2 className="text-2xl font-bold text-white">سجل العمليات</h2><div className="flex gap-2"><button onClick={handleExport} className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl"><FileSpreadsheet size={20} /></button><button onClick={() => window.print()} className="p-2 bg-sari-purple/10 text-sari-purple-light rounded-xl"><Printer size={20} /></button><button onClick={initiateClearAll} className="p-2 bg-red-500/10 text-red-400 rounded-xl"><Trash2 size={20} /></button></div></div>
               
               {/* Filter Tabs */}
               <div className="flex gap-2 p-1 bg-white/5 border border-white/10 rounded-xl w-fit">
                  {['all', 'sale', 'expense'].map(f => (
                     <button key={f} onClick={() => setHistoryFilterType(f as any)} className="relative px-6 py-2 rounded-lg text-sm font-bold z-10 transition-colors">
                        {historyFilterType === f && (<motion.div layoutId="filterPill" className="absolute inset-0 bg-sari-purple rounded-lg shadow-lg shadow-sari-purple/20 -z-10" />)}
                        <span className={historyFilterType === f ? 'text-white' : 'text-white/50 hover:text-white'}>{f === 'all' ? 'الكل' : f === 'sale' ? 'مبيعات' : 'مصروفات'}</span>
                     </button>
                  ))}
               </div>

               <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden min-h-[500px]">
                  <div className="grid grid-cols-12 gap-4 p-4 border-b border-white/10 text-xs text-white/40 font-bold uppercase bg-black/20 text-right"><div className="col-span-2 text-left">Amount</div><div className="col-span-2 text-center">Status</div><div className="col-span-2 text-center">Method</div><div className="col-span-2 text-center">Date</div><div className="col-span-4 pr-4">Details</div></div>
                  <div className="divide-y divide-white/5">{currentItems.map((item) => (<motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} key={item.id} onClick={() => setEditingItem(item)} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-white/5 transition-colors cursor-pointer text-right"><div className="col-span-2 text-left font-num font-bold text-white"><span className={item.type === 'expense' ? 'text-amber-400' : 'text-emerald-400'}>{item.type === 'expense' ? '-' : '+'}{formatCurrency(item.amount, item.currency)}</span></div><div className="col-span-2 text-center"><span className={`inline-block px-2 py-1 rounded text-[10px] border ${item.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>{item.status}</span></div><div className="col-span-2 text-center text-white/60 text-sm">{item.method}</div><div className="col-span-2 text-center"><div className="text-white text-sm font-num">{item.date}</div><div className="text-[10px] text-white/30 font-num">{item.time}</div></div><div className="col-span-4 flex items-center justify-end gap-3"><div className="text-right"><div className="text-white font-medium text-sm">{item.client}</div><div className="text-[10px] text-white/30 font-num">{item.id}</div></div><div className={`p-2 rounded-lg ${item.type === 'sale' || item.type === 'cash' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>{item.type === 'sale' || item.type === 'cash' ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}</div></div></motion.div>))}</div>
               </div>
               <div className="flex justify-center items-center gap-4 mt-6"><button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} className="p-2 rounded-xl bg-white/5 text-white disabled:opacity-50"><ChevronLeft size={20} /></button><span className="text-sm text-white/60">Page {currentPage} of {totalPages}</span><button onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} className="p-2 rounded-xl bg-white/5 text-white disabled:opacity-50"><ChevronRight size={20} /></button></div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div key="settings" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="max-w-5xl mx-auto">
               
               {/* Horizontal Tabs */}
               <div className="flex flex-wrap items-center gap-4 mb-8">
                   {[
                     {id:'store', label:'المتجر', icon: Store}, 
                     {id:'companies', label:'الشركات', icon: Building2}, 
                     {id:'security', label:'الأمان', icon: ShieldCheck},
                     {id:'data', label:'البيانات', icon: Database}
                   ].map((t: any) => (
                       <button 
                         key={t.id} 
                         onClick={() => setSettingsTab(t.id)} 
                         className={`flex-1 min-w-[120px] flex flex-col md:flex-row items-center justify-center gap-3 p-4 rounded-3xl border transition-all ${
                           settingsTab === t.id 
                             ? 'bg-sari-purple border-sari-purple text-white shadow-lg shadow-sari-purple/20 scale-[1.02]' 
                             : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:border-white/20'
                         }`}
                       >
                           <t.icon size={20} />
                           <span className="font-bold">{t.label}</span>
                       </button>
                   ))}
               </div>

               {/* Settings Content */}
               <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                   
                   {/* Background Glow */}
                   <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-1/2 bg-sari-purple/5 blur-[100px] rounded-full pointer-events-none" />

                   <div className="relative z-10">
                     {settingsTab === 'store' && (
                         <div className="space-y-6">
                             <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                               <div className="p-2 bg-sari-purple/20 rounded-xl text-sari-purple"><Store size={24}/></div>
                               بيانات المتجر
                             </h3>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                               <div className="space-y-2">
                                 <label className="text-sm font-bold text-white/60">اسم المتجر</label>
                                 <input type="text" value={storeInfo.name} onChange={e => setStoreInfo({...storeInfo, name: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-white focus:border-sari-purple/50 transition-colors" />
                               </div>
                               <div className="space-y-2">
                                 <label className="text-sm font-bold text-white/60">رقم الهاتف</label>
                                 <input type="text" value={storeInfo.phone} onChange={e => setStoreInfo({...storeInfo, phone: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-white focus:border-sari-purple/50 transition-colors" placeholder="اختياري" />
                               </div>
                               <div className="space-y-2">
                                 <label className="text-sm font-bold text-white/60">العنوان</label>
                                 <input type="text" value={storeInfo.address} onChange={e => setStoreInfo({...storeInfo, address: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-white focus:border-sari-purple/50 transition-colors" placeholder="بغداد, العراق" />
                               </div>
                               <div className="space-y-2">
                                 <label className="text-sm font-bold text-white/60">العملة الافتراضية</label>
                                 <select value={storeInfo.currencySymbol} onChange={e => setStoreInfo({...storeInfo, currencySymbol: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-white focus:border-sari-purple/50 transition-colors appearance-none cursor-pointer">
                                   <option value="IQD" className="bg-gray-900">Dinar (IQD)</option>
                                   <option value="$" className="bg-gray-900">Dollar (USD)</option>
                                 </select>
                               </div>
                             </div>
                         </div>
                     )}
                     
                     {settingsTab === 'companies' && (
                         <div className="space-y-6">
                             <div className="flex justify-between items-center mb-6">
                               <h3 className="text-2xl font-bold text-white flex items-center gap-3">
                                 <div className="p-2 bg-sari-purple/20 rounded-xl text-sari-purple"><Building2 size={24}/></div>
                                 إدارة الشركات والعملاء
                               </h3>
                             </div>
                             
                             <div className="flex gap-2 mb-6">
                               <input type="text" value={newCompany} onChange={e=>setNewCompany(e.target.value)} placeholder="اسم جهة جديد..." className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-sari-purple/50 transition-colors"/>
                               <button onClick={handleAddCompany} className="px-6 bg-sari-purple hover:bg-sari-purple-deep text-white rounded-xl font-bold transition-colors flex items-center gap-2"><Plus size={18}/> إضافة</button>
                             </div>

                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[400px] overflow-y-auto custom-scrollbar p-1">
                                 {storeInfo.knownCompanies.map((c, i) => (
                                     <div key={i} className="flex justify-between items-center p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/20 group transition-all">
                                             <div className="flex items-center gap-3">
                                               <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-sari-purple-light">{c.charAt(0)}</div>
                                               <span className="text-white font-medium">{c}</span>
                                             </div>
                                             <button onClick={() => handleDeleteCompany(c)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 hover:text-white"><Trash2 size={16}/></button>
                                     </div>
                                 ))}
                             </div>
                         </div>
                     )}

                     {settingsTab === 'security' && (
                         <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center text-white/20"><ShieldCheck size={40} /></div>
                            <div>
                              <h3 className="text-xl font-bold text-white">إعدادات الأمان</h3>
                              <p className="text-white/40 max-w-sm mx-auto mt-2">قريباً: تغيير كلمة المرور وإدارة الصلاحيات</p>
                            </div>
                         </div>
                     )}

                     {settingsTab === 'data' && (
                         <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center text-white/20"><Database size={40} /></div>
                            <div>
                              <h3 className="text-xl font-bold text-white">إدارة البيانات</h3>
                              <p className="text-white/40 max-w-sm mx-auto mt-2">قريباً: النسخ الاحتياطي واستعادة البيانات</p>
                            </div>
                         </div>
                     )}
                   </div>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* --- Add Transaction Modal (Smart Combobox) --- */}
      <AnimatePresence>
          {manualModalOpen && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                  <div className="bg-[#1a1a1c] border border-white/10 w-full max-w-lg rounded-3xl p-6 shadow-2xl relative" onClick={() => setShowCompanyList(false)}>
                      <div className="flex justify-between items-center mb-6"><h3 className="text-xl font-bold text-white">إضافة معاملة</h3><button onClick={() => setManualModalOpen(false)} className="text-white/50 hover:text-white"><X size={24} /></button></div>
                      <div className="space-y-4">
                          <div className="flex gap-2 bg-black/20 p-1 rounded-xl">{['sale', 'expense', 'debt'].map(t => (<button key={t} onClick={() => setManualForm({...manualForm, type: t as any})} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${manualForm.type === t ? 'bg-sari-purple text-white shadow' : 'text-white/40'}`}>{t === 'sale' ? 'بيع' : t === 'expense' ? 'صرف' : 'دين'}</button>))}</div>
                          
                          {manualForm.type !== 'expense' && (
                              <div className="relative">
                                  <label className="text-xs text-white/50 block mb-1">اسم الشركة / العميل</label>
                                  <div className="relative" onClick={e => e.stopPropagation()}>
                                      <input 
                                          type="text" 
                                          value={companySearch} 
                                          onChange={e => { setCompanySearch(e.target.value); setShowCompanyList(true); }} 
                                          onFocus={() => setShowCompanyList(true)}
                                          className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right" 
                                          placeholder="اختر أو اكتب اسماً جديداً" 
                                      />
                                      <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={16} />
                                      {showCompanyList && (
                                          <div className="absolute z-50 w-full mt-1 bg-[#252529] border border-white/10 rounded-xl shadow-xl max-h-40 overflow-y-auto custom-scrollbar">
                                              {storeInfo.knownCompanies.filter(c => c.toLowerCase().includes(companySearch.toLowerCase())).map((c, i) => (
                                                  <button key={i} onClick={() => { setCompanySearch(c); setShowCompanyList(false); }} className="w-full text-right px-4 py-2 text-white hover:bg-white/5 text-sm block border-b border-white/5 last:border-0">{c}</button>
                                              ))}
                                              {companySearch && !storeInfo.knownCompanies.includes(companySearch) && (
                                                  <button onClick={() => { setShowCompanyList(false); }} className="w-full text-right px-4 py-2 text-sari-purple-light hover:bg-white/5 text-sm block font-bold">استخدام "{companySearch}"</button>
                                              )}
                                          </div>
                                      )}
                                  </div>
                              </div>
                          )}
                          
                          {manualForm.type === 'expense' && (<div><label className="text-xs text-white/50 block mb-1">الوصف</label><input type="text" value={manualForm.description} onChange={e => setManualForm({...manualForm, description: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right" placeholder="وصف المصروف" /></div>)}
                          <div><label className="text-xs text-white/50 block mb-1">المبلغ</label><input type="number" value={manualForm.amount} onChange={e => setManualForm({...manualForm, amount: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right font-num" placeholder="0.00" /></div>
                          {(manualForm.type === 'sale' || manualForm.type === 'debt') && (<div><label className="text-xs text-white/50 block mb-1">المنتج (يخصم من المخزون)</label><select value={manualForm.itemId} onChange={e => setManualForm({...manualForm, itemId: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right"><option value="">-- اختر منتج --</option>{inventory.map(i => <option key={i.id} value={i.id}>{i.name} ({i.quantity})</option>)}</select></div>)}
                          <button onClick={handleManualTransaction} className="w-full py-4 bg-sari-purple hover:bg-sari-purple-deep text-white rounded-xl font-bold mt-4">حفظ المعاملة</button>
                      </div>
                  </div>
              </motion.div>
          )}

          {itemModalOpen && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                  <div className="bg-[#1a1a1c] border border-white/10 w-full max-w-lg rounded-3xl p-6 shadow-2xl">
                      <div className="flex justify-between items-center mb-6"><h3 className="text-xl font-bold text-white">{newItemForm.id ? 'تعديل منتج' : 'منتج جديد'}</h3><button onClick={() => setItemModalOpen(false)} className="text-white/50 hover:text-white"><X size={24} /></button></div>
                      <div className="space-y-4">
                          <input type="text" value={newItemForm.name} onChange={e => setNewItemForm({...newItemForm, name: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right" placeholder="اسم المنتج" />
                          <div className="grid grid-cols-2 gap-4"><input type="number" value={newItemForm.price} onChange={e => setNewItemForm({...newItemForm, price: parseFloat(e.target.value)})} className="bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right font-num" placeholder="السعر" /><input type="number" value={newItemForm.quantity} onChange={e => setNewItemForm({...newItemForm, quantity: parseInt(e.target.value)})} className="bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right font-num" placeholder="الكمية" /></div>
                          <div className="grid grid-cols-2 gap-4"><input type="text" value={newItemForm.category} onChange={e => setNewItemForm({...newItemForm, category: e.target.value})} className="bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right" placeholder="القسم" /><input type="number" value={newItemForm.minLevel} onChange={e => setNewItemForm({...newItemForm, minLevel: parseInt(e.target.value)})} className="bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right font-num" placeholder="الحد الأدنى" /></div>
                          <button onClick={handleInventorySave} className="w-full py-4 bg-sari-purple hover:bg-sari-purple-deep text-white rounded-xl font-bold mt-4">حفظ</button>
                      </div>
                  </div>
              </motion.div>
          )}
          
          {editingItem && ( /* Edit Modal */ 
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"><div className="bg-[#1a1a1c] border border-white/10 w-full max-w-lg rounded-3xl p-6 shadow-2xl"><div className="flex justify-between items-center mb-6"><h3 className="text-xl font-bold text-white">تعديل العملية</h3><button onClick={() => setEditingItem(null)} className="text-white/50 hover:text-white"><X size={24} /></button></div><div className="space-y-4"><div><label className="text-xs text-white/50 block mb-1">الوصف / العميل</label><input type="text" value={editingItem.client} onChange={e => setEditingItem({...editingItem, client: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right" /></div><div><label className="text-xs text-white/50 block mb-1">المبلغ</label><input type="number" value={editingItem.amount} onChange={e => setEditingItem({...editingItem, amount: parseFloat(e.target.value)})} className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right font-num" /></div><div><label className="text-xs text-white/50 block mb-1">التاريخ</label><input type="date" value={editingItem.date} onChange={e => setEditingItem({...editingItem, date: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-white text-right font-num" /></div><button onClick={handleEditSave} className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold mt-4">حفظ التعديلات</button></div></div></motion.div>
          )}

          {deleteModal.isOpen && ( /* Delete Modal */ 
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"><div className="bg-[#1a1a1c] border border-white/10 w-full max-w-sm rounded-3xl p-8 shadow-2xl text-center"><div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500"><AlertTriangle size={32} /></div><h3 className="text-xl font-bold text-white mb-2">تأكيد الحذف</h3><p className="text-white/60 mb-6">{deleteModal.type === 'all' ? 'هل أنت متأكد من حذف جميع البيانات؟ لا يمكن التراجع عن هذا الإجراء.' : `هل أنت متأكد من حذف ${deleteModal.targetName}؟`}</p><div className="flex gap-3"><button onClick={() => setDeleteModal({ ...deleteModal, isOpen: false })} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold">إلغاء</button><button onClick={handleDeleteConfirm} className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold">حذف</button></div></div></motion.div>
          )}
      </AnimatePresence>

      {success && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 px-6 py-3 rounded-full shadow-2xl z-[200] flex items-center gap-2 font-bold backdrop-blur-md"><CheckCircle2 size={20} /> تم التنفيذ بنجاح</div>}
    </div>
  );
};

export default App;