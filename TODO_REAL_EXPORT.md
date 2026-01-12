# TODO: When Real Export Arrives

## Immediate Steps

### 1. First Upload
- [ ] Upload the new StarTracker export
- [ ] Screenshot the classification counts
- [ ] Save batch to history with note "First real export - [date]"

### 2. Validate Classifications
- [ ] Check 3 READY quotes in StarTracker — are they truly clean?
- [ ] Check 3 BLOCKED quotes — is the blocking reason correct?
- [ ] Review ALL FLAGGED quotes — most important category

### 3. Document Findings
- [ ] Any quotes classified wrong? Note the TourID and why
- [ ] Any new patterns we didn't anticipate? Describe them
- [ ] Any fields missing from export that we need? List them

---

## Likely Issues to Watch For

### Field Name Mismatches
The export might use different column headers than our test data. Check:
- `BusTrailer` vs `Bus` vs `Vehicle`
- `TourBudget` vs `BusBudget` vs `Budget`
- `CustomerName` vs `Customer`

**If headers don't match:** Update the `classifyTour()` function in App.jsx to handle alternate field names.

### New Status Values
We handle: "Quote - Active", "Quote - Closed", "Contract - Committed", "Contract - Signed", "Other"

**If new status values appear:** Decide how to classify them and update rules.

### Data Quality Issues
- Empty TourIDs
- Malformed dates
- Unexpected characters in vehicle names

---

## Questions to Answer

After first upload, determine:

1. **What % is READY?** (Target: >60%)
2. **What % is BLOCKED?** (Estimate manual workload)
3. **How many unique TourIDs?** (Total quote count)
4. **How many are Long-Term vs Short-Term?**
5. **Any surprises in the data?**

---

## If Classification Rules Need Updating

### Adding a new BLOCKED condition
1. Edit `classifyTour()` in `src/App.jsx`
2. Add detection logic before FLAGGED checks
3. Add reason string: `results.reasons.push('New reason here')`
4. Set `results.classification = 'BLOCKED'`
5. Update Rules Reference in UI
6. Update `CONTEXT.md`
7. Add test case to `test_blocked.csv`
8. Run regression test

### Adding a new FLAGGED condition
Same as above, but set classification to 'FLAGGED' and only if not already BLOCKED.

### Changing BLOCKED to FLAGGED (or vice versa)
This is a business decision — confirm with Page/leasing team before changing.

---

## After Validation

### If everything looks good:
1. Download READY quotes CSV
2. Plan Bravo import process (manual or automated)
3. Download BLOCKED quotes CSV for manual handling list

### If many issues found:
1. Document all issues
2. Prioritize fixes
3. Request enhanced export if needed
4. Iterate on classification rules

---

## Communication

### Update Aaron (yourself) on:
- Classification accuracy
- Manual workload estimate (BLOCKED count)
- Any blockers or needed decisions

### Update Page on:
- Which quotes can be imported automatically
- Which quotes need manual review
- Timeline for import completion

---

## Files to Update

After real-world testing, update these:
- [ ] `CONTEXT.md` — Add any new edge cases discovered
- [ ] `CHANGELOG.md` — Document rule changes
- [ ] `TEST_CHECKLIST.md` — Add regression tests for new rules
- [ ] Test data CSVs — Add examples of new patterns
