# Melio Restaurant Management System

## Local development

### Requirements
- Node.js 18+
- npm 9+
- SQLite for the default local database

### 1. Install dependencies

```bash
npm install
```

This project uses npm workspaces for `client` and `server`.

### 2. Configure the server

Copy `server/.env.example` to `server/.env` and set at least:

```env
DATABASE_URL="file:./dev.db"
PORT=5000
NODE_ENV=development
JWT_SECRET="replace-with-a-long-random-secret"
FRONTEND_URL="http://localhost:5173"
```

If menu/gallery image uploads are used, configure the Supabase storage values in the example file as well.

### 3. Configure the client

Copy `client/.env.example` to `client/.env` if you need a custom API URL. The default `/api` works when the frontend is served through the project's proxy configuration.

### 4. Prepare the database

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

The seed creates/updates the demo restaurant as **Melio**, creates the third **Moi Avenue, Nairobi** branch, makes all seeded demo staff passwords `melio@2026`, and makes menu items available at the new branch.

Demo staff emails are:
- `owner@example.com`
- `manager@example.com`
- `cashier@example.com`
- `waiter@example.com`
- `chef@example.com`

### 5. Start the application

```bash
npm run dev
```

The Vite client runs on port 5173 and the API on port 5000.

## Website management

After signing into the staff dashboard, use **Administration → Website Management** to manage the featured dish, gallery filters (maximum 6), gallery images, testimonials, and branch website details including dining hours and the number used by **Call Branch**.

## Important

Do not commit `.env` files or production secrets. Use the supplied `.env.example` files when setting up another environment.
