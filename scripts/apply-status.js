#!/usr/bin/env node
/**
 * Apply Status Script
 *
 * Updates quote statuses in Bravo to match StarTracker statuses.
 * Run this AFTER validating totals and making any manual adjustments.
 *
 * Usage:
 *   node scripts/apply-status.js --dir=./bravo-import/<batch> --env=dev --dry-run
 *   node scripts/apply-status.js --dir=./bravo-import/<batch> --env=dev
 *
 * Prerequisites:
 * - Quotes must already be imported (via import-to-supabase.js --skip-status)
 * - Totals should be validated (via validate-import.js)
 * - Manual adjustments should be complete
 *
 * What this does:
 * - Reads the quotes.csv to get the intended status for each quote
 * - Updates the status in Bravo for quotes that are currently Draft
 * - Skips quotes that already have the correct status
 * - For "Declined" status, uses a default lost_reason_id (or skips if not set)
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';

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
    throw new Error(`File not found: ${filepath}`);
  }

  const content = fs.readFileSync(filepath, 'utf-8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
  });
}

/**
 * Get or create a default lost reason for declined quotes
 */
async function getDefaultLostReason(supabase) {
  // Try to find an existing "Imported - Declined" reason
  const { data: existing } = await supabase
    .from('quote_lost_reasons')
    .select('id')
    .eq('reason', 'Imported - Declined')
    .limit(1)
    .single();

  if (existing) {
    return existing.id;
  }

  // Try to find any existing reason as fallback
  const { data: anyReason } = await supabase
    .from('quote_lost_reasons')
    .select('id')
    .limit(1)
    .single();

  if (anyReason) {
    return anyReason.id;
  }

  // Create one if none exists
  const { data: newReason, error } = await supabase
    .from('quote_lost_reasons')
    .insert({ reason: 'Imported - Declined', description: 'Quote was declined in StarTracker' })
    .select('id')
    .single();

  if (error) {
    log('yellow', `  Could not create lost reason: ${error.message}`);
    return null;
  }

  return newReason.id;
}

/**
 * Main function
 */
async function main() {
  log('blue', '='.repeat(60));
  log('blue', 'Apply Status Script');
  log('blue', `Environment: ${ENV.toUpperCase()}`);
  log('blue', `Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  log('blue', `Input directory: ${INPUT_DIR}`);
  log('blue', '='.repeat(60));

  // Read quotes CSV
  log('blue', '\nReading quotes.csv...');
  const quotes = readCSV('quotes.csv');
  log('green', `  Found ${quotes.length} quotes`);

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

  // Get default lost reason for Declined quotes
  const defaultLostReasonId = await getDefaultLostReason(supabase);
  if (!defaultLostReasonId) {
    log('yellow', '  Warning: No lost reason available. Declined quotes will be skipped.');
  }

  // Process each quote
  log('blue', '\nUpdating statuses...');
  const results = { updated: 0, skipped: 0, failed: 0 };

  for (const quote of quotes) {
    const externalId = quote.external_id;
    const intendedStatus = quote.status;

    // Skip if no status change needed (already Draft and intended is Draft)
    if (intendedStatus === 'Draft') {
      results.skipped++;
      continue;
    }

    // Find the quote in Bravo
    const { data: bravoQuote, error: findError } = await supabase
      .from('quotes')
      .select('id, status')
      .eq('external_id', externalId)
      .limit(1)
      .single();

    if (findError || !bravoQuote) {
      log('yellow', `  Quote not found in Bravo: ${externalId}`);
      results.failed++;
      continue;
    }

    // Skip if already has the correct status
    if (bravoQuote.status === intendedStatus) {
      results.skipped++;
      continue;
    }

    // Prepare update
    const updateData = { status: intendedStatus };

    // Handle Declined status (requires lost_reason_id)
    if (intendedStatus === 'Declined') {
      if (!defaultLostReasonId) {
        log('yellow', `  Skipping ${externalId} - Declined requires lost_reason_id`);
        results.failed++;
        continue;
      }
      updateData.lost_reason_id = defaultLostReasonId;
    }

    if (DRY_RUN) {
      log('cyan', `  [DRY RUN] Would update ${externalId}: ${bravoQuote.status} → ${intendedStatus}`);
      results.updated++;
      continue;
    }

    // Apply update
    const { error: updateError } = await supabase
      .from('quotes')
      .update(updateData)
      .eq('id', bravoQuote.id);

    if (updateError) {
      log('red', `  Error updating ${externalId}: ${updateError.message}`);
      results.failed++;
    } else {
      log('green', `  Updated ${externalId}: ${bravoQuote.status} → ${intendedStatus}`);
      results.updated++;
    }
  }

  // Summary
  log('blue', '\n' + '='.repeat(60));
  log('blue', 'SUMMARY');
  log('green', `  Updated: ${results.updated}`);
  log('yellow', `  Skipped: ${results.skipped} (already correct or Draft)`);
  if (results.failed > 0) {
    log('red', `  Failed:  ${results.failed}`);
  }

  if (DRY_RUN) {
    log('yellow', '\nThis was a dry run. No data was actually updated.');
    log('yellow', 'Run again without --dry-run to apply status changes.');
  }
}

main().catch(err => {
  log('red', 'Fatal error:', err.message);
  process.exit(1);
});
