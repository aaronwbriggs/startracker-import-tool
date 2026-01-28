#!/usr/bin/env node
/**
 * Import Validation Script
 *
 * Compares Bravo calculated totals against StarTracker source data.
 * Does NOT modify any data - read-only validation.
 *
 * Usage:
 *   node scripts/validate-import.js --dir=./bravo-import/<batch-name> --env=dev
 *   node scripts/validate-import.js --source=path/to/original-startracker.csv --env=dev
 *   node scripts/validate-import.js --dir=./bravo-import/<batch-name> --env=dev --output=./report.md
 *
 * Flags:
 *   --dir      Path to transformed output folder (reads quotes.csv with _startracker_total)
 *   --source   Path to original StarTracker export (reads TourID/TourBudget columns)
 *   --env      Environment: dev or prod (required)
 *   --output   Path for Markdown report (default: <dir>/validation-report.md when using --dir)
 *
 * Preferred: Use --dir to point to the transformed output folder containing quotes.csv
 * (which includes _startracker_total). This avoids needing the original export.
 *
 * Alternative: Use --source to point to the original StarTracker export
 * (must contain TourID and TourBudget columns). For multi-vehicle quotes,
 * TourBudget values are summed across all rows with the same TourID.
 */

import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';

// Load .env file
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const SOURCE_FILE = args.source;
const INPUT_DIR = args.dir;
const ENV = args.env; // No default - must be explicit
const OUTPUT_FILE = args.output; // Optional: write Markdown report to file

// Validate environment is explicitly specified
if (!ENV) {
  console.error('\x1b[31m');
  console.error('ERROR: You must specify --env=dev or --env=prod');
  console.error('\x1b[0m');
  console.error('Usage:');
  console.error('  node scripts/validate-import.js --env=dev --dir=./bravo-import/<batch>');
  console.error('  node scripts/validate-import.js --env=prod --dir=./bravo-import/<batch>');
  process.exit(1);
}

if (ENV !== 'dev' && ENV !== 'prod') {
  console.error('\x1b[31m');
  console.error(`ERROR: Invalid environment "${ENV}". Must be "dev" or "prod".`);
  console.error('\x1b[0m');
  process.exit(1);
}

if (!SOURCE_FILE && !INPUT_DIR) {
  console.error('Error: Either --dir or --source is required');
  console.error('Usage:');
  console.error('  node scripts/validate-import.js --dir=./bravo-import/<batch-name> --env=dev');
  console.error('  node scripts/validate-import.js --source=path/to/original-startracker.csv --env=dev');
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
 * Supports both original StarTracker export (TourID, TourBudget) and
 * transformed quotes.csv (external_id, _startracker_total)
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

  const totals = {};

  // Detect format: transformed quotes.csv has external_id and _startracker_total
  const firstRow = records[0] || {};
  const isTransformedFormat = 'external_id' in firstRow && '_startracker_total' in firstRow;

  for (const row of records) {
    if (isTransformedFormat) {
      // Transformed quotes.csv format
      const externalId = row.external_id;
      const total = parseFloat(row._startracker_total) || 0;
      if (externalId) {
        totals[externalId] = total;
      }
    } else {
      // Original StarTracker export format
      // Sum TourBudget for all rows with same TourID (multi-vehicle quotes)
      const tourId = row.TourID;
      const tourBudget = parseFloat(row.TourBudget) || 0;
      if (tourId) {
        totals[tourId] = (totals[tourId] || 0) + tourBudget;
      }
    }
  }

  return totals;
}

/**
 * Find the quotes.csv file in a directory
 */
