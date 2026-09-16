# Phase 23 — Notifications & Communication

Implemented a centralized notification center and provider-ready communication layer.

- In-app notification center with read/unread state
- Per-user notification preferences
- Order, low-stock, purchase and loyalty preference categories
- Provider-ready Email, SMS and WhatsApp channel flags
- Delivery status records: live in-app delivery and simulated external delivery until credentials are configured
- Online-order event integration: staff are notified when a new public order is placed
- API endpoints for listing, marking read, and managing preferences

Live Email/SMS/WhatsApp credentials are intentionally not hard-coded; those channels remain simulated until a provider is configured.
