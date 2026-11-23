import prisma from '../config/database';

export interface OrderCalculationInput {
  items: Array<{
    menuItemId: string;
    unitPrice: number;
    quantity: number;
    /** STANDARD | ZERO_RATED | EXEMPT; looked up from the menu item when not given. */
    taxCategory?: string;
    modifiers?: Array<{
      modifierOptionId?: string;
      priceAdjustment?: number;
    }>;
  }>;
  discountAmount?: number;
  discountType?: 'FIXED' | 'PERCENTAGE';
  restaurantId?: string;
  branchId?: string;
  taxRate?: number;
  serviceChargeRate?: number;
  /** Menu prices already include VAT; looked up from the restaurant when not given. */
  pricesIncludeTax?: boolean;
  promotion?: { discountType: 'FIXED'|'PERCENTAGE'; value: number; scope: 'ORDER'|'PRODUCT'; menuItemId?: string|null; maxDiscountAmount?: number|null };
}

export interface OrderCalculationResult {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  totalAmount: number;
  itemCount: number;
  /** Frozen on the bill: how VAT was worked out, and the base of each VAT category after discount, excluding VAT. */
  taxInclusive: boolean;
  taxableAmount: number;
  zeroRatedAmount: number;
  exemptAmount: number;
}

export const TAX_CATEGORIES = ['STANDARD', 'ZERO_RATED', 'EXEMPT'] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];
const asCategory = (value: unknown): TaxCategory => (TAX_CATEGORIES.includes(value as TaxCategory) ? (value as TaxCategory) : 'STANDARD');
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The VAT fields to store on a bill from its calculated totals. */
export const taxFields = (totals: OrderCalculationResult) => ({
  taxInclusive: totals.taxInclusive,
  taxableAmount: totals.taxableAmount,
  zeroRatedAmount: totals.zeroRatedAmount,
  exemptAmount: totals.exemptAmount,
});

