# Phase 20 — Multi-Branch Operations

## Implemented

- Active branch selector in the application header for Owner, Admin and Manager users
- Branch context is sent with every API request through `X-Branch-Id`
- Branch-assigned operational users remain locked to their assigned branch
- Invalid or inactive branch selections are rejected server-side
- Branch context is used by branch-scoped POS/order/kitchen/inventory operations through the authenticated user context
- New Branches administration page
- Branch overview showing active branch
- Inventory stock transfer workflow between branches
- Stock transfer references and statuses
- Transfer destination validation
- Transfer quantity validation
- Atomic source deduction and destination addition
- Transfer-out and transfer-in stock movements
- Transfer audit logging
- Transfer completion and cancellation
- Destination inventory stock is created automatically when needed
- Branch-aware dashboard operational metrics
- Existing multi-branch menu availability is preserved
- Existing branch/staff/station relationships are preserved

## Stock Transfer Workflow

```text
Active Branch
     ↓
Create Transfer
     ↓
Select Destination
     ↓
Select Ingredient + Quantity
     ↓
DRAFT
     ↓
Complete Transfer
     ↓
Source Stock Deducted
     +
Destination Stock Increased
     ↓
TRANSFER_OUT + TRANSFER_IN Movements
     ↓
COMPLETED
```

## Branch Access Rules

- Owner/Admin/Manager can switch between active branches.
- Staff assigned to a branch cannot switch to another branch.
- Branch selection is validated against the current restaurant.
- Only active branches can be selected.
- Inventory transfers require inventory-management permission.
- A transfer cannot be made from a branch to itself.

## Database Changes

Added:

- `StockTransfer`
- `StockTransferItem`

The existing database is preserved. Run `npm run db:push` to add the new tables.

## Setup

```powershell
npm install
npm run db:generate
npm run db:push
npm run dev
```

Do not run `npm run db:reset` when existing data must be preserved.
