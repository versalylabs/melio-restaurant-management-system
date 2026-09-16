# Phase 16 — Inventory Automation

Implemented on top of Phase 15 Reports Fixed4.

## Included
- Automatic recipe-based ingredient deduction when a sale is completed.
- Idempotent order deduction protection.
- FIFO/FEFO batch consumption (earliest expiry first, then received date).
- Batch and expiry tracking.
- Low-stock/out-of-stock monitoring and reorder dashboard.
- Stock adjustments with audit/movement history.
- Wastage recording and stock deduction.
- Physical stocktakes with variance capture and completion adjustments.
- Inventory valuation using quantity × cost per unit.
- Purchase receiving creates inventory batches; receiving accepts optional batch number and expiry date.
- Supplier/purchase workflow remains intact.

## Setup
```powershell
npm install
npm run db:generate
npm run db:push
npm run dev
```
Do not reset the database. The new tables/columns are additive.
