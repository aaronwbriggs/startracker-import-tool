# Claude Code Rules for StarTracker Import Tool

## Database Operations

### Use MCP Tools for Supabase
- **Always use `mcp__supabase-dev__execute_sql`** for bravo-dev database operations
- **Always use `mcp__supabase-prod__execute_sql`** for bravo-prod database operations
- **Never fall back to running Node.js import scripts** when MCP tools are available
- If you hit an obstacle with MCP (like enum casting), fix the SQL - don't abandon MCP

### No Creating Quote Item Types
- **Never create new `quote_item_types` records** during import
- All item types must already exist in Bravo
- If a line item type doesn't exist, that's a bug in the transformer mapping - fix the transformer
- The transformer (`src/transformer.js`) must output exact Bravo `quote_item_types.item_name` values

### Import Process
1. Read the CSV files from the export directory
2. Look up existing records (artists, coaches, trailers, quote_item_types) by name
3. Insert quotes, quote_coaches, quote_trailers, quote_line_items
4. Use proper enum casts: `value::quote_status_enum`, `value::quote_type_enum`
5. Run validation script after import

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

Or use `mcp__supabase-dev__execute_sql` to run validation queries from `scripts/validation-queries.sql`.
