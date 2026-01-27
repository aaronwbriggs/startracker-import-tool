-- ============================================================================
-- IMPORT VALIDATION QUERIES
-- ============================================================================
-- These queries help validate imports by examining Bravo data.
-- For total comparison against StarTracker, use the validate-import.js script:
--
--   node scripts/validate-import.js --source=path/to/source.csv --env=dev
--
-- The script compares Bravo calculated totals against TourBudget in the source CSV.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BRAVO TOTALS QUERY
-- Get calculated totals for all imported quotes
-- Run this via Supabase MCP to see what Bravo has calculated
-- ----------------------------------------------------------------------------
SELECT
  q.external_id,
  a.name as artist_name,
  q.quote_name,
  q.type,
  q.status,
  COALESCE(SUM(
    CASE
      WHEN qli.user_deleted = false
      THEN COALESCE(qli.quantity, 0) * COALESCE(qli.rate, 0)
      ELSE 0
    END
  ), 0) as bravo_total
FROM quotes q
LEFT JOIN artists a ON q.artist_id = a.id
LEFT JOIN quote_line_items qli ON qli.quote_id = q.id
WHERE q.external_id IS NOT NULL
GROUP BY q.id, q.external_id, q.quote_name, a.name, q.type, q.status
ORDER BY bravo_total DESC;


-- ----------------------------------------------------------------------------
-- 2. LINE ITEM BREAKDOWN FOR A SPECIFIC QUOTE
-- Use this to drill into why a specific quote total doesn't match
-- Replace 'EXTERNAL_ID_HERE' with the actual external_id (TourID)
-- ----------------------------------------------------------------------------
SELECT
  qit.item_name,
  qli.quantity,
  qli.rate,
  ROUND(qli.quantity * qli.rate, 2) as line_total,
  qli.user_deleted,
  qli.is_automatic,
  c.name as coach_name,
  t.name as trailer_name
FROM quote_line_items qli
JOIN quotes q ON qli.quote_id = q.id
LEFT JOIN quote_item_types qit ON qli.quote_item_type_id = qit.id
LEFT JOIN quote_coaches qc ON qli.quote_coach_id = qc.id
LEFT JOIN coaches c ON qc.coach_id = c.id
LEFT JOIN quote_trailers qt ON qli.quote_trailer_id = qt.id
LEFT JOIN trailers t ON qt.trailer_id = t.id
WHERE q.external_id = 'EXTERNAL_ID_HERE'
ORDER BY qli.user_deleted, qit.item_name;


-- ----------------------------------------------------------------------------
-- 3. AUTOMATIC ITEMS STATUS
-- See which automatic items were kept vs deleted per quote
-- ----------------------------------------------------------------------------
SELECT
  q.external_id,
  q.quote_name,
  qit.item_name,
  qli.quantity,
  qli.rate,
  qli.is_automatic,
  qli.user_deleted
FROM quote_line_items qli
JOIN quotes q ON qli.quote_id = q.id
LEFT JOIN quote_item_types qit ON qli.quote_item_type_id = qit.id
WHERE q.external_id IS NOT NULL
  AND qli.is_automatic = true
ORDER BY q.external_id, qli.user_deleted, qit.item_name;


-- ----------------------------------------------------------------------------
-- 4. IMPORT SUMMARY BY STATUS
-- Quick overview of imported quotes by status
-- ----------------------------------------------------------------------------
SELECT
  status,
  type,
  COUNT(*) as count
FROM quotes
WHERE external_id IS NOT NULL
GROUP BY status, type
ORDER BY status, type;
