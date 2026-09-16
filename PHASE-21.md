# Phase 21 — Discounts, Taxes, and Promotions

Implemented on top of Phase 20 Multi-Branch Operations.

## Included
- Restaurant tax and service-charge configuration in Settings.
- Percentage and fixed-amount manual order discounts.
- Role-based discount approval limits (percentage and fixed amount).
- Promotion management with active/inactive status.
- Order-wide and product-specific promotions.
- Customer-specific offers.
- Branch-specific promotions or restaurant-wide promotions.
- Minimum subtotal and maximum discount caps.
- Promotion start/end dates and daily active times.
- Happy-hour promotions.
- POS promotion selection and live total preview.
- Server-side promotion validation and discount calculation.
- Promotion audit logging.
- Discount reporting by promotion.

## Setup
```powershell
npm install
npm run db:generate
npm run db:push
npm run dev
```
Do not reset the database. New promotion fields/tables are additive.

## Verification
- Promotion-to-order linkage is persisted with `promotionId` and included in discount reporting.
- Root and server Prisma schemas remain synchronized.
- The Phase 21 migration is additive and does not require a database reset.
