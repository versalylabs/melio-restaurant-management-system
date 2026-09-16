# Phase 19 — Staff Management & Permissions

## Implemented

- Staff profiles with employee ID, job title, hire date and notes
- Staff/employee listing and profile editing
- Role assignment
- Branch assignment
- Multi-station assignment retained from Phase 17
- Account activation/deactivation
- Protected account deletion
- Role management with a visual permission catalog
- Custom roles and granular permissions
- Permission-aware authorization middleware
- Audit logging for staff/role/password security actions
- Admin password reset for staff
- Self-service password change
- Password changes invalidate existing sessions
- JWT token-version session invalidation
- Inactive users cannot sign in
- Logout invalidates the current session token
- Audit-log filtering by action, entity and user
- Staff navigation enabled

## Permission groups

- Dashboard
- Operations
- Menu
- Inventory
- Customers
- Finance
- Administration

## Security rules

- Owner accounts cannot be deleted by normal staff administrators.
- Users cannot deactivate their own account.
- Only an owner can modify/deactivate an owner account.
- Roles assigned to users cannot be deleted until users are reassigned.
- Passwords are stored as bcrypt hashes.
- Password changes increment the user's token version and invalidate older tokens.

## Setup

```powershell
npm install
npm run db:generate
npm run db:push
npm run dev
```

Do not run `npm run db:reset` when existing data must be preserved.
