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

## Batch: march 2026 tours_bravo

- **Quotes:** 33
- **Source:** StarTracker March 2026 tour data
- **Exported:** 2026-02-06

| Environment | Imported | Status Applied | Notes |
|-------------|----------|----------------|-------|
| dev         | 2026-02-06 | 2026-02-06 | All 33 quotes inserted as Draft. 12 new artists created, 16 contacts, 17 artist-contact links. Statuses applied (25 updated, 8 skipped). |
| prod        | 2026-02-06 | 2026-02-06 | All 33 quotes inserted as Draft. Manual fixes applied. Statuses applied (25 updated, 8 skipped). |

### Import Results (dev)

- **Quotes inserted:** 33
- **Coaches linked:** 48
- **Trailers linked:** 14
- **Line items created:** 939 (850 auto-generated deleted first)
- **Entity notes created:** 7
- **Contacts created:** 16
- **Artist-contact links:** 17

### Validation Summary (dev)

- **Exact match:** 29 of 33 (87.9%)
- **Close match (< $100):** 0
- **Mismatch (>= $100):** 4

### Mismatched Quotes

| Quote | ST Tour ID | StarTracker Total | Bravo Total | Difference | Root Cause | Resolution |
|-------|-----------|-------------------|-------------|------------|------------|------------|
| Blood Incantation - March 26 - April 10, 2026 | 29352 | $57,249.80 | $56,099.80 | -$1,150.00 | ST has $1,150 Per Diem on trailer record — data entry error (per diem shouldn't be on trailers) | Fixed: Added $1,150 Miscellaneous line item on trailer in Bravo to match. May remove later and accept discrepancy. |
| Tyler Farr - March 11 - 15, 2026 | 30460 | $9,142.60 | $8,217.60 | -$925.00 | ST has BusDays=0 / BusRate=$0 (driver-only/services quote). Transformer uses busDays for per-day service quantities (Satellite, Internet, Insurance, IFTA/DOT), so all got qty 0. Missing $925 = 5 × ($35+$50+$50+$50). | Manual fix in Bravo. |
| Kip Moore - March 5 - 8 | 29337 | $4,989.60 | $4,789.60 | -$200.00 | ST has DriverRate=$0 but still includes 5 days × $50 Per Diem ($250 minus payroll = $200). Transformer skips Driver Per Diem when DriverRate=0. | Fixed manually: added Per Diem line item in Bravo, auto-populated to 5 days. |
| Kip Moore - March 26 - 29, 2026 | 29338 | $4,989.60 | $4,789.60 | -$200.00 | Same as 29337 — DriverRate=$0 but Per Diem still expected. | Fixed manually: added Per Diem line item in Bravo, auto-populated to 5 days. |

### Close Matches

_None._

### Transformer Fix Applied

- **Bug:** `isLongTerm()` in `src/transformer.js` and `src/App.jsx` checked `driverDays === 0 && tourDays > 60` across all vehicle rows via `.some()`. Trailer rows naturally have `DriverDays = 0`, which false-positived multi-vehicle quotes with trailers and 60+ tour days as Long Term.
- **Fix:** Exclude trailer rows (identified by `TRAILER_PREFIXES`) from the `driverDays === 0` check. Applied to both `transformer.js` (line 393) and `App.jsx` (line 170).
- **Affected quote:** 30476 (Animals As Leaders) — was classified Long Term, all monthly quantities set to 0. Re-transformed as Short Term with correct daily quantities.

### Manual Fixes Applied

- Deleted quote 30476 from dev and re-imported with corrected Short Term data. Spliced fixed rows from `bravo-import/animals as leaders tour_bravo/` into batch CSVs. Validated: $0.01 diff (rounding).

---

## Batch: april 2026 tours_bravo

- **Quotes:** 34
- **Source:** StarTracker April 2026 tour data
- **Exported:** 2026-02-06

| Environment | Imported | Status Applied | Notes |
|-------------|----------|----------------|-------|
| dev         | 2026-02-06 | 2026-02-06 | All 34 quotes inserted as Draft. 9 new artists created. Coach name fixes applied. Statuses applied (17 updated, 17 skipped). |
| prod        | 2026-02-06 | 2026-02-06 | All 34 quotes inserted as Draft. 9 contacts created, 16 artist-contact links. Validated 33/34 match. Statuses applied (17 updated, 17 skipped). |

### Import Results (dev)

- **Quotes inserted:** 34
- **Coaches linked:** 54
- **Trailers linked:** 18
- **Line items created:** 1,030
- **Entity notes created:** 7
- **Contacts created:** 9
- **Artist-contact links:** 16
- **New artists:** Riley Green, Chet Faker, Ella Langley, Biffy Clyro, Street Execs Management LLC, CAIN, Anabolic Entertainment, Triumph, The Architects

### Coach Name Fixes (applied to CSV before import)

| CSV Value | Corrected Bravo Name | Issue |
|-----------|---------------------|-------|
| Rebel ( Jana) | Rebel | Extra parenthetical from StarTracker |
| Miss Behavin | Miss Behavin\u2019 | Straight apostrophe in CSV vs smart apostrophe (U+2019) in Bravo |
| Route 66 | Route-66 | Space vs hyphen |

### Import Issues & Fixes

1. **Partial first run created 12 orphan quotes** — Initial import ran before coach names were fixed. Created quote shells with no line items. Deleted all 12 and re-imported cleanly.
2. **Miss Behavin' smart apostrophe** — Bravo DB stores `Miss Behavin\u2019` (U+2019 RIGHT SINGLE QUOTATION MARK) but CSV had straight apostrophe `'` (U+0027). Fixed CSV with correct Unicode character.

### Validation Summary (dev)

- **Exact match:** 33 of 34 (97.1%)
- **Close match (< $100):** 0
- **Mismatch (>= $100):** 1

### Mismatched Quotes

| Quote | ST Tour ID | StarTracker Total | Bravo Total | Difference | Root Cause | Resolution |
|-------|-----------|-------------------|-------------|------------|------------|------------|
| Street Execs Management, LLC - April 10 - 27, 2026 | 30445 | $35,665.40 | $31,965.40 | -$3,700.00 (-10.4%) | Same as Tyler Farr 30460: driver-only/services quote with BusRate=$0 but BusDays=20. Transformer uses BusDays for per-day service quantities, so Satellite/Internet/Insurance/IFTA all got qty 0. Missing $3,700 = 20 × ($35+$50+$50+$50). | Manual fix in Bravo. |

### Manual Fixes Applied

_None yet._

---

## Batch: may tours_bravo

- **Quotes:** 22 (20 new + 2 skipped as duplicates)
- **Source:** StarTracker May 2026 tour data
- **Exported:** 2026-02-06

| Environment | Imported | Status Applied | Notes |
|-------------|----------|----------------|-------|
| dev         | 2026-02-06 | 2026-02-06 | 20 quotes inserted as Draft. 2 skipped (Tucker Wetmore 29319, Jordan Davis 29327 — already exist). 8 new artists created. 9 contacts, 9 artist-contact links. Statuses applied (6 updated, 16 skipped). |
| prod        | 2026-02-06 | 2026-02-06 | 20 quotes inserted as Draft. 2 skipped. 9 contacts, 9 artist-contact links. Validated 19/22 match (same 3 known mismatches as dev). Statuses applied (6 updated, 16 skipped). Brothers Osborne needs manual End of Tour Cleaning fix. |

### Import Results (dev)

- **Quotes inserted:** 20
- **Quotes skipped (duplicates):** 2 (29319 Tucker Wetmore, 29327 Jordan Davis)
- **Coaches linked:** 43
- **Trailers linked:** 4
- **Line items created:** 792 (680 auto-generated deleted first)
- **Entity notes created:** 4 (2 skipped — already exist on duplicate quotes)
- **Contacts created:** 9
- **Artist-contact links:** 9
- **New artists:** Brothers Osborne, The Warning, Mac Demarco, LCD Soundsystem, Young The Giant, Yellowcard, Stone Temple Pilots, Underworld, The Mountain Goats, Muscadine Bloodline

### Validation Summary (dev) — after Megan Moroney fix

- **Exact match:** 19 of 22 (86.4%)
- **Close match (< $100):** 0
- **Mismatch (>= $100):** 3

### Mismatched Quotes

| Quote | ST Tour ID | StarTracker Total | Bravo Total | Difference | Root Cause | Resolution |
|-------|-----------|-------------------|-------------|------------|------------|------------|
| Megan Moroney - May 28 - August 19, 2026 | 29384 | $645,120.00 | $0.00 | -$645,120 (-100.0%) | Different from Animals As Leaders — no trailers involved. 8 coaches, 84 days, no drivers (DriverDays=0). `isLongTerm()` condition `driverDays === 0 && tourDays > 60` tripped on every row. BusRateType="Per Day" confirms it's short-term. | **Fixed.** Transformer updated with `busRateType !== 'Per Day'` guard. Re-exported, spliced into batch, deleted and re-imported. Now matches exactly. |
| Tucker Wetmore - January 1 - December 31, 2026 | 29319 | $230,800.00 | $572,400.00 | +$341,600 (148.0%) | Multiple vehicles on LT quote with different durations. Bravo doesn't yet support per-vehicle duration on LT quotes. | Known limitation — no action for now. |
| Jordan Davis - April 1 - December 31, 2026 | 29327 | $176,681.00 | $246,150.00 | +$69,469 (39.3%) | Same as Tucker Wetmore: multiple vehicles on LT quote with different durations. Bravo doesn't yet support per-vehicle duration on LT quotes. | Known limitation — no action for now. |
| Brothers Osborne - May 1 - Oct 31, 2026 | 29335 | $327,600.00 | $326,400.00 | -$1,200 (-0.4%) | End of Tour Cleaning line item present in ST but not imported to LT quote. Same issue as Carrie Underwood (29330) from Jan/Feb batch. | Fixed manually: added End of Tour Cleaning line item in Bravo. Now matches. |

### Warnings

- State codes "NY" and "CA" not found in `states_provinces` for LCD Soundsystem, Young The Giant, Yellowcard, Stone Temple Pilots. Artists created without state linkage.

### Transformer Fix Applied

- **Bug:** `isLongTerm()` condition `driverDays === 0 && tourDays > 60` false-positived on driverless short-term quotes with 60+ day tours. Megan Moroney (29384): 8 coaches, 84 days, no drivers, BusRateType="Per Day" — clearly short-term but classified Long Term, zeroing all quantities.
- **Fix:** Added `busRateType !== 'Per Day'` guard. If StarTracker explicitly says "Per Day", the driverDays heuristic cannot override it. Applied to both `src/transformer.js` (line 397) and `src/App.jsx` (line 175).
- **Resolution:** Re-exported from web app with fixed transformer, spliced corrected rows into batch CSVs, deleted quote from dev, re-imported. Now matches exactly.

### Manual Fixes Applied

- Brothers Osborne (29335): Added End of Tour Cleaning line item manually in Bravo to match ST total.

---

## Batch: june july 2026 tours_bravo

- **Quotes:** 27
- **Source:** StarTracker June-July 2026 tour data
- **Exported:** 2026-02-07

| Environment | Imported | Status Applied | Notes |
|-------------|----------|----------------|-------|
| dev         | 2026-02-07 | 2026-02-07 | All 27 quotes inserted as Draft. 6 new artists created. 5 contacts, 5 artist-contact links. Coach fuzzy matching fix applied. Required re-import of 8 orphaned quotes (see Manual Fixes). Statuses applied (16 updated, 11 skipped). |
| prod        | 2026-02-07 | 2026-02-07 | All 27 quotes inserted as Draft. 6 new artists, 5 contacts, 5 artist-contact links. Coach fuzzy matching worked (Miss Behavin, Rebel). Validated 27/27 (100%). Statuses applied (16 updated, 11 skipped). |

### Import Results (dev)

- **Quotes inserted:** 27 (19 initially + 8 re-imported after orphan fix)
- **Coaches linked:** 59
- **Trailers linked:** 12
- **Line items created:** 1,199
- **Entity notes created:** 7
- **Contacts created:** 5 (Marcia Szabo, Josh Briand, Mike Gonzales, Anna Marsh, Alex Kopp)
- **Artist-contact links:** 5 (Live Nation, Sarah Mclachlan, Cypress Hill, Maren Morris, Icona Pop)
- **New artists:** Live Nation, Richy Mitch, Pussycat Dolls, Maren Morris, Icona Pop, Slushy Noobz

### Script Fix Applied

- **Coach fuzzy matching** — `getCoach()` in `import-to-supabase.js` now has 3-step matching: (1) exact case-insensitive, (2) strip parenthetical annotations and wildcard match (e.g. "Rebel ( Jana)" → "Rebel"), (3) trailing wildcard for punctuation differences (e.g. "Miss Behavin" → "Miss Behavin'").

### Validation Summary (dev)

- **Exact match:** 27 of 27 (100%)
- **Close match (< $100):** 0
- **Mismatch (>= $100):** 0

### Close Matches

_None — the two initially flagged close matches (Live Nation $0.01, Pussycat Dolls $0.04) confirmed as exact matches due to rounding in StarTracker/Bravo._

### Mismatched Quotes

_None._

### Warnings

- State codes "MI" and "TN" not found in `states_provinces` for Live Nation and Maren Morris. Artists created without state linkage.

### Manual Fixes Applied

- **Orphaned quotes fix:** First live import run was interrupted before line items were imported, leaving 8 quote shells with no line items (29323, 29333, 29339, 29349, 29365, 29374, 29383, 29387). Deleted the 8 orphan quotes and re-ran import. All 8 re-created with full line items. Validation now shows 25/27 exact match + 2 rounding close matches.

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
