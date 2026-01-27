#!/usr/bin/env node
/**
 * Import Validation Script
 *
 * Compares Bravo calculated totals against StarTracker source data.
 * Does NOT modify any data - read-only validation.
 *
 * Usage:
 *   node scripts/validate-import.js --source=path/to/source.csv --env=dev
 *
 * The source CSV should be the original StarTracker export that was transformed
 * and imported. It must contain TourID and TourBudget columns.
 */

import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const SOURCE_FILE = args.source;
const ENV = args.env || 'dev';

if (!SOURCE_FILE) {
  console.error('Error: --source=path/to/source.csv is required');
  console.error('Usage: node scripts/validate-import.js --source=path/to/source.csv --env=dev');
  process.exit(1);
}

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
 * Read and parse source CSV, extracting TourID -> TourBudget mapping
 */
function readSourceTotals(filepath) {
  if (!fs.existsSync(filepath)) {
    throw new Error(`Source file not found: ${filepath}`);
  }

  const content = fs.readFileSync(filepath, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
  });

  // Group by TourID and get the TourBudget (should be same for all rows of a tour)
  const totals = {};
  for (const row of records) {
    const tourId = row.TourID;
    const tourBudget = parseFloat(row.TourBudget) || 0;

    if (tourId && !totals[tourId]) {
      totals[tourId] = tourBudget;
    }
  }

  return totals;
}

/**
 * Query Bravo for calculated totals by external_id
 */
async function getBravoTotals(supabase) {
  const { data, error } = await supabase.rpc('get_import_validation_totals');

  if (error) {
    // If the function doesn't exist, fall back to a direct query
    log('yellow', 'RPC not found, using direct query...');
    return getBravoTotalsDirect(supabase);
  }

  return data;
}

/**
 * Direct query for Bravo totals (fallback if RPC doesn't exist)
 */
