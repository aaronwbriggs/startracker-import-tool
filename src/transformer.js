/**
 * StarTracker → Bravo Transformation Engine
 *
 * Transforms classified StarTracker data into Bravo-ready format.
 * Outputs CSV-ready objects for each Bravo table.
 */

// Quote Item Type mappings (from BRAVO_SCHEMA.md)
// These are looked up by name during import, but we define the structure here
const QUOTE_ITEM_TYPES = {
  COACH_RATE_DAILY: 'Coach Rate, Daily',
  COACH_RATE_MONTHLY: 'Coach Rate, Monthly',
  TRAILER_RATE_DAILY: 'Trailer Rate, Daily',
  TRAILER_RATE_MONTHLY: 'Trailer Rate, Monthly',
  DRIVER_RATE_DAILY: 'Driver Rate, Daily',
  ADDITIONAL_DRIVER_DAYS: 'Additional Driver Days',
  ADMIN_FEE: 'Admin Fee',
  MISCELLANEOUS: 'Miscellaneous',
  SATELLITE_DAILY: 'Satellite Service, Daily',
  SATELLITE_MONTHLY: 'Satellite Service, Monthly',
  INTERNET_DAILY: 'Internet Service, Daily',
  INTERNET_MONTHLY: 'Internet Service, Monthly',
  INSURANCE_DAILY: 'Insurance, Daily',
  INSURANCE_MONTHLY: 'Insurance, Monthly',
  IFTA_DOT_DAILY: 'IFTA/DOT Fee, Daily',
  IFTA_DOT_MONTHLY: 'IFTA/DOT Fee, Monthly',
  FUEL_ESTIMATE: 'Fuel Estimate',
  ENGINE_SERVICES: 'Engine Services',
  INTERIOR_CLEANINGS: 'Interior Cleanings',
  BUS_WASHES: 'Weekly Coach Wash',
  LINEN_CLEANINGS: 'Linen Cleanings',
  GENERATOR_SERVICES: 'Generator Services',
  WEEKLY_GENERATOR_SERVICES: 'Weekly Generator Services',
  DRIVER_PER_DIEM: 'Driver Per Diem',
  CO_DRIVER_PER_DIEMS: 'Co-Driver Per Diems',
  CO_DRIVER_RATE_DAILY: 'Co-Driver Rate, Daily',
  DRIVER_OVERDRIVES: 'Driver Overdrives',
  DRIVER_HOTEL_BUY_OUTS: 'Driver Hotel Buy Outs',
  TOLLS: 'Tolls',
  END_OF_TOUR_CLEANING: 'End of Tour Cleaning',
  UPHOLSTERY_CLEANING: 'Upholstery Cleaning',
  BED_KIT_INSTALL: 'Bed Kit Install / Bunk Change Fee',
};

// Trailer prefixes (from Master Plan)
const TRAILER_PREFIXES = ['CC', 'ML', 'LK', 'TA'];

/**
 * CONTACT_ROLE_MAPPING - Maps role abbreviations/keywords to Bravo contact roles
 * Default role is 'Business Manager' when no role indicator is found
 */
const CONTACT_ROLE_PATTERNS = [
  { pattern: /\bTM\b/i, role: 'Tour Manager' },
  { pattern: /\bTour\s*Manager\b/i, role: 'Tour Manager' },
  { pattern: /\bTour\s*Mgr\b/i, role: 'Tour Manager' },
  { pattern: /\bPM\b/i, role: 'Production Manager' },
  { pattern: /\bProduction\s*Manager\b/i, role: 'Production Manager' },
  { pattern: /\bProd\s*Mgr\b/i, role: 'Production Manager' },
  { pattern: /\bBusiness\s*Manager\b/i, role: 'Business Manager' },
  { pattern: /\bBiz\s*Mgr\b/i, role: 'Business Manager' },
  { pattern: /\bBilling\b/i, role: 'Billing Contact' },
];

const DEFAULT_CONTACT_ROLE = 'Business Manager';

/**
 * RATE_FIELD_MAPPING - Maps StarTracker fields to Bravo line item types by quote type
 *
 * This explicit mapping handles the ST/LT difference:
 * - StarTracker has no ST/LT distinction - agents use $0 for both waived charges AND non-applicable items
 * - Bravo enforces quote type constraints - certain items only valid for ST or LT
 *
 * For each StarTracker field:
 *   shortTerm: Bravo item type for Short Term quotes (null = skip for ST)
 *   longTerm:  Bravo item type for Long Term quotes (null = skip for LT)
 *   unitType:  { shortTerm, longTerm } - unit types for each quote type
 *   quantitySource: 'days' | 'months' | 'weeks' | 'mileage' | 'flat' - what to use for quantity
 *
 * CHECKPOINT: Review this mapping with Aaron before implementing the refactor.
 */
