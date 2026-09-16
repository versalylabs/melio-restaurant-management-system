# 🔒 Restaurant Management System Security & Integrity Architecture

This document provides a comprehensive overview of the security controls, data integrity mechanisms, and production hardening implemented across the system.

---

## 1. Threat Model & Role-Based Access Control (RBAC)

The system enforces strict multi-tenant restaurant and branch isolation, along with granular role boundaries to prevent unauthorized operations, employee collusion, and revenue leakage.

| Role | POS Orders | Modify In-Flight Order | Apply Discounts | Process Payments | Issue Refunds | Kitchen Ticket Management | Admin & Reports |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **OWNER** | Full | Full | Unrestricted | Full | Full | View & Complete | Full Access |
| **ADMIN** | Full | Full | Unrestricted | Full | Full | View & Complete | Full Access |
| **MANAGER** | Full | Full | Up to 50% / KES 5,000 | Full | Full | View & Complete | Branch Scope |
| **CASHIER** | Full | Full | Up to 10% / KES 500 | Full | ❌ Blocked | View & Complete | Read-Only |
| **WAITER** | Create & View | Draft Only | ❌ Prohibited (0%) | ❌ Blocked | ❌ Blocked | View Ready Only | ❌ Blocked |
| **KITCHEN_STAFF** | ❌ Blocked | ❌ Blocked | ❌ Prohibited (0%) | ❌ Blocked | ❌ Blocked | Update Prep State | ❌ Blocked |

---

## 2. Pricing & Financial Calculation Integrity

### Authoritative Server-Side DB Pricing
- **Zero Client Price Trust**: `unitPrice` and `priceAdjustment` submitted in client payloads are strictly ignored. Prices are authoritatively queried from active `menuItem` and `modifierOption` database records.
- **Modifiers Snapshot**: Whenever an item is ordered, item names and price adjustments are snapshotted in the `SaleItem` record to preserve historical transaction accuracy even if menu prices change later.
- **Quantity Validation**: Item quantities are strictly validated as positive integers (`1 <= qty <= 500`).

### High-Precision Decimal Arithmetic
- Subtotals, discounts, taxes (16% VAT), and service charges (10%) use explicit 2-decimal rounded arithmetic (`Math.round(val * 100) / 100`) to eliminate floating-point representation anomalies.
- **Discount Clamping**:
  - Negative discounts are rejected and clamped to `0`.
  - Discounts cannot exceed the subtotal (`0 <= discount <= subtotal`).
  - Tax and service charges are calculated strictly on net taxable amounts after valid discounts.

---

## 3. Order Lifecycle State Machine

Orders adhere to an explicit, non-bypassable unidirectional state transition matrix:

```
[ DRAFT ] <--------> [ HELD ]
    │                   │
    └──────> [ SUBMITTED ]
                  │
                  ▼
            [ PREPARING ]
                  │
                  ▼
              [ READY ]
               │     │
               │     ▼
               │  [ COMPLETED ] (Terminal)
               ▼     ▲
            [ SERVED ]
```
- **Cancellation**: Any non-terminal state (`DRAFT`, `HELD`, `SUBMITTED`, `PREPARING`, `READY`, `SERVED`) can transition to `CANCELLED` with a mandatory reason and staff audit log.
- **Terminal States**: `COMPLETED` and `CANCELLED` orders are immutable. No status changes, line item edits, or duplicate payment captures are permitted once completed or cancelled.
- **Automatic Kitchen Synchronization**: Transitioning to `SUBMITTED` automatically generates a kitchen display ticket.

---

## 4. POS & Online Payment Integrity

### Atomic Transactions & Balance Invariants
- **Atomic Balance Verification**: When recording cash, card, or mobile money payments, the system locks the sale within a Prisma database transaction (`prisma.$transaction`), re-computes `totalAmount - amountPaid`, and guarantees that `requestedPayment <= remainingBalance + 0.005`.
- **Race Condition Immunity**: Concurrent payment attempts cannot exceed the total bill or produce negative balances.
- **Authoritative Gateways (M-Pesa / Card)**: Public checkout endpoints for online orders authoritatively calculate the payable balance directly from the DB record, ignoring any spoofed client `amount` parameters.
- **Idempotent Webhooks**: M-Pesa STK confirmations and card authorizations are idempotent; duplicate webhook payloads or retries will not duplicate payment entries.

### Refund Protection
- Refunds are strictly restricted to `OWNER`, `ADMIN`, and `MANAGER` roles.
- Mandatory audit logs record the refund timestamp, operator ID, amount, and justification reason.

---

## 5. Security Middleware & Error Sanitization

- **Rate Limiting**: Rate limiters protect authentication, checkout, and payment webhook endpoints against brute-force and credential-stuffing attacks.
- **JWT Authentication**: High-entropy JWT tokens with explicit expiration.
- **Data Leak Prevention**: Database errors (`PrismaClientKnownRequestError`) are sanitized in production to prevent schema introspection, table leaks, or internal query disclosure.
- **Protected Notifications**: Internal customer notification and communication logs are restricted to authenticated staff.

---

## 6. Verification & Automated Test Suite

To run the automated security and data integrity regression suite:

```bash
cd server
npm test
```

The test suite validates:
1. Floating-point rounding and non-negative discount clamping.
2. 100% percentage discount caps and subtotal clamping.
3. Order state machine illegal transition rejection.
4. Role-based discount authorizations (Waiter vs Cashier vs Manager vs Admin).
5. Exact and partial payment acceptance with overpayment rejection.
