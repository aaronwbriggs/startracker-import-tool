# Changelog

All notable changes to the StarTracker Import Tool.

---

## [1.1.0] - 2025-01-12

### Added
- Batch history tracking with localStorage persistence
- Notes field for batch annotations
- TourID-first column ordering in all tables and exports
- Expandable history records showing TourIDs by classification
- Detailed CSV export option (includes all vehicle rows)

### Changed
- TourID now displayed prominently in blue monospace font
- Summary cards are clickable to filter

---

## [1.0.0] - 2025-01-12

### Added
- Initial release
- CSV upload and parsing
- Classification engine (READY, FLAGGED, BLOCKED, EXCLUDED)
- Classification rules:
  - EXCLUDED: Status "Other", Celebrity Coaches, TEST CLIENT
  - BLOCKED: DiscountedDays > 0, vehicle swaps, multiple $0 rows
  - FLAGGED: $0 BusRate with mileage, driver days override, admin fee
- Multi-vehicle quote grouping by TourID
- Long-term lease detection
- Expandable quote details with vehicle table
- CSV export by classification
- Classification rules reference panel

---

## [Unreleased]

### Planned
- Full transformation to Bravo import format
- Manual classification override
- Bravo API integration
- Batch comparison tool