const RATE_FIELD_MAPPING = {
  // --- Vehicle Rates ---
  BusRate: {
    shortTerm: QUOTE_ITEM_TYPES.COACH_RATE_DAILY,
    longTerm: QUOTE_ITEM_TYPES.COACH_RATE_MONTHLY,
    unitType: { shortTerm: 'Per Day', longTerm: 'Per Month' },
    quantitySource: { shortTerm: 'busDays', longTerm: 'billedMonths' },
  },
  // Note: Trailer rate uses same BusRate field but different item type - handled specially in code

  // --- Driver Services ---
  DriverRate: {
    // LT quotes show Driver Rate Daily as "variable expense" with qty=0
    // This lets customers see the rate they'll pay when using driver services under their lease
    shortTerm: QUOTE_ITEM_TYPES.DRIVER_RATE_DAILY,
    longTerm: QUOTE_ITEM_TYPES.DRIVER_RATE_DAILY,
    unitType: { shortTerm: 'Per Day', longTerm: 'Per Day' },
    quantitySource: { shortTerm: 'driverDays', longTerm: 'zero' }, // LT uses qty=0
  },

  // --- Daily/Monthly Services (switch item type based on quote type) ---
  SatelliteRate: {
    shortTerm: QUOTE_ITEM_TYPES.SATELLITE_DAILY,
    longTerm: QUOTE_ITEM_TYPES.SATELLITE_MONTHLY,
    unitType: { shortTerm: 'Per Day', longTerm: 'Per Month' },
    quantitySource: { shortTerm: 'busDays', longTerm: 'billedMonths' },
  },
  InternetRate: {
    shortTerm: QUOTE_ITEM_TYPES.INTERNET_DAILY,
    longTerm: QUOTE_ITEM_TYPES.INTERNET_MONTHLY,
    unitType: { shortTerm: 'Per Day', longTerm: 'Per Month' },
    quantitySource: { shortTerm: 'busDays', longTerm: 'billedMonths' },
  },
  InsuranceRate: {
    shortTerm: QUOTE_ITEM_TYPES.INSURANCE_DAILY,
    longTerm: QUOTE_ITEM_TYPES.INSURANCE_MONTHLY,
    unitType: { shortTerm: 'Per Day', longTerm: 'Per Month' },
    quantitySource: { shortTerm: 'busDays', longTerm: 'billedMonths' },
  },
  DOTRate: {
    shortTerm: QUOTE_ITEM_TYPES.IFTA_DOT_DAILY,
    longTerm: QUOTE_ITEM_TYPES.IFTA_DOT_MONTHLY,
    unitType: { shortTerm: 'Per Day', longTerm: 'Per Month' },
    quantitySource: { shortTerm: 'busDays', longTerm: 'billedMonths' },
  },

  // --- Mileage-Based Services ---
  // LT quotes show these as "variable expense" with qty=0 so customer sees the rate
  FuelRate: {
    shortTerm: QUOTE_ITEM_TYPES.FUEL_ESTIMATE,
    longTerm: QUOTE_ITEM_TYPES.FUEL_ESTIMATE,
    unitType: { shortTerm: 'Per Mile', longTerm: 'Per Mile' },
    quantitySource: { shortTerm: 'mileage', longTerm: 'zero' }, // LT uses qty=0
  },
  EngineRate: {
    shortTerm: QUOTE_ITEM_TYPES.ENGINE_SERVICES,
    longTerm: QUOTE_ITEM_TYPES.ENGINE_SERVICES,
    unitType: { shortTerm: 'Per Mile', longTerm: 'Per Mile' },
    quantitySource: { shortTerm: 'mileage', longTerm: 'zero' }, // LT uses qty=0
  },

  // --- Weekly Services (Short Term only) ---
  InteriorCleaning: {
    shortTerm: QUOTE_ITEM_TYPES.INTERIOR_CLEANINGS,
    longTerm: null, // Not applicable to LT
    unitType: { shortTerm: 'Per Week', longTerm: null },
    quantitySource: { shortTerm: 'weeks', longTerm: null },
  },
  BusWashRate: {
    shortTerm: QUOTE_ITEM_TYPES.BUS_WASHES,
    longTerm: null, // Not applicable to LT
    unitType: { shortTerm: 'Per Week', longTerm: null },
    quantitySource: { shortTerm: 'weeks', longTerm: null },
  },
  LinenRate: {
    shortTerm: QUOTE_ITEM_TYPES.LINEN_CLEANINGS,
    longTerm: null, // Not applicable to LT
    unitType: { shortTerm: 'Per Week', longTerm: null },
    quantitySource: { shortTerm: 'weeks', longTerm: null },
  },
  GeneratorRate: {
    // ST: "Weekly Generator Services" (per week, minimum_quantity=1 in Bravo)
    // LT: "Generator Services" only if rate > 0 (shows as variable expense)
    shortTerm: QUOTE_ITEM_TYPES.WEEKLY_GENERATOR_SERVICES,
    longTerm: QUOTE_ITEM_TYPES.GENERATOR_SERVICES,
    unitType: { shortTerm: 'Per Week', longTerm: 'Per Week' },
    quantitySource: { shortTerm: 'weeksMinOne', longTerm: 'zero' }, // ST uses min(weeks, 1) to match Bravo's minimum_quantity
    longTermRequiresPositiveRate: true, // Special: only create LT item if rate > 0
  },

  // --- Flat Rate Items (Short Term only) ---
  CleaningTotal: {
    shortTerm: QUOTE_ITEM_TYPES.END_OF_TOUR_CLEANING,
    longTerm: null, // Not applicable to LT
    unitType: { shortTerm: 'Flat Rate', longTerm: null },
    quantitySource: { shortTerm: 'flat', longTerm: null },
  },
  Upholstery: {
    shortTerm: QUOTE_ITEM_TYPES.UPHOLSTERY_CLEANING,
    longTerm: null, // Not applicable to LT
    unitType: { shortTerm: 'Flat Rate', longTerm: null },
    quantitySource: { shortTerm: 'flat', longTerm: null },
  },
  BedKitTotal: {
    shortTerm: QUOTE_ITEM_TYPES.BED_KIT_INSTALL,
    longTerm: null, // Not applicable to LT
    unitType: { shortTerm: 'Flat Rate', longTerm: null },
    quantitySource: { shortTerm: 'flat', longTerm: null },
  },
  Tolls: {
    shortTerm: QUOTE_ITEM_TYPES.TOLLS,
    longTerm: null, // Not applicable to LT - no route to estimate tolls
    unitType: { shortTerm: 'Flat Rate', longTerm: null },
    quantitySource: { shortTerm: 'flat', longTerm: null },
  },

  // --- Flat Rate Items (both ST and LT) ---
  // Note: In StarTracker, AdminTotal and MiscTotal are per-row (per-vehicle), not quote-level
  MiscTotal: {
    shortTerm: QUOTE_ITEM_TYPES.MISCELLANEOUS,
    longTerm: QUOTE_ITEM_TYPES.MISCELLANEOUS,
    unitType: { shortTerm: 'Flat Rate', longTerm: 'Flat Rate' },
    quantitySource: { shortTerm: 'flat', longTerm: 'flat' },
  },
  AdminTotal: {
    shortTerm: QUOTE_ITEM_TYPES.ADMIN_FEE,
    longTerm: QUOTE_ITEM_TYPES.ADMIN_FEE,
    unitType: { shortTerm: 'Flat Rate', longTerm: 'Flat Rate' },
    quantitySource: { shortTerm: 'flat', longTerm: 'flat' },
  },
};