export const calculateOrderTotals = async (input: OrderCalculationInput): Promise<OrderCalculationResult> => {
  let taxRate = input.taxRate;
  let serviceChargeRate = input.serviceChargeRate;
  let pricesIncludeTax = input.pricesIncludeTax;

  if ((taxRate === undefined || serviceChargeRate === undefined || pricesIncludeTax === undefined) && input.restaurantId) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: input.restaurantId },
      select: { taxRate: true, serviceChargeRate: true, pricesIncludeTax: true },
    });
    if (restaurant) {
      if (taxRate === undefined) taxRate = restaurant.taxRate;
      if (serviceChargeRate === undefined) serviceChargeRate = restaurant.serviceChargeRate;
      if (pricesIncludeTax === undefined) pricesIncludeTax = restaurant.pricesIncludeTax;
    }
  }
  const inclusive = !!pricesIncludeTax;

  // Each item's VAT category (zero-rated and exempt items carry no VAT).
  const missing = [...new Set(input.items.filter((i) => !i.taxCategory).map((i) => i.menuItemId))];
  const categoryById = new Map<string, TaxCategory>();
  if (missing.length) {
    const rows = await prisma.menuItem.findMany({ where: { id: { in: missing } }, select: { id: true, taxCategory: true } });
    rows.forEach((r) => categoryById.set(r.id, asCategory(r.taxCategory)));
  }
  const byCategory: Record<TaxCategory, number> = { STANDARD: 0, ZERO_RATED: 0, EXEMPT: 0 };

  taxRate = Math.max(0, Number(taxRate ?? 16) || 0);
  serviceChargeRate = Math.max(0, Number(serviceChargeRate ?? 0) || 0);

  let subtotal = 0;
  let itemCount = 0;

  for (const item of input.items) {
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const price = Math.max(0, Number(item.unitPrice) || 0);
    const itemSubtotal = price * qty;
    let modifierTotal = 0;
    for (const mod of item.modifiers || []) {
      const modAdjustment = Math.max(0, Number(mod.priceAdjustment) || 0);
      modifierTotal += modAdjustment * qty;
    }
    subtotal += itemSubtotal + modifierTotal;
    byCategory[item.taxCategory ? asCategory(item.taxCategory) : categoryById.get(item.menuItemId) || 'STANDARD'] += itemSubtotal + modifierTotal;
    itemCount += qty;
  }

  subtotal = Math.round(subtotal * 100) / 100;

  let discountAmount = Math.max(0, Number(input.discountAmount) || 0);
  if (input.promotion) {
    if (input.promotion.scope === 'ORDER') {
      discountAmount = input.promotion.discountType === 'PERCENTAGE'
        ? (subtotal * Math.min(100, Math.max(0, input.promotion.value))) / 100
        : Math.max(0, input.promotion.value);
    } else if (input.promotion.menuItemId) {
      const eligible = input.items
        .filter((i) => i.menuItemId === input.promotion!.menuItemId)
        .reduce((sum, i) => {
          const qty = Math.max(1, Math.floor(Number(i.quantity) || 1));
          const price = Math.max(0, Number(i.unitPrice) || 0);
          const modTotal = (i.modifiers || []).reduce((m, x) => m + Math.max(0, Number(x.priceAdjustment) || 0), 0);
          return sum + (price + modTotal) * qty;
        }, 0);

      discountAmount = input.promotion.discountType === 'PERCENTAGE'
        ? (eligible * Math.min(100, Math.max(0, input.promotion.value))) / 100
        : input.promotion.value * input.items
            .filter((i) => i.menuItemId === input.promotion!.menuItemId)
            .reduce((n, i) => n + Math.max(1, Math.floor(Number(i.quantity) || 1)), 0);
    }
  } else if (input.discountType === 'PERCENTAGE' && discountAmount > 0) {
    discountAmount = (subtotal * Math.min(100, Math.max(0, discountAmount))) / 100;
  }

  discountAmount = Math.round(discountAmount * 100) / 100;
  if (input.promotion?.maxDiscountAmount != null && input.promotion.maxDiscountAmount >= 0) {
    discountAmount = Math.min(discountAmount, input.promotion.maxDiscountAmount);
  }
  // Guarantee discount is strictly between 0 and subtotal
  discountAmount = Math.max(0, Math.min(discountAmount, subtotal));

  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const normalizedTaxRate = taxRate > 1 ? taxRate / 100 : taxRate;
  const normalizedServiceChargeRate = serviceChargeRate > 1 ? serviceChargeRate / 100 : serviceChargeRate;

  // Which VAT category the discount comes off: a promotion on one product comes off
  // that product's category; an order-wide or manual discount is spread in proportion.
  const promoItem = input.promotion && input.promotion.scope !== 'ORDER' && input.promotion.menuItemId
    ? input.items.find((i) => i.menuItemId === input.promotion!.menuItemId)
    : undefined;
  const productCategory: TaxCategory | null = promoItem
    ? promoItem.taxCategory ? asCategory(promoItem.taxCategory) : categoryById.get(promoItem.menuItemId) || 'STANDARD'
    : null;
  const after = (category: TaxCategory) => {
    const amount = byCategory[category];
    if (productCategory) return category === productCategory ? Math.max(0, amount - discountAmount) : amount;
    return subtotal > 0 ? amount - (discountAmount * amount) / subtotal : 0;
  };
  const standardAfterDiscount = after('STANDARD');
  const zeroRatedAmount = round2(after('ZERO_RATED'));
  const exemptAmount = round2(after('EXEMPT'));

  // Inclusive prices: VAT is the part of the price already paid (r / (1 + r)), not added on top.
  const taxAmount = inclusive
    ? round2((standardAfterDiscount * normalizedTaxRate) / (1 + normalizedTaxRate))
    : round2(standardAfterDiscount * normalizedTaxRate);
  const taxableAmount = round2(inclusive ? standardAfterDiscount - taxAmount : standardAfterDiscount);
  const serviceChargeAmount = round2(afterDiscount * normalizedServiceChargeRate);
  const totalAmount = round2(afterDiscount + (inclusive ? 0 : taxAmount) + serviceChargeAmount);

  return {
    subtotal,
    discountAmount,
    taxAmount,
    serviceChargeAmount,
    totalAmount,
    itemCount,
    taxInclusive: inclusive,
    taxableAmount,
    zeroRatedAmount,
    exemptAmount,
  };
};

export const formatCurrency = (amount: number, currency: string = 'KES'): string => {
  return `${currency} ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
