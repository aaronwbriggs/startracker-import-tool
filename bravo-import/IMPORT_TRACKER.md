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

_None yet — awaiting investigation of mismatched quotes._

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

_None._

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