// Note: Per Diems (Driver Per Diem, Co-Driver Per Diems) are handled separately
// because they have special logic around co_driver_days and rate derivation

/**
 * Check if a rate field exists in the source data (even if value is $0)
 * Returns true if the field is present and not empty, false if absent/null/empty
 */
export const hasRateField = (row, fieldName) => {
  const value = row[fieldName];
  return value !== undefined && value !== null && value !== '';
};

/**
 * Get the Bravo item type for a StarTracker field based on quote type
 * Returns null if the field should be skipped for this quote type
 */
export const getItemTypeForQuoteType = (fieldName, isLongTerm, rate = 0) => {
  const mapping = RATE_FIELD_MAPPING[fieldName];
  if (!mapping) return null;

  if (isLongTerm) {
    // Special case: some LT items only created if rate > 0
    if (mapping.longTermRequiresPositiveRate && rate <= 0) {
      return null;
    }
    return mapping.longTerm;
  }
  return mapping.shortTerm;
};

/**
 * Get the unit type for a StarTracker field based on quote type
 */
export const getUnitTypeForQuoteType = (fieldName, isLongTerm) => {
  const mapping = RATE_FIELD_MAPPING[fieldName];
  if (!mapping) return null;
  return isLongTerm ? mapping.unitType.longTerm : mapping.unitType.shortTerm;
};

/**
 * Get the quantity source for a StarTracker field based on quote type
 */
export const getQuantitySource = (fieldName, isLongTerm) => {
  const mapping = RATE_FIELD_MAPPING[fieldName];
  if (!mapping) return null;
  return isLongTerm ? mapping.quantitySource.longTerm : mapping.quantitySource.shortTerm;
};

/**
 * Check if a field is quote-level (not vehicle-specific)
 */
export const isQuoteLevelField = (fieldName) => {
  const mapping = RATE_FIELD_MAPPING[fieldName];
  return mapping?.isQuoteLevel === true;
};

/**
 * Calculate quantity based on quantitySource
 */
export const calculateQuantity = (quantitySource, context) => {
  const { busDays, billedMonths, driverDays, tourWeeks, mileage } = context;
  switch (quantitySource) {
    case 'busDays': return busDays;
    case 'billedMonths': return billedMonths;
    case 'driverDays': return driverDays;
    case 'weeks': return tourWeeks;
    case 'weeksMinOne': return Math.max(tourWeeks, 1); // For items with minimum_quantity=1 in Bravo
    case 'mileage': return mileage;
    case 'flat': return 1;
    case 'zero': return 0;
    default: return 0;
  }
};

/**
 * Create a line item using the mapping table
 * Returns the line item object or null if it should be skipped
 */
export const createMappedLineItem = (fieldName, rate, longTerm, context) => {
  const { tourId, vehicleName, vehicleIdx } = context;

  // Get item type for this quote type
  const itemType = getItemTypeForQuoteType(fieldName, longTerm, rate);
  if (!itemType) return null; // Skip - not applicable for this quote type

  // Get unit type and quantity source
  const unitType = getUnitTypeForQuoteType(fieldName, longTerm);
  const quantitySource = getQuantitySource(fieldName, longTerm);
  const quantity = calculateQuantity(quantitySource, context);

  // For quote-level items, don't attach to a vehicle
  const isQuoteLevel = isQuoteLevelField(fieldName);

  return {
    external_id: String(tourId),
    vehicle_name: isQuoteLevel ? null : vehicleName,
    vehicle_index: isQuoteLevel ? null : vehicleIdx,
    item_type: itemType,
    quantity: quantity,
    rate: rate,
    unit_type: unitType,
    billing_category: 'Contracted',
  };
};

/**
 * Check if a vehicle name is a trailer
 */
export const isTrailer = (vehicleName) => {
  if (!vehicleName) return false;
  const normalized = vehicleName.trim().toUpperCase();
  return TRAILER_PREFIXES.some(prefix => normalized.startsWith(prefix));
};

/**
 * Normalize vehicle name (remove asterisks, trim)
 */
