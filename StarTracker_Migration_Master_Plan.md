# StarTracker to Bravo Migration: Master Plan

**Document Owner:** Aaron Briggs  
**Last Updated:** January 12, 2025  
**Status:** Import tool built and deployed; awaiting enhanced StarTracker export  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Import Scope & Phases](#2-import-scope--phases)
3. [Record Classification Rules](#3-record-classification-rules)
4. [Status Mapping](#4-status-mapping)
5. [Object Creation Rules](#5-object-creation-rules)
6. [Field Mapping Reference](#6-field-mapping-reference)
7. [Line Item Type Mapping](#7-line-item-type-mapping)
8. [Calculation Rules & Formulas](#8-calculation-rules--formulas)
9. [Special Handling Rules](#9-special-handling-rules)
10. [Architecture Decisions](#10-architecture-decisions)
11. [Known Issues & Decisions](#11-known-issues--decisions)
12. [Open Questions](#12-open-questions)
13. [Enhanced Export Requirements](#13-enhanced-export-requirements)
14. [Validation Checklist](#14-validation-checklist)
15. [Change Log](#15-change-log)

---

## 1. Executive Summary

### Purpose
Migrate historical quote and lease data from StarTracker (legacy system) to Bravo (new Supabase-based Leasing & Operations system) to enable the Celebrity Coaches team to operate entirely in Bravo.

### Timeline
- **Phase 1:** 2026 data (must-have for January go-live)
- **Phase 2:** 2025 data (backfill after Phase 1 validated)

### Critical Dependencies
- **Enhanced StarTracker export** — Request sent (Jan 2025), awaiting delivery
- **`external_id` field on quotes table** — ✅ COMPLETE (applied to bravo-dev and bravo-prod)
- Vehicle name matching between systems
- Artist/customer name matching between systems
- DocuSign field schema decision for external agreements

### Key Principles
1. **Accuracy over speed** — imported data must match StarTracker totals
2. **Use deprecated line items** to handle edge cases rather than schema changes
3. **Document everything** — create audit trail for variances
4. **Exclude internal records** — service blocks, test data handled separately

---

## 2. Import Scope & Phases

### Phase 1: 2026 Data (Priority)
- **Date range:** January 1, 2026 onwards
- **Purpose:** Enable leasing team to use Bravo for current/upcoming work
- **Must complete before:** January 2026 go-live

### Phase 2: 2025 Data (Backfill)
- **Date range:** January 1, 2025 - December 31, 2025
- **Purpose:** Historical reference and reporting continuity
- **Timeline:** After Phase 1 validated

### What Gets Imported

| Record Type | Phase 1 | Phase 2 |
|-------------|---------|---------|
| Standard quotes | ✓ | ✓ |
| Converted quotes → Leases | ✓ | ✓ |
| Tours (from short-term leases) | ✓ | ✓ |
| Departures (from tours) | ✓ | ✓ |

### What Gets Excluded

| Record Type | Reason | Handling |
|-------------|--------|----------|
| Status = "Other" | Service/maintenance blocks | Inventory separately; recreate as Vehicle Unavailability |
| CustomerName = "Celebrity Coaches" | Internal records | Exclude from import |
| CustomerName contains "TEST" | Test data | Exclude from import |
| BusRate = $0 with mileage (tours in LT leases) | Different structure | Inventory separately; import after LT lease framework decided |

---

## 3. Record Classification Rules

### Decision Tree for Each Row

```
START
  │
  ├─► Status = "Other"? ──────────────────────► EXCLUDE (service block)
  │
  ├─► CustomerName = "Celebrity Coaches"? ────► EXCLUDE (internal)
  │
  ├─► CustomerName contains "TEST"? ──────────► EXCLUDE (test data)
  │
  ├─► BusRate = $0 AND TotalMileage > 0 
  │   AND Status = "Contract-*"? ─────────────► SET ASIDE (tour within LT lease)
  │
  ├─► Is this a Long-Term quote/lease? ───────► See Long-Term Detection below
  │
  └─► Otherwise ──────────────────────────────► IMPORT (standard quote/lease)
```

### Long-Term vs Short-Term Detection

**Primary Rule (for coaches):**
```
IF BusRate >= $2,000 THEN Long Term
ELSE Short Term
```

**Secondary Rule (if primary inconclusive):**
```
IF BilledMonths >= 6 THEN Long Term
```

**Trailer Detection:**
```
IF BusTrailer STARTS WITH 'CC' OR 'ML' OR 'LK' OR 'TA' THEN Trailer
ELSE Coach
```

**Note:** For trailers, the $2,000 threshold may indicate monthly rate. Use BilledMonths >= 6 as confirmation.

---

## 3A. Import Tool Classification Framework

### Overview

A standalone web tool has been built to classify StarTracker CSV exports before import. The tool groups rows by TourID and applies rules to categorize each quote.

**Tool:** [StarTracker Import Tool](https://startracker-import.netlify.app) (or your Netlify URL)  
**Repo:** `startracker-import-tool` (separate from Bravo)  
**Documentation:** See `CONTEXT.md` in the tool repo for detailed rules

### Classification Categories

| Category | Meaning | Action |
|----------|---------|--------|
| **READY** | Clean data, passes all checks | Import automatically |
| **FLAGGED** | Importable but needs human review | Review reasons, then import |
| **BLOCKED** | Cannot import — missing Bravo feature | Handle manually in Bravo |
| **EXCLUDED** | Should not be imported | Skip entirely |

### EXCLUDED Rules

| Condition | Reason |
|-----------|--------|
| Status = "Other" | Service/maintenance records |
| CustomerName = "Celebrity Coaches" | Internal records |
| CustomerName = "TEST CLIENT" | Test data |

### BLOCKED Rules

| Condition | Reason | Resolution |
|-----------|--------|------------|
| DiscountedDays > 0 | Bravo lacks Discount Days feature | Backlog: implement in Bravo |
| Vehicle swap detected | Same vehicle appears 2+ times in tour | Backlog: implement vehicle swap feature |
| Multiple $0 budget rows (≥2) | Indicates vehicle swaps | Same as above |

**Vehicle Swap Detection:**
- Same vehicle name appears multiple times within a TourID
- Often accompanied by $0 budget rows (replacement tracked at no charge)
- Estimated: 10-20% of tours, mostly 2025 data

**Discount Days (10 affected quotes):**
- JAL JLL LLC, Railroad Park Concert, Restless Road, Sound Image, The Touring Company, TV on the Radio

### FLAGGED Rules

| Condition | Reason | Import Action |
|-----------|--------|---------------|
| BusRate = $0 with TotalMileage > 0 | Tour within LT lease | Review parent lease relationship |
| Driver days override detected | DriverDays > (TourDays + DHF + DHR) | Create "Additional Driver Days" line item |
| AdminTotal > 0 | Admin fee present | Create flat "Admin Fee" line item |

### READY

Passes all checks above. Apply transformation rules to import.

---

## 4. Status Mapping

| StarTracker Status | Bravo Quote Status | Creates Lease? | Bravo Lease Status |
|--------------------|-------------------|----------------|-------------------|
| Quote - Active | **Sent** | No | — |
| Quote - Closed | **Declined** | No | — |
| Contract - Verbal | **Converted** | **Yes** | Draft |
| Contract - Committed | **Converted** | **Yes** | Draft |
| Contract - Signed | **Converted** | **Yes** | Fully Executed |
| Other | — | — | EXCLUDE |

---

## 5. Object Creation Rules

### For Standard Short-Term Quotes (Quote - Active/Closed)

```
Quote
  └── Quote Coaches (one per coach)
  └── Quote Trailers (one per trailer)
  └── Quote Line Items (all fee items)
  └── Tour(s) in "Quoted" status (if multi-tour quote)
```

### For Converted Short-Term Quotes (Contract - *)

```
Quote (status: Converted)
  └── Lease
        ├── Status: Draft (Verbal/Committed) OR Fully Executed (Signed)
        └── Tour (status: Leased)
              └── Departure(s) (one per coach)
                    └── Workflow Steps (auto-created)
```

### For Long-Term Quotes (Not Converted)

```
Quote
  └── Quote Coaches
  └── Quote Trailers  
  └── Quote Line Items
  (No Tour created — LT quotes don't have tour details)
```

### For Converted Long-Term Quotes

```
Quote (status: Converted)
  └── Lease
        └── Status: Draft or Fully Executed
        (No Tour/Departure — created later when artist books usage)
```

### Multi-Vehicle Quote Handling

**Same TourID = Same Quote**

When multiple rows share a TourID:
1. Create ONE quote
2. Create multiple Quote Coaches/Trailers
3. Check if custom tours needed (see below)

**Custom Tour Detection:**

Compare these fields across vehicles with same TourID:
- TourDays, BilledDays, TotalMileage
- StartDate, EndDate
- TravelDaysIn, TravelDaysOut

```
IF all vehicles have identical values → Single tour, multiple vehicles
IF any vehicle has different values → Custom tour(s) needed
```

---

## 6. Field Mapping Reference

### Quote Header Fields

| StarTracker | Bravo Table.Field | Notes |
|-------------|-------------------|-------|
| TourID | quotes.external_id | Store for reference |
| Status | quotes.status | See Status Mapping |
| CustomerName | quotes.artist_id | Lookup by name |
| TourName | quotes.name | |
| StartDate | quotes.lease_start_date | |
| EndDate | quotes.lease_end_date | |
| — | quotes.quote_type | "Short Term" or "Long Term" (derived) |

### Tour Fields (Short-Term Only)

| StarTracker | Bravo Table.Field | Notes |
|-------------|-------------------|-------|
| TourName | tours.name | |
| StartDate | tours.start_date | |
| EndDate | tours.end_date | |
| TotalMileage | tours.total_estimated_miles | |
| TravelDaysIn | quotes.bus_deadhead_front_days | |
| TravelDaysOut | quotes.bus_deadhead_rear_days | |
| DriverDHF | quotes.driver_deadhead_front_days | |
| DriverDHR | quotes.driver_deadhead_rear_days | |
| TourDays | (calculated) | EndDate - StartDate + 1 |
| BilledDays | (derived) | TourDays - DiscountedDays |
| AddDriverDays | quotes.co_driver_days | |

### Vehicle Fields

| StarTracker | Bravo Table.Field | Notes |
|-------------|-------------------|-------|
| BusTrailer | coaches.name OR trailers.name | Lookup by name (strip asterisk) |
| Driver | — | Informational only, don't import |
| CoDriver | — | Informational only, don't import |

### Vehicle Name Normalization

```python
def normalize_vehicle_name(startracker_name):
    # Remove asterisk suffix
    return startracker_name.strip().rstrip('*').strip()

# Examples:
# "Cobra*" → "Cobra"
# "Freedom *" → "Freedom"
# "CC9033" → "CC9033"
```

---

## 7. Line Item Type Mapping

### Vehicle Rates

| StarTracker Column | Bravo Line Item Type | Unit | Qty Source | Notes |
|--------------------|---------------------|------|------------|-------|
| BusRate (coach, ST) | Coach Rate, Daily | Per Day | BilledDays | |
| BusRate (coach, LT) | Coach Rate, Monthly | Per Month | BilledMonths | |
| BusRate (trailer, ST) | Trailer Rate, Daily | Per Day | BilledDays | |
| BusRate (trailer, LT) | Trailer Rate, Monthly | Per Month | BilledMonths | |

### Driver Labor

| StarTracker Column | Bravo Line Item Type | Unit | Qty Source | Payroll Coded |
|--------------------|---------------------|------|------------|---------------|
| DriverRate | Driver Rate, Daily | Per Day | DriverDays | ✓ |
| CoDriverRate | Co-Driver Rate, Daily | Per Day | AddDriverDays | ✓ |
| DriverODRate | Driver Overdrives | Per Day | **MISSING** | ✓ |
| HotelBuyOut | Driver Hotel Buy Outs | Per Night | **MISSING** | ✓ |

**Note:** Overdrive and Hotel quantities not in current export — BLOCKER.

### Coach Fees

| StarTracker Column | Bravo Line Item Type | Unit | Qty Source |
|--------------------|---------------------|------|------------|
| DOTRate | IFTA/DOT Fee | Per Day/Month | BilledDays or BilledMonths |
| SatelliteRate | Satellite Service | Per Day/Month | BilledDays or BilledMonths |
| InternetRate | Internet Service | Per Day/Month | BilledDays or BilledMonths |
| InsuranceRate | Insurance | Per Day/Month | BilledDays or BilledMonths |

### Weekly Services

| StarTracker Column | Bravo Line Item Type | Unit | Qty Source | Payroll Coded |
|--------------------|---------------------|------|------------|---------------|
| InteriorCleaning | Interior Cleanings | Per Week | FLOOR(TourDays/7) | ✓ |
| BusWashRate | Bus Washes | Per Week | FLOOR(TourDays/7) | ✓ |
| LinenRate | Linen Cleanings | Per Week | FLOOR(TourDays/7) | ✓ |
| GeneratorRate | Generator Services | Per Week | MAX(FLOOR(TourDays/7), 1) | ✓ |

### Mileage-Based

| StarTracker Column | Bravo Line Item Type | Unit | Qty Source |
|--------------------|---------------------|------|------------|
| FuelRate | Fuel Estimate | Per Mile | TotalMileage |
| EngineRate | Engine Services | Per Mile | TotalMileage |

### Flat Rate Items

| StarTracker Column | Bravo Line Item Type | Notes |
|--------------------|---------------------|-------|
| Upholstery | Upholstery Cleaning | Already a total |
| CleaningTotal | End of Tour Cleaning | Already a total |
| BedKitTotal | Bed Kit Install / Bunk Change Fee | Already a total |
| Tolls | Tolls | Already a total |
| MiscTotal | Miscellaneous | Already a total |
| PerDeimTotal | Driver Per Diem | Total; derive rate = total/DriverDays |

### Payroll Fee

| StarTracker Column | Bravo Line Item Type | Notes |
|--------------------|---------------------|-------|
| PayrollFeeTotal | (auto-calculated) | Bravo calculates 28% of payroll-coded items |

**Payroll-coded items:** Driver Rate, Co-Driver Rate, Overdrives, Hotel Buy Outs, Weekly Services (Interior, Bus Wash, Linen, Generator). **NOT** Per Diem.

### Billing Categories

**StarTracker has 3 categories:**
- Contract (99.4% of revenue)
- Driver Collect (0.3% of revenue)
- Client Responsibility (0.3% of revenue)

**Bravo has 2 categories:**
- Contracted
- Client Responsibility

**Mapping Rule:**
| StarTracker | Bravo |
|-------------|-------|
| Contract | Contracted |
| Driver Collect | Client Responsibility |
| Client Responsibility | Client Responsibility |

**Current Export Limitation:**
The export provides TOTALS per billing category (`IncludedInContract`, `DriverCollect`, `ClientResp`) but NOT per-line-item categories. This means we know the total amount in each category, but not which specific line items.

**Data from May-Dec 2025 export:**
- 27 rows (3.7%) have DriverCollect > 0
- 17 rows (2.3%) have ClientResp > 0  
- 0 rows have both (mutually exclusive)
- Examples: Alexandra Kay, Chayce Beckham, Koe Wetzel (Driver Collect); Phish, Restless Road (Client Resp)

**Enhanced Export Requirement:** Need per-line-item billing category to accurately recreate quotes.

---

## 8. Calculation Rules & Formulas

### Understanding the BusDays Column (IMPORTANT)

The `BusDays` column in the StarTracker export is **context-dependent**:

| Quote Type | BusDays Column Contains | Use For |
|------------|------------------------|---------|
| Short-Term | Actual days | Daily rate calculations |
| Long-Term | Months (mislabeled!) | Monthly rate calculations |

**Detection:** Use `BusRate >= $2000` (coaches) to identify Long-Term quotes.

### Quantity Calculations

```
TourDays = (EndDate - StartDate) + 1
TourWeeks = FLOOR(TourDays / 7)
BilledDays = TourDays - DiscountedDays
BilledMonths = BilledDays / 30.0  (decimal allowed)

MainDriverDays = TourDays + DriverDHF + DriverDHR
BilledBusDays = TourDays + TravelDaysIn + TravelDaysOut
```

### Line Item Total Calculations

```
line_total = rate × quantity

# For vehicle rates (coach/trailer):
# Use BusDays column - it's the correct quantity regardless of quote type
# Just set the unit type appropriately:
if is_long_term:
    coach_total = BusRate × BusDays  # BusDays is actually months
    unit_type = "Per Month"
else:
    coach_total = BusRate × BusDays  # BusDays is actual days
    unit_type = "Per Day"

# For mileage items:
fuel_total = FuelRate × TotalMileage

# For weekly services:
interior_total = InteriorCleaning × FLOOR(TourDays / 7)

# For daily items:
coach_total = BusRate × BilledDays

# For monthly items (LT):
coach_total = BusRate × BilledMonths
```

### Payroll Fee Calculation

```
payroll_base = SUM(all payroll-coded line items)
payroll_fee = payroll_base × 0.28
```

### Grand Total

```
grand_total = IncludedInContract + DriverCollect + ClientResp
```

**Validation:** This should equal TourBudget (confirmed in data analysis).

---

## 9. Special Handling Rules

### 9.1 Trailer Rate (No Separate Column)

StarTracker reuses `BusRate` for trailers. Detection:

```python
if is_trailer(BusTrailer):
    if quote_type == "Short Term":
        line_item_type = "Trailer Rate, Daily"
    else:
        line_item_type = "Trailer Rate, Monthly"
else:
    if quote_type == "Short Term":
        line_item_type = "Coach Rate, Daily"
    else:
        line_item_type = "Coach Rate, Monthly"
```

### 9.2 Trailer Driver Increase ($50/day)

**StarTracker:** Leasing agents manually add $50/day to DriverRate when trailer present.
**Bravo:** Separate line item exists but we can't detect it.

**Decision:** Import DriverRate as-is. Do NOT attempt to break out the $50 increase.

### 9.3 Overdrive/Hotel Buyout Flattening

**StarTracker:** Combines main driver + co-driver quantities.
**Bravo:** Has separate line items for each.

**Decision:** Import to main driver line items only:
- Combined Overdrive Qty → "Driver Overdrives"
- Combined Hotel Buyout Qty → "Driver Hotel Buy Outs"

### 9.4 DriverDays Manual Override Handling

**Problem:** 21 contract records have DriverDays that don't match the formula.

**Decision:** Create deprecated "Driver Days Adjustment" line item type.

**Process:**
1. Calculate expected DriverDays using formula
2. If StarTracker DriverDays differs:
   - Calculate variance (Actual - Expected)
   - Create adjustment line item: `variance × DriverRate`
   - Mark line item as billing category that nets to correct total

**Affected TourIDs (contracts only):**
- 29111 (Autobus): -1 day × 2 vehicles
- 29098 (Dirtyheads): -1 day × 2 vehicles
- 29207 (Fox Racing): -11 days
- 29253 (Fox Racing): -3 days
- 27848 (Jack White): +1, +3, -14 days across 3 vehicles
- 29299 (JAL, JLL LLC): -4 days × 4 vehicles
- Plus 9 others with small variances

### 9.5 Discount Days (BLOCKED)

**Business Context:** StarTracker allows discounting specific days within a tour (e.g., Nashville breaks between legs). Instead of creating separate quotes, leasing team creates one quote with discounted days.

**Example:** 30-day tour with 3 discounted days = 27 billable days

**Current Status:** BLOCKED — Bravo lacks this feature.

**Affected Records:** 10 quotes (see Appendix A)

**Resolution Options:**
1. Build Discount Days feature in Bravo (backlog)
2. Import manually with adjusted BusDays and note explaining variance
3. Create separate quotes for each tour leg

**Recommendation:** Option 2 for Phase 1 (manual with notes), Option 1 for long-term

---

### 9.6 Vehicle Swaps (BLOCKED)

**Business Context:** When a vehicle has issues mid-tour, Celebrity sends a replacement. The leasing team edits the StarTracker tour record, adding vehicles with new start/end dates.

**Data Pattern:**
- Same vehicle appears multiple times with different date ranges
- Replacement vehicles often have $0 budget
- Original vehicle carries the revenue

**Examples:**
| TourID | Customer | Pattern |
|--------|----------|---------|
| 29091 | Malcolm Todd | Snowman appears 3×, mix of $0 and revenue rows |
| 27707 | Sam Hunt | Route 66 → Carrera sequential swap |
| 27750 | Josh Ross | Conspiracy LT + CC9038 trailer swap |
| 27674 | Tucker Wetmore | Encore carries revenue, Drifter swap at $0 |

**Current Status:** BLOCKED — Too complex without Bravo swap feature.

**Estimated Impact:** 10-20% of tours, concentrated in 2025 data (long-running tours/leases)

**Resolution:** Build vehicle swap functionality in Bravo, then import these records.

---

### 9.7 DocuSign for Converted Quotes

**Problem:** Converted quotes have existing signed agreements not created through Bravo.

**Proposed solution (pending Derek/Marc):**
- Add `external_envelope_id` and/or `external_agreement_url` fields to leases table
- Populate during import if we can obtain envelope IDs
- Frontend shows "External Agreement" indicator

---

## 10. Architecture Decisions

### 10.1 External ID for Cross-System Reference

**Decision Date:** January 5, 2025  
**Status:** ✅ IMPLEMENTED (January 6, 2025) — Applied to bravo-dev and bravo-prod

**Problem:**  
StarTracker uses `TourID` as the primary identifier. Bravo generates its own UUIDs for quotes, leases, tours, and departures. When importing data in multiple passes (e.g., core quote data first, then pickup/dropoff info later), we need a way to correlate StarTracker records to their Bravo counterparts.

**Decision:**  
Add an `external_id` field to the `quotes` table (at minimum) to store the StarTracker TourID.

**Schema Change Required:**
```sql
ALTER TABLE quotes ADD COLUMN external_id TEXT;
CREATE INDEX idx_quotes_external_id ON quotes(external_id);

-- Optional: Add to related tables if needed
ALTER TABLE leases ADD COLUMN external_id TEXT;
ALTER TABLE tours ADD COLUMN external_id TEXT;
ALTER TABLE departures ADD COLUMN external_id TEXT;
```

**Field Properties:**

| Property | Value |
|----------|-------|
| Nullable | Yes (Bravo-native quotes won't have one) |
| Unique | Yes (no duplicate TourIDs) |
| Visible in Frontend | No |
| Editable by Users | No |
| Purpose | Migration correlation only |

**Usage Pattern:**

```python
# Pass 1: Import core quote data
quote = create_quote(
    name=row['TourName'],
    external_id=str(row['TourID']),  # Store StarTracker ID
    ...
)

# Pass 2: Import additional data (e.g., pickup info)
quote = db.query("SELECT * FROM quotes WHERE external_id = ?", startracker_tour_id)
# Then update related records via quote relationship
```

**Benefits:**
- Enables incremental/multi-pass imports
- Allows reconciliation between systems
- Simple to implement (one column, one index)
- Doesn't affect existing Bravo functionality

**Alternatives Considered:**
- Mapping table: More complex, extra joins required
- Recreate TourID as Bravo ID: Would conflict with UUID convention

---

### 10.2 Import Workflow & Staging Approach

**Status:** Approved (January 6, 2025)

**Problem:**  
How do we analyze, transform, QA, and import StarTracker data while ensuring confidence and minimizing risk? Key concerns:
- Aaron is the primary owner of this process (limited team involvement)
- Must be confident in what's being imported before it hits production
- Clean data is paramount — avoid rework and rollbacks
- This is a 2-phase migration (2026 data, then 2025 data), not a repeatable pipeline

**Decision:**  
Hybrid approach using iterative batches with human review checkpoint.

**Workflow:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ITERATIVE BATCH IMPORT                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  For each batch (~2 months of data):                                        │
│                                                                              │
│  ANALYZE ──► TRANSFORM ──► REVIEW ──► IMPORT                                │
│  (Python)    (Python)      (Human +   (Script)                              │
│                            Agent)                                           │
│       │                        │           │                                │
│       ▼                        ▼           ▼                                │
│  Classification    Import-ready    Approved    Data in Bravo               │
│  reports           CSVs            data file   (DEV → PROD)                │
│                                                                              │
│  After each batch: Capture learnings, refine logic, update Master Plan     │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Phase Details:**

| Phase | Tool | Input | Output |
|-------|------|-------|--------|
| **Analyze** | Python/Pandas | Raw StarTracker export | Classification report, gap report, edge case flags |
| **Transform** | Python/Pandas | Classified export | Import-ready CSVs (one per Bravo table) |
| **Review** | Excel + Claude | Import-ready CSVs | Approved/corrected data files |
| **Import** | Python script | Approved CSVs | Records in Bravo (DEV first, then PROD) |

**Key Principles:**

1. **Nothing goes into PROD until reviewed** — Human reviews import-ready CSVs before import
2. **Agent-assisted QA** — Claude reviews data for anomalies, outliers, missing values, failed validations
3. **Small batches** — ~2 months of data per batch to maintain tight control
4. **Iterative refinement** — Each batch teaches us something; Python logic and Master Plan evolve
5. **Spreadsheet as staging** — The "staging area" is the import-ready CSV that Aaron reviews, not a database table

**Batch Size Rationale:**
- ~50-100 records per batch (based on ~700 rows covering 8 months)
- Small enough to review thoroughly
- Large enough to surface edge cases
- Can adjust based on confidence level

**Import-Ready CSV Structure:**

The Python transformation produces clean CSVs mapping directly to Bravo tables:

```
quotes_to_import.csv
├── external_id (TourID)
├── name
├── quote_type
├── status
├── artist_name (for lookup)
├── start_date
├── end_date
└── ... (all quote fields)

quote_line_items_to_import.csv
├── external_id (TourID for parent quote)
├── line_item_type
├── rate
├── quantity
├── unit_type
├── total
├── billing_category
└── vehicle_name (for lookup)

(Similar CSVs for leases, tours, departures)
```

**Alternatives Considered:**
- Supabase staging tables: More setup, better for team collaboration (not needed here)
- Direct import without review: Faster but risky for data quality
- All-at-once import: Too risky for a first-time migration

---

### 10.3 Validation Failure Handling

**Status:** Approved (January 6, 2025)

**Problem:**  
When transforming StarTracker data, some records will fail validation. How do we handle each type of failure while maintaining data quality and avoiding rework?

**Decision:**  
Three-tier handling based on failure type: Auto-fix, Flag for review, or Block.

**Philosophy:** When in doubt, block. Better to understand and fix than to import garbage and clean up later.

**Handling Rules:**

| Failure Type | Action | Details |
|--------------|--------|---------|
| **Artist not found** | Flag | Review new artists before auto-creation from export data |
| **Vehicle not found** | Block | Vehicle must exist in Bravo first; likely naming mismatch or new vehicle needing full setup |
| **Total mismatch ≤ $1** | Auto-fix | Accept silently (rounding differences) |
| **Total mismatch $1–$100** | Flag | Review and decide: import with adjustment line item, or investigate first |
| **Total mismatch > $100** | Block | Must investigate; signals fundamental problem |
| **Missing required field** | Block | All required fields must be present (dates, customer, vehicle, etc.) |
| **Invalid/unknown status** | Block | Unknown status needs investigation; shouldn't happen if mapping is correct |

**Edge Case Handling:**

| Edge Case | Action | Rationale |
|-----------|--------|-----------|
| DriverDays override | Flag | Have rule (adjustment line item), verify totals |
| DiscountedDays > 0 | Flag | Have hypothesis, awaiting team confirmation |
| AdminFee > 0 | Block | Don't know what it is yet |
| Tours within LT leases (BusRate=$0) | Block | Different structure, needs parent lease framework |

**Note:** Edge case list will grow as we import real data. Pattern: **Block** when no rule exists → **Flag** when we have a hypothesis → **Auto-fix** once rule is proven.

**Import-Ready CSV Columns for Flagged Records:**

```
_validation_status:  READY | FLAGGED | BLOCKED
_validation_notes:   "Artist 'New Band' will be created" | "Total variance: $48.50" | etc.
_edge_cases:         "DriverDays override (+3 days)" | "DiscountedDays: 7" | etc.
```

This lets you filter the CSV to review flagged items, understand why they're flagged, and approve or investigate.

---

### 10.4 Downstream Object Creation

**Status:** Approved (January 6, 2025)

**Problem:**  
When we import a StarTracker record, what Bravo objects should we create? A single quote can cascade into Lease → Tour → Tour Vehicles → Departures → Driver Assignments.

**Decision:**  
Let Bravo's existing functions handle the cascade, with a two-phase import for safety.

**What We Import Directly:**

| Object | Import? | Notes |
|--------|---------|-------|
| Quote | ✓ Yes | Primary import target |
| Quote Vehicles | ✓ Yes | Part of quote |
| Quote Line Items | ✓ Yes | Part of quote |

**What Bravo Creates Automatically:**

| Object | How | Trigger |
|--------|-----|---------|
| Lease | `convert_quote_to_lease()` | Called by us after review |
| Tour | `create_tour_from_quote()` | Called by convert function (Short Term only) |
| Tour Vehicles | Auto-assigned | Trigger on tour creation |
| Departures | Auto-created | Trigger on tour_vehicles insert |

**What We Skip (For Now):**

| Object | Reason | Future Plan |
|--------|--------|-------------|
| Driver Assignments | Not built in Bravo yet | Import later via `external_id` correlation |
| Pickup/Dropoff details | Departures auto-created first | Update departures in second pass |

**Two-Phase Import Process:**

```
PHASE A: Import Quotes Only
───────────────────────────────────────────────────────────
1. Import Quote record
2. Import Quote Vehicles  
3. Import Quote Line Items
4. Status remains as-is but NO conversion yet
                    │
                    ▼
           REVIEW GATE (Manual)
           • Spot-check quotes in Bravo UI
           • Validate totals match
           • Confirm vehicles assigned correctly
           • Approve batch for conversion
                    │
                    ▼
PHASE B: Convert Approved Quotes  
───────────────────────────────────────────────────────────
5. Call convert_quote_to_lease() for Contract-* quotes
6. Bravo cascades → Lease → Tour → Departures
7. Validate downstream objects
                    │
                    ▼
PHASE C: Enrich Departures (Optional)
───────────────────────────────────────────────────────────
8. Update departures with Pickup/Dropoff data
9. Use external_id to correlate to original TourID
```

**Environment Strategy:**

| Step | Environment | Purpose |
|------|-------------|---------|
| 1 | DEV | Import quotes |
| 2 | DEV | Review in Bravo UI |
| 3 | DEV | Run conversion |
| 4 | DEV | Validate everything |
| 5 | PROD | Import quotes (only if DEV passed) |
| 6 | PROD | Review in Bravo UI |
| 7 | PROD | Run conversion |
| 8 | PROD | Final validation |

**Safety Net — Cleanup Script:**

If something goes wrong, `external_id` lets us identify and remove all imported records:

```sql
-- Identify imported records
SELECT * FROM quotes WHERE external_id IS NOT NULL;

-- Clean up cascade (if needed)
DELETE FROM departures WHERE tour_id IN (
  SELECT id FROM tours WHERE lease_id IN (
    SELECT id FROM leases WHERE quote_id IN (
      SELECT id FROM quotes WHERE external_id IS NOT NULL
      AND external_id LIKE 'batch_001_%'  -- scope to specific batch
)));

DELETE FROM tours WHERE lease_id IN (...);
DELETE FROM leases WHERE quote_id IN (...);
DELETE FROM quote_line_items WHERE quote_id IN (...);
DELETE FROM quote_vehicles WHERE quote_id IN (...);
DELETE FROM quotes WHERE external_id IS NOT NULL AND external_id LIKE 'batch_001_%';
```

**Historical Dates:**

Bravo's functions work with historical dates — no validation blocks past dates. Tours and departures will be created with whatever dates are in the quote.

---

### 10.5 Multi-Vehicle Custom Tours (Different Dates per Vehicle)

**Status:** Approved (January 6, 2025)

**Problem:**  
31 StarTracker tours have vehicles with different Start/End dates within the same TourID. How do we represent these in Bravo?

**Example — Sarah McLachlan (TourID 29034):**

| Vehicle | Start Date | End Date |
|---------|------------|----------|
| ENT 13 | 10/13/2025 | 11/23/2025 |
| Cayman | 10/14/2025 | 11/23/2025 |
| Matador | 10/14/2025 | 11/9/2025 |

**Decision:**  
Use Bravo's `use_custom_tour_data` feature on `lease_vehicles` to preserve vehicle-specific dates within a single tour.

**Structure:**

```
Quote: Sarah McLachlan Tour (TourID 29034)
└── Tour (overall dates: 10/13 - 11/23)
      ├── Tour Vehicle: ENT 13 
      │     └── use_custom_tour_data = true
      │     └── custom_start_date = 10/13
      │     └── custom_end_date = 11/23
      ├── Tour Vehicle: Cayman
      │     └── use_custom_tour_data = true  
      │     └── custom_start_date = 10/14
      │     └── custom_end_date = 11/23
      └── Tour Vehicle: Matador
            └── use_custom_tour_data = true
            └── custom_start_date = 10/14
            └── custom_end_date = 11/9
```

**Import Logic:**

```python
# For each vehicle in a multi-vehicle quote
if vehicle_has_different_dates_than_tour:
    lease_vehicle.use_custom_tour_data = True
    lease_vehicle.custom_start_date = vehicle_start_date
    lease_vehicle.custom_end_date = vehicle_end_date
else:
    lease_vehicle.use_custom_tour_data = False
    # Inherits tour-level dates
```

**Tour-Level Dates:**
- `tour.start_date` = earliest vehicle start date
- `tour.end_date` = latest vehicle end date

**Benefits:**
- One TourID = One Quote = One Tour (simple, matches StarTracker)
- Vehicle-specific granularity preserved
- Line item calculations use correct per-vehicle dates
- Uses existing Bravo capability

---

### 10.6 Trailers with Custom Tour Details

**Status:** Approved (January 6, 2025)

**Problem:**  
StarTracker data may include trailers with different Start/End dates than their associated coaches. Bravo's schema supports this (`lease_vehicles` custom tour fields work for both coaches and trailers), but the `convert_quote_to_lease()` function only populates custom tour data for coaches, not trailers.

**Decision:**  
Use post-conversion UPDATE to add custom tour details to trailers (Option A).

**Why Not Other Options:**

| Option | Why Not |
|--------|---------|
| Direct INSERT (bypass conversion) | Working around Bravo's normal flow; risk of missing conversion logic |
| Extend Bravo schema | Scope creep; changing Bravo for migration purposes |
| Ignore trailer custom dates | Data loss if trailers really have different dates |

**Import Flow:**

```
PHASE B: Import & Convert
─────────────────────────
1. Insert quotes, quote_vehicles, quote_line_items
2. Call convert_quote_to_lease()
3. Bravo creates: Lease → Tour → Lease Vehicles (trailers get tour-level dates)

PHASE D: Enrich
─────────────────────────
4. UPDATE departures with Pickup/Dropoff data
5. UPDATE lease_vehicles (trailers) with custom tour details ← THIS
6. Future: Import Driver Assignments
```

**UPDATE Statement:**

```sql
UPDATE lease_vehicles lv
SET 
    use_custom_tour_data = true,
    custom_tour_start_date = import.trailer_start_date,
    custom_tour_end_date = import.trailer_end_date,
    custom_total_estimated_miles = import.trailer_miles
FROM staging_trailer_custom_data import
WHERE lv.trailer_id = import.bravo_trailer_id
  AND lv.lease_id = import.bravo_lease_id
  AND (import.trailer_start_date != lv.custom_tour_start_date 
       OR import.trailer_end_date != lv.custom_tour_end_date);
```

**Note:** First check if trailers actually have different dates in the export. If they don't, this step is skipped.

---

## 11. Known Issues & Decisions

### ✅ RESOLVED

#### R1: AdminTotal Handling
**Finding:** 11 TourIDs have AdminTotal > 0 (ranging from $36 to $1,922)

**Resolution:** Map to flat "Admin Fee" line item in Bravo
- Quantity = 1
- Rate = AdminTotal value
- Ignore underlying percentage (StarTracker calculates %, we just import the total)

**Status:** Classification tool flags these as FLAGGED; transformation spec maps to Admin Fee line item type.

---

#### R2: Driver Days Override Handling
**Finding:** 21 contracts have DriverDays ≠ (TourDays + DHF + DHR)

**Business Context:** StarTracker allows manual override for:
- Pre-departure work (Nashville pickups before tour starts)
- Cost reduction strategy (charge driver days but waive bus days)
- Deadhead manipulation

**Resolution:** 
- Calculate Base DriverDays = TourDays + DriverDHF + DriverDHR
- Calculate Additional = StarTracker.DriverDays - Base
- If Additional > 0: Create "Additional Driver Days" line item
- If Additional < 0: FLAG for review (rare case, may indicate LT lease with no driver)

**Status:** Classification tool flags these as FLAGGED; transformation spec handles the math.

---

#### R3: BusDays vs BilledDays Column
**Finding:** BusDays column contains BusMonths for LT quotes (export bug)

**Resolution:** Enhanced export request includes separate BusDays and BusMonths columns.

**Status:** Awaiting enhanced export.

---

### 🔴 BLOCKED (Cannot Import Automatically)

#### B1: Discount Days
**Finding:** 10 quotes have DiscountedDays > 0

**Impact:** These cannot be imported until Bravo has Discount Days feature.

**Workaround:** Manual import with adjusted days and explanatory notes.

---

#### B2: Vehicle Swaps
**Finding:** Tours with vehicle replacements appear as multiple rows for the same vehicle, often with $0 budget rows.

**Impact:** These cannot be imported until Bravo has vehicle swap functionality.

**Estimated scope:** 10-20% of tours

---

### 🟡 STILL OPEN

#### Q3: Driver = "." Placeholder
**Finding:** 66 rows have Driver = "."

**Recommendation:** Import with driver field blank/null.

**Status:** Awaiting confirmation.

---

#### Q4: Vehicle Asterisk Meaning
**Finding:** 13 vehicle names have asterisks (e.g., "Cobra*", "Freedom *")

**Questions:**
1. What does asterisk signify?
2. Do Bravo vehicle names include or exclude asterisks?

**Status:** Awaiting confirmation.

---

## 12. Open Questions

### ✅ RESOLVED

#### Q1: BusDays vs BilledDays — SOLVED (Jan 5, 2025)

**Discovery:** The StarTracker export **collapses two separate fields** into one column called `BusDays`:

| StarTracker UI Fields | Export Column | When Quote Type Is |
|----------------------|---------------|-------------------|
| BusDays | `BusDays` | Short-Term |
| BusMonths | `BusDays` | Long-Term |

Aaron verified in StarTracker UI: Alana Springsteen (TourID 27815) shows BusDays=245, BusMonths=8 in the interface. But the export shows BusDays=8 (which is actually BusMonths).

**Evidence from data analysis:**
- Long-Term quotes: 11/11 (100%) have `BusDays` column = `BilledMonths`
- Short-Term quotes: 505/508 (99.4%) have `BusDays` column = `BilledDays`

**Handling Rule:**
```python
if is_long_term_quote:
    # BusDays column actually contains MONTHS
    quantity_for_vehicle_rate = row['BusDays']  # interpret as months
    unit_type = "Per Month"
else:
    # BusDays column contains DAYS  
    quantity_for_vehicle_rate = row['BusDays']  # interpret as days
    unit_type = "Per Day"
```

**Impact:** This simplifies our logic! The `BusDays` column IS the correct quantity multiplier for vehicle rates — we just need to set the correct unit type based on quote type.

**Added to Enhanced Export Request:** Request separate `BusDays` and `BusMonths` columns to avoid this ambiguity in future exports.

---

### 🔴 HIGH PRIORITY

#### Q2: AdminTotal — What Is It?

**Finding:** 11 rows (all "Quote - Closed") have AdminTotal values.

**Examples:**
| TourID | Customer | AdminTotal | Budget |
|--------|----------|------------|--------|
| 27898 | Livingston | $1,921.66 | $111,412 |
| 27664 | OMD | $640.49 | $123,149 |
| 27775 | 5 Seconds of Summer | $240.25 | $176,440 |

**Observation:** AdminTotal is already included in IncludedInContract (totals match).

**Questions:**
1. What is AdminTotal?
2. Do we need a Bravo line item type for it?
3. Since it's included in totals already, is it just informational?

### 🟡 MEDIUM PRIORITY

#### Q3: Driver = "." Placeholder

**Finding:** 66 rows have `Driver = "."` 

**Question:** Import with driver field blank?

#### Q4: Vehicle Asterisk Meaning

**Finding:** 13 vehicle names have asterisks (e.g., "Cobra*", "Freedom *")

**Questions:**
1. What does asterisk signify?
2. Do Bravo vehicle names include or exclude asterisks?

#### Q5: Large MiscTotal Values

**Finding:** Burna Boy has misc totals up to $47,940.

**Question:** Can we get MiscDescription in enhanced export?

---

## 13. Enhanced Export Requirements

**Status:** Request sent to StarTracker developer (January 2025)

### Export 1: Full Contract Data Report (115 columns)

One row per vehicle per tour. Includes:

**Tour/Customer Fields (21 columns):**
- TourID, Status, Archive, AllInclusiveContract, PayEmployeeCommission, TourName, TourNotes
- CustomerName, CustomerAddress1/2, CustomerCity, CustomerState, CustomerZip
- Contact1Name/Phone/Fax/Email, Contact2Name/Phone/Fax/Email

**Vehicle & Date Fields (18 columns):**
- BusTrailer, Driver, CoDriver
- StartDate, EndDate, TourDays, DiscountedDays, BilledDays
- BusDays, BusMonths (SEPARATE columns - critical fix)
- DriverDays, AddDriverDays
- BusDHF, BusDHR, DriverDHF, DriverDHR
- TotalMileage, VehicleNotes

**Line Items with Billing Categories (72 columns):**
Each line item includes Rate, Unit (where applicable), Total, and BillingCat:
- Bus/Trailer: BusRate, BusRateUnit, BusTotal, BusRate_BillingCat
- Driver: DriverRate, DriverTotal, DriverRate_BillingCat
- Co-Driver: CoDriverRate, CoDriverTotal, CoDriverRate_BillingCat
- Coach Fees (DOT, Satellite, Internet, Insurance): Rate, Unit, Total, BillingCat each
- Hotel Buyout: HotelBuyOutQty, HotelBuyOutRate, HotelBuyOutTotal, HotelBuyOut_BillingCat
- Driver Overdrive: DriverODQty, DriverODRate, DriverODTotal, DriverOD_BillingCat
- Weekly Services (Interior, BusWash, Linen, Generator): Rate, Total, BillingCat each
- Mileage (Fuel, Engine): Rate, Total, BillingCat each
- Flat Rate (Upholstery, EndOfTourCleaning, BedKit): Total, BillingCat each
- Per Diem: PerDiemRate, PerDiemTotal, PerDiem_BillingCat
- Misc: MiscDescription, MiscTotal, Misc_BillingCat
- Tolls: Tolls, Tolls_BillingCat
- Payroll Fee: PayrollFeePercent, PayrollFeeTotal, PayrollFee_BillingCat
- Admin Fee: AdminFeePercent, AdminFeeTotal, AdminFee_BillingCat

**Category Totals (4 columns):**
- IncludedInContract, DriverCollect, ClientResp, TourBudget

**Fields NOT requested (not needed):**
- Co-driver Overdrive/Hotel Buyout (not tracked separately)
- Commission/Referral fields (not used)
- Audit fields (EnteredBy, LastEditedBy, dates)

### Export 2: Pickup/Dropoff Logistics Report (24 columns)

One row per vehicle per tour:
- TourID, TourName, CustomerName, BusTrailer (for joining to Export 1)
- PickupDateTime, PickupLocation, PickupAddress, PickupCity, PickupState, PickupZip, PickupPhone
- Contacts (single field with all contacts)
- HotelRoomAtPickup, FirstDrive
- EndingDateTime, EndingLocation, EndingAddress, EndingCity, EndingState, EndingZip, EndingPhone
- MinNumberOfBunks, NumberOfPassengers, Notes

### Date Range Requested

January 1, 2024 through December 31, 2026

---

## 14. Validation Checklist

### Pre-Import Validation

- [ ] Enhanced export received (Full Contract Data Report + Pickup/Dropoff Logistics Report)
- [ ] Verify BusDays and BusMonths are separate columns
- [ ] Verify billing categories present per line item
- [ ] Verify Hotel Buyout and Driver OD quantities present
- [ ] All StarTracker vehicle names exist in Bravo
- [ ] All StarTracker customer names exist as Bravo Artists
- [x] `external_id` column added to quotes table
- [ ] Staging table created
- [ ] Transformation SQL tested on sample data

### Per-Quote Validation

- [ ] Calculated total matches TourBudget (within $1)
- [ ] All line items have valid quote_item_type_id
- [ ] Vehicle assignments valid (coach/trailer exists)
- [ ] Status correctly mapped
- [ ] For contracts: Lease created with correct status

### Post-Import Validation

- [ ] Quote count matches expected
- [ ] Lease count matches expected (contracts only)
- [ ] Tour count matches expected (short-term contracts only)
- [ ] Departure count matches expected
- [ ] Run Supabase security advisors
- [ ] Spot check 10 quotes in Bravo UI
- [ ] Financial totals reconcile

---

## 15. Change Log

| Date | Change | By |
|------|--------|-----|
| 2025-01-05 | Initial document created from conversation analysis | Claude |
| 2025-01-05 | Added status mapping (confirmed by Aaron) | Aaron |
| 2025-01-05 | Added lease creation rules for contracts | Aaron |
| 2025-01-05 | Confirmed "Other" status = exclude | Aaron |
| 2025-01-05 | Confirmed tours within LT leases = set aside | Aaron |
| 2025-01-05 | Added trailer prefix rules (CC, ML, LK, TA) | Aaron |
| 2025-01-05 | Confirmed BusRate reuse for trailers | Aaron |
| 2025-01-05 | Decision: Don't break out $50 trailer driver increase | Aaron |
| 2025-01-05 | Decision: Flatten overdrive/hotel to main driver | Aaron |
| 2025-01-05 | Decision: Use deprecated line item for DriverDays variance | Aaron |
| 2025-01-05 | Added BusDays vs BilledDays as open question | Analysis |
| 2025-01-05 | Added AdminTotal as open question | Analysis |
| 2025-01-05 | Identified 21 contracts with DriverDays override | Analysis |
| 2025-01-05 | Added billing category mapping: ST 3 categories → Bravo 2 categories | Aaron |
| 2025-01-05 | Driver Collect + Client Resp both map to Client Responsibility | Aaron |
| 2025-01-05 | Added per-line-item billing category to enhanced export requirements | Aaron |
| 2025-01-05 | **RESOLVED: BusDays column = BusMonths for LT quotes** (export bug) | Aaron |
| 2025-01-05 | Added BusDays/BusMonths separation to enhanced export request | Aaron |
| 2025-01-05 | **ARCHITECTURE: Add external_id to quotes table** for cross-system reference | Aaron |
| 2025-01-05 | Created StarTracker field inventory from UI screenshots | Aaron/Claude |
| 2025-01-05 | **SENT: Enhanced export request to StarTracker developer** (115 + 24 columns) | Aaron |
| 2025-01-06 | **ARCHITECTURE: Import workflow** — Hybrid iterative batch approach with CSV review checkpoint | Aaron |
| 2025-01-06 | **ARCHITECTURE: Validation failure handling** — Block/Flag/Auto-fix rules by failure type | Aaron |
| 2025-01-06 | **ARCHITECTURE: Downstream object creation** — Two-phase import; let Bravo functions cascade; skip Driver Assignments for now | Aaron |
| 2025-01-06 | **ARCHITECTURE: Multi-vehicle custom tours** — Use `use_custom_tour_data` on lease_vehicles for per-vehicle dates | Aaron |
| 2025-01-06 | **ARCHITECTURE: Trailers with custom tour details** — Post-conversion UPDATE in Phase D: Enrich | Aaron |
| 2025-01-06 | **COMPLETE: `external_id` column** — Applied to quotes table in bravo-dev and bravo-prod | Aaron |
| 2025-01-12 | **RESOLVED: AdminTotal** — Map to flat "Admin Fee" line item | Aaron |
| 2025-01-12 | **RESOLVED: Driver Days Override** — Use "Additional Driver Days" line item for positive variance | Aaron |
| 2025-01-12 | **BLOCKED: Discount Days** — 10 quotes cannot import (Bravo lacks feature) | Aaron |
| 2025-01-12 | **BLOCKED: Vehicle Swaps** — 10-20% of tours cannot import (need swap feature) | Aaron |
| 2025-01-12 | **TOOL: StarTracker Import Tool deployed** — Classifies CSV exports as READY/FLAGGED/BLOCKED/EXCLUDED | Aaron |
| 2025-01-12 | Created CONTEXT.md, TRANSFORMATION_SPEC.md for import tool | Aaron |

---

## Appendix A: Affected Records Lists

### Tours Within Long-Term Leases (BusRate=$0, Set Aside)

To be generated from enhanced export. Pattern: `BusRate = 0 AND TotalMileage > 0 AND Status LIKE 'Contract%'`

### DriverDays Override Contracts (21 records)

| TourID | Customer | Variance | Notes |
|--------|----------|----------|-------|
| 29111 | Autobus | -1 (×2) | |
| 29098 | Dirtyheads | -1 (×2) | |
| 29207 | Fox Racing | -11 | |
| 29253 | Fox Racing | -3 | |
| 27848 | Jack White | +1, +3, -14 | 3 vehicles, mixed |
| 29299 | JAL, JLL LLC | -4 (×4) | |
| 29166 | Richard Hardin | -2 | |
| 27931 | Seether | -1 | |
| 29156 | Smack Management | -2 | |
| 29134 | Sound Image | -2 | |
| 29300 | Tim Gajser | -3 | |
| 29014 | Titos Handmade Vodka | -5 | |
| 29123 | Titos Vodka | -4 | |
| 29084 | Tyler Farr | +1 | |

### AdminTotal Records (11 records)

| TourID | Customer | AdminTotal |
|--------|----------|------------|
| 27881 | 3 Doors Down | $179.02 (×2 vehicles) |
| 27775 | 5 Seconds of Summer | $240.25 (×3 vehicles) |
| 27898 | Livingston | $1,921.66 |
| 27664 | OMD | $640.49 |
| 27730 | Samia | $267.38 |
| 27731 | Samia | $391.53 |
| 27796 | Seether | $36.42 (×2 vehicles) |

### Discount Days Quotes (10 records, BLOCKED)

| TourID | Customer | DiscountedDays |
|--------|----------|----------------|
| TBD | JAL JLL LLC | TBD |
| TBD | Railroad Park Concert | TBD |
| TBD | Restless Road | TBD |
| TBD | Sound Image | TBD |
| TBD | The Touring Company | TBD |
| TBD | TV on the Radio | TBD |

*Note: Full TourIDs to be populated from actual StarTracker export*

### Vehicle Swap Tours (BLOCKED)

**Known examples from 2025 data:**

| TourID | Customer | Pattern |
|--------|----------|---------|
| 29091 | Malcolm Todd | 9 vehicles, Snowman 3×, CC9046 2× |
| 27707 | Sam Hunt | 5 vehicles, Route 66 → Carrera swap |
| 27750 | Josh Ross | 7 vehicles, Conspiracy LT + nested tours |
| 27674 | Tucker Wetmore | 5 vehicles, Encore/Drifter swap |

*Note: Full list to be generated when running classification tool on actual export*

---

## Appendix B: Data Statistics (May-Dec 2025 Export)

| Metric | Value |
|--------|-------|
| Total rows | 727 |
| Unique TourIDs | 404 |
| Status: Quote - Closed | 382 |
| Status: Contract - Committed | 297 |
| Status: Contract - Signed | 32 |
| Status: Contract - Verbal | 3 |
| Status: Other | 13 |
| Coaches | 608 rows |
| Trailers | 119 rows |
| Multi-vehicle quotes | 172 (42.6%) |
| Tours with 4+ vehicles | 37 |
| Long-term leases detected | ~16 |
| DiscountedDays > 0 | 10 |
| BusDays ≠ BilledDays | 89 |
| DriverDays mismatch (contracts) | 21 |
| AdminTotal > 0 | 11 |

---

*End of Document*
