/**
 * Manual discount approval limits.
 *
 * Every role has two limits: a maximum percentage and a maximum amount.
 * A manual discount must satisfy BOTH, whichever way it was entered:
 * a 10% discount on a KES 50,000 bill is KES 5,000 and is checked against
 * the amount cap too.
 *
 * The schema defaults (100% / 1,000,000) mean "never configured". Leaving
 * them on front-line roles let any cashier discount a bill to zero, so
 * unconfigured non-admin roles fall back to a conservative limit until an
 * owner sets real values on the Roles page.
 */

export const UNCONFIGURED_PERCENT = 100;
export const UNCONFIGURED_AMOUNT = 1_000_000;
export const FALLBACK_MAX_PERCENT = 10;
export const FALLBACK_MAX_AMOUNT = 1_000;

/** Roles allowed to approve any discount. */
const UNLIMITED_ROLES = new Set(['OWNER', 'ADMIN']);

export interface RoleDiscountLimits {
  maxDiscountPercent?: number | null;
  maxDiscountAmount?: number | null;
}

export function effectiveDiscountLimits(roleName: string, role: RoleDiscountLimits | null | undefined) {
  if (UNLIMITED_ROLES.has(roleName)) return { maxPercent: Infinity, maxAmount: Infinity };
  const pct = role?.maxDiscountPercent;
  const amt = role?.maxDiscountAmount;
  const unconfigured = (pct == null || pct === UNCONFIGURED_PERCENT) && (amt == null || amt === UNCONFIGURED_AMOUNT);
  if (unconfigured) return { maxPercent: FALLBACK_MAX_PERCENT, maxAmount: FALLBACK_MAX_AMOUNT };
  return {
    maxPercent: pct == null ? FALLBACK_MAX_PERCENT : Math.max(0, pct),
    maxAmount: amt == null ? FALLBACK_MAX_AMOUNT : Math.max(0, amt),
  };
}

/**
 * Returns an error message if the manual discount exceeds the role's limits,
 * otherwise null. `value` is a percentage when type is PERCENTAGE, else an amount.
 */
export function manualDiscountError(
  roleName: string,
  role: RoleDiscountLimits | null | undefined,
  discount: { type: 'FIXED' | 'PERCENTAGE'; value: number; subtotal: number },
): string | null {
  const value = Number(discount.value);
  if (!Number.isFinite(value) || value < 0) return 'Invalid discount amount';
  if (value === 0) return null;
  if (discount.type === 'PERCENTAGE' && value > 100) return 'Discount percentage cannot exceed 100%';

  const { maxPercent, maxAmount } = effectiveDiscountLimits(roleName, role);
  const subtotal = Math.max(0, Number(discount.subtotal) || 0);
  const amount = discount.type === 'PERCENTAGE' ? (subtotal * value) / 100 : Math.min(value, subtotal);
  const percent = discount.type === 'PERCENTAGE' ? value : subtotal > 0 ? (amount / subtotal) * 100 : 0;

  // Small epsilon so 10% of a bill is not rejected by float rounding.
  if (percent > maxPercent + 1e-9 || amount > maxAmount + 0.005) {
    return 'Discount exceeds your approval limit. Ask a manager to apply it.';
  }
  return null;
}
