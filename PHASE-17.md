# Phase 17 — Reservations & Kitchen Station Improvements

Implemented on top of Phase 16 Inventory Automation.

## Reservations
- Create, edit, list and cancel reservations.
- Date, status and guest search filters.
- Optional customer and table assignment.
- Party size, start/end time, source and notes.
- Table conflict prevention for overlapping active reservations.
- Confirm, seat, complete, cancel and no-show statuses.
- Seating updates the assigned table to OCCUPIED; completion/cancellation returns it to AVAILABLE when no active sale is using it.

## Kitchen stations
- Kitchen station filtering now uses the station assignments of individual order items, so an order using Grill, Fryer and Bar can appear in each relevant station view.
- Item cards display their assigned stations.
- Station dropdown labels include the branch name to avoid ambiguity across branches.

## Cashier/staff station assignments
- Users can be assigned multiple kitchen stations.
- Station options are branch-aware and use unique station IDs with branch-qualified labels, removing confusing duplicate-looking options.
- Assignments are persisted in `user_kitchen_stations` and returned with user/auth data.

## Setup
```powershell
npm install
npm run db:generate
npm run db:push
npm run dev
```
Do not reset the database. New tables are additive.
