# Melio — Backend / Frontend Functional Fix Audit

This build includes a pass over the operational flows that were producing the reported errors.

## Fixed in this build

- **Authentication state desynchronization:** a 401 response used to remove the token from localStorage while leaving the React auth state active. Protected pages could then remain visible while every API call returned `Access token required`. The API layer now notifies the auth context so the session is cleared consistently.
- **Auth endpoint isolation:** login/setup requests no longer inherit an old staff token.
- **Staff realtime stream:** browser `EventSource` cannot send an Authorization header. The staff realtime endpoint now accepts the JWT query credential specifically for `/api/realtime/stream`.
- **Realtime event delivery:** the client now listens to named SSE events and unwraps the server's `{ event, channel, data }` envelope. This fixes order/kitchen/notification/realtime updates that previously arrived but were ignored.
- **Kitchen item workflow:** changing individual kitchen-ticket item statuses now synchronizes the parent sale status when the ticket becomes PREPARING/READY.
- **Customer order tracking fallback:** the order tracking page keeps SSE live updates but also refreshes the order every 8 seconds while active, so it continues to reflect backend status when a network/proxy blocks long-lived SSE.
- **Order delivery stage:** `OUT_FOR_DELIVERY` is now a valid order status and transition from READY, allowing the fourth customer tracking stage to be driven from the backend.
- **SERVED tracking:** customer tracking normalizes SERVED to the final fulfilled stage instead of falling back to the first stage.
- **POS cart readability:** the totals/discount panel uses less vertical space so the cart item list retains a larger scrollable area.
- **Top-bar live site:** the existing View Live Site control opens the public homepage in a new tab.
- **Website reservations:** website reservations create real back-office Reservation records with branch, customer, party size, time, source=WEBSITE, and automatic table assignment where an available table exists.
- **Three branches:** seed data contains Westlands, Kilimani, and Moi Avenue, and branch-aware API queries use the active branch context.
- **Analytics:** the advanced analytics screen uses Order Volume rather than the previous sales-value trend presentation.

## Important local verification

Run from the project root:

```powershell
npm install
npm run db:generate
npm run db:local-reset
npm run dev
```

Then test the following end-to-end:

1. Sign in with `owner@example.com` / `melio@2026`.
2. Select **Melio - Moi Avenue (MA)** in the top branch selector.
3. Open POS, add several items, and verify the cart remains readable while the discount/total area is visible.
4. Submit an order and confirm it appears in Orders.
5. Open Kitchen and move the ticket through ACCEPTED/PREPARING/READY.
6. Open the tracking URL in a second browser tab. Its stage should update from the kitchen actions.
7. In Tables, click Add Table and confirm the active branches are available.
8. In Sections, add a section and confirm it is created for the active branch.
9. Make a website reservation and confirm it appears in back-office Reservations with source WEBSITE.
10. Click View Live Site and confirm it opens the public homepage in a new tab.
11. Open Analytics and verify Order Volume renders with daily values/empty state.

A successful database reset/seed confirms the Prisma schema and seed data are synchronized. A successful `npm run dev` must show both Vite on port 5173 and the API on port 5000 without a server compilation crash.
