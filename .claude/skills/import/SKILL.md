---
name: import
description: Import StarTracker data to Bravo. Use when user has uploaded files to bravo-import/ and wants to import them.
argument-hint: [folder-name] [environment]
---

# Bravo Import Skill

Import StarTracker-transformed CSV files into Bravo database using the Node.js import scripts.

## Step 1: Gather Parameters

If not provided, ask:
1. **Folder name**: Which subfolder of `bravo-import/` contains the export? (list available folders)
2. **Environment**: `dev` or `prod`? (default: dev)

## Step 2: Pre-flight Checks

Verify the folder contains required files:
- `quotes.csv` (required)
- `quote_coaches.csv`
- `quote_trailers.csv`
- `line_items.csv`
- Optional: `artists.csv`, `contacts.csv`, `artist_contacts.csv`

Report what was found and the record counts.

## Step 3: Dry Run

Run the import script in dry-run mode to verify everything looks correct:

```bash
node scripts/import-to-supabase.js --env=<env> --dir=./bravo-import/<folder> --skip-status --dry-run
```

Review the output for:
- Missing coaches/trailers (need to be created in Bravo first)
- Missing quote item types (transformer bug - do NOT create them)
- Any other errors

If there are blocking issues, STOP and report them.

## Step 4: Live Import

Run the actual import (all quotes imported as Draft):

```bash
node scripts/import-to-supabase.js --env=<env> --dir=./bravo-import/<folder> --skip-status
```

Report the results:
- Quotes imported
- Coaches linked
- Trailers linked
- Line items created
- Contacts/artist_contacts created
- Any skipped records (already existed)

## Step 5: Validate

Run the validation script to compare Bravo totals against StarTracker totals:

```bash
node scripts/validate-import.js --env=<env> --dir=./bravo-import/<folder>
```

This generates `validation-report.md` in the batch folder.

**Present the validation results to the user:**
- How many quotes match exactly
- How many have minor differences (< $100)
- How many have significant mismatches (need attention)

If there are mismatches, list them with the difference amounts.

## Step 6: STOP and Wait

After validation, **STOP and wait for user instructions**.

Tell the user:
- All quotes are currently in Draft status
- They should review the quotes in Bravo and the validation report
- When ready, they can ask to apply final statuses

## Step 7: Apply Statuses (On User Request Only)

Only when the user explicitly asks to apply statuses:

```bash
node scripts/apply-status.js --env=<env> --dir=./bravo-import/<folder>
```

This updates quotes from Draft to their intended status (Approved, Declined, etc.) based on the CSV.

## Critical Rules

1. **Use Node.js scripts** - NOT manual SQL via MCP (prevents context loss issues)
2. **Never create quote_item_types** - if item type is missing, it's a transformer bug
3. **Always use --skip-status** on import - quotes start as Draft for review
4. **Always validate** - run validation script after every import
5. **Wait for user approval** before applying final statuses
6. **Production requires confirmation** - script will prompt to type "yes"

## MCP Tools

Use MCP tools (`mcp__supabase-dev__execute_sql`) only for:
- Quick lookups during troubleshooting
- Investigating mismatches
- Ad-hoc queries

Do NOT use MCP for batch imports.
