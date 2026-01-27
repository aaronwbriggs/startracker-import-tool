# Plan: Import Fixes from QA Report 2026-01-27

**Status: IMPLEMENTED** - All fixes completed 2026-01-27

## Context

After importing 25 quotes from `january_tour_test_upload_bravo_V3`, manual QA revealed:
- 17 of 25 quotes match (68% success rate)
- 8 quotes have discrepancies
- The validation script reported false negatives (showed only 4 matches instead of 17)

## Issues to Fix

### Issue 1: Validation Script False Negatives (HIGH PRIORITY)

**Problem:** The validation script only uses the first row's `TourBudget` when multiple rows share the same TourID, instead of summing them.

**File:** `scripts/validate-import.js`

**Current code (lines 98-105):**
```javascript
} else {
  // Original StarTracker export format
  const tourId = row.TourID;
  const tourBudget = parseFloat(row.TourBudget) || 0;
  if (tourId && !totals[tourId]) {  // <-- BUG: Only takes first row
    totals[tourId] = tourBudget;
  }
}
```

**Fix:** Sum TourBudget values for all rows with the same TourID:
```javascript
} else {
  // Original StarTracker export format
  const tourId = row.TourID;
  const tourBudget = parseFloat(row.TourBudget) || 0;
  if (tourId) {
    totals[tourId] = (totals[tourId] || 0) + tourBudget;
  }
}
```

**Verified:** Analyzed actual StarTracker data and confirmed `TourBudget` contains per-vehicle totals that need summing:
- Quote 29362: Row 1 (CC9033) = $4,230, Row 2 (Conspiracy) = $90,273.40 → Tour total = $94,503.40
- Quote 29291: Row 1 (Gypsy) = $420,772.80, Row 2 (Hickory) = $438,997.80 → Tour total = $859,770.60
- Quote 30441: Row 1 (CC9046) = $29,079, Row 2 (Snowman) = $161,550 → Tour total = $190,629

**Impact:** This will make the validation script report accurate match counts.

**Additional Feature:** Add Markdown output file for easier review:
```javascript
// After printReport(), add:
function writeMarkdownReport(results, outputPath) {
  const lines = [];
  lines.push('# Import Validation Report\n');
  lines.push(`Generated: ${new Date().toISOString()}\n`);
  lines.push('## Summary\n');
  lines.push(`| Status | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Match (< $0.01) | ${results.match.length} |`);
  lines.push(`| Close (< $100) | ${results.close.length} |`);
  lines.push(`| Mismatch (>= $100) | ${results.mismatch.length} |`);
  // ... etc
  fs.writeFileSync(outputPath, lines.join('\n'));
}
```

Add `--output` flag to write results to a Markdown file in the batch directory.

---

### Issue 2: Missing "Co-Driver Rate, Daily" Line Item

**Problem:** When `AddDriverDays > 0` and `CoDriverRate` exists in StarTracker data, the transformer should create a "Co-Driver Rate, Daily" line item but doesn't.

**Affected quotes:** 30410, 29230, 29363, 29362, 29344

**File:** `src/transformer.js`

**Changes needed:**

1. Add to `QUOTE_ITEM_TYPES` constant:
```javascript
CO_DRIVER_RATE_DAILY: 'Co-Driver Rate, Daily',
```

2. Add line item creation logic (after Driver Rate section, before Co-Driver Per Diems):
```javascript
// --- Co-Driver Rate (ST only, when AddDriverDays > 0) ---
const coDriverDays = cleanNum(row.AddDriverDays);
const coDriverRate = cleanNum(row.CoDriverRate);
if (coDriverDays > 0 && coDriverRate > 0 && !longTerm) {
  lineItems.push({
    external_id: String(tourId),
    vehicle_name: vehicleName,
    vehicle_index: vehicleIdx,
    item_type: QUOTE_ITEM_TYPES.CO_DRIVER_RATE_DAILY,
    quantity: coDriverDays,
    rate: coDriverRate,
    unit_type: 'Per Day',
    billing_category: 'Contracted',
  });
}
```

**Note:** The quantity comes from `AddDriverDays` (same as `quote.co_driver_days`), and the rate comes from `CoDriverRate`.

---

### Issue 3: Co-Driver Per Diems Already Exists But May Not Be Working

**Problem:** The transformer has code for Co-Driver Per Diems (lines 865-881), but the QA report says it's missing on some quotes.

