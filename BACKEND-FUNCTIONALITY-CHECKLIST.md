# Melio backend / dashboard functionality pass

This release addresses the cross-cutting problems found during local testing rather than adding another one-off database-column patch.

## Branch context
- The active branch selected in the top bar is now the branch used by Orders, Tables, Sections, Table Combinations, Reservations, POS and Kitchen data loading.
- Owner/Admin/Manager users can switch branches from the top bar.
- Branch-assigned staff remain locked to their assigned branch by the server middleware.
- Add Section and Add Table now have a populated branch selector and default to the active branch.

## Orders / POS / Kitchen
- Orders are filtered to the active branch.
- Individual order reads and mutations are protected by branch context.
- POS displays the active branch name rather than the original profile branch name.
- Kitchen display subscribes to and loads the active branch.
- Online checkout notifications are best-effort and no longer block the customer's order response.
- API requests have a 15-second timeout so a failed request cannot leave the UI spinning forever.
- Fixed the client/server method mismatch for updating orders: the client now uses PATCH, matching the API route.

## Tables / Sections
- Floor plan loads the active branch's tables and sections.
- Add Table branch options come from the actual Branch API, not an empty fallback select.
- Section creation uses the active branch when no explicit branch is selected.
- Table combinations are branch-scoped and the Select Tables button takes staff to Floor Plan instead of opening a non-functional create form.

## Menu
- Fixed the Menu Items branch assignment UI: it previously rendered menu categories where branches should have been displayed.
- New menu items default to all active branches available in the restaurant.

## Controls
- Shared select styling uses the same warm/charcoal control language as the rest of the system.
- Dark-mode native select controls explicitly use the dark color scheme where supported by the browser.

## Local database
The project's historical migrations and current Prisma schema have diverged. For the disposable local/demo SQLite database, use:

```powershell
npm run db:local-reset
```

This intentionally recreates the local SQLite database from the current Prisma schema and runs the seed. Do not use this command against production data.

For production, use a PostgreSQL database and a reviewed migration workflow rather than resetting the database.