function findQuotesFile(dir) {
  const quotesPath = `${dir}/quotes.csv`;
  if (fs.existsSync(quotesPath)) {
    return quotesPath;
  }
  throw new Error(`quotes.csv not found in ${dir}`);
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
 * Direct query for Bravo totals using the quote_summary view
 * This view includes payroll fees in the grand_total calculation
 */
async function getBravoTotalsDirect(supabase) {
  // Use quote_summary view which includes payroll fee in grand_total
  const { data: summaries, error } = await supabase
    .from('quote_summary')
    .select(`
      quote_id,
      quote_name,
      quote_type,
      quote_status,
      artist_name,
      grand_total
    `)
    .not('quote_id', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch quote summaries: ${error.message}`);
  }

  // Now get external_ids from quotes table
  const { data: quotes, error: quotesError } = await supabase
    .from('quotes')
    .select('id, external_id')
    .not('external_id', 'is', null);

  if (quotesError) {
    throw new Error(`Failed to fetch quotes: ${quotesError.message}`);
  }

  // Build a map of quote_id -> external_id
  const externalIdMap = {};
  for (const q of quotes) {
    externalIdMap[q.id] = q.external_id;
  }

  // Filter summaries to only those with external_ids and map to result format
  const results = [];
  for (const summary of summaries) {
    const externalId = externalIdMap[summary.quote_id];
    if (!externalId) continue; // Skip quotes without external_id

    results.push({
      external_id: externalId,
      quote_name: summary.quote_name,
      artist_name: summary.artist_name || 'Unknown',
      type: summary.quote_type,
      status: summary.quote_status,
      bravo_total: parseFloat(summary.grand_total) || 0,
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
 * Write Markdown report to file
 */
function writeMarkdownReport(results, outputPath, sourceFile, env) {
  const total = results.match.length + results.close.length + results.mismatch.length;
  const matchRate = total > 0 ? ((results.match.length / total) * 100).toFixed(1) : 0;

  const lines = [];
  lines.push('# Import Validation Report\n');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Environment:** ${env.toUpperCase()}`);
  lines.push(`**Source:** ${sourceFile}`);
  lines.push(`**Match Rate:** ${matchRate}% (${results.match.length}/${total})\n`);

  lines.push('## Summary\n');
  lines.push('| Status | Count |');
  lines.push('|--------|-------|');
  lines.push(`| ✓ Match (< $0.01) | ${results.match.length} |`);
  lines.push(`| ~ Close (< $100) | ${results.close.length} |`);
  lines.push(`| ✗ Mismatch (>= $100) | ${results.mismatch.length} |`);
  if (results.notInSource.length > 0) {
    lines.push(`| ? Not in source | ${results.notInSource.length} |`);
  }
  if (results.notInBravo.length > 0) {
    lines.push(`| ? Not in Bravo | ${results.notInBravo.length} |`);
  }
  lines.push('');

  // Matches
  if (results.match.length > 0) {
    lines.push('## Matches\n');
    lines.push('| Tour ID | Artist | Quote Name | Total |');
    lines.push('|---------|--------|------------|-------|');
    for (const q of results.match) {
      lines.push(`| ${q.external_id} | ${q.artist_name} | ${q.quote_name} | $${q.bravo_total.toLocaleString()} |`);
    }
    lines.push('');
  }

  // Mismatches
  if (results.mismatch.length > 0) {
    lines.push('## Mismatches (Need Attention)\n');
    results.mismatch.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
    lines.push('| Tour ID | Artist | Quote Name | Source | Bravo | Diff | % |');
    lines.push('|---------|--------|------------|--------|-------|------|---|');
    for (const q of results.mismatch) {
      lines.push(`| ${q.external_id} | ${q.artist_name} | ${q.quote_name} | $${q.source_total.toLocaleString()} | $${q.bravo_total.toLocaleString()} | $${q.difference.toLocaleString()} | ${q.pct_diff.toFixed(1)}% |`);
    }
    lines.push('');
  }

  // Close matches
  if (results.close.length > 0) {
    lines.push('## Close Matches (Minor Differences)\n');
    lines.push('| Tour ID | Artist | Quote Name | Diff |');
    lines.push('|---------|--------|------------|------|');
    for (const q of results.close) {
      lines.push(`| ${q.external_id} | ${q.artist_name} | ${q.quote_name} | $${q.difference.toFixed(2)} |`);
    }
    lines.push('');
  }

  // Not in Bravo
  if (results.notInBravo.length > 0) {
    lines.push('## Not Found in Bravo\n');
    lines.push('| Tour ID | Source Total |');
    lines.push('|---------|--------------|');
    for (const q of results.notInBravo) {
      lines.push(`| ${q.external_id} | $${q.source_total.toLocaleString()} |`);
    }
    lines.push('');
  }

  fs.writeFileSync(outputPath, lines.join('\n'));
  log('green', `\nMarkdown report written to: ${outputPath}`);
}

/**
 * Main validation function
 */
async function main() {
  // Determine source file
  const sourceFile = SOURCE_FILE || findQuotesFile(INPUT_DIR);

  log('blue', '='.repeat(60));
  log('blue', 'StarTracker Import Validation (Read-Only)');

  // Visual indicator for production
  if (ENV === 'prod') {
    console.log('\x1b[43m\x1b[30m' + '  PRODUCTION  ' + '\x1b[0m' + ' Validating against bravo-prod');
  } else {
    log('green', `Environment: ${ENV.toUpperCase()} (development)`);
  }

  log('blue', `Source file: ${sourceFile}`);
  log('blue', '='.repeat(60));

  // Read source totals
  log('blue', '\nReading source CSV...');
  const sourceTotals = readSourceTotals(sourceFile);
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

  // Write Markdown report if --output specified
  if (OUTPUT_FILE) {
    writeMarkdownReport(results, OUTPUT_FILE, sourceFile, ENV);
  } else if (INPUT_DIR) {
    // Default: write to batch directory
    const defaultOutput = `${INPUT_DIR}/validation-report.md`;
    writeMarkdownReport(results, defaultOutput, sourceFile, ENV);
  }

  // Exit with error code if there are mismatches
  if (results.mismatch.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  log('red', 'Fatal error:', err.message);
  process.exit(1);
});