**Investigation needed:**
- Check if the code is being reached
- Check if the line items are being deleted by the import script
- Verify the `AddDriverDays` value is being read correctly from the correct row

**Possible issue:** The code reads `AddDriverDays` from the current row in the loop, but for multi-vehicle quotes, `AddDriverDays` may only be set on one row (typically the first coach, not the trailer).

---

### Issue 4: `co_driver_days` Not Set from Multi-Vehicle Quotes

**Problem:** Quote 29362 (Chris Lane) has `co_driver_days = 0` in Bravo but `AddDriverDays = 11` in StarTracker.

**Root cause:** The quote record is built from `firstRow` only:
```javascript
co_driver_days: cleanNum(firstRow.AddDriverDays) || 0,
```

For quote 29362, the first row is the trailer (CC9033) which has `AddDriverDays = 0`. The second row (Conspiracy coach) has `AddDriverDays = 11`.

**File:** `src/transformer.js`

**Fix:** Iterate through all rows to find the maximum `AddDriverDays` value:
```javascript
// Calculate co_driver_days from all rows (may vary by vehicle)
const maxCoDriverDays = Math.max(...rows.map(r => cleanNum(r.AddDriverDays) || 0));

const quote = {
  // ...
  co_driver_days: maxCoDriverDays,
  // ...
};
```

---

### Issue 5: Notes Don't Import (HIGH PRIORITY)

**Problem:** The `Notes` field from StarTracker should create `entity_note` records in Bravo linked to the quote.

**File:** `scripts/import-to-supabase.js`

**Changes needed:**
1. After importing quotes, query for the created quote IDs
2. For each quote with a non-empty `notes` value from the CSV, create an `entity_note` record

**Schema investigation needed:** Need to check the `entity_notes` table structure in Bravo.

---

### Issue 6: End of Tour Cleaning for Long Term Quotes

**Status:** NO ACTION REQUIRED

Quote 29330 (Carrie Underwood) is missing $600 for End of Tour Cleaning. This is a rare exception - LT quotes typically don't have this fee. Will be handled manually when needed.

---

### Issue 7: Discount Days Not Set (NEW)

**Problem:** Quote 29362 (Chris Lane) has `discount_days = 0` in Bravo but `DiscountedDays = 12` in StarTracker.

**Root cause:** The transformer doesn't map the `DiscountedDays` field to `quotes.discount_days`.

**Affected quotes:** 29362, and any other quote with discounted days

**File:** `src/transformer.js`

**Fix:** Add `discount_days` to the quote record:
```javascript
// Calculate discount_days from all rows (may vary by vehicle, take max)
const maxDiscountDays = Math.max(...rows.map(r => cleanNum(r.DiscountedDays) || 0));

const quote = {
  // ...
  discount_days: maxDiscountDays,
  // ...
};
```

**Impact:** This affects Per Day line item quantities in Bravo. When `discount_days` is set, Bravo adjusts billable days accordingly. Without this value, Per Day items will be calculated incorrectly for discounted tours.

---

## Edge Cases (Not Bugs - Manual Resolution Required)

These are StarTracker data patterns that Bravo doesn't support:

| Quote | Issue | Resolution |
|-------|-------|------------|
| 29319 Tucker Wetmore | Third coach (Bills RV) with partial duration | Manual adjustment after import |
| 30417 Daniel Donato | Payroll fee waived in StarTracker | Manual adjustment - Bravo doesn't support waiving payroll |
| 29230 Tyler Farr | Non-standard payroll fee percentage | Manual adjustment - Bravo uses fixed 28% |

---

## Implementation Order

1. **Validation script fix + Markdown output** (Issue 1) - High priority, enables accurate QA
2. **Notes import** (Issue 5) - High priority per user request
3. **discount_days mapping** (Issue 7) - Fixes quantity calculations
4. **co_driver_days from multi-vehicle** (Issue 4) - Fixes co-driver line items
5. **Co-Driver Rate, Daily** (Issue 2) - Fixes 5 quotes (depends on Issue 4)
6. **Verify Co-Driver Per Diems** (Issue 3) - May be fixed by Issues 4 & 5

---

## Testing Plan

After implementing fixes:
1. Re-transform the `january_tour_test_upload_bravo_V3` data
2. Delete existing imported data from bravo-dev
3. Re-import using `scripts/import-to-supabase.js`
4. Run validation script to verify improved match rate
5. Manually spot-check the previously failing quotes
