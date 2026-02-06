import React, { useState, useMemo, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, XCircle, MinusCircle, Download, ChevronDown, ChevronRight, History, Trash2, Calendar, ArrowRight, Package } from 'lucide-react';
import { transformAll, generateCSVs } from './transformer';
import JSZip from 'jszip';

// CSV Parser utility
const parseCSV = (text) => {
  const lines = text.split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }
  
  return rows;
};

const cleanNum = (val) => {
  if (!val || val === '') return 0;
  const cleaned = String(val).replace(/[$,]/g, '').trim();
  return parseFloat(cleaned) || 0;
};

// Column alias helper - handles different column names between export formats
// Sample data uses: Notes, BusMonths, PerDeimTotal, TravelDaysIn/Out
// Synthetic uses: TourNotes, BilledMonths, PerDiemTotal, BusDHF/BusDHR
const getField = (row, ...aliases) => {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== '') {
      return row[alias];
    }
  }
  return '';
};

const getNumField = (row, ...aliases) => {
  return cleanNum(getField(row, ...aliases));
};

// Classification Engine
const classifyTour = (rows) => {
  const tourId = rows[0]?.TourID;
  const results = {
    tourId,
    customer: rows[0]?.CustomerName,
    tourName: rows[0]?.TourName,
    status: rows[0]?.Status,
    rows: rows,
    classification: 'READY',
    reasons: [],
    totalBudget: rows.reduce((sum, r) => sum + cleanNum(r.TourBudget || r.BusBudget), 0),
    vehicleCount: rows.length
  };

  // EXCLUDED checks
  if (rows[0]?.Status === 'Other') {
    results.classification = 'EXCLUDED';
    results.reasons.push('Status = "Other" (service/maintenance record)');
    return results;
  }
  
  if (rows[0]?.CustomerName === 'Celebrity Coaches') {
    results.classification = 'EXCLUDED';
    results.reasons.push('Internal record (Celebrity Coaches)');
    return results;
  }
  
  if (rows[0]?.CustomerName === 'TEST CLIENT') {
    results.classification = 'EXCLUDED';
    results.reasons.push('Test data');
    return results;
  }

  // BLOCKED checks
  // Vehicle swap detection
  const vehicleCounts = {};
  rows.forEach(r => {
    const vehicle = r.BusTrailer || r.Bus;
    if (vehicle) {
      vehicleCounts[vehicle] = (vehicleCounts[vehicle] || 0) + 1;
    }
  });
  
  const duplicateVehicles = Object.entries(vehicleCounts).filter(([_, count]) => count > 1);
  if (duplicateVehicles.length > 0) {
    results.classification = 'BLOCKED';
    const vehicleList = duplicateVehicles.map(([v, c]) => `${v} (${c}×)`).join(', ');
    results.reasons.push(`Vehicle swap detected: ${vehicleList}`);
  }

  // Multiple $0 budget rows check
  const zeroBudgetRows = rows.filter(r => cleanNum(r.TourBudget || r.BusBudget) === 0);
  if (zeroBudgetRows.length >= 2 && results.classification !== 'BLOCKED') {
    results.classification = 'BLOCKED';
    results.reasons.push(`Multiple $0 budget rows (${zeroBudgetRows.length}) - likely vehicle swaps`);
  }

  // FLAGGED checks (only if not already BLOCKED)
  if (results.classification !== 'BLOCKED' && results.classification !== 'EXCLUDED') {
    // Discount Days - now supported in Bravo, flag for review
    const hasDiscountDays = rows.some(r => cleanNum(r.DiscountedDays) > 0);
    if (hasDiscountDays) {
      results.classification = 'FLAGGED';
      const discountDays = rows.reduce((sum, r) => sum + cleanNum(r.DiscountedDays), 0);
      results.reasons.push(`Uses Discount Days (${discountDays} days) - verify mapping in Bravo`);
    }

    const hasSingleZeroBusRate = rows.some(r => cleanNum(r.BusRate) === 0 && cleanNum(r.TotalMileage) > 0);
    if (hasSingleZeroBusRate) {
      if (results.classification === 'READY') {
        results.classification = 'FLAGGED';
      }
      results.reasons.push('$0 BusRate with mileage - may be tour within long-term lease');
    }

    rows.forEach(r => {
      const tourDays = cleanNum(r.TourDays);
      const dhf = cleanNum(r.DriverDHF);
      const dhr = cleanNum(r.DriverDHR);
      const driverDays = cleanNum(r.DriverDays);
      const expected = tourDays + dhf + dhr;
      
      if (driverDays > expected && expected > 0) {
        if (results.classification === 'READY') {
          results.classification = 'FLAGGED';
        }
        results.reasons.push(`Driver days override on ${r.BusTrailer || r.Bus}: ${driverDays} actual vs ${expected} expected (+${driverDays - expected} Additional Driver Days)`);
      }
    });

    const hasAdminFee = rows.some(r => cleanNum(r.AdminTotal) > 0);
    if (hasAdminFee) {
      if (results.classification === 'READY') {
        results.classification = 'FLAGGED';
      }
      const adminTotal = rows.reduce((sum, r) => sum + cleanNum(r.AdminTotal), 0);
      results.reasons.push(`Has Admin Fee: $${adminTotal.toFixed(2)} (will map to flat Admin Fee line item)`);
    }
  }

  // Long-term lease detection
  const TRAILER_PREFIXES = ['CC', 'ML', 'LK', 'TA'];
  const isLongTerm = rows.some(r => {
    const busRate = cleanNum(r.BusRate);
    const billedMonths = getNumField(r, 'BilledMonths', 'BusMonths');
    const tourDays = cleanNum(r.TourDays);
    const driverDays = cleanNum(r.DriverDays);
    // Exclude trailer rows from driverDays check — trailers naturally have 0 driver days
    const vehicleName = (r.BusTrailer || r.Bus || '').trim().toUpperCase();
    const isTrailerRow = TRAILER_PREFIXES.some(prefix => vehicleName.startsWith(prefix));
    // If BusRateType is "Per Day", it's explicitly short-term — don't let driverDays heuristic override
    const busRateType = (r.BusRateType || '').trim();
    return busRate >= 2000 || billedMonths >= 6 || (!isTrailerRow && driverDays === 0 && tourDays > 60 && busRateType !== 'Per Day');
  });
  
  results.leaseType = isLongTerm ? 'LONG_TERM' : 'SHORT_TERM';
  return results;
};

