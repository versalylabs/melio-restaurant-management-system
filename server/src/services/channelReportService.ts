import prisma from '../config/database';
import { getRestaurantTimeZone } from '../utils/timezone';
import { rangeDates } from './reportService';
import { CHANNEL_LABELS, CHANNELS, parseCommissions } from './channelService';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Profit by channel: for closed orders in the period, what each channel
 * brought in, what its commission cost, and what the restaurant kept.
 */
export async function buildChannelReport(restaurantId: string, options: { startDate?: string; endDate?: string; branchId?: string } = {}) {
  const timeZone = await getRestaurantTimeZone(restaurantId);
  const { start, end } = rangeDates(options.startDate, options.endDate, timeZone);
  const [rows, restaurant] = await Promise.all([
    prisma.sale.groupBy({
      by: ['channel'],
      where: { restaurantId, ...(options.branchId ? { branchId: options.branchId } : {}), status: 'COMPLETED', completedAt: { gte: start, lte: end } },
      _sum: { totalAmount: true, commissionAmount: true },
      _count: { _all: true },
    }),
    prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { channelCommissions: true } }),
  ]);
  const totalSales = rows.reduce((t, r) => t + (r._sum.totalAmount || 0), 0);
  const channels = rows
    .map((r) => {
      const sales = round2(r._sum.totalAmount || 0);
      const commission = round2(r._sum.commissionAmount || 0);
      const orders = r._count._all;
      const key = (CHANNELS as readonly string[]).includes(r.channel) ? (r.channel as keyof typeof CHANNEL_LABELS) : null;
      return {
        channel: r.channel,
        label: key ? CHANNEL_LABELS[key] : r.channel,
        orders,
        sales,
        commission,
        kept: round2(sales - commission),
        averageOrder: orders ? round2(sales / orders) : 0,
        shareOfSales: totalSales > 0 ? round2((sales / totalSales) * 100) : 0,
      };
    })
    .sort((a, b) => b.sales - a.sales);
  const commission = round2(channels.reduce((t, c) => t + c.commission, 0));
  return {
    range: { start, end, timeZone },
    totals: { orders: channels.reduce((t, c) => t + c.orders, 0), sales: round2(totalSales), commission, kept: round2(totalSales - commission) },
    channels,
    commissionRates: parseCommissions(restaurant?.channelCommissions),
  };
}
