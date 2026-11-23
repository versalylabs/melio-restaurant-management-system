/*
 * Access-control and policy tests that run without a database: role
 * escalation guards, discount approval limits and safe error messages.
 * Run with: npm test (from server/)
 */
import assert from 'assert';

process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef';

/* eslint-disable @typescript-eslint/no-var-requires */
const { canAssignRole, canManageAccount, canEditRoleDefinition, filterGrantablePermissions, isReservedRoleName } = require('../utils/roleGuards');
const { manualDiscountError, effectiveDiscountLimits } = require('../utils/discountPolicy');
const { safeErrorMessage } = require('../utils/safeError');
/* eslint-enable @typescript-eslint/no-var-requires */

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}\n     ${err.message}`);
    failed++;
  }
}

console.log('\n--- Role escalation guards ---');
test('only an OWNER can assign OWNER or ADMIN', () => {
  assert.strictEqual(canAssignRole('OWNER', 'OWNER'), true);
  assert.strictEqual(canAssignRole('OWNER', 'ADMIN'), true);
  assert.strictEqual(canAssignRole('ADMIN', 'OWNER'), false);
  assert.strictEqual(canAssignRole('ADMIN', 'ADMIN'), false);
  assert.strictEqual(canAssignRole('Shift Lead', 'OWNER'), false);
  assert.strictEqual(canAssignRole('ADMIN', 'CASHIER'), true);
});
test('only an OWNER can manage OWNER/ADMIN accounts', () => {
  assert.strictEqual(canManageAccount('ADMIN', 'ADMIN'), false);
  assert.strictEqual(canManageAccount('ADMIN', 'OWNER'), false);
  assert.strictEqual(canManageAccount('ADMIN', 'MANAGER'), true);
  assert.strictEqual(canManageAccount('OWNER', 'ADMIN'), true);
});
test('only an OWNER can redefine the OWNER/ADMIN roles', () => {
  assert.strictEqual(canEditRoleDefinition('ADMIN', 'OWNER'), false);
  assert.strictEqual(canEditRoleDefinition('ADMIN', 'ADMIN'), false);
  assert.strictEqual(canEditRoleDefinition('ADMIN', 'CASHIER'), true);
});
test('non-owners cannot grant "*" or unknown permissions', () => {
  const r = filterGrantablePermissions('ADMIN', ['*'], ['*', 'orders.view', 'made.up']);
  assert.deepStrictEqual(r.kept, ['orders.view']);
  assert.deepStrictEqual(r.rejected.sort(), ['*', 'made.up']);
});
test('custom-role editors can only grant permissions they hold', () => {
  const r = filterGrantablePermissions('Shift Lead', ['roles.manage', 'orders.view'], ['orders.view', 'payments.manage']);
  assert.deepStrictEqual(r.kept, ['orders.view']);
  assert.deepStrictEqual(r.rejected, ['payments.manage']);
});
test('an OWNER may grant "*"', () => {
  assert.deepStrictEqual(filterGrantablePermissions('OWNER', ['*'], ['*']).kept, ['*']);
});
test('cannot assign a custom role that holds more than the assigner', () => {
  // "*" role: only an owner may hand it out.
  assert.strictEqual(canAssignRole('ADMIN', 'Super Lead', { actorPermissions: [], targetPermissions: ['*'] }), false);
  assert.strictEqual(canAssignRole('OWNER', 'Super Lead', { actorPermissions: ['*'], targetPermissions: ['*'] }), true);
  // Custom-role staff manager can't assign a role with permissions they lack.
  assert.strictEqual(canAssignRole('HR Lead', 'Finance', { actorPermissions: ['users.manage'], targetPermissions: ['payments.manage'] }), false);
  assert.strictEqual(canAssignRole('HR Lead', 'Host', { actorPermissions: ['users.manage', 'reservations.view'], targetPermissions: ['reservations.view'] }), true);
  // Seeded system roles carry legacy strings ("read"/"write") that grant nothing.
  assert.strictEqual(canAssignRole('ADMIN', 'MANAGER', { actorPermissions: ['read', 'write', 'manage'], targetPermissions: ['read', 'write'] }), true);
});
test('ADMIN (legacy permission list) can still grant catalog permissions', () => {
  const r = filterGrantablePermissions('ADMIN', ['read', 'write', 'manage'], ['orders.view', 'payments.manage']);
  assert.deepStrictEqual(r.kept, ['orders.view', 'payments.manage']);
});
test('custom roles cannot reuse system role names', () => {
  assert.strictEqual(isReservedRoleName('owner'), true);
  assert.strictEqual(isReservedRoleName(' Admin '), true);
  assert.strictEqual(isReservedRoleName('Shift Lead'), false);
});

console.log('\n--- Discount approval limits ---');
const cashierCapped = { maxDiscountPercent: 10, maxDiscountAmount: 500 };
test('percentage discounts are also checked against the amount cap', () => {
  // 10% of 50,000 = 5,000 > 500 cap.
  assert.ok(manualDiscountError('CASHIER', cashierCapped, { type: 'PERCENTAGE', value: 10, subtotal: 50_000 }));
  assert.strictEqual(manualDiscountError('CASHIER', cashierCapped, { type: 'PERCENTAGE', value: 10, subtotal: 4_000 }), null);
});
test('fixed discounts are also checked against the percentage cap', () => {
  // 400 off a 1,000 bill = 40% > 10% cap.
  assert.ok(manualDiscountError('CASHIER', cashierCapped, { type: 'FIXED', value: 400, subtotal: 1_000 }));
  assert.strictEqual(manualDiscountError('CASHIER', cashierCapped, { type: 'FIXED', value: 100, subtotal: 1_000 }), null);
});
test('unconfigured front-line roles fall back to a conservative limit', () => {
  const unconfigured = { maxDiscountPercent: 100, maxDiscountAmount: 1_000_000 };
  assert.deepStrictEqual(effectiveDiscountLimits('CASHIER', unconfigured), { maxPercent: 10, maxAmount: 1000 });
  assert.ok(manualDiscountError('WAITER', unconfigured, { type: 'PERCENTAGE', value: 100, subtotal: 2_000 }));
});
test('OWNER and ADMIN are not limited', () => {
  assert.strictEqual(manualDiscountError('OWNER', cashierCapped, { type: 'PERCENTAGE', value: 100, subtotal: 50_000 }), null);
  assert.strictEqual(manualDiscountError('ADMIN', null, { type: 'FIXED', value: 50_000, subtotal: 50_000 }), null);
});
test('invalid discounts are rejected', () => {
  assert.ok(manualDiscountError('OWNER', null, { type: 'FIXED', value: -5, subtotal: 100 }));
  assert.ok(manualDiscountError('OWNER', null, { type: 'PERCENTAGE', value: 150, subtotal: 100 }));
});

console.log('\n--- Safe error messages ---');
test('deliberate messages pass through', () => {
  assert.strictEqual(safeErrorMessage(new Error('Invalid email or password'), 'Login failed'), 'Invalid email or password');
});
test('internal errors are hidden', () => {
  const prismaLike = new Error('Invalid `prisma.user.findFirst()` invocation: column "x" does not exist');
  assert.strictEqual(safeErrorMessage(prismaLike, 'Login failed'), 'Login failed');
  assert.strictEqual(safeErrorMessage(new TypeError("Cannot read properties of undefined (reading 'id')"), 'Failed'), 'Failed');
  assert.strictEqual(safeErrorMessage('boom', 'Failed'), 'Failed');
});

console.log(`\n========================================\nAccess Results: ${passed} Passed, ${failed} Failed\n========================================`);
process.exit(failed > 0 ? 1 : 0);
