# Melio Restaurant Management System

Full Melio Restaurant Management System with an internal operations platform and a customer-facing restaurant website, built with React, TypeScript, Express, Prisma, and Supabase Storage for menu images.

## Features (Phase 1)

- **Authentication & Authorization**: JWT-based auth with role-based access control
- **Multi-tenant Architecture**: Support for multiple restaurants and branches
- **User Management**: Foundation for managing restaurant staff
- **Role System**: Pre-defined roles (OWNER, ADMIN, MANAGER, CASHIER, WAITER, CHEF, INVENTORY_MANAGER)
- **Audit Logging**: Track system activity
- **Restaurant Settings**: Configure restaurant information
- **Dashboard**: Metrics overview with placeholder data
- **Responsive UI**: Professional interface with sidebar navigation

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Express + TypeScript
- **Database**: SQLite with Prisma ORM
- **Authentication**: JWT + bcrypt

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

## Installation

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:push

# Seed database with initial data
npm run db:seed
```

## Development

```bash
# Start both backend and frontend
npm run dev

# Or start individually:
npm run dev:server  # Backend on http://localhost:5000
npm run dev:client  # Frontend on http://localhost:5173
```

## Environment Variables

A development `.env` file is included in the project. If it is missing, copy `server/.env.example` to `server/.env` and configure:

```env
DATABASE_URL="file:./prisma/dev.db"
PORT=5000
NODE_ENV=development
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:5173
```

## Default Login

After running the seed:

- **Owner**: `owner@example.com` / `melio@2026`
- **Manager**: `manager@example.com` / `melio@2026`
- **Cashier**: `cashier@example.com` / `melio@2026`
- **Waiter**: `waiter@example.com` / `melio@2026`
- **Chef**: `chef@example.com` / `melio@2026`

## API Endpoints

### Health Check
- `GET /api/health`

### Authentication
- `POST /api/auth/login`
- `POST /api/auth/setup`
- `GET /api/auth/me`

### Restaurant
- `GET /api/restaurant`
- `PUT /api/restaurant`

### Users
- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:id`
- `DELETE /api/users/:id`

### Roles
- `GET /api/roles`
- `POST /api/roles`
- `PUT /api/roles/:id`
- `DELETE /api/roles/:id`

### Dashboard
- `GET /api/dashboard`

### Audit Log
- `GET /api/audit-logs`

## Database

```bash
# Reset database
npm run db:reset

# Open Prisma Studio
npm run db:studio
```

## Project Structure

```
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # Reusable components
│   │   ├── pages/         # Page components
│   │   ├── contexts/      # React contexts
│   │   ├── services/      # API services
│   │   ├── types/         # TypeScript types
│   │   └── lib/           # Utilities
│   └── ...
├── server/                # Express backend
│   ├── src/
│   │   ├── config/        # Configuration
│   │   ├── middleware/    # Express middleware
│   │   ├── routes/        # API routes
│   │   ├── controllers/   # Request handlers
│   │   ├── services/      # Business logic
│   │   ├── utils/         # Utilities
│   │   └── types/         # TypeScript types
│   └── ...
├── prisma/                # Database schema
│   ├── schema.prisma
│   └── migrations/
├── scripts/               # Utility scripts
└── package.json           # Root package.json
```

## Security

- Passwords are hashed using bcrypt
- JWT tokens for authentication
- Role-based access control
- Multi-tenant data isolation
- Environment variables for secrets
- CORS configuration

## License

MIT

## Environment setup

The server requires `server/.env`. It is included in this package with a development SQLite configuration:

```env
DATABASE_URL="file:./dev.db"
```

Run database commands from the project root using the provided npm scripts. Do not delete the database unless you intentionally want to reset demo data.


## Phase 17 — Reservations & Station Assignment
- Reservation management with table conflict prevention and guest tracking.
- Reservation statuses: pending, confirmed, seated, completed, cancelled, no-show.
- User-to-kitchen-station assignments with branch-aware station labels.
- Kitchen display station filtering now recognizes every station used by an order item, including multi-station orders.

## Menu image storage

Menu-item photos use Supabase Storage. See `SUPABASE-MENU-IMAGES.md` for setup and environment variables.

## Customer-facing website

The public restaurant website is available at `/` and uses the same public ordering API as the internal system. The existing `/order-online` flow remains the full menu/cart/checkout experience, and `/online-order/:trackingToken` provides order tracking.

For local development, run `npm run dev` and open `http://localhost:5173/`. The website reads restaurant, branch, menu, pricing and Supabase-hosted menu image URLs from the backend; no Supabase secret is exposed to the browser.

For a separate frontend/API deployment, set `VITE_API_URL` to the deployed API's `/api` base URL and set the server's `FRONTEND_URL` to the frontend origin. For a single-service deployment, run `npm run build` and `npm start`; the Express server serves `client/dist` in production.


## Customer Website

The system includes a public customer-facing website at `/`. Customers can view the restaurant and menu, browse Supabase-hosted meal photos, open `/order-online` to build a cart and check out, and track an order at `/online-order/:trackingToken`. The public ordering API writes orders into the same sales database used by the POS and creates the kitchen workflow for the restaurant.

See `WEBSITE-SETUP.md` for the architecture, local setup, Supabase connection and single-service production deployment instructions.
