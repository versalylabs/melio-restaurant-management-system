# Phase 22 — Online Ordering

Implemented in this version:

- Public online menu without staff authentication
- Restaurant and branch selection
- Search and category filtering
- Online cart and quantity controls
- Customer details captured at checkout and linked to existing customer records when possible
- Pickup and delivery fulfillment choices
- Delivery address capture
- Promotion code validation using the Phase 21 promotion engine
- Server-side recalculation of pricing, tax, service charge and promotion discounts
- Cash/pay-at-pickup or pay-at-delivery option
- Card and mobile-money payment records with local/demo confirmation flow pending a real provider integration
- Submitted online orders created as normal RMS sales
- Automatic kitchen ticket creation for POS/kitchen integration
- Public order tracking via an unguessable tracking token
- Order status tracking from submitted through completion

## Public routes

- `/order-online` — public menu and checkout
- `/online-order/:trackingToken` — public order tracking

## API routes

- `GET /api/public/restaurants`
- `GET /api/public/menu?restaurantId=...&branchId=...`
- `POST /api/public/orders`
- `GET /api/public/orders/:trackingToken`
- `POST /api/public/orders/:trackingToken/pay/confirm`

A live card/mobile-money gateway is intentionally not hard-coded because this project does not contain provider credentials or a selected provider. The current payment confirmation flow is explicitly local/demo mode and is designed to be replaced by a real provider webhook/confirmation flow during deployment work.