const groupByTour = (rows) => {
  const tours = {};
  rows.forEach(row => {
    const tourId = row.TourID;
    if (!tours[tourId]) tours[tourId] = [];
    tours[tourId].push(row);
  });
  return tours;
};

// Local Storage helpers
const HISTORY_KEY = 'startracker_import_history';
const loadHistory = () => {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
};
const saveHistory = (history) => {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } 
  catch (e) { console.error('Failed to save history:', e); }
};

// Storage size helpers
const getStorageSize = () => {
  try {
    let total = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        total += localStorage[key].length + key.length;
      }
    }
    return total;
  } catch { return 0; }
};

const getStorageSizeMB = () => {
  return getStorageSize() / (1024 * 1024);
};

const estimateBatchSize = (batch) => {
  try {
    return JSON.stringify(batch).length;
  } catch { return 0; }
};

const STORAGE_LIMIT_MB = 5;
const STORAGE_WARN_THRESHOLD_MB = 4.5;

export default function StarTrackerImportDashboard() {
  const [rawData, setRawData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [expandedTour, setExpandedTour] = useState(null);
  const [selectedFilter, setSelectedFilter] = useState('ALL');
  const [batchHistory, setBatchHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [currentBatchId, setCurrentBatchId] = useState(null);
  const [batchNotes, setBatchNotes] = useState('');
  const [expandedHistory, setExpandedHistory] = useState(null);
  const [storageSizeMB, setStorageSizeMB] = useState(0);
  const [activeTab, setActiveTab] = useState('classify'); // 'classify' or 'transform'
  const [transformedData, setTransformedData] = useState(null);
  const [selectedForTransform, setSelectedForTransform] = useState(new Set());

  useEffect(() => { 
    setBatchHistory(loadHistory());
    setStorageSizeMB(getStorageSizeMB());
  }, []);

  useEffect(() => {
    if (showHistory) {
      setStorageSizeMB(getStorageSizeMB());
    }
  }, [showHistory]);

  const processedData = useMemo(() => {
    if (!rawData) return null;
    const tours = groupByTour(rawData);
    const classified = Object.entries(tours).map(([_, rows]) => classifyTour(rows));
    return {
      total: classified.length,
      totalRows: rawData.length,
      ready: classified.filter(t => t.classification === 'READY'),
      flagged: classified.filter(t => t.classification === 'FLAGGED'),
      blocked: classified.filter(t => t.classification === 'BLOCKED'),
      excluded: classified.filter(t => t.classification === 'EXCLUDED'),
      all: classified,
      readyTourIds: classified.filter(t => t.classification === 'READY').map(t => t.tourId),
      flaggedTourIds: classified.filter(t => t.classification === 'FLAGGED').map(t => t.tourId),
      blockedTourIds: classified.filter(t => t.classification === 'BLOCKED').map(t => t.tourId),
      excludedTourIds: classified.filter(t => t.classification === 'EXCLUDED').map(t => t.tourId)
    };
  }, [rawData]);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseCSV(e.target.result);
      setRawData(parsed);
      setSelectedFilter('ALL');
      setBatchNotes('');
      setCurrentBatchId(crypto.randomUUID());
    };
    reader.readAsText(file);
  };

  const saveBatchToHistory = () => {
    if (!processedData || !fileName) return;
    
    const batch = {
      id: currentBatchId || crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      fileName,
      totalRows: processedData.totalRows,
      totalTours: processedData.total,
      counts: {
        ready: processedData.ready.length,
        flagged: processedData.flagged.length,
        blocked: processedData.blocked.length,
        excluded: processedData.excluded.length
      },
      tourIds: {
        ready: processedData.readyTourIds,
        flagged: processedData.flaggedTourIds,
        blocked: processedData.blockedTourIds,
        excluded: processedData.excludedTourIds
      },
      notes: batchNotes,
      data: processedData.all // Store full classified data
    };
    
    // Check storage size before saving
    const currentSizeMB = getStorageSizeMB();
    const batchSize = estimateBatchSize(batch);
    
    // Check if we're replacing an existing batch
    const existingBatch = batchHistory.find(b => b.id === batch.id);
    const existingBatchSize = existingBatch ? estimateBatchSize(existingBatch) : 0;
    
    // Calculate new size: current size - old batch size + new batch size
    const sizeDiff = batchSize - existingBatchSize;
    const newSizeMB = currentSizeMB + (sizeDiff / (1024 * 1024));
    
    if (newSizeMB > STORAGE_LIMIT_MB) {
      alert(`Cannot save batch: Storage would exceed ${STORAGE_LIMIT_MB}MB limit. Please delete old batches first.`);
      return;
    }
    
    if (currentSizeMB >= STORAGE_WARN_THRESHOLD_MB && sizeDiff > 0) {
      if (!confirm(`Warning: Storage is at ${currentSizeMB.toFixed(1)}MB / ${STORAGE_LIMIT_MB}MB. Continue saving this batch?`)) {
        return;
      }
    }
    
    const newHistory = [batch, ...batchHistory.filter(b => b.id !== batch.id)];
    setBatchHistory(newHistory);
    saveHistory(newHistory);
    setStorageSizeMB(getStorageSizeMB());
    alert('Batch saved to history!');
  };

  const deleteBatch = (batchId) => {
    if (confirm('Delete this batch from history?')) {
      const newHistory = batchHistory.filter(b => b.id !== batchId);
      setBatchHistory(newHistory);
      saveHistory(newHistory);
      setStorageSizeMB(getStorageSizeMB());
    }
  };

  const clearAllHistory = () => {
    if (confirm('Clear ALL batch history? This cannot be undone.')) {
      setBatchHistory([]);
      saveHistory([]);
      setStorageSizeMB(getStorageSizeMB());
    }
  };

  const generateExportCSV = (tours) => {
    if (!tours?.length) return '';
    const headers = ['TourID', 'Customer', 'TourName', 'Status', 'Classification', 'LeaseType', 'VehicleCount', 'TotalBudget', 'Reasons'];
    const rows = tours.map(t => [
      t.tourId,
      `"${(t.customer || '').replace(/"/g, '""')}"`,
      `"${(t.tourName || '').replace(/"/g, '""')}"`,
      t.status,
      t.classification,
      t.leaseType,
      t.vehicleCount,
      t.totalBudget.toFixed(2),
      `"${t.reasons.join('; ').replace(/"/g, '""')}"`
    ]);
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  };

  const generateDetailedCSV = (tours) => {
    if (!tours?.length) return '';
    const headers = ['TourID', 'Customer', 'TourName', 'Classification', 'LeaseType', 'Vehicle', 'StartDate', 'EndDate', 'Driver', 'BusRate', 'Budget', 'TourDays', 'DriverDays', 'DHF', 'DHR', 'Mileage', 'Reasons'];
    const rows = [];
    tours.forEach(t => {
      t.rows.forEach((r, idx) => {
        rows.push([
          t.tourId,
          idx === 0 ? `"${(t.customer || '').replace(/"/g, '""')}"` : '',
          idx === 0 ? `"${(t.tourName || '').replace(/"/g, '""')}"` : '',
          idx === 0 ? t.classification : '',
          idx === 0 ? t.leaseType : '',
          r.BusTrailer || r.Bus || '',
          r.StartDate || '', r.EndDate || '',
          `"${(r.Driver || '').replace(/"/g, '""')}"`,
          cleanNum(r.BusRate), cleanNum(r.TourBudget || r.BusBudget),
          cleanNum(r.TourDays), cleanNum(r.DriverDays),
          cleanNum(r.DriverDHF), cleanNum(r.DriverDHR),
          cleanNum(r.TotalMileage),
          idx === 0 ? `"${t.reasons.join('; ').replace(/"/g, '""')}"` : ''
        ]);
      });
    });
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  };

  const downloadCSV = (data, filename) => {
    const blob = new Blob([data], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Helper functions for batch downloads
  const getBatchToursByClassification = (batch, classification) => {
    if (!batch.data) return [];
    return batch.data.filter(t => t.classification === classification);
  };

  const handleBatchDownload = (batch, type, classification = null) => {
    if (!batch.data) {
      alert('This batch does not have saved data. Please re-upload the file.');
      return;
    }
    
    let tours = [];
    let filename = '';
    
    if (type === 'ready-summary') {
      tours = getBatchToursByClassification(batch, 'READY');
      filename = `batch_${batch.id}_ready.csv`;
      downloadCSV(generateExportCSV(tours), filename);
    } else if (type === 'ready-detailed') {
      tours = getBatchToursByClassification(batch, 'READY');
      filename = `batch_${batch.id}_ready_detailed.csv`;
      downloadCSV(generateDetailedCSV(tours), filename);
    } else if (type === 'flagged') {
      tours = getBatchToursByClassification(batch, 'FLAGGED');
      filename = `batch_${batch.id}_flagged.csv`;
      downloadCSV(generateExportCSV(tours), filename);
    } else if (type === 'blocked') {
      tours = getBatchToursByClassification(batch, 'BLOCKED');
      filename = `batch_${batch.id}_blocked.csv`;
      downloadCSV(generateExportCSV(tours), filename);
    } else if (type === 'full') {
      tours = batch.data;
      filename = `batch_${batch.id}_full_detailed.csv`;
      downloadCSV(generateDetailedCSV(tours), filename);
    }
  };

  const filteredTours = useMemo(() => {
    if (!processedData) return [];
    if (selectedFilter === 'ALL') return processedData.all;
    return processedData.all.filter(t => t.classification === selectedFilter);
  }, [processedData, selectedFilter]);

  // Get tours available for transformation (READY + FLAGGED)
  const transformableTours = useMemo(() => {
    if (!processedData) return [];
    return processedData.all.filter(t =>
      t.classification === 'READY' || t.classification === 'FLAGGED'
    );
  }, [processedData]);

  // Handle transform action
  const handleTransform = () => {
    const toursToTransform = selectedForTransform.size > 0
      ? transformableTours.filter(t => selectedForTransform.has(t.tourId))
      : transformableTours;

    if (toursToTransform.length === 0) {
      alert('No tours selected for transformation.');
      return;
    }

    const result = transformAll(toursToTransform);
    setTransformedData(result);
  };

  // Helper to get base filename without extension
  const getBaseFilename = () => {
    if (!fileName) return 'export';
    // Remove .csv or .xlsx extension if present
    return fileName.replace(/\.(csv|xlsx?)$/i, '');
  };

  // Download transformed CSVs
  const downloadTransformedCSV = async (type) => {
    if (!transformedData) return;
    const csvs = generateCSVs(transformedData);
    const baseName = getBaseFilename();

    const fileMap = {
      quotes: { data: csvs.quotes, name: `quotes.csv` },
      coaches: { data: csvs.quoteCoaches, name: `quote_coaches.csv` },
      trailers: { data: csvs.quoteTrailers, name: `quote_trailers.csv` },
      lineItems: { data: csvs.lineItems, name: `line_items.csv` },
      artists: { data: csvs.artists, name: `artists.csv` },
      contacts: { data: csvs.contacts, name: `contacts.csv` },
      artistContacts: { data: csvs.artistContacts, name: `artist_contacts.csv` },
    };

    if (type === 'all') {
      // Create a zip file with all CSVs
      const zip = new JSZip();
      Object.entries(fileMap).forEach(([key, { data, name }]) => {
        if (data) {
          zip.file(name, data);
        }
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}_bravo.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const file = fileMap[type];
      if (file) downloadCSV(file.data, `${baseName}_${file.name}`);
    }
  };

  // Toggle tour selection for transform
  const toggleTourSelection = (tourId) => {
    setSelectedForTransform(prev => {
      const next = new Set(prev);
      if (next.has(tourId)) {
        next.delete(tourId);
      } else {
        next.add(tourId);
      }
      return next;
    });
  };

  // Select/deselect all transformable tours
  const toggleAllSelection = () => {
    if (selectedForTransform.size === transformableTours.length) {
      setSelectedForTransform(new Set());
    } else {
      setSelectedForTransform(new Set(transformableTours.map(t => t.tourId)));
    }
  };

  const classificationColors = {
    READY: 'bg-green-100 text-green-800 border-green-200',
    FLAGGED: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    BLOCKED: 'bg-red-100 text-red-800 border-red-200',
    EXCLUDED: 'bg-gray-100 text-gray-600 border-gray-200'
  };

  const classificationIcons = {
    READY: <CheckCircle className="w-5 h-5 text-green-600" />,
    FLAGGED: <AlertTriangle className="w-5 h-5 text-yellow-600" />,
    BLOCKED: <XCircle className="w-5 h-5 text-red-600" />,
    EXCLUDED: <MinusCircle className="w-5 h-5 text-gray-400" />
  };

  const formatDate = (isoString) => new Date(isoString).toLocaleDateString('en-US', { 
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">StarTracker → Bravo Import Tool</h1>
              <p className="text-gray-600">Upload a StarTracker export CSV to classify and prepare quotes for Bravo import.</p>
            </div>
            <button onClick={() => setShowHistory(!showHistory)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${showHistory ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'}`}>
              <History className="w-5 h-5" />
              <span>History ({batchHistory.length})</span>
            </button>
          </div>
          {/* Tabs */}
          {processedData && (
            <div className="flex gap-2 border-t border-gray-200 pt-4">
              <button
                onClick={() => setActiveTab('classify')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'classify'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <FileText className="w-4 h-4" />
                Classify
              </button>
              <button
                onClick={() => setActiveTab('transform')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'transform'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <ArrowRight className="w-4 h-4" />
                Transform ({transformableTours.length} available)
              </button>
            </div>
          )}
        </div>

        {/* History Panel */}
        {showHistory && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Batch History</h2>
                {batchHistory.length > 0 && (
                  <div className="text-sm text-gray-500 mt-1">
                    Storage: {storageSizeMB.toFixed(1)} MB / {STORAGE_LIMIT_MB} MB
                  </div>
                )}
              </div>
              {batchHistory.length > 0 && (
                <button onClick={clearAllHistory} className="text-sm text-red-600 hover:text-red-800">Clear All</button>
              )}
            </div>
            
            {batchHistory.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No batches saved yet. Upload a file and click "Save to History" to track your imports.</p>
            ) : (
              <div className="space-y-3">
                {batchHistory.map((batch) => (
                  <div key={batch.id} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="p-4 bg-gray-50 cursor-pointer hover:bg-gray-100"
                      onClick={() => setExpandedHistory(expandedHistory === batch.id ? null : batch.id)}>
                      <div className="flex items-center gap-4">
                        <div className="flex-shrink-0">
                          {expandedHistory === batch.id ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
                        </div>
                        <div className="flex-grow">
                          <div className="flex items-center gap-3">
                            <FileText className="w-4 h-4 text-gray-400" />
                            <span className="font-medium text-gray-900">{batch.fileName}</span>
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(batch.timestamp)}</span>
                            <span>{batch.totalTours} tours</span>
                            <span>{batch.totalRows} rows</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="px-2 py-1 bg-green-100 text-green-700 rounded">{batch.counts.ready} ready</span>
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded">{batch.counts.flagged} flagged</span>
                          <span className="px-2 py-1 bg-red-100 text-red-700 rounded">{batch.counts.blocked} blocked</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); deleteBatch(batch.id); }} className="p-2 text-gray-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    
                    {expandedHistory === batch.id && (
                      <div className="p-4 border-t border-gray-200 bg-white">
                        {batch.notes && (
                          <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                            <div className="text-sm font-medium text-blue-700 mb-1">Notes:</div>
                            <div className="text-sm text-blue-900">{batch.notes}</div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                          <div>
                            <div className="text-sm font-medium text-gray-700 mb-2">Ready TourIDs ({batch.counts.ready})</div>
                            <div className="text-xs text-gray-600 max-h-32 overflow-y-auto bg-gray-50 p-2 rounded font-mono">
                              {batch.tourIds?.ready?.join(', ') || 'None'}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-700 mb-2">Flagged TourIDs ({batch.counts.flagged})</div>
                            <div className="text-xs text-gray-600 max-h-32 overflow-y-auto bg-yellow-50 p-2 rounded font-mono">
                              {batch.tourIds?.flagged?.join(', ') || 'None'}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-700 mb-2">Blocked TourIDs ({batch.counts.blocked})</div>
                            <div className="text-xs text-gray-600 max-h-32 overflow-y-auto bg-red-50 p-2 rounded font-mono">
                              {batch.tourIds?.blocked?.join(', ') || 'None'}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-700 mb-2">Excluded TourIDs ({batch.counts.excluded})</div>
                            <div className="text-xs text-gray-600 max-h-32 overflow-y-auto bg-gray-100 p-2 rounded font-mono">
                              {batch.tourIds?.excluded?.join(', ') || 'None'}
                            </div>
                          </div>
                        </div>
                        
                        {/* Download buttons */}
                        {batch.data ? (
                          <div className="pt-4 border-t border-gray-200">
                            <div className="text-sm font-medium text-gray-700 mb-3">Download CSVs:</div>
                            <div className="flex flex-wrap gap-2">
                              <button 
                                onClick={() => handleBatchDownload(batch, 'ready-summary')}
                                disabled={batch.counts.ready === 0}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">
                                <Download className="w-3.5 h-3.5" />Ready ({batch.counts.ready})
                              </button>
                              <button 
                                onClick={() => handleBatchDownload(batch, 'ready-detailed')}
                                disabled={batch.counts.ready === 0}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-100 text-green-700 border border-green-300 rounded hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed">
                                <Download className="w-3.5 h-3.5" />Ready Detailed
                              </button>
                              <button 
                                onClick={() => handleBatchDownload(batch, 'flagged')}
                                disabled={batch.counts.flagged === 0}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed">
                                <Download className="w-3.5 h-3.5" />Flagged ({batch.counts.flagged})
                              </button>
                              <button 
                                onClick={() => handleBatchDownload(batch, 'blocked')}
                                disabled={batch.counts.blocked === 0}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
                                <Download className="w-3.5 h-3.5" />Blocked ({batch.counts.blocked})
                              </button>
                              <button 
                                onClick={() => handleBatchDownload(batch, 'full')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-600 text-white rounded hover:bg-gray-700">
                                <Download className="w-3.5 h-3.5" />Full Report
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="pt-4 border-t border-gray-200">
                            <div className="text-sm text-gray-500 italic">
                              This batch was saved before data storage was added. Please re-upload the file to download CSVs.
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors">
              <Upload className="w-5 h-5" />
              <span>Upload CSV</span>
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </label>
            {fileName && (
              <div className="flex items-center gap-2 text-gray-600">
                <FileText className="w-5 h-5" />
                <span>{fileName}</span>
                <span className="text-gray-400">({rawData?.length || 0} rows)</span>
              </div>
            )}
            {processedData && (
              <>
                <div className="flex-grow" />
                <input type="text" placeholder="Add notes for this batch..." value={batchNotes} onChange={(e) => setBatchNotes(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={saveBatchToHistory} className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors">
                  <History className="w-4 h-4" />Save to History
                </button>
              </>
            )}
          </div>
        </div>

        {/* Results */}
        {processedData && activeTab === 'classify' && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { key: 'READY', label: 'Ready', count: processedData.ready.length, desc: 'quotes ready for import', color: 'green' },
                { key: 'FLAGGED', label: 'Flagged', count: processedData.flagged.length, desc: 'need review first', color: 'yellow' },
                { key: 'BLOCKED', label: 'Blocked', count: processedData.blocked.length, desc: 'manual import required', color: 'red' },
                { key: 'EXCLUDED', label: 'Excluded', count: processedData.excluded.length, desc: 'skipped (internal/test)', color: 'gray' }
              ].map(({ key, label, count, desc, color }) => (
                <div key={key} onClick={() => setSelectedFilter(key)}
                  className={`bg-white rounded-lg shadow-sm border-2 p-4 cursor-pointer transition-all ${
                    selectedFilter === key ? `border-${color}-500 ring-2 ring-${color}-200` : `border-gray-200 hover:border-${color}-300`
                  }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-600">{label}</span>
                    {classificationIcons[key]}
                  </div>
                  <div className={`text-3xl font-bold text-${color}-600`}>{count}</div>
                  <div className="text-sm text-gray-500">{desc}</div>
                </div>
              ))}
            </div>

            <div className="mb-4">
              <button onClick={() => setSelectedFilter('ALL')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedFilter === 'ALL' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                Show All ({processedData.total} quotes)
              </button>
            </div>

            {/* Export Actions */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
              <div className="flex flex-wrap gap-3">
                <button onClick={() => downloadCSV(generateExportCSV(processedData.ready), 'bravo_import_ready.csv')}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50" disabled={!processedData.ready.length}>
                  <Download className="w-4 h-4" />Ready Summary ({processedData.ready.length})
                </button>
                <button onClick={() => downloadCSV(generateDetailedCSV(processedData.ready), 'bravo_import_ready_detailed.csv')}
                  className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 border border-green-300 rounded-lg hover:bg-green-200 disabled:opacity-50" disabled={!processedData.ready.length}>
                  <Download className="w-4 h-4" />Ready Detailed
                </button>
                <button onClick={() => downloadCSV(generateExportCSV(processedData.flagged), 'bravo_import_flagged.csv')}
                  className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50" disabled={!processedData.flagged.length}>
                  <Download className="w-4 h-4" />Flagged ({processedData.flagged.length})
                </button>
                <button onClick={() => downloadCSV(generateExportCSV(processedData.blocked), 'bravo_import_blocked.csv')}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50" disabled={!processedData.blocked.length}>
                  <Download className="w-4 h-4" />Blocked ({processedData.blocked.length})
                </button>
                <button onClick={() => downloadCSV(generateDetailedCSV(processedData.all), 'bravo_import_full_detailed.csv')}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
                  <Download className="w-4 h-4" />Full Report (Detailed)
                </button>
              </div>
            </div>

            {/* Tours List */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedFilter === 'ALL' ? 'All Quotes' : `${selectedFilter} Quotes`}
                  <span className="ml-2 text-gray-500 font-normal">({filteredTours.length})</span>
                </h2>
              </div>
              
              <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-600">
                <div className="col-span-1">TourID</div>
                <div className="col-span-3">Customer</div>
                <div className="col-span-3">Tour Name</div>
                <div className="col-span-2">Classification</div>
                <div className="col-span-2 text-right">Budget</div>
                <div className="col-span-1 text-right">Vehicles</div>
              </div>
              
              <div className="divide-y divide-gray-100">
                {filteredTours.map((tour) => (
                  <div key={tour.tourId} className="hover:bg-gray-50">
                    <div className="p-4 cursor-pointer" onClick={() => setExpandedTour(expandedTour === tour.tourId ? null : tour.tourId)}>
                      <div className="flex items-center gap-4 md:grid md:grid-cols-12">
                        <div className="hidden md:flex md:col-span-1 items-center gap-2">
                          {expandedTour === tour.tourId ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                          <span className="font-mono text-sm text-blue-600 font-medium">{tour.tourId}</span>
                        </div>
                        <div className="flex-grow md:col-span-3 min-w-0">
                          <div className="font-medium text-gray-900 truncate">{tour.customer}</div>
                          <div className="md:hidden text-xs text-gray-500">ID: {tour.tourId}</div>
                        </div>
                        <div className="hidden md:block md:col-span-3">
                          <div className="text-sm text-gray-600 truncate">{tour.tourName}</div>
                        </div>
                        <div className="flex-shrink-0 md:col-span-2">
                          <div className="flex items-center gap-2">
                            {classificationIcons[tour.classification]}
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${classificationColors[tour.classification]}`}>
                              {tour.classification}
                            </span>
                          </div>
                          {tour.leaseType === 'LONG_TERM' && (
                            <span className="mt-1 inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">LONG TERM</span>
                          )}
                        </div>
                        <div className="flex-shrink-0 md:col-span-2 text-right">
                          <div className="font-medium text-gray-900">${tour.totalBudget.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                        </div>
                        <div className="flex-shrink-0 md:col-span-1 text-right text-sm text-gray-500">{tour.vehicleCount}</div>
                      </div>
                    </div>
                    
                    {expandedTour === tour.tourId && (
                      <div className="px-4 pb-4 md:ml-8">
                        {tour.reasons.length > 0 && (
                          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                            <div className="text-sm font-medium text-gray-700 mb-2">Classification Reasons:</div>
                            <ul className="space-y-1">
                              {tour.reasons.map((reason, idx) => (
                                <li key={idx} className="text-sm text-gray-600 flex items-start gap-2">
                                  <span className="text-gray-400">•</span>{reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="bg-gray-100">
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Vehicle</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Start</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">End</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Driver</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">Rate</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">Budget</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">Days</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">Driver Days</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">DHF</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">DHR</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {tour.rows.map((row, idx) => (
                                <tr key={idx} className={cleanNum(row.TourBudget || row.BusBudget) === 0 ? 'bg-red-50' : ''}>
                                  <td className="px-3 py-2 text-gray-900 font-medium">{row.BusTrailer || row.Bus || '—'}</td>
                                  <td className="px-3 py-2 text-gray-600">{row.StartDate || '—'}</td>
                                  <td className="px-3 py-2 text-gray-600">{row.EndDate || '—'}</td>
                                  <td className="px-3 py-2 text-gray-600">{row.Driver || '—'}</td>
                                  <td className="px-3 py-2 text-right text-gray-900">${cleanNum(row.BusRate).toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right text-gray-900">${cleanNum(row.TourBudget || row.BusBudget).toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right text-gray-600">{cleanNum(row.TourDays)}</td>
                                  <td className="px-3 py-2 text-right text-gray-600">{cleanNum(row.DriverDays)}</td>
                                  <td className="px-3 py-2 text-right text-gray-600">{cleanNum(row.DriverDHF)}</td>
                                  <td className="px-3 py-2 text-right text-gray-600">{cleanNum(row.DriverDHR)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {filteredTours.length === 0 && <div className="p-8 text-center text-gray-500">No quotes in this category.</div>}
              </div>
            </div>
          </>
        )}

        {/* Transform Tab */}
        {processedData && activeTab === 'transform' && (
          <div className="space-y-6">
            {/* Transform Controls */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Transform to Bravo Format</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedForTransform.size > 0
                      ? `${selectedForTransform.size} of ${transformableTours.length} tours selected`
                      : `All ${transformableTours.length} READY/FLAGGED tours will be transformed`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={toggleAllSelection}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    {selectedForTransform.size === transformableTours.length ? 'Deselect All' : 'Select All'}
                  </button>
                  <button
                    onClick={handleTransform}
                    disabled={transformableTours.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowRight className="w-4 h-4" />
                    Transform {selectedForTransform.size > 0 ? `(${selectedForTransform.size})` : `All (${transformableTours.length})`}
                  </button>
                </div>
              </div>

              {/* Tour selection list */}
              <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                {transformableTours.map(tour => (
                  <label
                    key={tour.tourId}
                    className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedForTransform.has(tour.tourId)}
                      onChange={() => toggleTourSelection(tour.tourId)}
                      className="w-4 h-4 text-purple-600 rounded"
                    />
                    <span className="font-mono text-sm text-blue-600">{tour.tourId}</span>
                    <span className="text-sm text-gray-900 flex-grow">{tour.customer}</span>
                    <span className="text-sm text-gray-500 truncate max-w-xs">{tour.tourName}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      tour.classification === 'READY'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {tour.classification}
                    </span>
                  </label>
                ))}
                {transformableTours.length === 0 && (
                  <div className="p-8 text-center text-gray-500">
                    No READY or FLAGGED tours available for transformation.
                  </div>
                )}
              </div>
            </div>

            {/* Transform Results */}
            {transformedData && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Package className="w-5 h-5 text-purple-600" />
                      Transformation Results
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Ready to export as Bravo-compatible CSVs
                    </p>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                  <div className="bg-purple-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-purple-700">{transformedData.stats.quotesCount}</div>
                    <div className="text-xs text-purple-600">Quotes</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-blue-700">{transformedData.stats.coachesCount}</div>
                    <div className="text-xs text-blue-600">Coaches</div>
                  </div>
                  <div className="bg-cyan-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-cyan-700">{transformedData.stats.trailersCount}</div>
                    <div className="text-xs text-cyan-600">Trailers</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-green-700">{transformedData.stats.lineItemsCount}</div>
                    <div className="text-xs text-green-600">Line Items</div>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${transformedData.stats.errorsCount > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <div className={`text-2xl font-bold ${transformedData.stats.errorsCount > 0 ? 'text-red-700' : 'text-gray-400'}`}>
                      {transformedData.stats.errorsCount}
                    </div>
                    <div className={`text-xs ${transformedData.stats.errorsCount > 0 ? 'text-red-600' : 'text-gray-500'}`}>Errors</div>
                  </div>
                </div>

                {/* Errors */}
                {transformedData.errors.length > 0 && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <h3 className="text-sm font-medium text-red-800 mb-2">Transformation Errors:</h3>
                    <ul className="text-sm text-red-700 space-y-1">
                      {transformedData.errors.map((err, i) => (
                        <li key={i}>TourID {err.tourId}: {err.error}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Download Buttons */}
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => downloadTransformedCSV('all')}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  >
                    <Download className="w-4 h-4" />
                    Download All CSVs
                  </button>
                  <button
                    onClick={() => downloadTransformedCSV('quotes')}
                    className="flex items-center gap-2 px-3 py-2 bg-purple-100 text-purple-700 border border-purple-300 rounded-lg hover:bg-purple-200"
                  >
                    <Download className="w-4 h-4" />
                    Quotes ({transformedData.stats.quotesCount})
                  </button>
                  <button
                    onClick={() => downloadTransformedCSV('coaches')}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-100 text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-200"
                  >
                    <Download className="w-4 h-4" />
                    Coaches ({transformedData.stats.coachesCount})
                  </button>
                  <button
                    onClick={() => downloadTransformedCSV('trailers')}
                    disabled={transformedData.stats.trailersCount === 0}
                    className="flex items-center gap-2 px-3 py-2 bg-cyan-100 text-cyan-700 border border-cyan-300 rounded-lg hover:bg-cyan-200 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    Trailers ({transformedData.stats.trailersCount})
                  </button>
                  <button
                    onClick={() => downloadTransformedCSV('lineItems')}
                    className="flex items-center gap-2 px-3 py-2 bg-green-100 text-green-700 border border-green-300 rounded-lg hover:bg-green-200"
                  >
                    <Download className="w-4 h-4" />
                    Line Items ({transformedData.stats.lineItemsCount})
                  </button>
                </div>

                {/* Preview Tables */}
                <div className="mt-6 space-y-4">
                  <details className="border border-gray-200 rounded-lg">
                    <summary className="px-4 py-3 bg-gray-50 cursor-pointer font-medium text-gray-700 hover:bg-gray-100">
                      Preview Quotes ({transformedData.quotes.length})
                    </summary>
                    <div className="p-4 overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="bg-gray-100">
                            <th className="px-2 py-1 text-left">external_id</th>
                            <th className="px-2 py-1 text-left">artist_name</th>
                            <th className="px-2 py-1 text-left">quote_name</th>
                            <th className="px-2 py-1 text-left">type</th>
                            <th className="px-2 py-1 text-left">start_date</th>
                            <th className="px-2 py-1 text-left">end_date</th>
                            <th className="px-2 py-1 text-right">tour_days</th>
                            <th className="px-2 py-1 text-right">miles</th>
                          </tr>
                        </thead>
                        <tbody>
                          {transformedData.quotes.slice(0, 10).map((q, i) => (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-2 py-1 font-mono text-blue-600">{q.external_id}</td>
                              <td className="px-2 py-1">{q.artist_name}</td>
                              <td className="px-2 py-1 max-w-xs truncate">{q.quote_name}</td>
                              <td className="px-2 py-1">{q.type}</td>
                              <td className="px-2 py-1">{q.quoted_lease_start_date}</td>
                              <td className="px-2 py-1">{q.quoted_lease_end_date}</td>
                              <td className="px-2 py-1 text-right">{q.tour_days}</td>
                              <td className="px-2 py-1 text-right">{q.total_estimated_miles}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {transformedData.quotes.length > 10 && (
                        <p className="text-xs text-gray-500 mt-2">...and {transformedData.quotes.length - 10} more</p>
                      )}
                    </div>
                  </details>

                  <details className="border border-gray-200 rounded-lg">
                    <summary className="px-4 py-3 bg-gray-50 cursor-pointer font-medium text-gray-700 hover:bg-gray-100">
                      Preview Line Items ({transformedData.lineItems.length})
                    </summary>
                    <div className="p-4 overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="bg-gray-100">
                            <th className="px-2 py-1 text-left">external_id</th>
                            <th className="px-2 py-1 text-left">vehicle</th>
                            <th className="px-2 py-1 text-left">item_type</th>
                            <th className="px-2 py-1 text-right">qty</th>
                            <th className="px-2 py-1 text-right">rate</th>
                            <th className="px-2 py-1 text-left">unit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {transformedData.lineItems.slice(0, 20).map((li, i) => (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-2 py-1 font-mono text-blue-600">{li.external_id}</td>
                              <td className="px-2 py-1">{li.vehicle_name || '—'}</td>
                              <td className="px-2 py-1">{li.item_type}</td>
                              <td className="px-2 py-1 text-right">{li.quantity}</td>
                              <td className="px-2 py-1 text-right">${li.rate?.toFixed(2)}</td>
                              <td className="px-2 py-1">{li.unit_type}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {transformedData.lineItems.length > 20 && (
                        <p className="text-xs text-gray-500 mt-2">...and {transformedData.lineItems.length - 20} more</p>
                      )}
                    </div>
                  </details>
                </div>
              </div>
            )}
          </div>
        )}

        {!processedData && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <Upload className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No data loaded</h3>
            <p className="text-gray-500">Upload a StarTracker CSV export to begin classification.</p>
          </div>
        )}

        {/* Rules Reference */}
        <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Classification Rules Reference</h3>
          <div className="grid md:grid-cols-2 gap-6 text-sm">
            <div>
              <div className="flex items-center gap-2 mb-2"><MinusCircle className="w-4 h-4 text-gray-400" /><span className="font-medium text-gray-700">EXCLUDED</span></div>
              <ul className="text-gray-600 space-y-1 ml-6">
                <li>• Status = "Other" (service/maintenance)</li>
                <li>• Customer = "Celebrity Coaches" (internal)</li>
                <li>• Customer = "TEST CLIENT" (test data)</li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2"><XCircle className="w-4 h-4 text-red-600" /><span className="font-medium text-gray-700">BLOCKED</span></div>
              <ul className="text-gray-600 space-y-1 ml-6">
                <li>• Vehicle swap detected (same vehicle 2×)</li>
                <li>• Multiple $0 budget rows (swap tracking)</li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4 text-yellow-600" /><span className="font-medium text-gray-700">FLAGGED</span></div>
              <ul className="text-gray-600 space-y-1 ml-6">
                <li>• DiscountedDays &gt; 0 (verify mapping)</li>
                <li>• $0 BusRate with mileage (tour within LT lease)</li>
                <li>• Driver days override detected</li>
                <li>• Admin fee present</li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2"><CheckCircle className="w-4 h-4 text-green-600" /><span className="font-medium text-gray-700">READY</span></div>
              <ul className="text-gray-600 space-y-1 ml-6">
                <li>• Passes all classification checks</li>
                <li>• Can be imported directly to Bravo</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-gray-400">StarTracker → Bravo Import Tool • Celebrity Coaches • v1.1</div>
      </div>
    </div>
  );
}
