import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response } from 'express';
import { createAuditLog } from './auditLogService';

export const getExpenses = async (req: AuthRequest, res: Response) => {
  const { status, category, paymentMethod, from, to, search } = req.query as any;
  const where: any = { restaurantId: req.user!.restaurantId };
  if (req.user!.branchId) where.branchId = req.user!.branchId;
  if (status) where.status = status;
  if (category) where.category = category;
  if (paymentMethod) where.paymentMethod = paymentMethod;
  if (from || to) where.expenseDate = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
  if (search) where.OR = [{ description: { contains: search } }, { vendor: { contains: search } }, { reference: { contains: search } }];
  const expenses = await prisma.expense.findMany({ where, include: { branch: { select: { name: true } }, creator: { select: { firstName: true, lastName: true } }, approver: { select: { firstName: true, lastName: true } }, shift: { select: { id: true, openedAt: true, status: true } } }, orderBy: { expenseDate: 'desc' } });
  const totals = expenses.reduce((a,e)=>{ if(e.status==='APPROVED') a.approved += e.amount; else if(e.status==='PENDING') a.pending += e.amount; return a; }, {approved:0,pending:0});
  return sendResponse(res, true, 'Expenses retrieved', { expenses: expenses.map(e=>({...e, creatorName:`${e.creator.firstName} ${e.creator.lastName}`, approverName:e.approver?`${e.approver.firstName} ${e.approver.lastName}`:null, branchName:e.branch.name})), totals });
};

export const createExpense = async (req: AuthRequest, res: Response) => {
  const branchId = req.user!.branchId;
  const amount = Number(req.body.amount);
  if (!branchId) return sendError(res, 'Select an active branch before recording an expense');
  if (!req.body.category || !req.body.description) return sendError(res, 'Category and description are required');
  if (!Number.isFinite(amount) || amount <= 0) return sendError(res, 'Expense amount must be greater than zero');
  const date = req.body.expenseDate ? new Date(req.body.expenseDate) : new Date();
  if (Number.isNaN(date.getTime())) return sendError(res, 'Invalid expense date');
  const shift = req.body.shiftId ? await prisma.shift.findFirst({ where: { id:req.body.shiftId, restaurantId:req.user!.restaurantId, branchId } }) : await prisma.shift.findFirst({ where: { restaurantId:req.user!.restaurantId, branchId, userId:req.user!.id, status:'OPEN' } });
  if (req.body.shiftId && !shift) return sendError(res, 'Invalid shift');
  const expense = await prisma.expense.create({ data: { restaurantId:req.user!.restaurantId, branchId, shiftId:shift?.id, category:req.body.category, description:req.body.description.trim(), amount, paymentMethod:req.body.paymentMethod || 'CASH', expenseDate:date, vendor:req.body.vendor || undefined, reference:req.body.reference || undefined, notes:req.body.notes || undefined, status:'PENDING', createdBy:req.user!.id } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'CREATE', 'Expense', expense.id, `Recorded expense ${expense.category}: KES ${expense.amount.toLocaleString()}`);
  return sendResponse(res, true, 'Expense recorded and awaiting approval', { expense }, 201);
};

export const updateExpense = async (req: AuthRequest, res: Response) => {
  const expense = await prisma.expense.findFirst({ where:{id:req.params.id,restaurantId:req.user!.restaurantId, ...(req.user!.branchId?{branchId:req.user!.branchId}:{})} });
  if (!expense) return sendError(res,'Expense not found',undefined,404);
  if (expense.status !== 'PENDING') return sendError(res,'Only pending expenses can be edited');
  const amount = req.body.amount == null ? expense.amount : Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return sendError(res,'Expense amount must be greater than zero');
  const updated = await prisma.expense.update({ where:{id:expense.id}, data:{category:req.body.category ?? expense.category,description:req.body.description ?? expense.description,amount,paymentMethod:req.body.paymentMethod ?? expense.paymentMethod,vendor:req.body.vendor ?? expense.vendor,reference:req.body.reference ?? expense.reference,notes:req.body.notes ?? expense.notes,expenseDate:req.body.expenseDate?new Date(req.body.expenseDate):expense.expenseDate} });
  return sendResponse(res,true,'Expense updated',{expense:updated});
};

export const deleteExpense = async (req: AuthRequest, res: Response) => {
  const expense = await prisma.expense.findFirst({ where:{id:req.params.id,restaurantId:req.user!.restaurantId, ...(req.user!.branchId?{branchId:req.user!.branchId}:{})} });
  if (!expense) return sendError(res,'Expense not found',undefined,404);
  if (expense.status !== 'PENDING') return sendError(res,'Only pending expenses can be deleted');
  await prisma.expense.delete({where:{id:expense.id}});
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'DELETE', 'Expense', expense.id, `Deleted expense ${expense.category}`);
  return sendResponse(res,true,'Expense deleted');
};

export const setExpenseStatus = async (req: AuthRequest, res: Response) => {
  const expense = await prisma.expense.findFirst({ where:{id:req.params.id,restaurantId:req.user!.restaurantId, ...(req.user!.branchId?{branchId:req.user!.branchId}:{})} });
  if (!expense) return sendError(res,'Expense not found',undefined,404);
  if (!['APPROVED','REJECTED'].includes(req.body.status)) return sendError(res,'Invalid expense status');
  if (expense.status !== 'PENDING') return sendError(res,'Only pending expenses can be approved or rejected');
  const updated = await prisma.expense.update({ where:{id:expense.id}, data:{status:req.body.status,approvedBy:req.body.status==='APPROVED'?req.user!.id:null,approvedAt:req.body.status==='APPROVED'?new Date():null} });
  await createAuditLog(req.user!.restaurantId, req.user!.id, req.body.status, 'Expense', expense.id, `${req.body.status === 'APPROVED' ? 'Approved' : 'Rejected'} expense ${expense.category}`);
  return sendResponse(res,true,`Expense ${req.body.status.toLowerCase()}`,{expense:updated});
};
