# Test Checklist

Use this checklist to verify the import tool is working correctly. Run each test file through the tool and confirm the expected results.

---

## Quick Start: Local Testing

Before testing, make sure you can run locally:

```bash
cd startracker-import-tool
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

---

## Test Files

### 1. `test_ready.csv` — All READY

**Upload this file and confirm:**
- [ ] 5 quotes total
- [ ] 5 READY, 0 FLAGGED, 0 BLOCKED, 0 EXCLUDED
- [ ] All classified as SHORT_TERM
- [ ] TourIDs: 30001, 30002, 30003, 30004, 30005

| TourID | Customer | Expected |
|--------|----------|----------|
| 30001 | Acme Tours | READY |
| 30002 | Beta Productions | READY |
| 30003 | Gamma Entertainment | READY |
| 30004 | Delta Music Group | READY |
| 30005 | Echo Records | READY |

---

### 2. `test_flagged.csv` — All FLAGGED

**Upload this file and confirm:**
- [ ] 4 quotes total
- [ ] 0 READY, 4 FLAGGED, 0 BLOCKED, 0 EXCLUDED

| TourID | Customer | Expected | Reason |
|--------|----------|----------|--------|
| 40001 | Flagged Co Alpha | FLAGGED | Driver days override (14 vs 11 expected) |
| 40002 | Flagged Co Beta | FLAGGED | Admin fee ($250.50) |
| 40003 | Flagged Co Gamma | FLAGGED | $0 BusRate with mileage |
| 40004 | Flagged Co Delta | FLAGGED | Driver override + Admin fee |

---

### 3. `test_blocked.csv` — All BLOCKED

**Upload this file and confirm:**
- [ ] 4 quotes total (8 rows, some share TourID)
- [ ] 0 READY, 0 FLAGGED, 4 BLOCKED, 0 EXCLUDED

| TourID | Customer | Expected | Reason |
|--------|----------|----------|--------|
| 50001 | Blocked Inc Alpha | BLOCKED | DiscountedDays = 3 |
| 50002 | Blocked Inc Beta | BLOCKED | Vehicle swap (Stallion 2×) |
| 50003 | Blocked Inc Gamma | BLOCKED | Multiple $0 budget rows |
| 50004 | Blocked Inc Delta | BLOCKED | Discount days + vehicle swap |

---

### 4. `test_excluded.csv` — All EXCLUDED

**Upload this file and confirm:**
- [ ] 5 quotes total
- [ ] 0 READY, 0 FLAGGED, 0 BLOCKED, 5 EXCLUDED

| TourID | Customer | Expected | Reason |
|--------|----------|----------|--------|
| 60001 | Celebrity Coaches | EXCLUDED | Internal record |
| 60002 | TEST CLIENT | EXCLUDED | Test data |
| 60003 | Maintenance Record | EXCLUDED | Status = "Other" |
| 60004 | Shop Work | EXCLUDED | Status = "Other" |
| 60005 | Celebrity Coaches | EXCLUDED | Internal record |

---

### 5. `test_mixed_all.csv` — Combined Scenarios

**Upload this file and confirm:**
- [ ] 14 quotes total (19 rows)
- [ ] 5 READY
- [ ] 4 FLAGGED
- [ ] 4 BLOCKED
- [ ] 5 EXCLUDED

**Verify classification breakdown matches:**
```
READY:    30001, 30002, 30003, 30004, 30005
FLAGGED:  40001, 40002, 40003
BLOCKED:  50001, 50002, 50003, 50004
EXCLUDED: 60001, 60002, 60003, 60004, 60005
```

**Note:** TourID 40004 from test_flagged.csv is not in this file.

---

## Feature Tests

### CSV Export
- [ ] Download "Ready Summary" — contains only READY TourIDs
- [ ] Download "Ready Detailed" — includes vehicle rows
- [ ] Download "Flagged" — contains only FLAGGED TourIDs
- [ ] Download "Blocked" — contains only BLOCKED TourIDs
- [ ] Download "Full Report" — contains all TourIDs
- [ ] TourID is first column in all exports

### Batch History
- [ ] Click "Save to History" after upload
- [ ] Add notes before saving
- [ ] Refresh page — history persists
- [ ] Expand history item — shows TourIDs by classification
- [ ] Delete individual history item
- [ ] Clear all history

### UI Interactions
- [ ] Click summary cards to filter by classification
- [ ] "Show All" button works
- [ ] Expand quote row to see vehicle details
- [ ] $0 budget rows highlighted in red
- [ ] Long-term leases show "LONG TERM" badge

---

## Edge Case Tests

### Empty File
- [ ] Upload empty CSV (just headers) — should show "No quotes"

### Single Row
- [ ] Upload CSV with 1 row — should classify correctly

### Large File
- [ ] Upload 500+ row file — should complete without freezing

### Malformed Data
- [ ] Missing TourID — should handle gracefully
- [ ] Non-numeric budget — should treat as 0

---

## When Real Export Arrives

### First Pass
1. [ ] Upload real StarTracker export
2. [ ] Record classification counts
3. [ ] Spot-check 5 READY quotes in StarTracker
4. [ ] Spot-check 5 BLOCKED quotes — confirm blocking reason is valid
5. [ ] Review all FLAGGED quotes — decide which are OK to import

### Iterate
1. [ ] Identify any misclassified quotes
2. [ ] Document new patterns
3. [ ] Update classification rules if needed
4. [ ] Re-test with updated rules

---

## Regression Test

After any code change, re-run `test_mixed_all.csv` and confirm counts still match:
- READY: 5
- FLAGGED: 3
- BLOCKED: 4
- EXCLUDED: 5
