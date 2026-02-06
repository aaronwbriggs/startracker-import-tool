# StarTracker Import Tracker

This document tracks all import batches, their status, validation results, and manual fixes applied.

---

## Batch: january_tour_test_upload_V5_bravo

- **Quotes:** 25
- **Source:** StarTracker January tour data (test batch)
- **Exported:** 2025-01-27

| Environment | Imported | Status Applied | Notes |
|-------------|----------|----------------|-------|
| dev         | 2025-01-27 | Pending | Initial test batch |
| prod        | Not yet  | —              | — |

### Validation Summary (dev)

- **Matched:** 20 of 25
- **Mismatched:** 4
- **Not created:** 1 (Daniel Donato 30426 — duplicate name collision)

### Mismatched Quotes

| Quote | ST Tour ID | StarTracker Total | Bravo Total | Difference | Root Cause | Resolution |
|-------|-----------|-------------------|-------------|------------|------------|------------|
| Tucker Wetmore - Jan 1 - Dec 31, 2026 | 29319 | $803,200.00 | $572,400.00 | -$230,800.00 | ST quote has a third coach (Bills RV) with partial duration, not currently supported in Bravo. Per-vehicle totals for Presley and Encore match. | Pending |
| Daniel Donato - Jan 28 - Mar 2, 2026 | 30417 | $25,715.00 | $31,194.60 | +$5,479.60 | Celebrity waived the Payroll Fee on this quote in StarTracker, which cannot be done in Bravo. | Pending |
| Tyler Farr - Jan 9-11, 2026 | 29230 | $9,113.97 | $9,219.60 | +$105.63 | Payroll fee set to non-standard rate (not 28%) in StarTracker. Bravo only supports 28%. | Pending |
| Snow Strippers - Jan 6 - Mar 1, 2026 | 29344 | $127,209.80 | $124,159.80 | -$3,050.00 | StarTracker has a $3,050 Per Diem charge on the Trailer record. Likely user error in ST data. | Pending |
| Carrie Underwood - Jan 1 - Dec 31, 2026 | 29330 | $339,000.00 | $338,400.00 | -$600.00 | End of Tour Cleaning line item present in ST but not imported. Unexpected for a long-term quote — investigating. | Pending |

### Not Created

| Quote | ST Tour ID | Root Cause | Resolution |
|-------|-----------|------------|------------|
| Daniel Donato - Jan 28 - Mar 2, 2026 (Driver Only) | 30426 | Duplicate quote name collision | Pending |

### Manual Fixes Applied

- All quotes deleted February 5 to clean slate for real data import.

---

## Batch: daniel_donato_fix

- **Quotes:** 1
- **Source:** Re-import of Daniel Donato (ST 30426) — Driver Only quote that failed in initial batch due to duplicate name collision
- **Exported:** 2026-01-27

| Environment | Imported | Status Applied | Notes |
|-------------|----------|----------------|-------|
| dev         | 2026-01-28 | Pending | Matched — $24,264.80 |
| prod        | Not yet  | —              | — |

### Validation Summary (dev)

- **Matched:** 1 of 1 (100%)

### Manual Fixes Applied

- All quotes deleted February 5 to clean slate for real data import.

---

## Batch: january-february 2026 tours_bravo

- **Quotes:** 59 (34 new + 25 overlap with test batch)
- **Source:** StarTracker January-February 2026 tour data
- **Exported:** 2026-02-05

| Environment | Imported | Status Applied | Notes |
|-------------|----------|----------------|-------|
| dev         | 2026-02-05 (partial) | — | 32 of 34 new quotes inserted; 25 skipped as duplicates. **ON HOLD** — line item references broken on test batch quotes ($0 totals). Plan: delete all imported data from dev and start fresh once quote_summary view issue is resolved. |
| prod        | Not yet  | —              | — |

### Script Fixes Made During This Session

1. **external_id normalization** — strip thousand-separator commas (`"30,418"` → `"30418"`) across all 3 scripts
2. **Date normalization** — fix StarTracker format `"YYYY  12:00:00 AM-MM-DD"` → `"YYYY-MM-DD"` (new export format)
3. **seq_number / quote_number** — use `generate_quote_number()` RPC for Bravo's global sequence instead of StarTracker's per-artist seq; quote_number now `Q-{seq}` format
4. **Contact full_name** — split into `first_name`/`last_name` (full_name is a generated column in Bravo)
5. **Artist state_province_id** — lookup `subdivision_code` from `states_provinces` table instead of passing raw abbreviation
6. **Skip duplicates fully** — coaches, trailers, line items, and delete operations now skip records belonging to duplicate (already-existing) quotes

### Known Issues (To Fix Before Clean Re-Import)

| Issue | Details |
|-------|---------|
| `quotes_name_artist_unique` constraint | Quotes 30425 (Daniel Donato) and 30412 (Prairie Entertainer Coaches) have same artist+name as other quotes. Need name differentiation. |
| `artist_contacts.is_primary` column missing | Schema changed since script was written. All artist-contact linking failed. Need to update insert to match current schema. |
| `states_provinces` lookup | "LA" and "TN" not matching with `ilike` — may need exact match with padding (char(3) column). Artists created without state for now. |
| Test batch line items showing $0 | Line item → quote_id references appear broken for the original 25 test quotes. Investigating. |
| `quote_summary` view discrepancy | View behaves differently between dev and prod. Needs investigation before prod imports. |

### Validation Summary (dev) — Partial

- **Matched (new quotes):** 32 of 32 exact match
- **Close match:** 1 (Lo Cash 30487 — $54.60 diff)
- **Skipped quotes showing $0:** 22 of 25 test batch quotes (broken line item refs)
- **Not in Bravo:** 2 (30425, 30412 — name uniqueness failures)