export const normalizeVehicleName = (name) => {
  if (!name) return '';
  return name.trim().replace(/\*+$/, '').trim();
};

/**
 * Parse date from various formats
 */
export const parseDate = (dateStr) => {
  if (!dateStr) return null;

  // Try MM/DD/YYYY format
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [month, day, year] = parts;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try ISO format
  if (dateStr.includes('-')) {
    return dateStr.substring(0, 10);
  }

  return null;
};

/**
 * Clean numeric value
 */
export const cleanNum = (val) => {
  if (!val || val === '') return 0;
  const cleaned = String(val).replace(/[$,]/g, '').trim();
  return parseFloat(cleaned) || 0;
};

/**
 * Column alias helper - handles different column names between export formats
 * Sample data uses: Notes, BusMonths, PerDeimTotal, TravelDaysIn/Out, AddDriverDays
 * Synthetic uses: TourNotes, BilledMonths, PerDiemTotal, BusDHF/BusDHR
 */
export const getField = (row, ...aliases) => {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== '') {
      return row[alias];
    }
  }
  return '';
};

export const getNumField = (row, ...aliases) => {
  return cleanNum(getField(row, ...aliases));
};

/**
 * Detect if quote is Long Term
 */
export const isLongTerm = (rows) => {
  return rows.some(r => {
    const busRate = cleanNum(r.BusRate);
    const billedMonths = getNumField(r, 'BilledMonths', 'BusMonths');
    const tourDays = cleanNum(r.TourDays);
    const driverDays = cleanNum(r.DriverDays);
    const vehicleName = r.BusTrailer || r.Bus || '';
    // Exclude trailer rows from driverDays check — trailers naturally have 0 driver days
    const isTrailerRow = isTrailer(vehicleName);
    // If BusRateType is "Per Day", it's explicitly short-term — don't let driverDays heuristic override
    const busRateType = (r.BusRateType || '').trim();
    return busRate >= 2000 || billedMonths >= 6 || (!isTrailerRow && driverDays === 0 && tourDays > 60 && busRateType !== 'Per Day');
  });
};

/**
 * Map StarTracker status to Bravo status
 *
 * StarTracker statuses:
 *   - "Quote - Active" → Draft (still being worked on)
 *   - "Quote - Closed" → Declined (quote not converted)
 *   - "Contract - Signed" → Approved (ready for manual lease conversion)
 *   - "Contract - Verbal" → Approved
 *   - "Contract - Committed" → Approved
 */
export const mapStatus = (starTrackerStatus) => {
  if (!starTrackerStatus) return 'Draft';

  if (starTrackerStatus === 'Quote - Active') {
    return 'Draft';
  }
  if (starTrackerStatus === 'Quote - Closed') {
    return 'Declined';
  }
  if (starTrackerStatus.startsWith('Contract')) {
    // Contract - Signed, Contract - Verbal, Contract - Committed
    return 'Approved';
  }

  // Default fallback for any unknown status
  return 'Draft';
};

/**
 * Determine if this is a contract that should create a lease
 */
export const isContract = (status) => {
  return status?.startsWith('Contract');
};

/**
 * Map billing category
 */
export const mapBillingCategory = (starTrackerCategory) => {
  if (!starTrackerCategory) return 'Contracted';
  if (starTrackerCategory === 'Included in Contract') return 'Contracted';
  // Both "Driver Collect" and "Client Responsibility" map to "Client Responsibility"
  return 'Client Responsibility';
};

/**
 * Parse contact name and extract role if embedded
 * e.g., "Geoff Donkin - TM" → { name: "Geoff Donkin", role: "Tour Manager" }
 * e.g., "Elaine Brown - Business Manager" → { name: "Elaine Brown", role: "Business Manager" }
 * e.g., "David Zeisler" → { name: "David Zeisler", role: "Business Manager" } (default)
 */
export const parseContactName = (rawName) => {
  if (!rawName || !rawName.trim()) return null;

  let name = rawName.trim();
  let role = DEFAULT_CONTACT_ROLE;

  // Check for role patterns in the name
  for (const { pattern, role: mappedRole } of CONTACT_ROLE_PATTERNS) {
    if (pattern.test(name)) {
      role = mappedRole;
      // Remove the role indicator from the name
      // Handle patterns like "Name - TM" or "Name - Tour Manager"
      name = name.replace(/\s*[-–]\s*.*$/, '').trim();
      break;
    }
  }

  // Also handle "Biz Mgr contact Name" prefix pattern
  name = name.replace(/^Biz\s*Mgr\s*contact\s*/i, '').trim();

  if (!name) return null;

  return { name, role };
};

/**
 * Build address string from Address1 and Address2
 */
export const buildAddress = (address1, address2) => {
  const parts = [address1, address2].filter(p => p && p.trim());
  return parts.join(', ') || null;
};

/**
 * Extract artist data from a StarTracker row
 */
export const extractArtistData = (row) => {
  const customerName = getField(row, 'CustomerName');
  if (!customerName) return null;

  return {
    name: customerName,
    legal_name: getField(row, 'Name') || null,
    address: buildAddress(getField(row, 'Address1'), getField(row, 'Address2')),
    city: getField(row, 'City') || null,
    state: getField(row, 'State') || null,
    zip: getField(row, 'Zip') || null,
  };
};

/**
 * Extract contacts from a StarTracker row (Contact1 and Contact2)
 * Returns array of contact objects with artist_name for linking
 */
