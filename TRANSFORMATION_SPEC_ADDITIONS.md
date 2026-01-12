# TRANSFORMATION_SPEC.md — Additional Sections

Add these sections to the existing TRANSFORMATION_SPEC.md to cover Tours, Departures, and Lease creation.

---

## Add After "Vehicle Assignment" Section:

```markdown
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
| `created_at` | now() | Auto-set |
| `updated_at` | now() | Auto-set |

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
| `created_at` | now() | Auto-set |
| `updated_at` | now() | Auto-set |

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
| `created_at` | now() | Auto-set |
| `updated_at` | now() | Auto-set |

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
```

---

## Update: Example Transformation Section

Add this after the existing example to show Contract flow:

```markdown
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
```

---

## Update: Implementation Notes

Add this to the Implementation Notes section:

```markdown
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
```
