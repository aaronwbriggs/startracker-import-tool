# StarTracker → Bravo Transformation Specification

> **Purpose:** This document defines exactly how to transform READY StarTracker quotes into Bravo database records. Use this as the implementation specification for the transformation feature.

---

## Table of Contents

1. [Quote Record Mapping](#quote-record-mapping)
2. [Customer Lookup/Creation](#customer-lookupcreation)
3. [Vehicle Assignment](#vehicle-assignment)
4. [Lease Creation (Contracts Only)](#lease-creation-contracts-only)
5. [Tour Creation (Short-Term Contracts Only)](#tour-creation-short-term-contracts-only)
6. [Departure Creation (Short-Term Contracts Only)](#departure-creation-short-term-contracts-only)
7. [Billing Categories](#billing-categories)
8. [Quote Line Item Mapping](#quote-line-item-mapping)
9. [Example Transformation](#example-transformation)

---

## Quote Record Mapping

### StarTracker → Bravo Field Mapping

| StarTracker Field | Bravo Column | Transformation Logic | Notes |
|-------------------|--------------|---------------------|-------|
| `TourID` | `external_id` | Direct copy as string | Store for reference |
| `TourID` | `seq_number` | Direct copy as integer | Sequence number |
| `CustomerName` | `artist_id` | Lookup/create artist, use `id` | See [Customer Lookup](#customer-lookupcreation) |
| `TourName` | `quote_name` | Direct copy | Required field |
| `Status` | `status` | Map status values (see below) | Enum conversion |
| - | `type` | Detect from data (see below) | "Short Term" or "Long Term" |
| `StartDate` | `quoted_lease_start_date` | Parse date, format as YYYY-MM-DD | Required for date calculations |
| `EndDate` | `quoted_lease_end_date` | Parse date, format as YYYY-MM-DD | Required for date calculations |
| `StartDate` | `tour_start_date` | Same as `quoted_lease_start_date` | Usually same |
| `EndDate` | `tour_end_date` | Same as `quoted_lease_end_date` | Usually same |
| `TourDays` | `quoted_lease_days` | Direct copy | Total lease days |
| `TourDays` | `tour_days` | Direct copy | Tour days |
| `BusDays` | `billed_bus_days` | Direct copy | Billable bus days |
| `BilledDays` | `billed_driver_days` | Use `DriverDays` instead | StarTracker `BilledDays` may differ |
| `DriverDays` | `main_driver_days` | Direct copy | Main driver days |
| `BilledMonths` | `quoted_lease_months` | Direct copy (if > 0) | For long-term leases |
| `TotalMileage` | `total_estimated_miles` | Direct copy | Total estimated miles |
| `DriverDHF` | `driver_deadhead_front_days` | Direct copy | Default: 0 |
| `DriverDHR` | `driver_deadhead_rear_days` | Direct copy | Default: 0 |
| - | `bus_deadhead_front_days` | Default to 0 | Not in StarTracker export |
| - | `bus_deadhead_rear_days` | Default to 0 | Not in StarTracker export |
| - | `co_driver_days` | Default to 0 | Not in StarTracker export |
| - | `main_driver_overdrives` | Default to 0 | Not in StarTracker export |
| - | `quote_number` | Generate: `Q-{customer-slug}-{seq}` | Auto-generate if not provided |
| - | `quote_description` | Optional: copy from `Notes` if exists | Optional field |
| - | `notes` | Copy if available in source | Optional field |
| - | `status` | Default to "Draft" | Can be updated later |

### Status Mapping

| StarTracker Status | Bravo Status | Notes |
|-------------------|--------------|-------|
| `Quote - Active` | `Draft` | New quotes start as Draft |
| `Quote - Closed` | `Draft` | Closed quotes → Draft for import |
| `Contract - Committed` | `Draft` | Imports as Draft, can be converted later |
| `Contract - Signed` | `Draft` | Imports as Draft, can be converted later |
| `Other` | - | EXCLUDED, never imported |

**Note:** All imported quotes start with `status = "Draft"` regardless of StarTracker status. Users can update status after review.

### Quote Type Detection

Determine `type` field based on these signals (any match = Long Term):

1. **BusRate >= $2,000** → `"Long Term"`
2. **BilledMonths >= 6** → `"Long Term"`
3. **DriverDays = 0 AND TourDays >= 180** → `"Long Term"` (no driver, long duration)

If none match → `"Short Term"`

### Required Fields Not in StarTracker

| Field | Default Value | Notes |
|-------|--------------|-------|
| `quote_name` | **Required** - Use `TourName` | Must be provided |
| `artist_id` | **Required** - Lookup/create | See customer section |
| `status` | `"Draft"` | All imports start as Draft |
| `type` | Detect from data | "Short Term" or "Long Term" |
| `created_at` | `now()` | Auto-set by database |
| `updated_at` | `now()` | Auto-set by database |

### Optional Fields

All other fields in `quotes` table are optional. Set to `null` if not available from StarTracker.

---

## Customer Lookup/Creation

### Matching Existing Customers

1. **Lookup by name:** Query `artists` table where `name` matches `CustomerName` (case-insensitive)
2. **If found:** Use existing `artist_id`
3. **If not found:** Create new artist record

### Creating New Artists

**Required fields:**
- `name` = `CustomerName` (exact copy)

**Optional fields (all null):**
- `legal_name`
- `address`
- `city`
- `state_province_id`
- `zip`

**Auto-set fields:**
- `id` = `gen_random_uuid()`
- `created_at` = `now()`
- `updated_at` = `now()`

**Implementation:**
```sql
-- Lookup
SELECT id FROM artists WHERE LOWER(name) = LOWER('{CustomerName}');

-- Create if not found
INSERT INTO artists (name) VALUES ('{CustomerName}') RETURNING id;
```

---

## Vehicle Assignment

### Coaches (Buses)

1. **Lookup coach:** Query `coaches` table where `name` matches `BusTrailer` field (case-insensitive)
2. **If found:** Use existing `coach_id`
3. **If not found:** Create new coach record (name only required)

4. **Create `quote_coaches` record:**
   - `quote_id` = created quote ID
   - `coach_id` = matched/created coach ID
   - `use_custom_tour_data` = `false` (use quote-level data by default)
   - All custom fields = `null` (unless vehicle-specific overrides needed)

### Trailers

**Note:** StarTracker `BusTrailer` field may contain either coach or trailer name. Distinguish by:
- Checking if name exists in `coaches` table
- If not in coaches, check/create in `trailers` table
- If in both or ambiguous, treat as coach

**For trailers:**
1. **Lookup trailer:** Query `trailers` table where `name` matches
2. **If found:** Use existing `trailer_id`
3. **If not found:** Create new trailer record
4. **Create `quote_trailers` record:**
   - `quote_id` = created quote ID
   - `trailer_id` = matched/created trailer ID

---

## Lease Creation (Contracts Only)

### When to Create a Lease

| StarTracker Status | Create Lease? | Bravo Quote Status | Bravo Lease Status |
|--------------------|---------------|--------------------|--------------------|
| Quote - Active | No | Draft | — |
| Quote - Closed | No | Draft | — |
| Contract - Verbal | **Yes** | Converted | Draft |
| Contract - Committed | **Yes** | Converted | Draft |
| Contract - Signed | **Yes** | Converted | Fully Executed |

### Lease Record Fields

| Field | Source | Notes |
|-------|--------|-------|
| `quote_id` | Created quote ID | Required FK |
| `status` | See mapping above | "Draft" or "Fully Executed" |
| `lease_start_date` | StarTracker StartDate | |
| `lease_end_date` | StarTracker EndDate | |
| `created_at` | `now()` | Auto-set |
| `updated_at` | `now()` | Auto-set |

### Lease Coaches / Lease Trailers

For each `quote_coach` or `quote_trailer`, create corresponding `lease_coach` or `lease_trailer`:

```json
{
  "lease_id": "created-lease-id",
  "coach_id": "from-quote-coach",
  "use_custom_tour_data": false
}
```

---

## Tour Creation (Short-Term Contracts Only)

### When to Create a Tour

- **Short-Term + Contract status** → Create Tour
- **Long-Term** → No Tour (tours created later when artist books usage)
- **Quote only (not contract)** → No Tour

### Tour Record Fields

| Field | Source | Notes |
|-------|--------|-------|
| `lease_id` | Created lease ID | Required FK |
| `name` | StarTracker TourName | |
| `status` | "Leased" | All imported tours are leased |
| `start_date` | StarTracker StartDate | |
| `end_date` | StarTracker EndDate | |
| `tour_days` | StarTracker TourDays | |
| `total_estimated_miles` | StarTracker TotalMileage | |
| `created_at` | `now()` | Auto-set |
| `updated_at` | `now()` | Auto-set |

### Single vs Multiple Tours

**Single Tour (Default):**
All vehicles in the quote share identical tour details:
- Same StartDate, EndDate
- Same TourDays, TotalMileage

→ Create ONE tour, link all vehicles to it

**Multiple Tours (Custom):**
Vehicles have different tour details. Detection:
- Different StartDate or EndDate across vehicles
- Different TourDays or TotalMileage

→ Set `use_custom_tour_data = true` on each `lease_coach`/`lease_trailer`
→ Store per-vehicle dates in the junction record

---

## Departure Creation (Short-Term Contracts Only)

### When to Create Departures

For each Tour, create one Departure per coach (not trailers).

### Departure Record Fields

| Field | Source | Notes |
|-------|--------|-------|
| `tour_id` | Created tour ID | Required FK |
| `coach_id` | From lease_coach | One departure per coach |
| `status` | "Confirmed" | Imported departures are confirmed |
| `departure_date` | StarTracker StartDate | |
| `return_date` | StarTracker EndDate | |
| `created_at` | `now()` | Auto-set |
| `updated_at` | `now()` | Auto-set |

### Workflow Steps

Bravo auto-creates workflow steps when departures are created. No manual creation needed during import.

### Driver Assignment

**Current Decision:** Skip driver assignment during import.

Reason: Driver matching complexity (name variations, availability verification). Leasing team will assign drivers manually post-import.

---

## Billing Categories

### StarTracker Categories → Bravo Categories

| StarTracker Category | Bravo billing_category |
|---------------------|------------------------|
| Included in Contract | "Contracted" |
| Driver Collect | "Client Responsibility" |
| Client Responsibility | "Client Responsibility" |

**Note:** StarTracker has 3 categories; Bravo has 2. Both "Driver Collect" and "Client Responsibility" map to Bravo's "Client Responsibility".

### Applying to Line Items

Each line item in StarTracker export includes a `_BillingCat` suffix field (e.g., `BusRate_BillingCat`).

When creating `quote_line_items`:
```
If BillingCat = "Included in Contract" → billing_category = "Contracted"
If BillingCat = "Driver Collect" → billing_category = "Client Responsibility"
If BillingCat = "Client Responsibility" → billing_category = "Client Responsibility"
If BillingCat is null/empty → billing_category = "Contracted" (default)
```

**Note:** Current StarTracker export doesn't include per-line billing categories. Enhanced export requested.

---

## Quote Line Item Mapping

### Line Item Type Lookup Table

Use these UUIDs when creating `quote_line_items` (lookup by `item_name` from `quote_item_types`):

| Item Name | UUID | Unit Type | Use Case |
|-----------|------|-----------|----------|
| **Coach Rate, Daily** | `08de2042-f98b-447a-8193-005d0e8f48c0` | Per Day | Short-term coach rate |
| **Coach Rate, Monthly** | `cb91a76f-0acc-47a1-8d38-34cf7cad593c` | Per Month | Long-term coach rate |
| **Driver Rate, Daily** | `96dc0032-6f68-4bf7-9231-955bf50dac35` | Per Day | Driver wages |
| **Additional Driver Days** | `974656c1-557d-4c57-9a37-0cf19701bd90` | Per Quantity | Extra driver days |
| **Admin Fee** | `fc624aee-7f8f-4adf-b8f8-4a28e4acb214` | Flat Rate | Admin fee |
| **Miscellaneous** | `d0ec922a-0b6e-4406-b3f5-59b178b1a698` | Flat Rate | Misc charges |

**Implementation:** Query `quote_item_types` table by `item_name` to get `id` dynamically (don't hardcode UUIDs).

### StarTracker → Quote Line Items Mapping

#### 1. Coach Rate (Per Vehicle)

**For Short-Term Leases:**
- **Item Type:** "Coach Rate, Daily" (`08de2042-f98b-447a-8193-005d0e8f48c0`)
- **Quantity:** `BusDays`
- **Rate:** `BusRate`
- **Calculation:** `quantity × rate = BusDays × BusRate`
- **Link to:** `quote_coach_id` (vehicle-specific)

**For Long-Term Leases:**
- **Item Type:** "Coach Rate, Monthly" (`cb91a76f-0acc-47a1-8d38-34cf7cad593c`)
- **Quantity:** `BilledMonths`
- **Rate:** `BusRate`
- **Calculation:** `quantity × rate = BilledMonths × BusRate`
- **Link to:** `quote_coach_id` (vehicle-specific)

#### 2. Driver Rate

**Driver Days Calculation:**
```
BaseDriverDays = TourDays + DriverDHF + DriverDHR
AdditionalDriverDays = DriverDays - BaseDriverDays
```

**If AdditionalDriverDays = 0:**
- **Item Type:** "Driver Rate, Daily" (`96dc0032-6f68-4bf7-9231-955bf50dac35`)
- **Quantity:** `DriverDays`
- **Rate:** `PerDiemTotal / DriverDays` (calculate from StarTracker data)
- **Calculation:** `quantity × rate = DriverDays × (PerDiemTotal / DriverDays) = PerDiemTotal`
- **Link to:** `quote_coach_id` (vehicle-specific)

**If AdditionalDriverDays > 0:**
- **Item 1:** "Driver Rate, Daily"
  - **Quantity:** `BaseDriverDays` (TourDays + DriverDHF + DriverDHR)
  - **Rate:** `PerDiemTotal / DriverDays`
- **Item 2:** "Additional Driver Days" (`974656c1-557d-4c57-9a37-0cf19701bd90`)
  - **Quantity:** `AdditionalDriverDays`
  - **Rate:** `PerDiemTotal / DriverDays` (same rate)
  - **Link to:** `quote_coach_id`

**If AdditionalDriverDays < 0:**
- **FLAG for review** (unexpected - driver days less than base calculation)

#### 3. Admin Fee

**If AdminTotal > 0:**
- **Item Type:** "Admin Fee" (`fc624aee-7f8f-4adf-b8f8-4a28e4acb214`)
- **Quantity:** `1`
- **Rate:** `AdminTotal`
- **Calculation:** `1 × AdminTotal = AdminTotal`
- **Link to:** `quote_id` only (quote-level, not vehicle-specific)

#### 4. Miscellaneous

**If MiscTotal > 0:**
- **Item Type:** "Miscellaneous" (`d0ec922a-0b6e-4406-b3f5-59b178b1a698`)
- **Quantity:** `1`
- **Rate:** `MiscTotal`
- **Calculation:** `1 × MiscTotal = MiscTotal`
- **Link to:** `quote_id` only (quote-level)

#### 5. Other Charges (Not in StarTracker Export)

The following line items are **not** created from StarTracker data (they're auto-generated or manual in Bravo):
- Satellite Service
- Internet Service
- Insurance
- IFTA/DOT Fee
- Fuel Estimate
- Engine Services
- Cleanings/Washes
- Per Diems (separate from driver rate)
- Hotel Buy Outs
- Overdrives
- Tolls

**Note:** Only create line items that can be directly mapped from StarTracker fields. Don't create items that require Bravo-specific calculations or defaults.

### Line Item Field Mapping

For each `quote_line_items` record:

| Field | Value | Notes |
|-------|-------|-------|
| `quote_id` | Created quote ID | Required - FK to quotes |
| `quote_item_type_id` | Lookup by item_name | Required - FK to quote_item_types |
| `quote_coach_id` | Coach junction ID | If vehicle-specific (coach charges) |
| `quote_trailer_id` | Trailer junction ID | If vehicle-specific (trailer charges) |
| `quantity` | Calculated from StarTracker | Per mapping rules above |
| `rate` | Calculated from StarTracker | Per mapping rules above |
| `billing_category` | `"Contracted"` | Default for all StarTracker imports |
| `unit_type` | From quote_item_type | Auto-populated from type |
| `is_automatic` | `false` | Manual import, not auto-generated |
| `user_deleted` | `false` | Active item |
| `created_at` | `now()` | Auto-set |
| `updated_at` | `now()` | Auto-set |

---

## Example Transformation

### Input: TourID 30001 from test_ready.csv

**StarTracker CSV Row:**
```csv
TourID,CustomerName,TourName,Status,BusTrailer,StartDate,EndDate,Driver,TourDays,BusDays,BilledDays,DiscountedDays,BusRate,TourBudget,DriverDays,DriverDHF,DriverDHR,PerDiemTotal,AdminTotal,TotalMileage,BilledMonths
30001,Acme Tours,Spring Tour 2025,Contract - Committed,Silverado,3/1/2025,3/15/2025,Smith John,14,14,14,0,450,6300,16,1,1,800,0,2500,0
```

### Step 1: Customer Lookup/Creation

**Lookup:**
```sql
SELECT id FROM artists WHERE LOWER(name) = 'acme tours';
```

**If not found, create:**
```json
{
  "name": "Acme Tours",
  "legal_name": null,
  "address": null,
  "city": null,
  "state_province_id": null,
  "zip": null
}
```

**Result:** `artist_id = "abc123-artist-id-uuid"` (example)

### Step 2: Quote Type Detection

- BusRate = $450 (< $2,000) → Short Term
- BilledMonths = 0 → Short Term
- DriverDays = 16 (> 0) → Short Term

**Result:** `type = "Short Term"`

### Step 3: Create Quote Record

```json
{
  "artist_id": "abc123-artist-id-uuid",
  "quote_name": "Spring Tour 2025",
  "external_id": "30001",
  "seq_number": 30001,
  "status": "Draft",
  "type": "Short Term",
  "quoted_lease_start_date": "2025-03-01",
  "quoted_lease_end_date": "2025-03-15",
  "tour_start_date": "2025-03-01",
  "tour_end_date": "2025-03-15",
  "quoted_lease_days": 14,
  "tour_days": 14,
  "billed_bus_days": 14,
  "main_driver_days": 16,
  "billed_driver_days": 16,
  "total_estimated_miles": 2500,
  "driver_deadhead_front_days": 1,
  "driver_deadhead_rear_days": 1,
  "bus_deadhead_front_days": 0,
  "bus_deadhead_rear_days": 0,
  "co_driver_days": 0,
  "main_driver_overdrives": 0,
  "quote_number": null,
  "quote_description": null,
  "notes": null
}
```

**Result:** `quote_id = "def456-quote-id-uuid"` (example)

### Step 4: Vehicle Assignment

**Lookup coach:**
```sql
SELECT id FROM coaches WHERE LOWER(name) = 'silverado';
```

**If not found, create:**
```json
{
  "name": "Silverado",
  "make": null,
  "model": null,
  "status": "active"
}
```

**Result:** `coach_id = "ghi789-coach-id-uuid"` (example)

**Create quote_coaches:**
```json
{
  "quote_id": "def456-quote-id-uuid",
  "coach_id": "ghi789-coach-id-uuid",
  "use_custom_tour_data": false
}
```

**Result:** `quote_coach_id = "jkl012-quote-coach-id-uuid"` (example)

### Step 5: Create Line Items

#### Line Item 1: Coach Rate, Daily

**Driver Days Calculation:**
- BaseDriverDays = 14 + 1 + 1 = 16
- DriverDays = 16
- AdditionalDriverDays = 16 - 16 = 0 (no additional days needed)

**Coach Rate:**
```json
{
  "quote_id": "def456-quote-id-uuid",
  "quote_item_type_id": "08de2042-f98b-447a-8193-005d0e8f48c0",  // Coach Rate, Daily
  "quote_coach_id": "jkl012-quote-coach-id-uuid",
  "quantity": 14,        // BusDays
  "rate": 450,           // BusRate
  "billing_category": "Contracted",
  "unit_type": "Per Day",
  "is_automatic": false,
  "user_deleted": false
}
```
**Calculation:** 14 × $450 = $6,300 ✓ (matches TourBudget)

#### Line Item 2: Driver Rate, Daily

**Driver Rate Calculation:**
- Rate = PerDiemTotal / DriverDays = $800 / 16 = $50/day

```json
{
  "quote_id": "def456-quote-id-uuid",
  "quote_item_type_id": "96dc0032-6f68-4bf7-9231-955bf50dac35",  // Driver Rate, Daily
  "quote_coach_id": "jkl012-quote-coach-id-uuid",
  "quantity": 16,        // DriverDays
  "rate": 50,            // PerDiemTotal / DriverDays = 800 / 16
  "billing_category": "Contracted",
  "unit_type": "Per Day",
  "is_automatic": false,
  "user_deleted": false
}
```
**Calculation:** 16 × $50 = $800 ✓ (matches PerDiemTotal)

#### Line Item 3: Admin Fee (SKIPPED)

- AdminTotal = 0, so no Admin Fee line item is created.

#### Line Item 4: Miscellaneous (SKIPPED)

- MiscTotal not in CSV (assumed 0), so no Miscellaneous line item is created.

### Complete Output Summary

**Records to Create:**
1. **1 artist record** (if not exists): Acme Tours
2. **1 quote record**: Spring Tour 2025 quote
3. **1 quote_coaches record**: Link quote to Silverado coach
4. **2 quote_line_items records**: Coach Rate + Driver Rate

**Total:** 4-5 records (depending on whether artist/coach already exist)

### Example: Contract - Signed (Full Flow)

**Input: TourID 30002 (hypothetical contract version)**

```csv
TourID,CustomerName,TourName,Status,BusTrailer,StartDate,EndDate,...
30002,Beta Productions,Summer Run,Contract - Signed,Maverick,6/1/2025,6/20/2025,...
```

**Step 1-5:** Same as READY quote example (create artist, quote, quote_coach, line items)

**Step 6: Update Quote Status**
```json
{
  "status": "Converted"
}
```

**Step 7: Create Lease**
```json
{
  "quote_id": "def456-quote-id",
  "status": "Fully Executed",
  "lease_start_date": "2025-06-01",
  "lease_end_date": "2025-06-20"
}
```
Result: `lease_id = "aaa111-lease-id"`

**Step 8: Create Lease Coach**
```json
{
  "lease_id": "aaa111-lease-id",
  "coach_id": "ghi789-coach-id",
  "use_custom_tour_data": false
}
```

**Step 9: Create Tour** (Short-Term only)
```json
{
  "lease_id": "aaa111-lease-id",
  "name": "Summer Run",
  "status": "Leased",
  "start_date": "2025-06-01",
  "end_date": "2025-06-20",
  "tour_days": 19,
  "total_estimated_miles": 3200
}
```
Result: `tour_id = "bbb222-tour-id"`

**Step 10: Create Departure** (One per coach)
```json
{
  "tour_id": "bbb222-tour-id",
  "coach_id": "ghi789-coach-id",
  "status": "Confirmed",
  "departure_date": "2025-06-01",
  "return_date": "2025-06-20"
}
```

**Complete Record Count for Contract - Signed:**
- 1 artist (if new)
- 1 quote (status: Converted)
- 1 quote_coach
- 2 quote_line_items
- 1 lease (status: Fully Executed)
- 1 lease_coach
- 1 tour (status: Leased)
- 1 departure (status: Confirmed)
- N workflow_steps (auto-created by Bravo)

**Total:** 9+ records per single-vehicle contract

---

## Implementation Notes

### Lookup Strategy

1. **Always lookup first** before creating to avoid duplicates
2. **Use case-insensitive matching** for names
3. **Cache lookups** during batch import for performance

### Error Handling

- **Missing required fields:** Skip quote, log error
- **Invalid dates:** Parse errors → log and skip
- **Vehicle not found:** Create new vehicle with name only
- **Customer not found:** Create new artist with name only

### Transaction Handling

- **Wrap in transaction:** All records for one quote should be created atomically
- **Rollback on error:** If any record fails, rollback entire quote import
- **Batch commits:** For multiple quotes, commit in batches (e.g., 10 quotes per transaction)

### Validation

Before creating records, validate:
- `quote_name` + `artist_id` is unique (Bravo constraint)
- Date ranges are valid (`tour_end_date >= tour_start_date`)
- Numeric fields are non-negative where required
- Required foreign keys exist (artist_id, quote_item_type_id)

### Creation Order (Transaction)

For contracts, create records in this order to satisfy FK constraints:

1. Artist (if not exists)
2. Coach/Trailer (if not exists)
3. Quote
4. Quote Coaches / Quote Trailers
5. Quote Line Items
6. Lease
7. Lease Coaches / Lease Trailers
8. Tour (short-term only)
9. Departures (short-term only)

Wrap entire sequence in a transaction. Rollback if any step fails.

### Status Transitions

After successful import:
- Quote status = "Converted" (for contracts)
- Lease status = "Draft" or "Fully Executed"
- Tour status = "Leased"
- Departure status = "Confirmed"

### What NOT to Create

- **Driver Assignments** — Manual post-import
- **Invoices** — Generated through normal Bravo workflow
- **DocuSign envelopes** — External agreements tracked separately
- **Workflow step completions** — Let ops team work through normally

---

*Last updated: January 2025*
*Source: CONTEXT.md, BRAVO_SCHEMA.md, Supabase DEV database*