export const extractContacts = (row, artistName) => {
  const contacts = [];

  // Contact 1 (columns O-R)
  const contact1Name = getField(row, 'Contact1');
  if (contact1Name) {
    const parsed = parseContactName(contact1Name);
    if (parsed) {
      contacts.push({
        artist_name: artistName,
        full_name: parsed.name,
        role: parsed.role,
        phone: getField(row, 'Phone1') || null,
        email: getField(row, 'EMail1') || null,
        is_primary: true, // First contact is primary
      });
    }
  }

  // Contact 2 (columns S-V)
  const contact2Name = getField(row, 'Contact2');
  if (contact2Name) {
    const parsed = parseContactName(contact2Name);
    if (parsed) {
      contacts.push({
        artist_name: artistName,
        full_name: parsed.name,
        role: parsed.role,
        phone: getField(row, 'Phone2') || null,
        email: getField(row, 'EMail2') || null,
        is_primary: false,
      });
    }
  }

  return contacts;
};

/**
 * Generate a quote number slug from customer name
 */
export const generateQuoteSlug = (customerName, tourId) => {
  if (!customerName) return `Q-UNKNOWN-${tourId}`;
  const slug = customerName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 20);
  return `Q-${slug}-${tourId}`;
};

/**
 * Transform a single tour (group of rows with same TourID) into Bravo records
 *
 * @param {Object} classifiedTour - Output from classifyTour()
 * @returns {Object} Bravo-ready records
 */
