---
name: import
description: Import StarTracker data to Bravo. Use when user has uploaded files to bravo-import/ and wants to import them.
argument-hint: [folder-path] [environment]
disable-model-invocation: true
---

# Bravo Import Skill

Import StarTracker-transformed CSV files into Bravo database.

## Gather Parameters

If arguments not provided, ask:
1. **Folder path**: Which subfolder of `bravo-import/` contains the export? (e.g., `bravo-import/january_tour_test_upload_bravo_V5`)
2. **Environment**: `dev` or `prod`?

## Pre-flight Checks

Before importing, verify:

1. **Required files exist** in the folder:
   - `quotes.csv`
   - `quote_coaches.csv`
   - `quote_trailers.csv`
   - `line_items.csv`
   - Optional: `artists.csv`, `contacts.csv`, `artist_contacts.csv`

2. **Line item types are valid** - check that all `item_type` values in `line_items.csv` exist in `quote_item_types`:
   ```sql
   SELECT DISTINCT item_name FROM quote_item_types ORDER BY item_name;
   ```
   If any CSV item_type doesn't match, STOP and report the mismatch. Do NOT create new item types - this is a transformer bug.

3. **Vehicles exist** - verify all coach and trailer names exist in the database

4. **No duplicate external_ids** - check quotes don't already exist:
   ```sql
   SELECT external_id FROM quotes WHERE external_id IN (...);
   ```

## Import Order

Use `mcp__supabase-dev__execute_sql` (or `mcp__supabase-prod__execute_sql` for prod).

Import in this order:
1. **Artists** - get or create, build artist_id map
2. **Quotes** - insert with proper enum casts (`::quote_status_enum`, `::quote_type_enum`)
3. **Quote Coaches** - link quotes to coaches
4. **Quote Trailers** - link quotes to trailers
5. **Delete auto-generated line items** - Bravo auto-creates line items on quote creation; delete them first
6. **Line Items** - insert with quote_coach_id/quote_trailer_id links
7. **Entity Notes** - for quotes with notes
8. **Contacts & Artist Contacts** - if contact files exist

## SQL Patterns

### Insert quotes with enum casts:
```sql
INSERT INTO quotes (external_id, status, type, ...)
SELECT v.external_id, v.status::quote_status_enum, v.type::quote_type_enum, ...
FROM (VALUES (...)) AS v(...)
```

### Look up vehicle IDs:
```sql
SELECT id, name FROM coaches WHERE name IN (...);
SELECT id, name FROM trailers WHERE name IN (...);
```

### Look up item type IDs:
```sql
SELECT id, item_name FROM quote_item_types WHERE item_name IN (...);
```

## Post-Import Validation

After import completes, run validation:

1. **Count verification**:
   ```sql
   SELECT COUNT(*) FROM quotes WHERE external_id IN (...);
   SELECT COUNT(*) FROM quote_coaches WHERE quote_id IN (SELECT id FROM quotes WHERE external_id IN (...));
   SELECT COUNT(*) FROM quote_line_items WHERE quote_id IN (SELECT id FROM quotes WHERE external_id IN (...));
   ```

2. **Compare to CSV counts** - report any discrepancies

3. **Run validation queries** from `scripts/validation-queries.sql`

## Report Results

Provide a summary:
- Quotes imported: X
- Coaches linked: X
- Trailers linked: X
- Line items created: X
- Contacts created: X
- Any errors or warnings

## Critical Rules

- **NEVER create quote_item_types** - if item type missing, it's a transformer bug
- **NEVER fall back to Node.js scripts** - use MCP tools only
- **Fix SQL issues** (like enum casting) - don't abandon MCP
- **Batch large inserts** - split into groups of 10-20 records if needed
