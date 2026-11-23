import prisma from '../config/database';
import { buildSalesReport, rangeDates } from './reportService';
import { getRestaurantTimeZone, zonedParts } from '../utils/timezone';

export async function buildAdvancedAnalytics(restaurantId: string, options: { startDate?: string; endDate?: string; branchId?: string } = {}) {
  const report = await buildSalesReport(restaurantId, options);
  const timeZone = await getRestaurantTimeZone(restaurantId);
  const { start, end } = rangeDates(options.startDate, options.endDate, timeZone);
  const where: any = { restaurantId, status: 'COMPLETED', createdAt: { gte: start, lte: end } };
  if (options.branchId) where.branchId = options.branchId;
  const sales = await prisma.sale.findMany({ where, select: { id:true, customerId:true, totalAmount:true, createdAt:true } });

  // Group by the restaurant's local calendar day.
  const dayKey = (date: Date) => {
    const p = zonedParts(date, timeZone);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  };
  const byDay = new Map<string, { sales:number; orders:number }>();
  for (let t=start.getTime(); t<=end.getTime(); t+=86_400_000) byDay.set(dayKey(new Date(t)), {sales:0,orders:0});
  for (const sale of sales) { const k=dayKey(sale.createdAt); const row=byDay.get(k)||{sales:0,orders:0}; row.orders++; row.sales += Number(sale.totalAmount || 0); byDay.set(k,row); }
  const trend = [...byDay.entries()].map(([date,v])=>({date,...v}));
  const customerOrders = new Map<string, number>();
  sales.filter(s=>s.customerId).forEach(s=>customerOrders.set(s.customerId!, (customerOrders.get(s.customerId!)||0)+1));
  const identified = customerOrders.size;
  const repeat = [...customerOrders.values()].filter(n=>n>1).length;
  const forecastBase = trend.slice(-7).reduce((a,x)=>a+x.sales,0)/Math.max(1,trend.slice(-7).length);
  const foodCostPct = report.summary.grossSales ? (report.summary.totalCost/report.summary.grossSales)*100 : 0;
  const grossMarginPct = report.summary.grossSales ? (report.summary.grossProfitEstimate/report.summary.grossSales)*100 : 0;
  return {
    ...report,
    analytics: {
      salesTrend: trend,
      foodCostPercentage: foodCostPct,
      grossMarginPercentage: grossMarginPct,
      repeatPurchaseRate: identified ? (repeat/identified)*100 : 0,
      repeatCustomers: repeat,
      identifiedCustomers: identified,
      forecastNextDaySales: forecastBase,
      topProducts: report.byProduct.slice(0,8).map((p:any)=>({ ...p, profit:p.sales-p.cost, margin:p.sales?((p.sales-p.cost)/p.sales)*100:0 })),
      topCategories: report.byCategory.slice(0,6).map((p:any)=>({ ...p, profit:p.sales-p.cost })),
      branchPerformance: report.byBranch,
      staffPerformance: report.byCashier,
    }
  };
}
