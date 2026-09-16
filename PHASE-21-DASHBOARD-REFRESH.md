# Dashboard refresh and POS promotion fix

This follow-up refreshes the dashboard with a more distinctive restaurant operations layout inspired by the supplied dashboard examples: compact greeting header, four primary KPI cards, seven-day sales trend, order-flow breakdown, recent orders, trending menu items, operational table/menu cards, and a compact activity feed.

It also fixes discounted/promotion order creation and updates by connecting the `Promotion` relation through Prisma's relation field instead of passing `promotionId` directly in a checked nested create/update input. This prevents the runtime error: `Unknown argument promotionId. Did you mean promotion?`.

No database reset or destructive migration is required for this follow-up.