### Manual Fixes Applied

- All quotes deleted February 5 to clean slate for real data import.

---

## Batch: january-february-2026-tours-v2-bravo

- **Quotes:** 59 (v2 re-export after dev was cleaned)
- **Source:** StarTracker January-February 2026 tour data (fresh export)
- **Exported:** 2026-02-05

| Environment | Imported | Status Applied | Notes |
|-------------|----------|----------------|-------|
| dev         | 2026-02-05 | 2026-02-06 | All 59 quotes inserted. Artist-contact links all created. Statuses applied (54 updated, 5 skipped). |
| prod        | 2026-02-06 | 2026-02-06 | All 59 quotes inserted. 11 artist-contact links, 10 new contacts created. Manual fixes applied. Statuses applied (54 updated, 5 skipped). |

### Import Results (dev)

- **Quotes inserted:** 59 (57 initially + 2 after name fix)
- **Coaches linked:** 72
- **Trailers linked:** 9
- **Line items created:** 1,372
- **Entity notes created:** 13
- **Contacts created/updated:** 24
- **Artist-contact links:** 11 (after `is_primary` column fix)

### Name Collision Fixes

| ST Tour ID | Artist | Original Name | Fixed Name |
|-----------|--------|--------------|------------|
| 30412 | Prairie Entertainer Coaches | Feb 1, 2026 - Jan 31, 2027 | Feb 1, 2026 - Jan 31, 2027 (ST-30412) |
| 30425 | Daniel Donato | Jan 28 - March 2, 2026 | Jan 28 - March 2, 2026 (ST-30425) |

### Validation Summary (dev)

- **Exact match:** 49 of 57 (86%) — 30412 and 30425 not yet validated
- **Close match (< $100):** 0
- **Mismatch (>= $100):** 7

### Mismatched Quotes

| Quote | ST Tour ID | StarTracker Total | Bravo Total | Difference | Root Cause | Resolution |
|-------|-----------|-------------------|-------------|------------|------------|------------|
| Tucker Wetmore - Jan 1 - Dec 31, 2026 | 29319 | $803,200.00 | $572,400.00 | -$230,800.00 | ST quote has a third coach (Bills RV) with partial duration, not currently supported in Bravo. Per-vehicle totals for Presley and Encore match. | Pending |
| Daniel Donato - Jan 28 - March 2, 2026 | 30417 | $25,715.00 | $31,194.60 | +$5,479.60 | Known: Celebrity waived Payroll Fee in ST | Unresolved: need Discount line item capability |
| Snow Strippers - January 6 - March 1, 2026 | 29344 | $127,209.80 | $124,159.80 | -$3,050.00 | Known: $3,050 Per Diem on Trailer record in ST | Fixed. Adding “Miscelleneous” line item to Trailer  discrepancy in Bravo quote for $3050 to make financial data match.  |
| Carrie Underwood - Jan 1 - Dec 31, 2026 | 29330 | $339,000.00 | $338,400.00 | -$600.00 | Known: End of Tour Cleaning line item discrepancy | Fixed: Set “End of Tour Cleaning” to required_for = both so that can be added to either kind of quote. Will need to be manually removed, going forward, from LT Quotes OR create a separate item type (one for Short Term, one for Long Term). Quote fixed to match ST data.  |
| 21 Savage - Test | 30491 | $3,954.60 | $3,804.60 | -$150.00 | ST has DriverDays=0 but ST total includes 3 days × $50 per diem ($150). Transformer skips Driver Per Diem when DriverDays=0. ST data inconsistency. | Fixed via Bravo UI. |
| Tyler Farr - Jan 9-11, 2026 | 29230 | $9,113.97 | $9,219.60 | +$105.63 | Known: Non-standard Payroll Fee rate in ST | Fixed manually; to make financial data match, took a Flat Rate item (End of Tour Cleaning) and discounted by the difference of ~$109 so the totals would match. |
| Daniel Donato - Jan 28 - Dec 20, 2026 | 30441 | $190,729.00 | $190,629.00 | -$100.00 | ST has $100 Per Diem on "The Rig" (swap vehicle added for Snowman breakdown per quote notes). All other line items on The Rig are $0 — the Per Diem is likely a missed zero-out during swap setup. Dirty data artifact. | Fixed. Added $100 Miscellaneous line item. |
| Lo Cash | 30487 | $6829.20 | $6774.60 | -$54.60 | Payroll Fee set to 0% in ST (non-standard). Bravo doesn't allow waiving Payroll Fee. Needs Discount line item capability (not yet implemented). |

### Script Fixes Applied

1. **Removed `is_primary` from artist_contacts insert** — column was dropped from Bravo schema. All 11 links now succeed.
2. **Appended `(ST-XXXXX)` to colliding quote names** in CSV — quotes 30412 and 30425 now differentiated from 30411/30417.
3. **Populated `artistIdMap` for skipped quotes** — artist-contact linking now works on re-runs where quotes already exist.

### Manual Fixes Applied

_None yet._

---

<!-- TEMPLATE: Copy this section for new batches

## Batch: <batch-name>

- **Quotes:** <count>
- **Source:** <description of what's in this batch>
- **Exported:** <date>

| Environment | Imported | Status Applied | Notes |
|-------------|----------|----------------|-------|
| dev         | Not yet  | —              | — |
| prod        | Not yet  | —              | — |

### Validation Summary

_Not yet validated._

### Mismatched Quotes

| Quote | StarTracker Total | Bravo Total | Difference | Root Cause | Resolution |
|-------|-------------------|-------------|------------|------------|------------|

### Manual Fixes Applied

_None._

-->
