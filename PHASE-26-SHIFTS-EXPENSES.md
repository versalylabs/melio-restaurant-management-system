# Phase 26 — Shifts & Expenses

Completed in the current project version.

## Shifts
- Open and close staff shifts.
- Record opening and closing cash.
- Calculate expected cash from opening cash + completed cash payments - approved cash expenses.
- Calculate cash variance at close.
- Link expenses to the active shift automatically when possible.
- View shift history with staff, branch, dates, cash totals, variance and status.
- Branch-aware and role-protected access.
- Audit logging for opening and closing shifts.

## Expenses
- Record operating expenses by branch.
- Categories, vendor/payee, reference, payment method, date and notes.
- Pending, approved and rejected workflow.
- Edit/delete pending expenses.
- Approve/reject pending expenses.
- Search and status filtering.
- Approved and pending totals.
- Approved cash expenses feed into shift cash reconciliation.
- Audit logging for creation, deletion and approval/rejection.

## Test
```powershell
npm install
npm run db:generate
npm run db:push
npm run dev
```

Then test `/shifts` and `/expenses` using an Owner, Admin or Manager account. Cashiers can operate their own shifts.
