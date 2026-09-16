# Melio — Windows Local Run Guide

## 1. Open the project folder
Extract the ZIP, then open PowerShell in the folder that contains `package.json`.

## 2. Create the server environment file
Run:

```powershell
Copy-Item server\.env.example server\.env
```

The included local configuration uses SQLite. `SUPABASE_URL` is already set to Melio's public storage project; the server-side `SUPABASE_SECRET_KEY` is only needed for dashboard image uploads.

## 3. Install dependencies

```powershell
npm install
```

## 4. Create a completely clean local database
Use this for the supplied demo database instead of `db:migrate`:

```powershell
npm run db:local-reset
```

This explicitly removes stale SQLite files, regenerates Prisma Client, pushes the current schema, and seeds all demo data, including Westlands, Kilimani, and Moi Avenue.

You should finish with messages including:
- `Restaurant created: Melio`
- `Branches created: Melio - Westlands , Melio - Kilimani , Melio - Moi Avenue`
- `Users created: ...`
- `Orders seeded: 6`
- `Moi Avenue operational data verified...`

## 5. Start Melio

```powershell
npm run dev
```

Keep this terminal running. You should see both:
- Vite: `http://localhost:5173/`
- Server: `Server running on port 5000`

## 6. Open the website
Open:

`http://localhost:5173/`

The root URL is the **Melio public landing page**. It does not redirect to staff login.

Use the **Staff / Sign In** link when you want the management dashboard.

## Demo staff accounts
All supplied staff demo accounts use:

`melio@2026`

Emails:
- `owner@example.com`
- `manager@example.com`
- `cashier@example.com`
- `waiter@example.com`
- `chef@example.com`

Demo credentials are intentionally not displayed on the public/customer login form.

## Branch testing
After signing in as Owner/Admin/Manager, use the branch selector in the top bar to switch between:
- Melio - Westlands (WL)
- Melio - Kilimani (KM)
- Melio - Moi Avenue (MA)

The selected branch is sent to the API as `X-Branch-Id` and the operational pages reload against that branch.

## If you see `ECONNREFUSED`
That means the client cannot reach the API. Look at the terminal running `npm run dev` and make sure it contains:

`Server running on port 5000`

If the server stopped because of a compile error, fix that server error first; the website, login, POS, Orders, Sections, Tables, Kitchen, Reservations, and notifications all depend on the API.

## If the database reports a missing column
Do not manually edit the SQLite file. Run:

```powershell
npm run db:local-reset
```

That rebuilds the local database from the current Prisma schema.
