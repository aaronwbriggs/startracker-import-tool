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
  BUS_WASHES: 'Bus Washes',
  LINEN_CLEANINGS: 'Linen Cleanings',
  GENERATOR_SERVICES: 'Generator Services',
  DRIVER_PER_DIEM: 'Driver Per Diem',
  TOLLS: 'Tolls',
  END_OF_TOUR_CLEANING: 'End of Tour Cleaning',
  UPHOLSTERY_CLEANING: 'Upholstery Cleaning',
  BED_KIT_INSTALL: 'Bed Kit Install / Bunk Change Fee',
};

// Trailer prefixes (from Master Plan)
const TRAILER_PREFIXES = ['CC', 'ML', 'LK', 'TA'];

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
 * Detect if quote is Long Term
 */
export const isLongTerm = (rows) => {
  return rows.some(r => {
    const busRate = cleanNum(r.BusRate);
    const billedMonths = cleanNum(r.BilledMonths);
    const tourDays = cleanNum(r.TourDays);
    const driverDays = cleanNum(r.DriverDays);
    return busRate >= 2000 || billedMonths >= 6 || (driverDays === 0 && tourDays > 60);
  });
};

/**
 * Map StarTracker status to Bravo status
 */
export const mapStatus = (starTrackerStatus) => {
  // All imports start as Draft for review
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

  // Build quote record
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
    billed_bus_days: cleanNum(firstRow.BusDays || firstRow.BilledDays),
    main_driver_days: cleanNum(firstRow.DriverDays),
    billed_driver_days: cleanNum(firstRow.DriverDays),
    total_estimated_miles: cleanNum(firstRow.TotalMileage),
    driver_deadhead_front_days: cleanNum(firstRow.DriverDHF),
    driver_deadhead_rear_days: cleanNum(firstRow.DriverDHR),
    bus_deadhead_front_days: cleanNum(firstRow.TravelDaysIn || firstRow.BusDHF) || 0,
    bus_deadhead_rear_days: cleanNum(firstRow.TravelDaysOut || firstRow.BusDHR) || 0,
    co_driver_days: cleanNum(firstRow.AddDriverDays) || 0,
    main_driver_overdrives: 0,
    quoted_lease_months: longTerm ? cleanNum(firstRow.BilledMonths) : null,
    tour_months: longTerm ? cleanNum(firstRow.BilledMonths) : null,
    notes: firstRow.TourNotes || null,
    _startracker_status: status, // Preserve original for reference
    _is_contract: isContract(status),
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
        vehicleData.custom_billed_bus_days = cleanNum(row.BusDays || row.BilledDays);
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

    // --- Vehicle Rate ---
    const busRate = cleanNum(row.BusRate);
    const busDays = cleanNum(row.BusDays || row.BilledDays);
    const billedMonths = cleanNum(row.BilledMonths);

    if (busRate > 0) {
      if (vehicleIsTrailer) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: longTerm ? QUOTE_ITEM_TYPES.TRAILER_RATE_MONTHLY : QUOTE_ITEM_TYPES.TRAILER_RATE_DAILY,
          quantity: longTerm ? billedMonths : busDays,
          rate: busRate,
          unit_type: longTerm ? 'Per Month' : 'Per Day',
          billing_category: 'Contracted',
        });
      } else {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: longTerm ? QUOTE_ITEM_TYPES.COACH_RATE_MONTHLY : QUOTE_ITEM_TYPES.COACH_RATE_DAILY,
          quantity: longTerm ? billedMonths : busDays,
          rate: busRate,
          unit_type: longTerm ? 'Per Month' : 'Per Day',
          billing_category: 'Contracted',
        });
      }
    }

    // --- Driver Rate (only for coaches) ---
    if (!vehicleIsTrailer) {
      const driverDays = cleanNum(row.DriverDays);
      const tourDays = cleanNum(row.TourDays);
      const dhf = cleanNum(row.DriverDHF);
      const dhr = cleanNum(row.DriverDHR);
      const perDiemTotal = cleanNum(row.PerDiemTotal);

      if (driverDays > 0 && perDiemTotal > 0) {
        const driverRate = perDiemTotal / driverDays;
        const baseDriverDays = tourDays + dhf + dhr;
        const additionalDays = driverDays - baseDriverDays;

        // Main driver rate
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.DRIVER_RATE_DAILY,
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

      // --- Satellite Service ---
      const satelliteRate = cleanNum(row.SatelliteRate);
      if (satelliteRate > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: longTerm ? QUOTE_ITEM_TYPES.SATELLITE_MONTHLY : QUOTE_ITEM_TYPES.SATELLITE_DAILY,
          quantity: longTerm ? billedMonths : busDays,
          rate: satelliteRate,
          unit_type: longTerm ? 'Per Month' : 'Per Day',
          billing_category: 'Contracted',
        });
      }

      // --- Internet Service ---
      const internetRate = cleanNum(row.InternetRate);
      if (internetRate > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: longTerm ? QUOTE_ITEM_TYPES.INTERNET_MONTHLY : QUOTE_ITEM_TYPES.INTERNET_DAILY,
          quantity: longTerm ? billedMonths : busDays,
          rate: internetRate,
          unit_type: longTerm ? 'Per Month' : 'Per Day',
          billing_category: 'Contracted',
        });
      }

      // --- Insurance ---
      const insuranceRate = cleanNum(row.InsuranceRate);
      if (insuranceRate > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: longTerm ? QUOTE_ITEM_TYPES.INSURANCE_MONTHLY : QUOTE_ITEM_TYPES.INSURANCE_DAILY,
          quantity: longTerm ? billedMonths : busDays,
          rate: insuranceRate,
          unit_type: longTerm ? 'Per Month' : 'Per Day',
          billing_category: 'Contracted',
        });
      }

      // --- IFTA/DOT Fee ---
      const dotRate = cleanNum(row.DOTRate);
      if (dotRate > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: longTerm ? QUOTE_ITEM_TYPES.IFTA_DOT_MONTHLY : QUOTE_ITEM_TYPES.IFTA_DOT_DAILY,
          quantity: longTerm ? billedMonths : busDays,
          rate: dotRate,
          unit_type: longTerm ? 'Per Month' : 'Per Day',
          billing_category: 'Contracted',
        });
      }

      // --- Fuel Estimate (mileage-based) ---
      const fuelRate = cleanNum(row.FuelRate);
      const totalMileage = cleanNum(row.TotalMileage);
      if (fuelRate > 0 && totalMileage > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.FUEL_ESTIMATE,
          quantity: totalMileage,
          rate: fuelRate,
          unit_type: 'Per Mile',
          billing_category: 'Contracted',
        });
      }

      // --- Engine Services (mileage-based) ---
      const engineRate = cleanNum(row.EngineRate);
      if (engineRate > 0 && totalMileage > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.ENGINE_SERVICES,
          quantity: totalMileage,
          rate: engineRate,
          unit_type: 'Per Mile',
          billing_category: 'Contracted',
        });
      }

      // --- Weekly Services ---
      const tourWeeks = Math.floor(tourDays / 7);

      const interiorRate = cleanNum(row.InteriorCleaning);
      if (interiorRate > 0 && tourWeeks > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.INTERIOR_CLEANINGS,
          quantity: tourWeeks,
          rate: interiorRate,
          unit_type: 'Per Week',
          billing_category: 'Contracted',
        });
      }

      const busWashRate = cleanNum(row.BusWashRate);
      if (busWashRate > 0 && tourWeeks > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.BUS_WASHES,
          quantity: tourWeeks,
          rate: busWashRate,
          unit_type: 'Per Week',
          billing_category: 'Contracted',
        });
      }

      const linenRate = cleanNum(row.LinenRate);
      if (linenRate > 0 && tourWeeks > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.LINEN_CLEANINGS,
          quantity: tourWeeks,
          rate: linenRate,
          unit_type: 'Per Week',
          billing_category: 'Contracted',
        });
      }

      const generatorRate = cleanNum(row.GeneratorRate);
      if (generatorRate > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.GENERATOR_SERVICES,
          quantity: Math.max(tourWeeks, 1),
          rate: generatorRate,
          unit_type: 'Per Week',
          billing_category: 'Contracted',
        });
      }

      // --- Flat Rate Items ---
      const upholsteryTotal = cleanNum(row.Upholstery);
      if (upholsteryTotal > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.UPHOLSTERY_CLEANING,
          quantity: 1,
          rate: upholsteryTotal,
          unit_type: 'Flat Rate',
          billing_category: 'Contracted',
        });
      }

      const cleaningTotal = cleanNum(row.CleaningTotal);
      if (cleaningTotal > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.END_OF_TOUR_CLEANING,
          quantity: 1,
          rate: cleaningTotal,
          unit_type: 'Flat Rate',
          billing_category: 'Contracted',
        });
      }

      const bedKitTotal = cleanNum(row.BedKitTotal);
      if (bedKitTotal > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.BED_KIT_INSTALL,
          quantity: 1,
          rate: bedKitTotal,
          unit_type: 'Flat Rate',
          billing_category: 'Contracted',
        });
      }

      const tollsTotal = cleanNum(row.Tolls);
      if (tollsTotal > 0) {
        lineItems.push({
          external_id: String(tourId),
          vehicle_name: vehicleName,
          vehicle_index: vehicleIdx,
          item_type: QUOTE_ITEM_TYPES.TOLLS,
          quantity: 1,
          rate: tollsTotal,
          unit_type: 'Flat Rate',
          billing_category: 'Contracted',
        });
      }
    }
  });

  // --- Quote-level items (not vehicle-specific) ---
  const adminTotal = rows.reduce((sum, r) => sum + cleanNum(r.AdminTotal), 0);
  if (adminTotal > 0) {
    lineItems.push({
      external_id: String(tourId),
      vehicle_name: null,
      vehicle_index: null,
      item_type: QUOTE_ITEM_TYPES.ADMIN_FEE,
      quantity: 1,
      rate: adminTotal,
      unit_type: 'Flat Rate',
      billing_category: 'Contracted',
    });
  }

  const miscTotal = rows.reduce((sum, r) => sum + cleanNum(r.MiscTotal), 0);
  if (miscTotal > 0) {
    lineItems.push({
      external_id: String(tourId),
      vehicle_name: null,
      vehicle_index: null,
      item_type: QUOTE_ITEM_TYPES.MISCELLANEOUS,
      quantity: 1,
      rate: miscTotal,
      unit_type: 'Flat Rate',
      billing_category: 'Contracted',
    });
  }

  return {
    quote,
    quoteCoaches,
    quoteTrailers,
    lineItems,
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

  classifiedTours.forEach(tour => {
    try {
      const transformed = transformTour(tour);
      quotes.push(transformed.quote);
      quoteCoaches.push(...transformed.quoteCoaches);
      quoteTrailers.push(...transformed.quoteTrailers);
      lineItems.push(...transformed.lineItems);
    } catch (err) {
      errors.push({
        tourId: tour.tourId,
        error: err.message,
      });
    }
  });

  return {
    quotes,
    quoteCoaches,
    quoteTrailers,
    lineItems,
    errors,
    stats: {
      quotesCount: quotes.length,
      coachesCount: quoteCoaches.length,
      trailersCount: quoteTrailers.length,
      lineItemsCount: lineItems.length,
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
    'bus_deadhead_front_days', 'bus_deadhead_rear_days', 'co_driver_days',
    'main_driver_overdrives', 'quoted_lease_months', 'tour_months', 'notes',
    '_startracker_status', '_is_contract'
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

  return {
    quotes: toCSV(transformedData.quotes, quoteColumns),
    quoteCoaches: toCSV(transformedData.quoteCoaches, coachColumns),
    quoteTrailers: toCSV(transformedData.quoteTrailers, trailerColumns),
    lineItems: toCSV(transformedData.lineItems, lineItemColumns),
  };
};
