import prisma from '../config/database';

export interface OrderCalculationInput {
  items: Array<{
    menuItemId: string;
    unitPrice: number;
    quantity: number;
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
  promotion?: { discountType: 'FIXED'|'PERCENTAGE'; value: number; scope: 'ORDER'|'PRODUCT'; menuItemId?: string|null; maxDiscountAmount?: number|null };
}

export interface OrderCalculationResult {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  totalAmount: number;
  itemCount: number;
}

export const calculateOrderTotals = async (input: OrderCalculationInput): Promise<OrderCalculationResult> => {
  let taxRate = input.taxRate;
  let serviceChargeRate = input.serviceChargeRate;

  if ((taxRate === undefined || serviceChargeRate === undefined) && input.restaurantId) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: input.restaurantId },
      select: { taxRate: true, serviceChargeRate: true },
    });
    if (restaurant) {
      if (taxRate === undefined) taxRate = restaurant.taxRate;
      if (serviceChargeRate === undefined) serviceChargeRate = restaurant.serviceChargeRate;
    }
  }

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

  const taxAmount = Math.round(afterDiscount * normalizedTaxRate * 100) / 100;
  const serviceChargeAmount = Math.round(afterDiscount * normalizedServiceChargeRate * 100) / 100;
  const totalAmount = Math.round((afterDiscount + taxAmount + serviceChargeAmount) * 100) / 100;

  return {
    subtotal,
    discountAmount,
    taxAmount,
    serviceChargeAmount,
    totalAmount,
    itemCount,
  };
};

export const formatCurrency = (amount: number, currency: string = 'KES'): string => {
  return `${currency} ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
