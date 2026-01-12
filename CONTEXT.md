# StarTracker Import Tool — Context & Requirements

> **Purpose:** This document provides complete context for AI-assisted development of the StarTracker Import Tool. It covers business context, classification rules, transformation logic, known edge cases, and development guidance.

---

## Table of Contents
1. [Business Context](#business-context)
2. [How This Tool Works](#how-this-tool-works)
3. [Classification Rules](#classification-rules)
4. [Transformation Rules](#transformation-rules)
5. [Known Edge Cases](#known-edge-cases)
6. [Data Dictionary](#data-dictionary)
7. [Future Development](#future-development)
8. [Decision Log](#decision-log)

---

## Business Context

### The Migration Project
Celebrity Coaches is a luxury tour bus leasing company. They've used a legacy system called **StarTracker** for 15+ years to manage quotes and leases. We're building a modern replacement called **Bravo**.

This import tool bridges the gap — it takes CSV exports from StarTracker and prepares them for import into Bravo.

### Key Business Entities

| StarTracker Term | Bravo Term | Description |
|------------------|------------|-------------|
| Tour | Quote/Lease | A customer engagement with one or more vehicles |
| TourID | quote_id | Unique identifier for a quote |
| Bus/BusTrailer | Vehicle | A coach or trailer being leased |
| TourDays | lease_days | Duration of the lease |
| BusRate | coach_rate | Daily or monthly rate for the vehicle |

### Short-Term vs Long-Term Leases

Celebrity Coaches has two lease types, but **StarTracker doesn't explicitly flag which is which**. We must infer it:

| Type | Typical Duration | Pricing | Driver Services |
|------|------------------|---------|-----------------|
| **Short-Term** | Days to weeks | Daily rates ($300-800/day) | Usually included |
| **Long-Term** | 6+ months | Monthly rates ($2,000+/month) | Often not included |

**Detection signals for Long-Term:**
- BusRate >= $2,000 (monthly pricing)
- BilledMonths >= 6
- DriverDays = 0 with high TourDays (lease without driver services)
- TotalMileage = 0 (no tour routing tracked)

### Multi-Vehicle Quotes

One TourID can have multiple vehicles. In the StarTracker export, this appears as **multiple rows with the same TourID**, each representing a different vehicle assignment.

Example: A tour with 2 coaches and 1 trailer = 3 rows in the CSV, all sharing the same TourID.

---

## How This Tool Works

### Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  StarTracker    │     │  This Tool      │     │  Output CSVs    │
│  CSV Export     │ ──▶ │  (Browser)      │ ──▶ │  by Category    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Processing Steps

1. **Parse CSV** — Read StarTracker export, handle quoted fields
2. **Group by TourID** — Combine rows into tour objects
3. **Classify** — Apply rules to categorize each tour
4. **Display** — Show results with filtering and drill-down
5. **Export** — Generate downloadable CSVs by classification
6. **Track History** — Save batch results to localStorage

### Classification Categories

| Category | Meaning | Action |
|----------|---------|--------|
| **READY** | Clean data, can be imported | Export and import to Bravo |
| **FLAGGED** | Importable but needs review | Review reasons, then import |
| **BLOCKED** | Cannot import automatically | Handle manually in Bravo |
| **EXCLUDED** | Should not be imported | Skip entirely |

---

## Classification Rules

### EXCLUDED (Skip Entirely)

These records should never enter Bravo:

| Condition | Reason |
|-----------|--------|
| `Status = "Other"` | Internal service/maintenance records hacked into quoting system |
| `CustomerName = "Celebrity Coaches"` | Internal company records |
| `CustomerName = "TEST CLIENT"` | Test data |

### BLOCKED (Manual Import Required)

These cannot be automatically imported due to missing Bravo features:

| Condition | Reason | Future Resolution |
|-----------|--------|-------------------|
| `DiscountedDays > 0` | Bravo lacks Discount Days feature | Backlog item to implement |
| Vehicle swap detected | Same vehicle appears 2+ times in tour | Awaiting vehicle swap feature in Bravo |
| Multiple $0 budget rows (>=2) | Indicates vehicle swaps or tour tracking | Same as above |

**Vehicle Swap Detection Logic:**
```javascript
// Count occurrences of each vehicle in tour
const vehicleCounts = {};
rows.forEach(r => {
  const vehicle = r.BusTrailer || r.Bus;
  vehicleCounts[vehicle] = (vehicleCounts[vehicle] || 0) + 1;
});

// If any vehicle appears more than once = swap detected
const hasDuplicateVehicle = Object.values(vehicleCounts).some(count => count > 1);
```

### FLAGGED (Review Required)

These can be imported but may need human verification:

| Condition | Reason | Import Action |
|-----------|--------|---------------|
| `BusRate = $0` with `TotalMileage > 0` | Likely a tour within an existing long-term lease | Set aside, may need parent lease link |
| Driver days override detected | `DriverDays > (TourDays + DHF + DHR)` | Create "Additional Driver Days" line item |
| `AdminTotal > 0` | Rare admin fee was applied | Map to flat "Admin Fee" line item |

### READY (Good to Import)

Passes all checks above. May still require transformation rules to map fields correctly.

---

## Transformation Rules

These rules define how StarTracker fields map to Bravo fields during import.

### Driver Days Calculation

**StarTracker formula (expected):**
```
DriverDays = TourDays + DriverDHF + DriverDHR
```

**But StarTracker allows manual override**, so actual DriverDays may differ.

**Transformation logic:**
```
Base DriverDays = TourDays + DriverDHF + DriverDHR
Additional Driver Days = StarTracker.DriverDays - Base DriverDays

If Additional Driver Days > 0:
  → Create "Driver Rate, Daily" line item × Base days
  → Create "Additional Driver Days" line item × difference
  
If Additional Driver Days = 0:
  → Create "Driver Rate, Daily" line item × DriverDays
  
If Additional Driver Days < 0:
  → FLAG for review (unexpected)
```

**Common override scenarios:**
- Pre-departure work (driver does Nashville pickups day before tour)
- Cost reduction strategy (charge driver days but waive bus days)
- Deadhead manipulation (4 technical deadhead days = 1 charged bus day + 4 driver days)

### Admin Fee

StarTracker calculates AdminTotal as a percentage, but Bravo uses flat fees.

**Transformation:**
```
If AdminTotal > 0:
  → Create "Admin Fee" line item with quantity=1, rate=AdminTotal
If AdminTotal = 0:
  → Skip (no line item)
```

### Long-Term Lease Handling

For tours detected as long-term:
- DriverDays = 0 is expected (client provides own driver)
- Use monthly rates instead of daily
- TourDays represents lease duration, not tour duration

### Line Item Mapping (Future)

When full transformation is implemented, map these StarTracker fields to Bravo quote_item_types:

| StarTracker Field | Bravo Line Item Type | Calculation |
|-------------------|---------------------|-------------|
| BusRate × BusDays | "Coach Rate, Daily" | Per day |
| DriverDays × PerDiemRate | "Driver Rate, Daily" | Per day |
| Additional Driver Days | "Additional Driver Days" | Per quantity |
| SatelliteRate | "Satellite & Internet, Daily" or "Monthly" | Depends on lease type |
| InsuranceRate | "Insurance, Daily" or "Monthly" | Depends on lease type |
| AdminTotal | "Admin Fee" | Flat amount |
| MiscTotal | "Miscellaneous" | Flat amount |

---

## Known Edge Cases

### 1. Discount Days (BLOCKED)

**Business context:** Clients with Nashville-based breaks between tour legs create billing complexity. Instead of creating separate quotes (management burden), Celebrity uses a single quote with discounted days.

**Example:** 30-day tour with 3 discounted days = 27 billable days

**Strategic usage:**
- Summer/high-demand: charge straight through
- Slower periods: discount break days to secure work

**Current status:** Bravo lacks this feature. These quotes are BLOCKED until implemented.

### 2. Vehicle Swaps (BLOCKED)

**Business context:** When a bus or trailer has issues during a tour, Celebrity sends a replacement. The leasing team edits the StarTracker tour record, adding vehicles with new dates.

**Data pattern:**
- Same vehicle appears multiple times with different date ranges
- Replacement vehicles often have $0 budget (swap, not new charge)
- Notes field contains swap narrative

**Example (Tucker Wetmore tour):**
```
Row 1: Encore, 1/1-12/31, $302,400 (carries revenue)
Row 2: Drifter, 5/2-5/15, $0 (maintenance swap)
Row 3: Encore, 5/16-12/31, $0 (return tracking)
```

**Current status:** BLOCKED until Bravo has vehicle swap functionality.

### 3. Tours Within Long-Term Leases

**Business context:** A client on a long-term lease may have individual tour legs tracked separately within that lease.

**Data pattern:**
- Multiple rows with same TourID
- One row has budget (the parent LT lease)
- Other rows have $0 BusRate but have mileage data (the tours)

**Current status:** FLAGGED for manual review. May need parent-child linking in Bravo.

### 4. Status = "Other"

**What it means:** Internal service/maintenance records that were hacked into the quoting system because StarTracker had no proper place for them.

**Examples found:**
- "Out of Service-DEF contamination"
- "Wrecked in Temptation accident 9.13.25"
- "Floor remodel Jason Quarters"

**Current status:** EXCLUDED from import.

### 5. Driver = "." Placeholder

**What it means:** 66 rows in sample data have Driver = "." — a placeholder for unassigned driver.

**Current status:** Import as blank/null in Bravo.

---

## Data Dictionary

### StarTracker Export Fields

| Field | Type | Description |
|-------|------|-------------|
| TourID | Integer | Unique quote identifier |
| CustomerName | String | Client name |
| TourName | String | Descriptive name (e.g., "May 1 - June 18, 2025") |
| Status | String | "Quote - Active", "Quote - Closed", "Contract - Committed", "Contract - Signed", "Other" |
| BusTrailer / Bus | String | Vehicle name |
| StartDate | Date | Vehicle assignment start |
| EndDate | Date | Vehicle assignment end |
| Driver | String | Assigned driver name |
| TourDays | Integer | Duration in days |
| BusDays | Integer | Billable bus days |
| BilledDays | Integer | Total billed days (may differ from BusDays for LT leases) |
| BilledMonths | Decimal | For long-term leases |
| DiscountedDays | Integer | Days discounted from billing |
| BusRate | Decimal | Daily or monthly rate |
| TourBudget / BusBudget | Decimal | Total budget for this vehicle |
| DriverDays | Integer | Billable driver days |
| DriverDHF | Integer | Driver deadhead days front |
| DriverDHR | Integer | Driver deadhead days rear |
| PerDiemTotal | Decimal | Total per diem charges |
| AdminTotal | Decimal | Admin fee (usually $0) |
| MiscTotal | Decimal | Miscellaneous charges |
| TotalMileage | Integer | Tour mileage |

---

## Future Development

### Planned Features

1. **Full Transformation Engine**
   - Transform READY quotes to Bravo import format
   - Generate quote_items with proper quote_item_type mappings
   - Output Bravo-ready CSV or direct API import

2. **Override Capability**
   - Allow user to manually override classification
   - Mark FLAGGED as READY after review
   - Move BLOCKED to READY if manually handled

3. **Bravo API Integration**
   - Push READY quotes directly to Bravo via API
   - Requires Supabase credentials in environment variables

4. **Batch Comparison**
   - Compare two batch runs to see what changed
   - Identify new quotes, resolved issues

### Waiting On

- **Discount Days feature in Bravo** — then unblock those quotes
- **Vehicle Swap feature in Bravo** — then unblock swap scenarios
- **Enhanced StarTracker export** — additional fields requested from developer

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-01 | Status "Other" = EXCLUDED | These are service records, not real quotes |
| 2025-01 | Vehicle swaps = BLOCKED | Too complex without Bravo swap feature |
| 2025-01 | DiscountedDays > 0 = BLOCKED | Bravo lacks this feature |
| 2025-01 | AdminTotal → flat fee | StarTracker uses %, Bravo uses flat; just import the total |
| 2025-01 | Driver days override → Additional Driver Days | Preserves accuracy while using existing Bravo line item type |
| 2025-01 | LT detection: BusRate >= $2K OR BilledMonths >= 6 | Multiple signals needed since StarTracker has no explicit flag |

---

## Development Notes

### Tech Stack
- **React** — UI framework
- **Vite** — Build tool
- **Tailwind CSS** — Styling
- **Lucide React** — Icons
- **localStorage** — Batch history persistence

### Key Files
- `src/App.jsx` — Main application (classification engine + UI)
- `netlify.toml` — Deployment configuration

### Local Development
```bash
npm install
npm run dev
```

### Deployment
Push to `main` branch → Netlify auto-deploys

---

## Questions for Human Review

When working on this tool, escalate to Aaron if:
1. A new classification pattern emerges that doesn't fit existing rules
2. StarTracker export format changes
3. Bravo schema changes affect transformation rules
4. Business rules need clarification

---

*Last updated: January 2025*
*Tool version: 1.1*
