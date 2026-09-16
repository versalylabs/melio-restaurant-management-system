# Phase 25 — Production Readiness & Deployment

Implemented baseline production hardening without changing the SQLite data model.

- API health endpoint with database connectivity check
- Security response headers
- `X-Request-ID` on responses
- JSON request-size limit (1 MB)
- Lightweight API/auth rate limiting
- Production JWT secret validation
- Graceful SIGINT/SIGTERM shutdown
- Unhandled rejection / uncaught exception logging
- Existing error handler retained
- Shared RMS form-control styling for consistent rounded controls
- Notifications page refresh action retained

## Production checklist

Before deployment, set `NODE_ENV=production`, a strong `JWT_SECRET`, `FRONTEND_URL`, and a production PostgreSQL `DATABASE_URL`. Run database migration, build both workspaces, and configure HTTPS, backups, monitoring and provider-specific rate limiting at the hosting layer.