export const transformTour = (classifiedTour) => {
  const { tourId, customer, tourName, status, rows, leaseType } = classifiedTour;
  const firstRow = rows[0];
  const longTerm = leaseType === 'LONG_TERM';

  // Calculate values from ALL rows (for multi-vehicle quotes)
  // co_driver_days: max AddDriverDays across all rows (may only be set on one vehicle)
  const maxCoDriverDays = Math.max(...rows.map(r => cleanNum(r.AddDriverDays) || 0));
  // discount_days: max DiscountedDays across all rows
  const maxDiscountDays = Math.max(...rows.map(r => cleanNum(r.DiscountedDays) || 0));
  // _startracker_total: sum TourBudget across all rows (each row has per-vehicle total)
  const totalStarTrackerBudget = rows.reduce((sum, r) => sum + (getNumField(r, 'TourBudget') || 0), 0);

  // Build quote record - using getField/getNumField for aliased columns
  const billedMonths = getNumField(firstRow, 'BilledMonths', 'BusMonths');
  const quote = {
    external_id: String(tourId),
    seq_number: parseInt(tourId) || null,
    artist_name: customer, // Will be looked up to get artist_id during import
    quote_name: tourName || `Tour ${tourId}`,
    quote_number: generateQuoteSlug(customer, tourId),
    status: mapStatus(status),
    type: longTerm ? 'Long Term' : 'Short Term',
    quoted_lease_start_date: parseDate(firstRow.StartDate),
    quoted_lease_end_date: parseDate(firstRow.EndDate),
    tour_start_date: parseDate(firstRow.StartDate),
    tour_end_date: parseDate(firstRow.EndDate),
    quoted_lease_days: cleanNum(firstRow.TourDays),
    tour_days: cleanNum(firstRow.TourDays),
    billed_bus_days: getNumField(firstRow, 'BusDays', 'BilledDays'),
    main_driver_days: cleanNum(firstRow.DriverDays),
    billed_driver_days: cleanNum(firstRow.DriverDays),
    total_estimated_miles: cleanNum(firstRow.TotalMileage),
    driver_deadhead_front_days: cleanNum(firstRow.DriverDHF),
    driver_deadhead_rear_days: cleanNum(firstRow.DriverDHR),
    bus_deadhead_front_days: getNumField(firstRow, 'TravelDaysIn', 'BusDHF'),
    bus_deadhead_rear_days: getNumField(firstRow, 'TravelDaysOut', 'BusDHR'),
    co_driver_days: maxCoDriverDays,
    discount_days: maxDiscountDays,
    main_driver_overdrives: getNumField(firstRow, 'DriverODQty') || 0,
    quoted_lease_months: longTerm ? billedMonths : null,
    tour_months: longTerm ? billedMonths : null,
    notes: getField(firstRow, 'Notes', 'TourNotes') || null,
    _startracker_status: status, // Preserve original for reference
    _is_contract: isContract(status),
    _startracker_total: totalStarTrackerBudget, // Sum of TourBudget across all vehicles
  };

  // Build vehicle assignments
  const quoteCoaches = [];
  const quoteTrailers = [];

  rows.forEach((row, idx) => {
    const vehicleName = normalizeVehicleName(row.BusTrailer || row.Bus);
    if (!vehicleName) return;

    const vehicleData = {
      external_id: String(tourId),
      vehicle_name: vehicleName,
      vehicle_index: idx, // For matching line items
      use_custom_tour_data: false, // Will be set if vehicle has different dates
      custom_tour_start_date: null,
      custom_tour_end_date: null,
      custom_total_estimated_miles: null,
      custom_tour_days: null,
      custom_billed_bus_days: null,
      custom_main_driver_days: null,
    };

    // Check if this vehicle has different dates than the first vehicle
    if (idx > 0) {
      const firstStart = parseDate(firstRow.StartDate);
      const thisStart = parseDate(row.StartDate);
      const firstEnd = parseDate(firstRow.EndDate);
      const thisEnd = parseDate(row.EndDate);

      if (firstStart !== thisStart || firstEnd !== thisEnd) {
        vehicleData.use_custom_tour_data = true;
        vehicleData.custom_tour_start_date = thisStart;
        vehicleData.custom_tour_end_date = thisEnd;
        vehicleData.custom_total_estimated_miles = cleanNum(row.TotalMileage);
        vehicleData.custom_tour_days = cleanNum(row.TourDays);
        vehicleData.custom_billed_bus_days = getNumField(row, 'BusDays', 'BilledDays');
        vehicleData.custom_main_driver_days = cleanNum(row.DriverDays);
      }
    }

    if (isTrailer(vehicleName)) {
      quoteTrailers.push(vehicleData);
    } else {
      quoteCoaches.push(vehicleData);
    }
  });

  // Build line items
  const lineItems = [];

  rows.forEach((row, vehicleIdx) => {
    const vehicleName = normalizeVehicleName(row.BusTrailer || row.Bus);
    const vehicleIsTrailer = isTrailer(vehicleName);

    // Common context for line item creation
    const busDays = getNumField(row, 'BusDays', 'BilledDays');
    const rowBilledMonths = getNumField(row, 'BilledMonths', 'BusMonths');
    const tourDays = cleanNum(row.TourDays);
    const tourWeeks = Math.floor(tourDays / 7); // Match Bravo: FLOOR(days / 7), 0 for tours < 7 days
    const totalMileage = cleanNum(row.TotalMileage);
    const driverDays = cleanNum(row.DriverDays);

    const context = {
      tourId,
      vehicleName,
      vehicleIdx,
      busDays,
      billedMonths: rowBilledMonths,
      driverDays,
      tourWeeks,
      mileage: totalMileage,
    };

    // --- Vehicle Rate (Coach or Trailer) ---
    // Note: Trailers use separate item types, handled specially
    const busRate = cleanNum(row.BusRate);
    if (hasRateField(row, 'BusRate')) {
      if (vehicleIsTrailer) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: longTerm ? QUOTE_ITEM_TYPES.TRAILER_RATE_MONTHLY : QUOTE_ITEM_TYPES.TRAILER_RATE_DAILY,
          quantity: longTerm ? rowBilledMonths : busDays,
          rate: busRate,
          unit_type: longTerm ? 'Per Month' : 'Per Day',
          billing_category: 'Contracted',
        });
      } else {
        const lineItem = createMappedLineItem('BusRate', busRate, longTerm, context);
        if (lineItem) lineItems.push(lineItem);
      }
    }

    // --- Coach-specific line items (not for trailers) ---
    if (!vehicleIsTrailer) {
      const dhf = cleanNum(row.DriverDHF);
      const dhr = cleanNum(row.DriverDHR);

      // --- Driver Rate ---
      // Special handling: has fallback rate derivation and Additional Driver Days logic
      let driverRate = cleanNum(row.DriverRate);
      const driverTotal = cleanNum(row.DriverTotal);

      // Fallback: calculate from DriverTotal if DriverRate not available
      if (driverRate === 0 && driverTotal > 0 && driverDays > 0) {
        driverRate = driverTotal / driverDays;
      }
      // Second fallback: synthetic data may use PerDiemTotal
      if (driverRate === 0) {
        const perDiemTotal = getNumField(row, 'PerDiemTotal', 'PerDeimTotal');
        if (perDiemTotal > 0 && driverDays > 0) {
          driverRate = perDiemTotal / driverDays;
        }
      }

      // Create Driver Rate line item if field exists (even if $0)
      if (hasRateField(row, 'DriverRate') || hasRateField(row, 'DriverTotal') || hasRateField(row, 'PerDiemTotal')) {
        const itemType = getItemTypeForQuoteType('DriverRate', longTerm, driverRate);
        if (itemType) {
          if (longTerm) {
            // LT: qty=0 as "variable expense"
            lineItems.push({
              external_id: String(tourId),
              vehicle_name: vehicleName,
              vehicle_index: vehicleIdx,
              item_type: itemType,
              quantity: 0,
              rate: driverRate,
              unit_type: 'Per Day',
              billing_category: 'Contracted',
            });
          } else {
            // ST: calculate base days and additional days
            const baseDriverDays = tourDays + dhf + dhr;
            const additionalDays = driverDays - baseDriverDays;

            lineItems.push({
              external_id: String(tourId),
              vehicle_name: vehicleName,
              vehicle_index: vehicleIdx,
              item_type: itemType,
              quantity: additionalDays > 0 ? baseDriverDays : driverDays,
              rate: driverRate,
              unit_type: 'Per Day',
              billing_category: 'Contracted',
            });

            // Additional driver days if override detected
            if (additionalDays > 0) {
              lineItems.push({
                external_id: String(tourId),
                vehicle_name: vehicleName,
                vehicle_index: vehicleIdx,
                item_type: QUOTE_ITEM_TYPES.ADDITIONAL_DRIVER_DAYS,
                quantity: additionalDays,
                rate: driverRate,
                unit_type: 'Per Quantity',
                billing_category: 'Contracted',
              });
            }
          }
        }
      }

      // --- Daily/Monthly Services (using mapping table) ---
      const mappedFields = [
        'SatelliteRate',
        'InternetRate',
        'InsuranceRate',
        'DOTRate',
        'FuelRate',
        'EngineRate',
        'GeneratorRate',
      ];

      mappedFields.forEach(fieldName => {
        if (hasRateField(row, fieldName)) {
          const rate = cleanNum(row[fieldName]);
          const lineItem = createMappedLineItem(fieldName, rate, longTerm, context);
          if (lineItem) lineItems.push(lineItem);
        }
      });

      // --- Weekly Services (ST only, using mapping table) ---
      const weeklyFields = ['InteriorCleaning', 'BusWashRate', 'LinenRate'];
      weeklyFields.forEach(fieldName => {
        if (hasRateField(row, fieldName)) {
          const rate = cleanNum(row[fieldName]);
          const lineItem = createMappedLineItem(fieldName, rate, longTerm, context);
          if (lineItem) lineItems.push(lineItem);
        }
      });

      // --- Flat Rate Items (ST only, using mapping table) ---
      const flatRateFields = ['CleaningTotal', 'Upholstery', 'BedKitTotal', 'Tolls'];
      flatRateFields.forEach(fieldName => {
        if (hasRateField(row, fieldName)) {
          const rate = cleanNum(row[fieldName]);
          const lineItem = createMappedLineItem(fieldName, rate, longTerm, context);
          if (lineItem) lineItems.push(lineItem);
        }
      });

      // --- Driver Overdrives (ST only) ---
      // StarTracker fields: DriverODQty, DriverODRate, DriverODTotal
      const driverODQty = getNumField(row, 'DriverODQty');
      const driverODRate = getNumField(row, 'DriverODRate');
      if (driverODQty > 0 && !longTerm) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.DRIVER_OVERDRIVES,
          quantity: driverODQty,
          rate: driverODRate,
          unit_type: 'Per Quantity',
          billing_category: 'Contracted',
        });
      }

      // --- Driver Hotel Buy Outs (ST only) ---
      // StarTracker fields: HotelBuyOutQty, HotelBuyOutRate, HotelBuyOutTotal
      const hotelBuyOutQty = getNumField(row, 'HotelBuyOutQty');
      const hotelBuyOutRate = getNumField(row, 'HotelBuyOutRate');
      if (hotelBuyOutQty > 0 && !longTerm) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.DRIVER_HOTEL_BUY_OUTS,
          quantity: hotelBuyOutQty,
          rate: hotelBuyOutRate,
          unit_type: 'Per Quantity',
          billing_category: 'Contracted',
        });
      }

      // --- Driver Per Diem (ST only) ---
      // StarTracker stores PerDeimTotal as a flat amount (agent manually calculates days × $50)
      // Bravo uses qty=DriverDays × rate=$50 per day
      // Only create when DriverDays > 0 (driver services are included)
      if (driverDays > 0 && !longTerm) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.DRIVER_PER_DIEM,
          quantity: driverDays,
          rate: 50, // Standard per diem rate
          unit_type: 'Per Day',
          billing_category: 'Contracted',
        });
      }

      // --- Admin Fee (per vehicle row) ---
      if (hasRateField(row, 'AdminTotal')) {
        const adminTotal = cleanNum(row.AdminTotal);
        const lineItem = createMappedLineItem('AdminTotal', adminTotal, longTerm, context);
        if (lineItem) lineItems.push(lineItem);
      }

      // --- Miscellaneous (per vehicle row) ---
      if (hasRateField(row, 'MiscTotal')) {
        const miscTotal = cleanNum(row.MiscTotal);
        const lineItem = createMappedLineItem('MiscTotal', miscTotal, longTerm, context);
        if (lineItem) lineItems.push(lineItem);
      }

      // --- Co-Driver Rate, Daily (ST only, when AddDriverDays > 0 and CoDriverRate > 0) ---
      // This represents the daily rate charged for the co-driver
      const coDriverDays = cleanNum(row.AddDriverDays);
      const coDriverRate = cleanNum(row.CoDriverRate);
      if (coDriverDays > 0 && coDriverRate > 0 && !longTerm) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.CO_DRIVER_RATE_DAILY,
          quantity: coDriverDays,
          rate: coDriverRate,
          unit_type: 'Per Day',
          billing_category: 'Contracted',
        });
      }

      // --- Co-Driver Per Diems (ST only, when co_driver_days > 0) ---
      // Created when AddDriverDays > 0 to show per diem for co-driver
      if (coDriverDays > 0 && !longTerm) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.CO_DRIVER_PER_DIEMS,
          quantity: coDriverDays,
          rate: 50, // Standard per diem rate
          unit_type: 'Per Day',
          billing_category: 'Contracted',
        });
      }
    }
  });

  // --- Extract Artist data (from first row) ---
  const artist = extractArtistData(firstRow);

  // --- Extract Contacts (from first row - contacts are per-customer not per-vehicle) ---
  const contacts = extractContacts(firstRow, customer);

  return {
    quote,
    quoteCoaches,
    quoteTrailers,
    lineItems,
    artist,
    contacts,
  };
};