async function getBravoTotalsDirect(supabase) {
  const { data: quotes, error } = await supabase
    .from('quotes')
    .select(`
      id,
      external_id,
      quote_name,
      type,
      status,
      artist:artists(name)
    `)
    .not('external_id', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch quotes: ${error.message}`);
  }

  // Get line items for each quote
  const results = [];
  for (const quote of quotes) {
    const { data: lineItems, error: liError } = await supabase
      .from('quote_line_items')
      .select('quantity, rate, user_deleted')
      .eq('quote_id', quote.id);

    if (liError) {
      log('yellow', `  Error fetching line items for ${quote.external_id}: ${liError.message}`);
      continue;
    }

    const bravoTotal = lineItems
      .filter(li => !li.user_deleted)
      .reduce((sum, li) => sum + ((li.quantity || 0) * (li.rate || 0)), 0);

    results.push({
      external_id: quote.external_id,
      quote_name: quote.quote_name,
      artist_name: quote.artist?.name || 'Unknown',
      type: quote.type,
      status: quote.status,
      bravo_total: bravoTotal,
    });
  }

  return results;
}

/**
 * Compare totals and generate report
 */
function compareAndReport(sourceTotals, bravoData) {
  const results = {
    match: [],
    close: [],
    mismatch: [],
    notInBravo: [],
    notInSource: [],
  };

  // Check each Bravo quote against source
  for (const quote of bravoData) {
    const externalId = quote.external_id;
    const bravoTotal = quote.bravo_total;
    const sourceTotal = sourceTotals[externalId];

    if (sourceTotal === undefined) {
      results.notInSource.push({ ...quote, bravo_total: bravoTotal });
      continue;
    }

    const difference = bravoTotal - sourceTotal;
    const absDiff = Math.abs(difference);

    const entry = {
      ...quote,
      bravo_total: bravoTotal,
      source_total: sourceTotal,
      difference: difference,
      pct_diff: sourceTotal !== 0 ? (difference / sourceTotal * 100) : 0,
    };

    if (absDiff < 0.01) {
      results.match.push(entry);
    } else if (absDiff < 100) {
      results.close.push(entry);
    } else {
      results.mismatch.push(entry);
    }
  }

  // Check for source records not in Bravo
  const bravoExternalIds = new Set(bravoData.map(q => q.external_id));
  for (const [tourId, total] of Object.entries(sourceTotals)) {
    if (!bravoExternalIds.has(tourId)) {
      results.notInBravo.push({ external_id: tourId, source_total: total });
    }
  }

  return results;
}

/**
 * Print report to console
 */
function printReport(results) {
  const total = results.match.length + results.close.length + results.mismatch.length;

  log('blue', '\n' + '='.repeat(70));
  log('blue', 'IMPORT VALIDATION REPORT');
  log('blue', '='.repeat(70));

  // Summary
  log('blue', '\nSUMMARY:');
  log('green', `  ✓ MATCH (diff < $0.01):     ${results.match.length} quotes`);
  log('yellow', `  ~ CLOSE (diff < $100):      ${results.close.length} quotes`);
  log('red', `  ✗ MISMATCH (diff >= $100):  ${results.mismatch.length} quotes`);

  if (results.notInSource.length > 0) {
    log('cyan', `  ? Not in source CSV:        ${results.notInSource.length} quotes`);
  }
  if (results.notInBravo.length > 0) {
    log('cyan', `  ? Not in Bravo:             ${results.notInBravo.length} tours`);
  }

  const matchRate = total > 0 ? ((results.match.length / total) * 100).toFixed(1) : 0;
  log('blue', `\n  Match rate: ${matchRate}% (${results.match.length}/${total})`);

  // Mismatches detail
  if (results.mismatch.length > 0) {
    log('red', '\n' + '-'.repeat(70));
    log('red', 'MISMATCHES (need attention):');
    log('red', '-'.repeat(70));

    // Sort by absolute difference descending
    results.mismatch.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

    for (const q of results.mismatch) {
      console.log(`  ${q.external_id} | ${q.artist_name}`);
      console.log(`    ${q.quote_name}`);
      console.log(`    Source: $${q.source_total.toLocaleString()} | Bravo: $${q.bravo_total.toLocaleString()} | Diff: $${q.difference.toLocaleString()} (${q.pct_diff.toFixed(1)}%)`);
      console.log('');
    }
  }

  // Close matches detail
  if (results.close.length > 0) {
    log('yellow', '\n' + '-'.repeat(70));
    log('yellow', 'CLOSE MATCHES (minor differences):');
    log('yellow', '-'.repeat(70));

    for (const q of results.close) {
      console.log(`  ${q.external_id} | ${q.artist_name} | Diff: $${q.difference.toFixed(2)}`);
    }
  }

  log('blue', '\n' + '='.repeat(70));
}

/**
 * Main validation function
 */
async function main() {
  log('blue', '='.repeat(60));
  log('blue', 'StarTracker Import Validation');
  log('blue', `Environment: ${ENV.toUpperCase()}`);
  log('blue', `Source file: ${SOURCE_FILE}`);
  log('blue', '='.repeat(60));

  // Read source totals
  log('blue', '\nReading source CSV...');
  const sourceTotals = readSourceTotals(SOURCE_FILE);
  log('green', `  Found ${Object.keys(sourceTotals).length} tours in source`);

  // Connect to Supabase
  const config = SUPABASE_CONFIG[ENV];
  if (!config?.url || !config?.key) {
    throw new Error(`Missing Supabase config for environment: ${ENV}`);
  }

  const supabase = createClient(config.url, config.key);

  // Test connection
  const { error: testError } = await supabase.from('quotes').select('id').limit(1);
  if (testError) {
    throw new Error(`Failed to connect to Supabase: ${testError.message}`);
  }
  log('green', '  Connected to Supabase');

  // Get Bravo totals
  log('blue', '\nFetching Bravo totals...');
  const bravoData = await getBravoTotalsDirect(supabase);
  log('green', `  Found ${bravoData.length} imported quotes in Bravo`);

  // Compare and report
  const results = compareAndReport(sourceTotals, bravoData);
  printReport(results);

  // Exit with error code if there are mismatches
  if (results.mismatch.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  log('red', 'Fatal error:', err.message);
  process.exit(1);
});
