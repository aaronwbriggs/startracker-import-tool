#!/usr/bin/env node
/**
 * Supabase Import Script
 *
 * Reads Bravo-ready CSVs and inserts them into Supabase.
 * Run with: node scripts/import-to-supabase.js --env=dev --dry-run
 *
 * Prerequisites:
 * - npm install @supabase/supabase-js csv-parse
 * - Set environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const DRY_RUN = args['dry-run'] || args.dryRun || false;
const ENV = args.env || 'dev';
const INPUT_DIR = args.dir || './bravo-import';

// Environment-specific Supabase config
const SUPABASE_CONFIG = {
  dev: {
    url: process.env.SUPABASE_DEV_URL || process.env.SUPABASE_URL,
    key: process.env.SUPABASE_DEV_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY,
  },
  prod: {
    url: process.env.SUPABASE_PROD_URL,
    key: process.env.SUPABASE_PROD_SERVICE_KEY,
  },
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(colors[color], ...args, colors.reset);
}

/**
 * Read and parse a CSV file
 */
function readCSV(filename) {
  const filepath = path.join(INPUT_DIR, filename);
  if (!fs.existsSync(filepath)) {
    log('yellow', `File not found: ${filepath}`);
    return [];
  }

  const content = fs.readFileSync(filepath, 'utf-8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    cast: (value, context) => {
      // Handle empty strings
      if (value === '') return null;
      // Handle booleans
      if (value === 'true') return true;
      if (value === 'false') return false;
      // Try to parse numbers
      if (context.column && !context.column.includes('date') && !context.column.includes('name') && !context.column.includes('id')) {
        const num = parseFloat(value);
        if (!isNaN(num) && String(num) === value) return num;
      }
      return value;
    },
  });
}

/**
 * Lookup artist by name, create if not found
 */
async function getOrCreateArtist(supabase, artistName) {
  if (!artistName) return null;

  // Lookup existing
  const { data: existing, error: lookupError } = await supabase
    .from('artists')
    .select('id')
    .ilike('name', artistName)
    .limit(1)
    .single();

  if (existing) return existing.id;

  // Create new
  if (DRY_RUN) {
    log('cyan', `  [DRY RUN] Would create artist: ${artistName}`);
    return `dry-run-artist-${artistName.replace(/\s+/g, '-')}`;
  }

  const { data: newArtist, error: createError } = await supabase
    .from('artists')
    .insert({ name: artistName })
    .select('id')
    .single();

  if (createError) {
    log('red', `  Error creating artist ${artistName}:`, createError.message);
    return null;
  }

  log('green', `  Created artist: ${artistName}`);
  return newArtist.id;
}

/**
 * Lookup coach by name
 */
async function getCoach(supabase, coachName) {
  if (!coachName) return null;

  const { data, error } = await supabase
    .from('coaches')
    .select('id')
    .ilike('name', coachName)
    .limit(1)
    .single();

  if (error || !data) {
    log('yellow', `  Coach not found: ${coachName}`);
    return null;
  }

  return data.id;
}

/**
 * Lookup trailer by name
 */
async function getTrailer(supabase, trailerName) {
  if (!trailerName) return null;

  const { data, error } = await supabase
    .from('trailers')
    .select('id')
    .ilike('name', trailerName)
    .limit(1)
    .single();

  if (error || !data) {
    log('yellow', `  Trailer not found: ${trailerName}`);
    return null;
  }

  return data.id;
}

/**
 * Lookup quote item type by name
 */
async function getQuoteItemType(supabase, itemTypeName, cache = {}) {
  if (!itemTypeName) return null;
  if (cache[itemTypeName]) return cache[itemTypeName];

  const { data, error } = await supabase
    .from('quote_item_types')
    .select('id')
    .eq('item_name', itemTypeName)
    .limit(1)
    .single();

  if (error || !data) {
    log('yellow', `  Quote item type not found: ${itemTypeName}`);
    return null;
  }

  cache[itemTypeName] = data.id;
  return data.id;
}

/**
 * Import quotes
 */
