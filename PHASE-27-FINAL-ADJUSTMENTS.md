# Phase 27 — Final UI, Role Navigation & Sales Trend Adjustments

## Changes

### Sidebar
- Added collapsible navigation groups to reduce sidebar length.
- Navigation is role-aware for Owner, Admin, Manager, Cashier, Waiter, Chef and Inventory Manager.
- Restricted items are hidden from roles that should not use them.
- Existing routes and backend authorization remain unchanged.

### Online Ordering
- Added dark-mode support to the public `/order-online` page.
- Updated header, restaurant selector, menu cards, search field, cart, checkout modal, inputs and surfaces for dark mode.
- Reused the RMS control styling for selectors and form controls.

### Dashboard Sales Performance
- Sales trend revenue is now based on completed payment records, so recording a completed payment is reflected in the trend.
- Order counts remain based on orders created during the selected trend period.
- Added a clear empty-state message when no completed payments exist.

### Advanced Analytics Sales Trend
- Sales trend revenue now uses completed payment records for the selected period/branch.
- Added an explicit empty state when there are no completed payments.

### Cleanup
- Removed an unused `ComingSoon` import from `App.tsx`.
- Consolidated sidebar navigation into a single role-aware structure.

## Validation
The project source files were checked after modification. A complete TypeScript build could not be completed in this environment because the temporary npm dependency installation was interrupted and left several type-definition packages unavailable. The project should be installed normally before local testing.
