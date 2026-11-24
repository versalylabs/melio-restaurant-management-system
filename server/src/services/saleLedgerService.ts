/**
 * Shared, concurrency-safe building blocks for anything that changes an
 * order's money or lifecycle (staff payments, refunds, online payment
 * settlement, cancellation, status changes).
 *
 * Rule: inside a transaction, call lockSale() FIRST, then read the sale and
 * its payments. Every writer takes the same row lock, so two cashiers paying
 * the same bill, or a payment racing a cancellation, are serialised instead of
 * both acting on stale balances.
 */
import { Prisma } from '@prisma/client';
import { queueEtimsSale, topUpEtimsSale } from './etimsService';

type Tx = Prisma.TransactionClient;

/** Takes a row lock on the order until the surrounding transaction ends. Returns false if it doesn't exist. */
export async function lockSale(tx: Tx, saleId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "orders" WHERE id = ${saleId} FOR UPDATE`;
  return rows.length > 0;
}

/** Same lock, addressed through the online order row. Returns the saleId, or null. */
export async function lockSaleForOnlineOrder(tx: Tx, onlineOrderId: string): Promise<string | null> {
  const online = await tx.onlineOrder.findUnique({ where: { id: onlineOrderId }, select: { saleId: true } });
  if (!online) return null;
  return (await lockSale(tx, online.saleId)) ? online.saleId : null;
}

/**
 * Recomputes amountPaid / paymentStatus from COMPLETED payments (the single
 * source of truth) and mirrors it onto the online order. Call under lockSale().
 */
export async function syncPaymentState(tx: Tx, saleId: string) {
  const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { onlineOrder: true } });
  if (!sale) throw new Error('ORDER_NOT_FOUND');
  const agg = await tx.payment.aggregate({ where: { saleId, status: 'COMPLETED' }, _sum: { amount: true } });
  const paid = Math.round(Number(agg._sum.amount || 0) * 100) / 100;
  const paymentStatus = paid <= 0 ? 'UNPAID' : paid + 0.005 < sale.totalAmount ? 'PARTIAL' : 'PAID';
  await tx.sale.update({ where: { id: saleId }, data: { amountPaid: paid, paymentStatus } });
  if (sale.onlineOrder) {
    const newOnlineState = paymentStatus === 'PAID' ? 'PAID' : paymentStatus === 'PARTIAL' ? 'PARTIAL' : (sale.onlineOrder.paymentMethod === 'CASH' ? 'PAY_AT_PICKUP' : 'PENDING');
    await tx.onlineOrder.update({ where: { id: sale.onlineOrder.id }, data: { paymentState: newOnlineState } });
  }
  return { paid, paymentStatus, balance: Math.max(0, Math.round((sale.totalAmount - paid) * 100) / 100), saleStatus: sale.status };
}

/** Issues the order's receipt number once (idempotent). */
export async function ensureReceipt(tx: Tx, sale: { id: string; restaurantId: string; branchId: string }) {
  const existing = await tx.receipt.findUnique({ where: { saleId: sale.id } });
  if (existing) {
    // Paid again after a refund: KRA hears about the money again.
    await topUpEtimsSale(tx, sale);
    return existing;
  }
  const counter = await tx.receiptCounter.upsert({
    where: { restaurantId_branchId: { restaurantId: sale.restaurantId, branchId: sale.branchId } },
    create: { restaurantId: sale.restaurantId, branchId: sale.branchId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  const receipt = await tx.receipt.create({ data: { restaurantId: sale.restaurantId, branchId: sale.branchId, saleId: sale.id, receiptNumber: `R-${String(counter.lastNumber).padStart(6, '0')}` } });
  // Branches with a KRA eTIMS device send each receipt to KRA (signed after the payment is saved).
  await queueEtimsSale(tx, sale);
  return receipt;
}

/** Payments that block cancelling an order: taken money, or an M-Pesa prompt still in flight. */
export async function blockingPaymentsForCancel(tx: Tx, saleId: string) {
  const [completed, inFlight] = await Promise.all([
    tx.payment.aggregate({ where: { saleId, status: 'COMPLETED' }, _sum: { amount: true } }),
    tx.payment.count({
      where: {
        saleId,
        status: 'PENDING',
        method: 'MOBILE_MONEY',
        reference: { not: null },
        OR: [
          // Prompt sent recently: the customer may be entering their PIN.
          { createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
          // Safaricom said it was paid but we couldn't verify yet: money is (probably) taken.
          { notes: { contains: '[AWAITING_VERIFICATION' } },
        ],
      },
    }),
  ]);
  return { paidAmount: Number(completed._sum.amount || 0), mpesaInFlight: inFlight > 0 };
}