async function importQuotes(supabase, quotes) {
  log('blue', `\nImporting ${quotes.length} quotes...`);
  const results = { success: 0, failed: 0, skipped: 0 };
  const quoteIdMap = {}; // external_id -> bravo_quote_id

  for (const quote of quotes) {
    // Check if already exists
    const { data: existing } = await supabase
      .from('quotes')
      .select('id')
      .eq('external_id', quote.external_id)
      .limit(1)
      .single();

    if (existing) {
      log('yellow', `  Skipping quote ${quote.external_id} (already exists)`);
      quoteIdMap[quote.external_id] = existing.id;
      results.skipped++;
      continue;
    }

    // Get or create artist
    const artistId = await getOrCreateArtist(supabase, quote.artist_name);
    if (!artistId) {
      log('red', `  Failed to get artist for quote ${quote.external_id}`);
      results.failed++;
      continue;
    }

    // Prepare quote record
    const quoteRecord = {
      external_id: quote.external_id,
      seq_number: quote.seq_number,
      artist_id: artistId,
      quote_name: quote.quote_name,
      quote_number: quote.quote_number,
      status: quote.status || 'Draft',
      type: quote.type,
      quoted_lease_start_date: quote.quoted_lease_start_date,
      quoted_lease_end_date: quote.quoted_lease_end_date,
      tour_start_date: quote.tour_start_date,
      tour_end_date: quote.tour_end_date,
      quoted_lease_days: quote.quoted_lease_days,
      tour_days: quote.tour_days,
      billed_bus_days: quote.billed_bus_days,
      main_driver_days: quote.main_driver_days,
      billed_driver_days: quote.billed_driver_days,
      total_estimated_miles: quote.total_estimated_miles,
      driver_deadhead_front_days: quote.driver_deadhead_front_days || 0,
      driver_deadhead_rear_days: quote.driver_deadhead_rear_days || 0,
      bus_deadhead_front_days: quote.bus_deadhead_front_days || 0,
      bus_deadhead_rear_days: quote.bus_deadhead_rear_days || 0,
      co_driver_days: quote.co_driver_days || 0,
      main_driver_overdrives: quote.main_driver_overdrives || 0,
      quoted_lease_months: quote.quoted_lease_months,
      tour_months: quote.tour_months,
      notes: quote.notes,
    };

    if (DRY_RUN) {
      log('cyan', `  [DRY RUN] Would insert quote: ${quote.external_id} - ${quote.quote_name}`);
      quoteIdMap[quote.external_id] = `dry-run-quote-${quote.external_id}`;
      results.success++;
      continue;
    }

    const { data: newQuote, error } = await supabase
      .from('quotes')
      .insert(quoteRecord)
      .select('id')
      .single();

    if (error) {
      log('red', `  Error inserting quote ${quote.external_id}:`, error.message);
      results.failed++;
    } else {
      log('green', `  Inserted quote: ${quote.external_id} -> ${newQuote.id}`);
      quoteIdMap[quote.external_id] = newQuote.id;
      results.success++;
    }
  }

  return { results, quoteIdMap };
}

/**
 * Import quote coaches
 */
async function importQuoteCoaches(supabase, coaches, quoteIdMap) {
  log('blue', `\nImporting ${coaches.length} quote coaches...`);
  const results = { success: 0, failed: 0 };
  const coachIdMap = {}; // "external_id:vehicle_index" -> quote_coach_id

  for (const coach of coaches) {
    const quoteId = quoteIdMap[coach.external_id];
    if (!quoteId) {
      log('yellow', `  Skipping coach - quote not found: ${coach.external_id}`);
      results.failed++;
      continue;
    }

    const coachId = await getCoach(supabase, coach.vehicle_name);
    if (!coachId && !DRY_RUN) {
      log('yellow', `  Skipping coach - vehicle not found: ${coach.vehicle_name}`);
      results.failed++;
      continue;
    }

    const coachRecord = {
      quote_id: quoteId,
      coach_id: coachId || `dry-run-coach-${coach.vehicle_name}`,
      use_custom_tour_data: coach.use_custom_tour_data || false,
      custom_tour_start_date: coach.custom_tour_start_date,
      custom_tour_end_date: coach.custom_tour_end_date,
      custom_total_estimated_miles: coach.custom_total_estimated_miles,
      custom_tour_days: coach.custom_tour_days,
      custom_billed_bus_days: coach.custom_billed_bus_days,
      custom_main_driver_days: coach.custom_main_driver_days,
    };

    if (DRY_RUN) {
      log('cyan', `  [DRY RUN] Would insert quote_coach: ${coach.vehicle_name} for quote ${coach.external_id}`);
      coachIdMap[`${coach.external_id}:${coach.vehicle_index}`] = `dry-run-qc-${coach.external_id}-${coach.vehicle_index}`;
      results.success++;
      continue;
    }

    const { data: newCoach, error } = await supabase
      .from('quote_coaches')
      .insert(coachRecord)
      .select('id')
      .single();

    if (error) {
      log('red', `  Error inserting quote_coach:`, error.message);
      results.failed++;
    } else {
      coachIdMap[`${coach.external_id}:${coach.vehicle_index}`] = newCoach.id;
      results.success++;
    }
  }

  return { results, coachIdMap };
}

