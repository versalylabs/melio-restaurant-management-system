# Phase 29 Run Fix

## First-time local setup

From the project root:

```powershell
npm install
npm run db:generate
npm run db:seed
npm run dev
```

`npm run db:seed` now runs `prisma db push` first, so a fresh checkout gets its SQLite schema before the seed script queries the database.

## Existing database

If the database already exists, the same command is safe when the schema is already in sync:

```powershell
npm run db:seed
```

Do not use `db:reset` unless you intentionally want to erase development data.

## Port already in use

If you see `EADDRINUSE` for port 5000, another RMS server is already running. Stop the old Node processes, then run the dev command again:

```powershell
taskkill /F /IM node.exe
npm run dev
```

Vite may also report port 5173 as occupied. The client proxy is configured for the backend on port 5000, so make sure the backend is actually running on 5000 before testing the client.
