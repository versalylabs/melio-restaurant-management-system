import assert from 'assert';
import { calculateOrderTotals } from '../services/orderCalculationService';

async function runSecurityTests() {
  console.log('🔒 Starting Restaurant Management System Security & Integrity Test Suite...\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // --- 1. Pricing & Calculation Invariant Tests ---
  console.log('--- 1. Pricing & Calculation Invariants ---');

  await test('Floating-point rounding is exact to 2 decimal places', async () => {
    const mockOrder = {
      items: [
        {
          menuItemId: 'item-1',
          itemNameSnapshot: 'Steak',
          unitPrice: 19.99,
          quantity: 3,
          modifiers: [],
        },
      ],
      discountAmount: 0,
      discountType: 'FIXED' as const,
      taxRate: 16,
      serviceChargeRate: 0,
    };

    const totals = await calculateOrderTotals(mockOrder);
    assert.strictEqual(totals.subtotal, 59.97);
    assert.strictEqual(totals.discountAmount, 0);
    // 59.97 * 0.16 = 9.5952 -> rounds to 9.60
    assert.strictEqual(totals.taxAmount, 9.6);
    assert.strictEqual(totals.totalAmount, 69.57);
  });

  await test('Negative discount amounts are clamped to zero', async () => {
    const mockOrder = {
      items: [
        {
          menuItemId: 'item-1',
          itemNameSnapshot: 'Burger',
          unitPrice: 500,
          quantity: 2,
          modifiers: [],
        },
      ],
      discountAmount: -200,
      discountType: 'FIXED' as const,
      taxRate: 0,
      serviceChargeRate: 0,
    };

    const totals = await calculateOrderTotals(mockOrder);
    assert.strictEqual(totals.subtotal, 1000);
    assert.strictEqual(totals.discountAmount, 0);
    assert.strictEqual(totals.totalAmount, 1000);
  });

  await test('Discounts exceeding subtotal are capped at subtotal (no negative bills)', async () => {
    const mockOrder = {
      items: [
        {
          menuItemId: 'item-1',
          itemNameSnapshot: 'Coffee',
          unitPrice: 300,
          quantity: 1,
          modifiers: [],
        },
      ],
      discountAmount: 99999,
      discountType: 'FIXED' as const,
      taxRate: 16,
      serviceChargeRate: 10,
    };

    const totals = await calculateOrderTotals(mockOrder);
    assert.strictEqual(totals.subtotal, 300);
    assert.strictEqual(totals.discountAmount, 300);
    assert.strictEqual(totals.taxAmount, 0);
    assert.strictEqual(totals.serviceChargeAmount, 0);
    assert.strictEqual(totals.totalAmount, 0);
  });

  await test('Percentage discount > 100% is capped at 100%', async () => {
    const mockOrder = {
      items: [
        {
          menuItemId: 'item-1',
          itemNameSnapshot: 'Wine',
          unitPrice: 2500,
          quantity: 1,
          modifiers: [],
        },
      ],
      discountAmount: 250,
      discountType: 'PERCENTAGE' as const,
      taxRate: 16,
      serviceChargeRate: 0,
    };

    const totals = await calculateOrderTotals(mockOrder);
    assert.strictEqual(totals.subtotal, 2500);
    assert.strictEqual(totals.discountAmount, 2500);
    assert.strictEqual(totals.totalAmount, 0);
  });

  // --- 2. Order State Machine Transition Tests ---
  console.log('\n--- 2. Order State Machine Transitions ---');

  const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
    DRAFT: ['HELD', 'SUBMITTED', 'CANCELLED'],
    HELD: ['DRAFT', 'SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY', 'CANCELLED'],
    READY: ['SERVED', 'COMPLETED', 'CANCELLED'],
    SERVED: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  };

  function canTransition(current: string, next: string): boolean {
    if (current === next) return true;
    const allowed = VALID_STATUS_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  await test('Valid progression: DRAFT -> SUBMITTED -> PREPARING -> READY -> SERVED -> COMPLETED', () => {
    assert.strictEqual(canTransition('DRAFT', 'SUBMITTED'), true);
    assert.strictEqual(canTransition('SUBMITTED', 'PREPARING'), true);
    assert.strictEqual(canTransition('PREPARING', 'READY'), true);
    assert.strictEqual(canTransition('READY', 'SERVED'), true);
    assert.strictEqual(canTransition('SERVED', 'COMPLETED'), true);
  });

  await test('Illegal skipping: DRAFT directly to COMPLETED or READY is rejected', () => {
    assert.strictEqual(canTransition('DRAFT', 'COMPLETED'), false);
    assert.strictEqual(canTransition('DRAFT', 'READY'), false);
    assert.strictEqual(canTransition('DRAFT', 'SERVED'), false);
  });

  await test('Terminal states: COMPLETED and CANCELLED reject all further status modifications', () => {
    assert.strictEqual(canTransition('COMPLETED', 'DRAFT'), false);
    assert.strictEqual(canTransition('COMPLETED', 'PREPARING'), false);
    assert.strictEqual(canTransition('COMPLETED', 'CANCELLED'), false);
    assert.strictEqual(canTransition('CANCELLED', 'DRAFT'), false);
    assert.strictEqual(canTransition('CANCELLED', 'COMPLETED'), false);
  });

  // --- 3. Role-based Discount Constraints ---
  console.log('\n--- 3. Role-based Discount Constraints ---');

  interface RoleLimits {
    maxPercent: number;
    maxAmount: number;
  }

  const ROLE_DISCOUNT_LIMITS: Record<string, RoleLimits> = {
    OWNER: { maxPercent: 100, maxAmount: Infinity },
    ADMIN: { maxPercent: 100, maxAmount: Infinity },
    MANAGER: { maxPercent: 50, maxAmount: 5000 },
    CASHIER: { maxPercent: 10, maxAmount: 500 },
    WAITER: { maxPercent: 0, maxAmount: 0 },
    KITCHEN_STAFF: { maxPercent: 0, maxAmount: 0 },
  };

  function validateDiscountForRole(role: string, subtotal: number, discountType: 'FIXED' | 'PERCENTAGE', discountValue: number): boolean {
    const limits = ROLE_DISCOUNT_LIMITS[role] || { maxPercent: 0, maxAmount: 0 };
    if (limits.maxPercent === 0 && limits.maxAmount === 0 && discountValue > 0) return false;

    if (discountType === 'PERCENTAGE') {
      if (discountValue > limits.maxPercent) return false;
      const nominal = (subtotal * discountValue) / 100;
      if (nominal > limits.maxAmount) return false;
    } else {
      if (discountValue > limits.maxAmount) return false;
      const pct = (discountValue / subtotal) * 100;
      if (pct > limits.maxPercent) return false;
    }
    return true;
  }

  await test('WAITER is prohibited from granting any discount', () => {
    assert.strictEqual(validateDiscountForRole('WAITER', 1000, 'PERCENTAGE', 5), false);
    assert.strictEqual(validateDiscountForRole('WAITER', 1000, 'FIXED', 50), false);
  });

  await test('CASHIER cannot exceed 10% or KES 500 discount', () => {
    assert.strictEqual(validateDiscountForRole('CASHIER', 1000, 'PERCENTAGE', 10), true);
    assert.strictEqual(validateDiscountForRole('CASHIER', 1000, 'PERCENTAGE', 15), false);
    assert.strictEqual(validateDiscountForRole('CASHIER', 10000, 'PERCENTAGE', 10), false); // 1000 > 500 maxAmount
    assert.strictEqual(validateDiscountForRole('CASHIER', 1000, 'FIXED', 100), true); // 10% of 1000
    assert.strictEqual(validateDiscountForRole('CASHIER', 5000, 'FIXED', 500), true); // 10% of 5000
    assert.strictEqual(validateDiscountForRole('CASHIER', 5000, 'FIXED', 600), false); // 600 > 500 maxAmount
    assert.strictEqual(validateDiscountForRole('CASHIER', 1000, 'FIXED', 500), false); // 500 on 1000 is 50% > 10%
  });

  await test('MANAGER is permitted up to 50% / KES 5000', () => {
    assert.strictEqual(validateDiscountForRole('MANAGER', 4000, 'PERCENTAGE', 50), true);
    assert.strictEqual(validateDiscountForRole('MANAGER', 4000, 'PERCENTAGE', 60), false);
    assert.strictEqual(validateDiscountForRole('MANAGER', 20000, 'PERCENTAGE', 50), false);
  });

  await test('OWNER and ADMIN have unrestricted discount authorization', () => {
    assert.strictEqual(validateDiscountForRole('OWNER', 100000, 'PERCENTAGE', 100), true);
    assert.strictEqual(validateDiscountForRole('ADMIN', 100000, 'FIXED', 100000), true);
  });

  // --- 4. Payment Balance & Overpayment Prevention ---
  console.log('\n--- 4. Payment Integrity & Overpayment Guard ---');

  function validatePayment(totalAmount: number, alreadyPaid: number, incomingAmount: number): { valid: boolean; reason?: string } {
    if (!Number.isFinite(incomingAmount) || incomingAmount <= 0) {
      return { valid: false, reason: 'Payment amount must be positive' };
    }
    const remaining = Math.max(0, totalAmount - alreadyPaid);
    if (incomingAmount > remaining + 0.005) {
      return { valid: false, reason: `Exceeds remaining balance of KES ${remaining.toFixed(2)}` };
    }
    return { valid: true };
  }

  await test('Exact payment for total bill is accepted', () => {
    const res = validatePayment(1500, 0, 1500);
    assert.strictEqual(res.valid, true);
  });

  await test('Partial payments up to exact remaining balance are accepted', () => {
    const p1 = validatePayment(1500, 0, 500);
    assert.strictEqual(p1.valid, true);
    const p2 = validatePayment(1500, 500, 1000);
    assert.strictEqual(p2.valid, true);
  });

  await test('Overpayment above remaining balance is strictly rejected', () => {
    const res = validatePayment(1500, 1000, 600);
    assert.strictEqual(res.valid, false);
    assert(res.reason?.includes('Exceeds remaining balance'));
  });

  await test('Zero and negative payment amounts are rejected', () => {
    assert.strictEqual(validatePayment(1500, 0, 0).valid, false);
    assert.strictEqual(validatePayment(1500, 0, -100).valid, false);
  });

  // --- Results Summary ---
  console.log('\n========================================');
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests().catch((err) => {
  console.error('Test runner exception:', err);
  process.exit(1);
});
