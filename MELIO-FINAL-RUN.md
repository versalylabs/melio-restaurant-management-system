# Melio — Final Local Run Instructions

## 1. Extract
Extract the ZIP so the folder is:

`Melio Restaurant Management System`

Open PowerShell in that folder.

## 2. Install dependencies

```powershell
npm install
```

## 3. Create the local environment file

```powershell
Copy-Item server\.env.example server\.env
```

For local development, `server/.env` should contain:

```env
DATABASE_URL="file:./dev.db"
PORT=5000
NODE_ENV=development
JWT_SECRET="melio-local-development-secret-2026"
JWT_EXPIRES_IN=7d
FRONTEND_URL="http://localhost:5173"
SUPABASE_URL=
SUPABASE_SECRET_KEY=
SUPABASE_STORAGE_BUCKET=menu-images
```

## 4. Generate Prisma Client

```powershell
npm run db:generate
```

## 5. Reset and seed the local database

Use the reset command for a clean demo database:

```powershell
npm run db:local-reset
```

This recreates the SQLite database and seeds Melio, including:

- Melio - Westlands (WL)
- Melio - Kilimani (KM)
- Melio - Moi Avenue (MA)
- demo staff users
- menu, tables, sections and kitchen stations
- orders and kitchen tickets
- inventory, suppliers and purchasing data
- Moi Avenue operational routing

If you already have data you want to keep, do **not** use `db:local-reset`; use the normal migration/push workflow instead.

## 6. Start Melio

```powershell
npm run dev
```

Leave this terminal running.

Open:

`http://localhost:5173/`

The public Melio website is the first page. Staff login is only opened by clicking **Sign In**.

## Demo staff login

Use any seeded account with:

- `owner@example.com`
- `manager@example.com`
- `cashier@example.com`
- `waiter@example.com`
- `chef@example.com`

Password:

`melio@2026`

## Important workflow checks

After login, test the branch selector and select **Melio - Moi Avenue (MA)**. Then test:

1. POS: add an item, choose a table for Dine In, submit the order.
2. Orders: confirm the new order appears without an endless loading state.
3. Kitchen: move the ticket through preparation to Ready.
4. Open the online-order tracking URL in another tab and confirm its stage updates live.
5. Tables: Add Table and confirm the branch selector contains all active Melio branches.
6. Sections: Add Section and confirm it saves under the active branch.
7. Reservations: make a website booking and confirm it appears automatically in the back-end Reservations page.
8. Top bar: **View Live Site** opens the public homepage in a new tab.
9. Analytics: confirm the **Order volume** metric displays daily completed-order activity.

## If port 5000 or 5173 is already in use

Stop the old development server windows/processes and run:

```powershell
npm run dev
```

Do not run `npm audit fix --force` as part of setup; dependency upgrades should be reviewed separately.