/**
 * Import quote trailers
 */
async function importQuoteTrailers(supabase, trailers, quoteIdMap) {
  log('blue', `\nImporting ${trailers.length} quote trailers...`);
  const results = { success: 0, failed: 0 };
  const trailerIdMap = {}; // "external_id:vehicle_index" -> quote_trailer_id

  for (const trailer of trailers) {
    const quoteId = quoteIdMap[trailer.external_id];
    if (!quoteId) {
      log('yellow', `  Skipping trailer - quote not found: ${trailer.external_id}`);
      results.failed++;
      continue;
    }

    const trailerId = await getTrailer(supabase, trailer.vehicle_name);
    if (!trailerId && !DRY_RUN) {
      log('yellow', `  Skipping trailer - vehicle not found: ${trailer.vehicle_name}`);
      results.failed++;
      continue;
    }

    const trailerRecord = {
      quote_id: quoteId,
      trailer_id: trailerId || `dry-run-trailer-${trailer.vehicle_name}`,
    };

    if (DRY_RUN) {
      log('cyan', `  [DRY RUN] Would insert quote_trailer: ${trailer.vehicle_name} for quote ${trailer.external_id}`);
      trailerIdMap[`${trailer.external_id}:${trailer.vehicle_index}`] = `dry-run-qt-${trailer.external_id}-${trailer.vehicle_index}`;
      results.success++;
      continue;
    }

    const { data: newTrailer, error } = await supabase
      .from('quote_trailers')
      .insert(trailerRecord)
      .select('id')
      .single();

    if (error) {
      log('red', `  Error inserting quote_trailer:`, error.message);
      results.failed++;
    } else {
      trailerIdMap[`${trailer.external_id}:${trailer.vehicle_index}`] = newTrailer.id;
      results.success++;
    }
  }

  return { results, trailerIdMap };
}

/**
 * Import line items
 */
async function importLineItems(supabase, lineItems, quoteIdMap, coachIdMap, trailerIdMap) {
  log('blue', `\nImporting ${lineItems.length} line items...`);
  const results = { success: 0, failed: 0 };
  const itemTypeCache = {};

  for (const item of lineItems) {
    const quoteId = quoteIdMap[item.external_id];
    if (!quoteId) {
      log('yellow', `  Skipping line item - quote not found: ${item.external_id}`);
      results.failed++;
      continue;
    }

    const itemTypeId = await getQuoteItemType(supabase, item.item_type, itemTypeCache);
    if (!itemTypeId && !DRY_RUN) {
      log('yellow', `  Skipping line item - type not found: ${item.item_type}`);
      results.failed++;
      continue;
    }

    // Determine vehicle link
    let quoteCoachId = null;
    let quoteTrailerId = null;
    if (item.vehicle_name && item.vehicle_index !== null) {
      const key = `${item.external_id}:${item.vehicle_index}`;
      quoteCoachId = coachIdMap[key] || null;
      quoteTrailerId = trailerIdMap[key] || null;
    }

    const lineItemRecord = {
      quote_id: quoteId,
      quote_item_type_id: itemTypeId || `dry-run-item-type-${item.item_type}`,
      quote_coach_id: quoteCoachId,
      quote_trailer_id: quoteTrailerId,
      quantity: item.quantity,
      rate: item.rate,
      billing_category: item.billing_category || 'Contracted',
      unit_type: item.unit_type,
      is_automatic: false,
      user_deleted: false,
    };

    if (DRY_RUN) {
      log('cyan', `  [DRY RUN] Would insert line item: ${item.item_type} (qty: ${item.quantity}, rate: ${item.rate})`);
      results.success++;
      continue;
    }

    const { error } = await supabase
      .from('quote_line_items')
      .insert(lineItemRecord);

    if (error) {
      log('red', `  Error inserting line item:`, error.message);
      results.failed++;
    } else {
      results.success++;
    }
  }

  return { results };
}

