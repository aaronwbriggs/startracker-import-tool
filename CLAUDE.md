# Claude Code Rules for StarTracker Import Tool

## Import Process

### Use the Node.js Import Script (Recommended)

**Always use the Node.js import scripts** for batch imports instead of manual SQL:

```bash
# Dry run first (no changes made)
node scripts/import-to-supabase.js --env=dev --dir=./bravo-import/<batch-name> --skip-status --dry-run

# Live import (all quotes imported as Draft)
node scripts/import-to-supabase.js --env=dev --dir=./bravo-import/<batch-name> --skip-status

# Validate after import
node scripts/validate-import.js --env=dev --dir=./bravo-import/<batch-name>

# Apply final statuses after review
node scripts/apply-status.js --env=dev --dir=./bravo-import/<batch-name>
```

**Why scripts over manual SQL:**
- Scripts are deterministic and won't lose context mid-import
- Automatic foreign key lookups (artists, coaches, trailers, item types)
- Auto-deletes Bravo's auto-generated line items before inserting
- Handles contacts and artist_contacts linking
- Creates entity_notes from quote notes
- Supports dry-run mode for testing
- `--skip-status` imports all quotes as Draft for review

### Environment Variables Required

Set these for the import scripts:
```bash
export SUPABASE_DEV_URL="https://xxx.supabase.co"
export SUPABASE_DEV_SERVICE_KEY="eyJ..."
export SUPABASE_PROD_URL="https://yyy.supabase.co"
export SUPABASE_PROD_SERVICE_KEY="eyJ..."
```

### MCP Tools for Ad-Hoc Queries

Use MCP tools (`mcp__supabase-dev__execute_sql`, `mcp__supabase-prod__execute_sql`) for:
- Validation queries
- Quick lookups
- Status updates on individual quotes
- Debugging issues

**Do not use MCP for batch imports** - the conversation context may compact mid-import, causing data integrity issues.

### No Creating Quote Item Types

- **Never create new `quote_item_types` records** during import
- All item types must already exist in Bravo
- If a line item type doesn't exist, that's a bug in the transformer mapping - fix the transformer
- The transformer (`src/transformer.js`) must output exact Bravo `quote_item_types.item_name` values

## Transformer Maintenance

The transformer maps StarTracker field names to Bravo item type names. Key mapping location:
- `src/transformer.js` lines 10-43: `QUOTE_ITEM_TYPES` constant

When a mapping is wrong:
1. Check the actual `quote_item_types.item_name` in Bravo database
2. Update the transformer constant to match exactly
3. Regenerate the export from the web app

## Validation

After every import, run validation:
```bash
node scripts/validate-import.js --env=dev --dir=<export-directory>
```

This compares Bravo calculated totals against `_startracker_total` from the CSV and generates a markdown report.
