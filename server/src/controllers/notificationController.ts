import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse } from '../utils/response';

export async function getNotifications(req: AuthRequest, res: Response) {
  const unreadOnly = req.query.unreadOnly === 'true';
  const notifications = await prisma.notification.findMany({ where: { restaurantId: req.user!.restaurantId, OR: [{ userId: req.user!.id }, { userId: null }], ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 });
  const data = notifications.map(n => ({ ...n, metadata: n.metadata ? JSON.parse(n.metadata) : null }));
  return sendResponse(res, true, 'Notifications retrieved', { notifications: data, unreadCount: notifications.filter(n => !n.readAt).length });
}
export async function markRead(req: AuthRequest, res: Response) {
  await prisma.notification.updateMany({ where: { id: req.params.id, restaurantId: req.user!.restaurantId, OR: [{ userId: req.user!.id }, { userId: null }] }, data: { readAt: new Date() } });
  return sendResponse(res, true, 'Notification marked as read');
}
export async function markAllRead(req: AuthRequest, res: Response) {
  await prisma.notification.updateMany({ where: { restaurantId: req.user!.restaurantId, OR: [{ userId: req.user!.id }, { userId: null }], readAt: null }, data: { readAt: new Date() } });
  return sendResponse(res, true, 'Notifications marked as read');
}
export async function getPreferences(req: AuthRequest, res: Response) {
  const preference = await prisma.notificationPreference.upsert({ where: { userId: req.user!.id }, update: {}, create: { restaurantId: req.user!.restaurantId, userId: req.user!.id } });
  return sendResponse(res, true, 'Notification preferences retrieved', { preference });
}
export async function updatePreferences(req: AuthRequest, res: Response) {
  const allowed = ['inAppEnabled','emailEnabled','smsEnabled','whatsappEnabled','orderUpdates','lowStock','purchaseUpdates','loyaltyUpdates'];
  const data: any = {}; for (const k of allowed) if (typeof req.body[k] === 'boolean') data[k] = req.body[k];
  const preference = await prisma.notificationPreference.upsert({ where: { userId: req.user!.id }, update: data, create: { restaurantId: req.user!.restaurantId, userId: req.user!.id, ...data } });
  return sendResponse(res, true, 'Notification preferences updated', { preference });
}