/**
 * Main import function
 */
async function main() {
  log('blue', '='.repeat(60));
  log('blue', `StarTracker → Bravo Import Script`);
  log('blue', `Environment: ${ENV.toUpperCase()}`);
  log('blue', `Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  log('blue', `Input directory: ${INPUT_DIR}`);
  log('blue', '='.repeat(60));

  // Check for required files
  const quotes = readCSV('bravo_quotes_*.csv') || readCSV('quotes.csv') || [];
  const coaches = readCSV('bravo_quote_coaches_*.csv') || readCSV('quote_coaches.csv') || [];
  const trailers = readCSV('bravo_quote_trailers_*.csv') || readCSV('quote_trailers.csv') || [];
  const lineItems = readCSV('bravo_line_items_*.csv') || readCSV('line_items.csv') || [];

  // Try to find files with glob pattern
  const files = fs.readdirSync(INPUT_DIR);
  const quotesFile = files.find(f => f.startsWith('bravo_quotes_') && f.endsWith('.csv'));
  const coachesFile = files.find(f => f.startsWith('bravo_quote_coaches_') && f.endsWith('.csv'));
  const trailersFile = files.find(f => f.startsWith('bravo_quote_trailers_') && f.endsWith('.csv'));
  const lineItemsFile = files.find(f => f.startsWith('bravo_line_items_') && f.endsWith('.csv'));

  const quotesData = quotesFile ? readCSV(quotesFile) : [];
  const coachesData = coachesFile ? readCSV(coachesFile) : [];
  const trailersData = trailersFile ? readCSV(trailersFile) : [];
  const lineItemsData = lineItemsFile ? readCSV(lineItemsFile) : [];

  if (quotesData.length === 0) {
    log('red', 'No quotes found in input directory. Export CSVs from the transform tab first.');
    process.exit(1);
  }

  log('blue', `\nFound:`);
  log('blue', `  - ${quotesData.length} quotes`);
  log('blue', `  - ${coachesData.length} coaches`);
  log('blue', `  - ${trailersData.length} trailers`);
  log('blue', `  - ${lineItemsData.length} line items`);

  // Initialize Supabase client
  const config = SUPABASE_CONFIG[ENV];
  if (!config?.url || !config?.key) {
    log('red', `Missing Supabase credentials for ${ENV} environment.`);
    log('yellow', `Set SUPABASE_${ENV.toUpperCase()}_URL and SUPABASE_${ENV.toUpperCase()}_SERVICE_KEY environment variables.`);
    process.exit(1);
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(config.url, config.key);

  // Test connection
  const { data: testData, error: testError } = await supabase
    .from('artists')
    .select('count')
    .limit(1);

  if (testError) {
    log('red', 'Failed to connect to Supabase:', testError.message);
    process.exit(1);
  }

  log('green', 'Connected to Supabase successfully.\n');

  // Run imports in order
  const { quoteIdMap } = await importQuotes(supabase, quotesData);
  const { coachIdMap } = await importQuoteCoaches(supabase, coachesData, quoteIdMap);
  const { trailerIdMap } = await importQuoteTrailers(supabase, trailersData, quoteIdMap);
  await importLineItems(supabase, lineItemsData, quoteIdMap, coachIdMap, trailerIdMap);

  log('blue', '\n' + '='.repeat(60));
  log('green', 'Import complete!');
  if (DRY_RUN) {
    log('yellow', 'This was a dry run. No data was actually imported.');
    log('yellow', 'Run again without --dry-run to perform the actual import.');
  }
}

main().catch(err => {
  log('red', 'Fatal error:', err.message);
  process.exit(1);
});
