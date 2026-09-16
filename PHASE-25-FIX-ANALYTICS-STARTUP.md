# Phase 25 Fix — Advanced Analytics Startup Crash

## Fixed

The Advanced Analytics route imported `requirePermission` from `middleware/permissions.ts`, but that helper called an undefined `authorizePermission` symbol. This caused the Express server to crash while loading the analytics route, which in turn made Vite report `ECONNREFUSED` and left the browser on a blank page.

The permission helper is now implemented directly in `permissions.ts` and uses a type-only `AuthRequest` import to avoid a runtime circular dependency with `auth.ts`.

## Expected startup

After installing dependencies, `npm run dev` should reach:

- `VITE ... ready`
- `Server running on port 5000`

without:

- `ReferenceError: authorizePermission is not defined`
- `TypeError: requirePermission is not a function`

## Test

1. Run `npm install`.
2. Run `npm run db:generate`.
3. Run `npm run db:push` if the database schema needs updating.
4. Run `npm run dev`.
5. Open `http://localhost:5173/`.
6. Log in and open **Advanced Analytics**.
