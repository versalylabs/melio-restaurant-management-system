import { AuthRequest } from '../middleware/auth';
import { Response } from 'express';
import { buildSalesReport, toCsv } from '../services/reportService';
import { sendError, sendResponse } from '../utils/response';

export const getSalesReport = async (req: AuthRequest, res: Response) => {
  try {
    const data = await buildSalesReport(req.user!.restaurantId, {
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      branchId: req.query.branchId as string | undefined,
    });
    return sendResponse(res, true, 'Sales report retrieved', data);
  } catch (error) {
    console.error(error);
    return sendError(res, 'Unable to generate sales report.', undefined, 500);
  }
};

export const exportSalesReport = async (req: AuthRequest, res: Response) => {
  try {
    const data = await buildSalesReport(req.user!.restaurantId, {
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      branchId: req.query.branchId as string | undefined,
    });
    const type = String(req.query.type || 'orders');
    let rows: any[] = data.orders;
    let columns = [
      { key: 'orderNumber', label: 'Order Number' }, { key: 'date', label: 'Date' }, { key: 'branch', label: 'Branch' },
      { key: 'cashier', label: 'Cashier' }, { key: 'customer', label: 'Customer' }, { key: 'total', label: 'Total' }, { key: 'paymentStatus', label: 'Payment Status' },
    ];
    if (type === 'products') { rows = data.byProduct; columns = [{key:'name',label:'Product'},{key:'quantity',label:'Quantity'},{key:'sales',label:'Sales'},{key:'cost',label:'Cost'},{key:'profit',label:'Estimated Profit'}]; rows = rows.map(r=>({...r,profit:r.sales-r.cost})); }
    if (type === 'categories') { rows = data.byCategory; columns = [{key:'name',label:'Category'},{key:'quantity',label:'Quantity'},{key:'sales',label:'Sales'},{key:'cost',label:'Cost'},{key:'profit',label:'Estimated Profit'}]; rows = rows.map(r=>({...r,profit:r.sales-r.cost})); }
    if (type === 'cashiers') { rows = data.byCashier; columns = [{key:'name',label:'Cashier'},{key:'orders',label:'Orders'},{key:'sales',label:'Sales'}]; }
    if (type === 'branches') { rows = data.byBranch; columns = [{key:'name',label:'Branch'},{key:'orders',label:'Orders'},{key:'sales',label:'Sales'}]; }
    if (type === 'payments') { rows = data.byPaymentMethod; columns = [{key:'method',label:'Payment Method'},{key:'transactions',label:'Transactions'},{key:'amount',label:'Amount'}]; }
    if (type === 'customers') { rows = data.customerSpending; columns = [{key:'name',label:'Customer'},{key:'orders',label:'Orders'},{key:'spent',label:'Amount Spent'}]; }
    const csv = toCsv(rows, columns);
    const filename = `sales-report-${type}-${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    console.error(error);
    return sendError(res, 'Unable to export report.', undefined, 500);
  }
};