/**
 * Transform multiple tours into Bravo-ready CSVs
 *
 * @param {Array} classifiedTours - Array of classified tours (from classifyTour)
 * @returns {Object} CSV-ready data for each Bravo table
 */
export const transformAll = (classifiedTours) => {
  const quotes = [];
  const quoteCoaches = [];
  const quoteTrailers = [];
  const lineItems = [];
  const errors = [];

  // Track artists and contacts for deduplication
  const artistMap = new Map(); // name -> artist data (keeps most complete record)
  const contactMap = new Map(); // email -> contact data
  const artistContactLinks = []; // { artist_name, contact_email, role, is_primary }

  classifiedTours.forEach(tour => {
    try {
      const transformed = transformTour(tour);
      quotes.push(transformed.quote);
      quoteCoaches.push(...transformed.quoteCoaches);
      quoteTrailers.push(...transformed.quoteTrailers);
      lineItems.push(...transformed.lineItems);

      // Collect artist data (dedupe by name, keep most complete record)
      if (transformed.artist) {
        const existing = artistMap.get(transformed.artist.name);
        if (!existing) {
          artistMap.set(transformed.artist.name, transformed.artist);
        } else {
          // Merge: prefer non-null values from new record
          artistMap.set(transformed.artist.name, {
            name: existing.name,
            legal_name: existing.legal_name || transformed.artist.legal_name,
            address: existing.address || transformed.artist.address,
            city: existing.city || transformed.artist.city,
            state: existing.state || transformed.artist.state,
            zip: existing.zip || transformed.artist.zip,
          });
        }
      }

      // Collect contacts (dedupe by email)
      for (const contact of transformed.contacts) {
        if (!contact.email) continue; // Skip contacts without email (can't dedupe reliably)

        const emailKey = contact.email.toLowerCase();
        if (!contactMap.has(emailKey)) {
          contactMap.set(emailKey, {
            full_name: contact.full_name,
            email: contact.email,
            phone: contact.phone,
          });
        } else {
          // Merge: prefer non-null values
          const existing = contactMap.get(emailKey);
          contactMap.set(emailKey, {
            full_name: existing.full_name || contact.full_name,
            email: existing.email,
            phone: existing.phone || contact.phone,
          });
        }

        // Track artist-contact link
        artistContactLinks.push({
          artist_name: contact.artist_name,
          contact_email: contact.email.toLowerCase(),
          role: contact.role,
          is_primary: contact.is_primary,
        });
      }
    } catch (err) {
      errors.push({
        tourId: tour.tourId,
        error: err.message,
      });
    }
  });

  // Convert maps to arrays
  const artists = Array.from(artistMap.values());
  const contacts = Array.from(contactMap.values());

  // Deduplicate artist-contact links (same artist + email + role)
  const linkSet = new Set();
  const artistContacts = artistContactLinks.filter(link => {
    const key = `${link.artist_name}|${link.contact_email}|${link.role}`;
    if (linkSet.has(key)) return false;
    linkSet.add(key);
    return true;
  });

  return {
    quotes,
    quoteCoaches,
    quoteTrailers,
    lineItems,
    artists,
    contacts,
    artistContacts,
    errors,
    stats: {
      quotesCount: quotes.length,
      coachesCount: quoteCoaches.length,
      trailersCount: quoteTrailers.length,
      lineItemsCount: lineItems.length,
      artistsCount: artists.length,
      contactsCount: contacts.length,
      artistContactsCount: artistContacts.length,
      errorsCount: errors.length,
    },
  };
};

