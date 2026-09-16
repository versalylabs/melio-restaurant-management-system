import prisma from '../config/database';
import { realtimeService } from './realtimeService';

export async function createNotification(input: {
  restaurantId: string; branchId?: string | null; userId?: string | null; customerId?: string | null;
  channel?: string; type: string; title: string; message: string; referenceType?: string; referenceId?: string; metadata?: any;
}) {
  return prisma.notification.create({ data: {
    ...input,
    channel: input.channel || 'IN_APP',
    status: input.channel && input.channel !== 'IN_APP' ? 'SIMULATED' : 'SENT',
    sentAt: new Date(), metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
  }});
}

export async function notifyRestaurantStaff(restaurantId: string, branchId: string | null | undefined, type: string, title: string, message: string, referenceType?: string, referenceId?: string) {
  const users = await prisma.user.findMany({ where: { restaurantId, status: 'ACTIVE', OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] }, select: { id: true } });
  await Promise.all(users.map((u) => createNotification({ restaurantId, branchId, userId: u.id, type, title, message, referenceType, referenceId })));
  
  // Realtime notification broadcast
  realtimeService.broadcast(`notifications:${restaurantId}`, 'new_notification', {
    type,
    title,
    message,
    referenceType,
    referenceId,
    timestamp: new Date().toISOString(),
  });
}
