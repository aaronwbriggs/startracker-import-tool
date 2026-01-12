# Bravo Database Schema Reference

> **Purpose:** This document describes the Bravo database schema for tables relevant to importing quotes from StarTracker. Use this as the target reference when building transformation logic.

---

## Table of Contents

1. [quotes](#quotes)
2. [quote_line_items](#quote_line_items)
3. [quote_item_types](#quote_item_types)
4. [artists (customers)](#artists-customers)
5. [Vehicles](#vehicles)
   - [coaches](#coaches)
   - [quote_coaches](#quote_coaches)
   - [quote_trailers](#quote_trailers)

---

## quotes

The main quote/lease table. Each row represents a single quote for a customer.

### Columns

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `artist_id` | `uuid` | YES | - | **Required** - FK to `artists.id` |
| `quote_name` | `text` | YES | - | **Required** - Display name for quote |
| `quote_description` | `text` | YES | - | Optional description/notes |
| `quote_number` | `text` | YES | - | Human-readable quote number |
| `external_id` | `text` | YES | - | External system ID (StarTracker TourID) |
| `seq_number` | `integer` | YES | - | Sequence number |
| `status` | `quote_status_enum` | YES | - | Quote status (see enum values below) |
| `type` | `quote_type_enum` | YES | - | Lease type: "Short Term" or "Long Term" |
| `quoted_lease_start_date` | `date` | YES | - | Start date of lease period |
| `quoted_lease_end_date` | `date` | YES | - | End date of lease period |
| `quoted_lease_days` | `integer` | YES | - | Total lease days |
| `quoted_lease_weeks` | `integer` | YES | - | Total lease weeks |
| `quoted_lease_months` | `numeric(12,2)` | YES | - | Total lease months (for LT) |
| `tour_start_date` | `date` | YES | - | Tour start date |
| `tour_end_date` | `date` | YES | - | Tour end date |
| `starting_location` | `text` | YES | - | Starting location |
| `ending_location` | `text` | YES | - | Ending location |
| `total_estimated_miles` | `numeric(10,2)` | YES | - | Total estimated miles |
| `bus_deadhead_front_days` | `integer` | YES | `0` | Bus deadhead days (front) |
| `bus_deadhead_rear_days` | `integer` | YES | `0` | Bus deadhead days (rear) |
| `driver_deadhead_front_days` | `integer` | YES | `0` | Driver deadhead days (front) |
| `driver_deadhead_rear_days` | `integer` | YES | `0` | Driver deadhead days (rear) |
| `co_driver_days` | `integer` | YES | `0` | Co-driver days |
| `tour_days` | `integer` | YES | - | Tour days |
| `tour_weeks` | `integer` | YES | - | Tour weeks |
| `tour_months` | `numeric(10,2)` | YES | - | Tour months |
| `billed_bus_days` | `integer` | YES | - | Billable bus days |
| `main_driver_days` | `integer` | YES | - | Main driver days |
| `billed_driver_days` | `integer` | YES | - | Billable driver days |
| `main_driver_overdrives` | `integer` | YES | `0` | Main driver overdrives |
| `notes` | `text` | YES | - | General notes |
| `lost_reason_id` | `uuid` | YES | - | FK to `quote_lost_reasons.id` (required if status = Declined/Expired) |
| `conflict_override_reason` | `text` | YES | - | Reason for conflict override |
| `conflict_override_date` | `timestamptz` | YES | - | Date override was approved |
| `conflict_override_approved_by` | `uuid` | YES | - | User who approved override |
| `status_changed_at` | `timestamptz` | YES | - | When status was last changed |
| `status_changed_by` | `uuid` | YES | - | User who changed status |
| `created_at` | `timestamptz` | NO | `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NO | `now()` | Last update timestamp |
| `created_by` | `uuid` | YES | - | User who created record |
| `updated_by` | `uuid` | YES | - | User who last updated |

### Foreign Keys

- `artist_id` → `artists.id`
- `lost_reason_id` → `quote_lost_reasons.id`

### Constraints

- **Required fields:** `quote_name` AND `artist_id` (enforced by check constraint)
- **Unique constraint:** `(quote_name, artist_id)` - quote names must be unique per artist
- **Lost reason required:** If `status` = 'Declined' or 'Expired', `lost_reason_id` must be provided
- **Deadhead days range:** All deadhead day fields must be between 0 and 30
- **Tour dates:** `tour_end_date >= tour_start_date` (if both are present)
- **Overdrives:** `main_driver_overdrives >= 0`

### Enum Types

**`quote_status_enum`:**
- `Draft`
- `Sent`
- `Approved`
- `Declined` (requires `lost_reason_id`)
- `Expired` (requires `lost_reason_id`)
- `Converted`

**`quote_type_enum`:**
- `Short Term`
- `Long Term`

### Example Row

```json
{
  "id": "5ee25e49-af57-45ae-b3b1-7ff8b317bacb",
  "artist_id": "0b8ebead-d963-41c9-b0f2-fbf86dbf6166",
  "quote_name": "Trey Anastasio Short-Term Lease - Nov 13, 2025 to Nov 30, 2025",
  "quote_number": "Q-TREY-ANASTASIO-001-251027",
  "external_id": null,
  "status": "Converted",
  "type": "Short Term",
  "quoted_lease_start_date": "2025-11-10",
  "quoted_lease_end_date": "2025-12-02",
  "quoted_lease_days": 23,
  "tour_start_date": "2025-11-13",
  "tour_end_date": "2025-11-30",
  "total_estimated_miles": "4900.00",
  "bus_deadhead_front_days": 3,
  "bus_deadhead_rear_days": 2,
  "driver_deadhead_front_days": 3,
  "driver_deadhead_rear_days": 2,
  "tour_days": 18,
  "billed_bus_days": 23,
  "main_driver_days": 23,
  "billed_driver_days": 23,
  "main_driver_overdrives": 0
}
```

### Import Notes

- **StarTracker TourID mapping:** Store in `external_id` field for reference
- **Required fields for import:** `artist_id` (must exist or be created), `quote_name`
- **Quote type detection:** Set based on lease duration and rate patterns (see CONTEXT.md)
- **Unique constraint:** Ensure `(quote_name, artist_id)` combination is unique
- **Date fields:** Map StarTracker StartDate/EndDate to `quoted_lease_start_date`/`quoted_lease_end_date`
- **Days calculation:** Map StarTracker TourDays → `quoted_lease_days`, BusDays → `billed_bus_days`

---

## quote_line_items

Line items (charges) for a quote. Each row represents one chargeable item.

### Columns

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `quote_id` | `uuid` | NO | - | **Required** - FK to `quotes.id` |
| `quote_item_type_id` | `uuid` | YES | - | FK to `quote_item_types.id` |
| `quote_coach_id` | `uuid` | YES | - | FK to `quote_coaches.id` (if vehicle-specific) |
| `quote_trailer_id` | `uuid` | YES | - | FK to `quote_trailers.id` (if trailer-specific) |
| `quantity` | `numeric` | YES | - | Quantity for this line item |
| `rate` | `numeric` | YES | - | Rate per unit |
| `billing_category` | `billing_category_enum` | YES | - | "Contracted" or "Client Responsibility" |
| `unit_type` | `unit_type_enum` | YES | - | Unit type (see enum values below) |
| `auto_generated_from_vehicle_type` | `auto_generated_vehicle_type_enum` | YES | - | If auto-generated: "coach" or "trailer" |
| `is_automatic` | `boolean` | NO | `false` | Whether item was auto-generated |
| `custom_sort_order` | `integer` | YES | - | Custom display order |
| `user_deleted` | `boolean` | NO | `false` | Soft delete flag |
| `created_at` | `timestamptz` | NO | `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NO | `now()` | Last update timestamp |
| `created_by` | `uuid` | YES | - | User who created record |
| `updated_by` | `uuid` | YES | - | User who last updated |

### Foreign Keys

- `quote_id` → `quotes.id`
- `quote_item_type_id` → `quote_item_types.id`
- `quote_coach_id` → `quote_coaches.id`
- `quote_trailer_id` → `quote_trailers.id`

### Enum Types

**`billing_category_enum`:**
- `Contracted` - Celebrity charges for this
- `Client Responsibility` - Client pays directly

**`unit_type_enum`:**
- `Per Day`
- `Per Week`
- `Per Month`
- `Per Mile`
- `Per Quantity`
- `Flat Rate`

**`auto_generated_vehicle_type_enum`:**
- `coach`
- `trailer`

### Example Row

```json
{
  "id": "7c10347b-82e3-4fd9-8039-98650eda74f0",
  "quote_id": "2da4ca0d-f6c0-4cc0-a3bd-33466d48fa2b",
  "quote_item_type_id": "716f69df-410f-4e51-bcdb-b29811b58f71",
  "quote_coach_id": "d29ddf29-d239-4853-944d-cc523f5a0566",
  "quote_trailer_id": null,
  "quantity": "4.00",
  "rate": "50.00",
  "billing_category": "Contracted",
  "unit_type": "Per Day",
  "is_automatic": false,
  "user_deleted": false
}
```

### Import Notes

- **Vehicle-specific items:** Link via `quote_coach_id` or `quote_trailer_id` if the charge applies to a specific vehicle
- **Quote-level items:** Leave `quote_coach_id` and `quote_trailer_id` null for quote-wide charges
- **Calculation:** `total = quantity × rate`
- **StarTracker mapping:** See CONTEXT.md transformation rules for field mappings

---

## quote_item_types

Defines all valid line item types that can be used in quotes. This is a reference/lookup table.

### Columns

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `item_name` | `text` | NO | - | **Required, Unique** - Name of the line item type |
| `description` | `text` | YES | - | Description of what this item represents |
| `status` | `text` | NO | - | "Available" or "Deprecated" |
| `billing_category` | `billing_category_enum` | YES | - | "Contracted" or "Client Responsibility" |
| `unit_type` | `unit_type_enum` | YES | - | Unit type (Per Day, Per Month, etc.) |
| `required_for` | `required_for_enum` | YES | - | "Short Term Quotes", "Long Term Quotes", or "Both" |
| `vehicle_type` | `vehicle_type_enum` | YES | - | "coach", "trailer", "any", or "both" |
| `is_automatic` | `boolean` | NO | `false` | Whether this item is auto-generated |
| `default_quantity` | `numeric(12,2)` | YES | - | Default quantity if applicable |
| `prepopulated_rate` | `numeric(12,2)` | YES | - | Default rate if applicable |
| `minimum_quantity` | `numeric(12,2)` | YES | - | Minimum allowed quantity |
| `payroll_coded` | `boolean` | YES | `false` | Whether this is payroll-related |
| `rate_source` | `text` | YES | - | Source for auto-populated rate (e.g., "coach_pricing.default_day_rate") |
| `quantity_source_quote_field` | `text` | NO | - | Quote field to pull quantity from |
| `quantity_source_coach_field` | `text` | YES | - | Quote_coach field to pull quantity from |
| `sort_order` | `integer` | YES | `999` | Display order |
| `pdf_display_name` | `text` | YES | - | Name to show on PDFs |
| `invoice_description_template` | `text` | YES | - | Template for invoice descriptions |
| `default_invoice_description` | `text` | YES | - | Default invoice description |
| `created_at` | `timestamptz` | NO | `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NO | `now()` | Last update timestamp |
| `created_by` | `uuid` | YES | - | User who created record |
| `updated_by` | `uuid` | YES | - | User who last updated |

### Constraints

- **Required fields:** `item_name`, `status`, `quantity_source_quote_field`
- **Unique constraint:** `item_name` must be unique
- **Status check:** `status` must be "Available" or "Deprecated" (or NULL)
- **Rate source format:** If `rate_source` is provided, must match pattern: `[a-z_]+\.(default_[a-z_]+_rate|default_internet_[a-z_]+_rate)`
- **Quantity source fields:** Must reference valid quote or quote_coach fields (enforced by check constraints)

### Enum Types

**`required_for_enum`:**
- `Short Term Quotes`
- `Long Term Quotes`
- `Both`

**`vehicle_type_enum`:**
- `coach`
- `trailer`
- `any`
- `both`

### All Valid Item Types (Available Only)

| Item Name | Unit Type | Required For | Vehicle Type | StarTracker Mapping |
|-----------|-----------|--------------|--------------|---------------------|
| **Coach Rate, Daily** | Per Day | Short Term Quotes | coach | BusRate × BusDays |
| **Coach Rate, Monthly** | Per Month | Long Term Quotes | coach | BusRate × BilledMonths |
| **Trailer Rate, Daily** | Per Day | Short Term Quotes | trailer | Trailer rate × days |
| **Trailer Rate, Monthly** | Per Month | Long Term Quotes | trailer | Trailer rate × months |
| **Driver Rate, Daily** | Per Day | Both | coach | DriverDays × PerDiemRate |
| **Driver Rate, Monthly** | Per Month | Long Term Quotes | coach | (Usually $0 for LT) |
| **Daily Driver Pay Increase for Trailer** | Per Day | Both | trailer | Additional $50/day with trailer |
| **Co-Driver Rate, Daily** | Per Day | Short Term Quotes | coach | CoDriverDays × rate |
| **IFTA/DOT Fee, Daily** | Per Day | Short Term Quotes | coach | IFTA/DOT charges |
| **IFTA/DOT Fee, Monthly** | Per Month | Long Term Quotes | coach | IFTA/DOT charges |
| **Satellite Service, Daily** | Per Day | Short Term Quotes | coach | SatelliteRate × days |
| **Satellite Service, Monthly** | Per Month | Long Term Quotes | coach | SatelliteRate × months |
| **Internet Service, Daily** | Per Day | Short Term Quotes | coach | InternetRate × days |
| **Internet Service, Monthly** | Per Month | Long Term Quotes | coach | InternetRate × months |
| **Insurance, Daily** | Per Day | Short Term Quotes | coach | InsuranceRate × days |
| **Insurance, Monthly** | Per Month | Long Term Quotes | coach | InsuranceRate × months |
| **Interior Cleanings** | Per Week | Short Term Quotes | coach | Weekly cleaning charges |
| **Bus Washes** | Per Week | Short Term Quotes | coach | Weekly wash charges |
| **Weekly Trailer Wash** | Per Week | Both | trailer | Weekly trailer wash |
| **Linen Cleanings** | Per Week | Short Term Quotes | coach | Weekly linen charges |
| **Generator Services** | Per Week | Both | coach | Weekly generator service |
| **Fuel Estimate** | Per Mile | Both | coach | TotalMileage × fuel rate |
| **Engine Services** | Per Mile | Both | coach | TotalMileage × engine rate |
| **Driver Hotel Buy Outs** | Per Quantity | Short Term Quotes | coach | Hotel buyout charges |
| **Co-Driver Hotel Buy Outs** | Per Quantity | Short Term Quotes | coach | Co-driver hotel charges |
| **Driver Overdrives** | Per Quantity | Short Term Quotes | coach | Overdrive charges |
| **Co-Driver Overdrives** | Per Quantity | Short Term Quotes | coach | Co-driver overdrives |
| **Additional Driver Days** | Per Quantity | Short Term Quotes | coach | Extra driver days beyond base calculation |
| **Upholstery Cleaning** | Flat Rate | Short Term Quotes | coach | One-time cleaning fee |
| **End of Tour Cleaning** | Flat Rate | Short Term Quotes | coach | End-of-tour cleaning |
| **Bed Kit Install / Bunk Change Fee** | Flat Rate | Short Term Quotes | coach | Bunk change fee |
| **Driver Per Diem** | Per Day | Short Term Quotes | coach | Per diem for driver |
| **Co-Driver Per Diems** | Per Day | Short Term Quotes | coach | Per diem for co-driver |
| **Per Diems, Combined** | Flat Rate | Short Term Quotes | coach | Combined per diem total |
| **Tolls** | Flat Rate | Short Term Quotes | coach | Estimated toll charges |
| **Miscellaneous** | Flat Rate | Both | any | MiscTotal |
| **Monthly Parking and Shore Power** | Per Month | Long Term Quotes | coach | Monthly parking/shore power |
| **Admin Fee** | Flat Rate | Both | any | AdminTotal |

### Deprecated Items (Do Not Use)

The following items exist but are marked "Deprecated" - do not use for new imports:
- Co-Driver Rate, Monthly
- Generator Services, Shop
- Miscellaneous 2
- Miscellaneous 3
- TEST DRIVER COLLECT ITEM
- TEST CLIENT RESPONSIBILITY ITEM
- TEST PER QUANT ITEM FOR LONG TERM
- TEST NEW ITEM VIA ADMIN
- TEST
- Marc Test
- TEST PER DAY ADDED MANUALLY
- TEST PER WEEK ADDED MANUALLY
- TEST PER MONTH ITEM ADDED MANUALLY
- TEST PER MILE ADDED MANUALLY

### Import Notes

- **Lookup by name:** Use `item_name` field to find the correct `quote_item_type_id` when creating line items
- **StarTracker field mapping:** See CONTEXT.md transformation rules for detailed mappings
- **Additional Driver Days:** Use this when `DriverDays > (TourDays + DriverDHF + DriverDHR)`
- **Admin Fee:** Map StarTracker `AdminTotal` to "Admin Fee" with `quantity=1, rate=AdminTotal`
- **Per Quantity items:** For items like "Additional Driver Days", set `quantity` to the count and `rate` to the daily rate

---

## artists (customers)

The `artists` table represents customers (clients) in Bravo. Note: Bravo uses "artists" as the term, not "customers".

### Columns

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `name` | `text` | NO | - | **Required** - Customer/artist name |
| `legal_name` | `text` | YES | - | Legal business name |
| `address` | `text` | YES | - | Street address |
| `city` | `text` | YES | - | City |
| `state_province_id` | `varchar(6)` | YES | - | FK to `states_provinces.iso_code` |
| `zip` | `text` | YES | - | ZIP/postal code |
| `created_at` | `timestamptz` | NO | `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NO | `now()` | Last update timestamp |
| `created_by` | `uuid` | YES | - | User who created record |
| `updated_by` | `uuid` | YES | - | User who last updated |

### Foreign Keys

- `state_province_id` → `states_provinces.iso_code`

### Constraints

- **Required fields:** `name`

### Example Row

```json
{
  "id": "2fb080fd-1cb1-4b9c-9250-719fa7f8fc5a",
  "name": "Zach Williams",
  "legal_name": null,
  "address": null,
  "city": null,
  "state_province_id": null,
  "zip": null
}
```

### Import Notes

- **Matching existing customers:** Match StarTracker `CustomerName` to `artists.name` (case-insensitive)
- **Creating new customers:** Only `name` is required. All other fields are optional.
- **Required for quotes:** Every quote must have a valid `artist_id` - either match existing or create new customer first
- **Duplicate handling:** Check for existing customers before creating to avoid duplicates

---

## Vehicles

Bravo separates vehicles into two types: **coaches** (buses) and **trailers**. Vehicles are assigned to quotes via `quote_coaches` and `quote_trailers` junction tables.

### coaches

The main coaches (buses) table.

#### Columns

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `name` | `text` | NO | - | **Required** - Coach name (e.g., "Backdraft") |
| `make` | `text` | YES | - | Manufacturer (e.g., "Prevost") |
| `model` | `coach_model_type` | YES | - | Model enum (H3, X3, X3-45, X4, XLII) |
| `vin` | `text` | YES | - | VIN number |
| `license_plate` | `text` | YES | - | License plate |
| `engine_type` | `text` | YES | - | Engine type |
| `year_manufactured` | `integer` | YES | - | Year |
| `door_code` | `text` | YES | - | Door code |
| `status` | `vehicle_status` | YES | - | Vehicle status (active, retired, rescue, new, client) |
| `created_at` | `timestamptz` | NO | `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NO | `now()` | Last update timestamp |
| `created_by` | `uuid` | YES | - | User who created record |
| `updated_by` | `uuid` | YES | - | User who last updated |

#### Example Row

```json
{
  "id": "b5f5be58-ce60-4bc0-a395-be8294244ae7",
  "name": "Backdraft",
  "make": "Prevost",
  "model": null
}
```

#### Import Notes

- **Matching vehicles:** Match StarTracker `Bus` or `BusTrailer` field to `coaches.name`
- **Vehicle identification:** Primary identifier is `name` field
- **Creating new coaches:** Only `name` is required. All other fields are optional.
- **Status:** Default to "active" for new vehicles

---

### quote_coaches

Junction table linking quotes to coaches. Allows multiple coaches per quote and vehicle-specific overrides.

#### Columns

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `quote_id` | `uuid` | NO | - | **Required** - FK to `quotes.id` |
| `coach_id` | `uuid` | NO | - | **Required** - FK to `coaches.id` |
| `use_custom_tour_data` | `boolean` | YES | `false` | Whether to use custom data for this coach |
| `custom_tour_start_date` | `date` | YES | - | Custom tour start date |
| `custom_tour_end_date` | `date` | YES | - | Custom tour end date |
| `custom_total_estimated_miles` | `numeric` | YES | - | Custom mileage |
| `custom_bus_deadhead_front_days` | `integer` | YES | `0` | Custom bus deadhead front days |
| `custom_bus_deadhead_rear_days` | `integer` | YES | `0` | Custom bus deadhead rear days |
| `custom_driver_deadhead_front_days` | `integer` | YES | `0` | Custom driver deadhead front days |
| `custom_driver_deadhead_rear_days` | `integer` | YES | `0` | Custom driver deadhead rear days |
| `custom_co_driver_days` | `integer` | YES | `0` | Custom co-driver days |
| `custom_tour_days` | `integer` | YES | - | Custom tour days |
| `custom_tour_weeks` | `integer` | YES | - | Custom tour weeks |
| `custom_tour_months` | `numeric` | YES | - | Custom tour months |
| `custom_billed_bus_days` | `integer` | YES | - | Custom billed bus days |
| `custom_main_driver_days` | `integer` | YES | - | Custom main driver days |
| `custom_billed_driver_days` | `integer` | YES | - | Custom billed driver days |
| `custom_main_driver_overdrives` | `integer` | YES | `0` | Custom driver overdrives |
| `created_at` | `timestamptz` | NO | `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NO | `now()` | Last update timestamp |
| `created_by` | `uuid` | YES | - | User who created record |
| `updated_by` | `uuid` | YES | - | User who last updated |

#### Example Row

```json
{
  "id": "9f03b94f-cc7a-441b-83cd-88a3e0b8579e",
  "quote_id": "79f9dde5-52cf-48d9-be29-445e3b87e647",
  "coach_id": "39b92e3f-fdd9-4a3e-ab81-02935c04845e",
  "use_custom_tour_data": true,
  "custom_tour_start_date": "2026-03-01",
  "custom_tour_end_date": "2026-03-17",
  "custom_total_estimated_miles": "5000.0",
  "custom_bus_deadhead_front_days": 2,
  "custom_bus_deadhead_rear_days": 1,
  "custom_tour_days": 17,
  "custom_billed_bus_days": 20,
  "custom_main_driver_days": 17
}
```

#### Import Notes

- **One row per coach:** Create one `quote_coaches` row for each coach assigned to the quote
- **Multi-vehicle quotes:** StarTracker TourID with multiple rows = multiple `quote_coaches` entries
- **Custom data:** Set `use_custom_tour_data = true` if vehicle has different dates/days than quote-level
- **Line item linking:** `quote_line_items.quote_coach_id` links charges to specific coaches

---

### quote_trailers

Junction table linking quotes to trailers. Simpler than quote_coaches - no custom data overrides.

#### Columns

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `quote_id` | `uuid` | NO | - | **Required** - FK to `quotes.id` |
| `trailer_id` | `uuid` | NO | - | **Required** - FK to `trailers.id` |
| `created_at` | `timestamptz` | NO | `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NO | `now()` | Last update timestamp |
| `created_by` | `uuid` | YES | - | User who created record |
| `updated_by` | `uuid` | YES | - | User who last updated |

#### Import Notes

- **Trailer identification:** Match StarTracker `BusTrailer` field to trailer name (if different from coach)
- **Line item linking:** `quote_line_items.quote_trailer_id` links trailer-specific charges
- **One row per trailer:** Create one `quote_trailers` row for each trailer assigned to the quote

---

## Import Workflow Summary

1. **Match or create customer:** Look up `artists` by `name` matching StarTracker `CustomerName`, or create new
2. **Create quote:** Insert into `quotes` with required fields (`artist_id`, `quote_name`, `type`)
3. **Assign vehicles:** 
   - Match coaches/trailers by name
   - Create `quote_coaches` rows (one per coach)
   - Create `quote_trailers` rows (one per trailer)
4. **Create line items:**
   - Look up `quote_item_type_id` by `item_name`
   - Link to quote and optionally to specific vehicle via `quote_coach_id`/`quote_trailer_id`
   - Set `quantity` and `rate` based on StarTracker calculations

---

*Last updated: January 2025*
*Source: Supabase DEV database schema queries*