/**
 * Convert array of objects to CSV string
 */
export const toCSV = (data, columns) => {
  if (!data || data.length === 0) return '';

  const headers = columns || Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
};

/**
 * Generate all CSVs for download
 */
export const generateCSVs = (transformedData) => {
  const quoteColumns = [
    'external_id', 'seq_number', 'artist_name', 'quote_name', 'quote_number',
    'status', 'type', 'quoted_lease_start_date', 'quoted_lease_end_date',
    'tour_start_date', 'tour_end_date', 'quoted_lease_days', 'tour_days',
    'billed_bus_days', 'main_driver_days', 'billed_driver_days',
    'total_estimated_miles', 'driver_deadhead_front_days', 'driver_deadhead_rear_days',
    'bus_deadhead_front_days', 'bus_deadhead_rear_days', 'co_driver_days', 'discount_days',
    'main_driver_overdrives', 'quoted_lease_months', 'tour_months', 'notes',
    '_startracker_status', '_is_contract', '_startracker_total'
  ];

  const coachColumns = [
    'external_id', 'vehicle_name', 'vehicle_index', 'use_custom_tour_data',
    'custom_tour_start_date', 'custom_tour_end_date', 'custom_total_estimated_miles',
    'custom_tour_days', 'custom_billed_bus_days', 'custom_main_driver_days'
  ];

  const trailerColumns = [
    'external_id', 'vehicle_name', 'vehicle_index', 'use_custom_tour_data',
    'custom_tour_start_date', 'custom_tour_end_date', 'custom_total_estimated_miles',
    'custom_tour_days', 'custom_billed_bus_days', 'custom_main_driver_days'
  ];

  const lineItemColumns = [
    'external_id', 'vehicle_name', 'vehicle_index', 'item_type',
    'quantity', 'rate', 'unit_type', 'billing_category'
  ];

  const artistColumns = [
    'name', 'legal_name', 'address', 'city', 'state', 'zip'
  ];

  const contactColumns = [
    'full_name', 'email', 'phone'
  ];

  const artistContactColumns = [
    'artist_name', 'contact_email', 'role', 'is_primary'
  ];

  return {
    quotes: toCSV(transformedData.quotes, quoteColumns),
    quoteCoaches: toCSV(transformedData.quoteCoaches, coachColumns),
    quoteTrailers: toCSV(transformedData.quoteTrailers, trailerColumns),
    lineItems: toCSV(transformedData.lineItems, lineItemColumns),
    artists: toCSV(transformedData.artists || [], artistColumns),
    contacts: toCSV(transformedData.contacts || [], contactColumns),
    artistContacts: toCSV(transformedData.artistContacts || [], artistContactColumns),
  };
};
