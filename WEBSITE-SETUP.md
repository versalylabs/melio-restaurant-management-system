# Customer Website & Backend Connection

The restaurant website is part of the same React + Express application. It is not a separate backend.

## Public pages

- `/` — restaurant landing page, restaurant/branch information and featured menu
- `/order-online` — full customer menu, cart and checkout
- `/online-order/:trackingToken` — public order tracking

## How the connection works

The website calls the existing Express API through the same `publicOrderingApi` service used by online ordering.

```text
Customer Website (React)
        |
        | /api/public/*
        v
Express API
        |
        v
Prisma + Database
        |
        +--> POS / Sales
        +--> Kitchen
        +--> Payments
        +--> Customers / Loyalty
        +--> Notifications

Menu photos are loaded from the URLs stored in MenuItem.image. When Supabase Storage is configured, those URLs point to the existing `menu-images` bucket.
```

## Local development

From the project root:

```powershell
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Open `http://localhost:5173/` for the public website and `http://localhost:5173/login` for staff login.

The Vite development server proxies `/api` to `http://localhost:5000`, so no separate API URL is required locally.

## Supabase menu images

Keep the existing Supabase project and `menu-images` bucket. Put the server-only credentials in `server/.env`:

```env
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
SUPABASE_STORAGE_BUCKET=menu-images
```

Never put the Supabase secret key in `client/.env` or any `VITE_*` variable.

See `SUPABASE-MENU-IMAGES.md` for the full image-upload workflow.

## Recommended production deployment: one service

This project is prepared for a simple single-service deployment:

1. Build the React client and Express server:

```powershell
npm run build
```

2. Configure production `server/.env`:

```env
DATABASE_URL=YOUR_POSTGRES_CONNECTION_STRING
PORT=5000
NODE_ENV=production
JWT_SECRET=USE-A-LONG-RANDOM-SECRET
JWT_EXPIRES_IN=7d
FRONTEND_URL=https://your-domain.com
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
SUPABASE_STORAGE_BUCKET=menu-images
```

3. Start the application:

```powershell
npm start
```

In production Express serves the built `client/dist` files itself, while `/api/*` continues to be handled by the backend. This means the public website and management system can use one domain and one backend deployment.

## Important distinction

The website is public. Staff pages remain protected by the existing JWT authentication and role/permission system. Customers do not need a staff account to browse the public website or place an online order.
