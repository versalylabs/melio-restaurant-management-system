import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';

const isWithinTime = (start?: string | null, end?: string | null) => {
  if (!start || !end) return true;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return false;
  const a = sh * 60 + sm, b = eh * 60 + em;
  return a <= b ? current >= a && current <= b : current >= a || current <= b;
};

export const getPromotions = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const promotions = await prisma.promotion.findMany({ where: { restaurantId }, include: { branch: true, menuItem: true, customer: true }, orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] });
  return sendResponse(res, true, 'Promotions retrieved', { promotions });
};

export const getActivePromotions = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId; const branchId = req.user!.branchId; const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
  const now = new Date();
  const promotions = await prisma.promotion.findMany({ where: { restaurantId, active: true, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])], AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] }, include: { menuItem: { select: { id: true, name: true } }, customer: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } });
  const filtered = promotions.filter(p => !p.customerId || p.customerId === customerId).filter(p => isWithinTime(p.startTime, p.endTime));
  return sendResponse(res, true, 'Active promotions retrieved', { promotions: filtered });
};

export const createPromotion = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId; const userId = req.user!.id;
  const b = req.body || {};
  if (!b.name?.trim()) return sendError(res, 'Promotion name is required');
  const value = Number(b.value); if (!Number.isFinite(value) || value <= 0) return sendError(res, 'Discount value must be greater than 0');
  if (!['PERCENTAGE','FIXED'].includes(b.discountType)) return sendError(res, 'Invalid discount type');
  if (!['ORDER','PRODUCT'].includes(b.scope)) return sendError(res, 'Invalid promotion scope');
  if (b.discountType === 'PERCENTAGE' && value > 100) return sendError(res, 'Percentage discount cannot exceed 100%');
  if (b.scope === 'PRODUCT' && !b.menuItemId) return sendError(res, 'Product promotions require a menu item');
  if (b.customerId) { const c = await prisma.customer.findFirst({ where: { id: b.customerId, restaurantId } }); if (!c) return sendError(res, 'Invalid customer'); }
  if (b.branchId) { const br = await prisma.branch.findFirst({ where: { id: b.branchId, restaurantId, status: 'ACTIVE' } }); if (!br) return sendError(res, 'Invalid branch'); }
  const promotion = await prisma.promotion.create({ data: { restaurantId, branchId: b.branchId || null, name: b.name.trim(), code: b.code?.trim() || null, description: b.description || null, discountType: b.discountType, value, scope: b.scope, menuItemId: b.menuItemId || null, customerId: b.customerId || null, minSubtotal: Math.max(0, Number(b.minSubtotal) || 0), maxDiscountAmount: b.maxDiscountAmount ? Math.max(0, Number(b.maxDiscountAmount)) : null, startsAt: b.startsAt ? new Date(b.startsAt) : null, endsAt: b.endsAt ? new Date(b.endsAt) : null, startTime: b.startTime || null, endTime: b.endTime || null, happyHour: !!b.happyHour, active: b.active !== false, createdBy: userId } });
  await createAuditLog(restaurantId, userId, 'CREATE', 'Promotion', promotion.id, `Created promotion ${promotion.name}`);
  return sendResponse(res, true, 'Promotion created successfully', promotion, 201);
};

export const updatePromotion = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId; const userId = req.user!.id; const id = req.params.id;
  const existing = await prisma.promotion.findFirst({ where: { id, restaurantId } }); if (!existing) return sendError(res, 'Promotion not found', undefined, 404);
  const b=req.body||{}; const data:any={};
  for (const k of ['name','description','code','discountType','scope','menuItemId','customerId','branchId','startTime','endTime']) if (b[k] !== undefined) data[k]=b[k] || null;
  if (b.name !== undefined) data.name=b.name.trim(); if (b.value !== undefined) data.value=Number(b.value); if (b.minSubtotal !== undefined) data.minSubtotal=Math.max(0,Number(b.minSubtotal)||0); if (b.maxDiscountAmount !== undefined) data.maxDiscountAmount=b.maxDiscountAmount===null||b.maxDiscountAmount===''?null:Math.max(0,Number(b.maxDiscountAmount)); if (b.startsAt !== undefined) data.startsAt=b.startsAt?new Date(b.startsAt):null; if (b.endsAt !== undefined) data.endsAt=b.endsAt?new Date(b.endsAt):null; if (b.happyHour !== undefined) data.happyHour=!!b.happyHour; if (b.active !== undefined) data.active=!!b.active;
  if (data.discountType==='PERCENTAGE' && data.value>100) return sendError(res,'Percentage discount cannot exceed 100%');
  const promotion=await prisma.promotion.update({where:{id},data}); await createAuditLog(restaurantId,userId,'UPDATE','Promotion',id,`Updated promotion ${promotion.name}`); return sendResponse(res,true,'Promotion updated successfully',promotion);
};
export const deletePromotion = async (req: AuthRequest,res:ExpressResponse)=>{const restaurantId=req.user!.restaurantId,userId=req.user!.id,id=req.params.id;const p=await prisma.promotion.findFirst({where:{id,restaurantId}});if(!p)return sendError(res,'Promotion not found',undefined,404);await prisma.promotion.delete({where:{id}});await createAuditLog(restaurantId,userId,'DELETE','Promotion',id,`Deleted promotion ${p.name}`);return sendResponse(res,true,'Promotion deleted successfully');};

export const validatePromotion = async (promotionId:string, restaurantId:string, branchId:string, customerId:string|undefined, subtotal:number) => {
  const p=await prisma.promotion.findFirst({where:{id:promotionId,restaurantId,active:true}}); if(!p) throw new Error('Promotion is not active or does not exist');
  if(p.branchId && p.branchId!==branchId) throw new Error('Promotion is not available at this branch');
  if(p.customerId && p.customerId!==customerId) throw new Error('Promotion is only available to the selected customer');
  const now=new Date(); if(p.startsAt && p.startsAt>now) throw new Error('Promotion has not started'); if(p.endsAt && p.endsAt<now) throw new Error('Promotion has expired'); if(!isWithinTime(p.startTime,p.endTime)) throw new Error('Promotion is outside its active hours'); if(subtotal<p.minSubtotal) throw new Error(`Minimum subtotal of ${p.minSubtotal.toFixed(2)} is required for this promotion`);
  return p;
};
