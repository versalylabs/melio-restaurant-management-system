import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { authenticate, AuthRequest } from '../middleware/auth';
import { realtimeService } from '../services/realtimeService';
import prisma from '../config/database';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

// Staff Real-time Events Stream (Authenticated)
router.get('/stream', authenticate, async (req: AuthRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const clientId = `staff-${user.id}-${crypto.randomBytes(4).toString('hex')}`;
  
  // Default staff channels based on user restaurant & branch
  const channels = new Set<string>([
    `restaurant:${user.restaurantId}`,
    `notifications:${user.restaurantId}`,
  ]);

  if (user.branchId) {
    channels.add(`branch:${user.branchId}`);
    channels.add(`kitchen:${user.branchId}`);
    channels.add(`orders:${user.branchId}`);
    channels.add(`reservations:${user.branchId}`);
  }

  // Allow client to specify additional custom requested channels if within restaurant
  const queryChannels = String(req.query.channels || '').split(',').map((c) => c.trim()).filter(Boolean);
  for (const c of queryChannels) {
    // Only allow channels scoped to their restaurant or branch
    if (c.startsWith(`branch:`) || c.startsWith(`kitchen:`) || c.startsWith(`orders:`) || c.startsWith(`reservations:`)) {
      channels.add(c);
    }
  }

  realtimeService.registerClient(clientId, res, Array.from(channels));
});

// Public Live Customer Order Tracking Stream
router.get('/public/track/:trackingToken', async (req: Request, res: Response) => {
  const trackingToken = String(req.params.trackingToken || '').trim();
  if (!trackingToken) {
    res.status(400).json({ success: false, message: 'Tracking token required' });
    return;
  }

  const onlineOrder = await prisma.onlineOrder.findUnique({
    where: { trackingToken },
    select: { id: true, saleId: true, branchId: true },
  });

  if (!onlineOrder) {
    res.status(404).json({ success: false, message: 'Order not found' });
    return;
  }

  const clientId = `guest-order-${trackingToken.slice(0, 8)}-${crypto.randomBytes(4).toString('hex')}`;
  const channels = [
    `order-tracking:${trackingToken}`,
    `order:${onlineOrder.saleId}`,
  ];

  realtimeService.registerClient(clientId, res, channels);
});

// Public Live Reservation Status Stream
router.get('/public/reservations/:reference', async (req: Request, res: Response) => {
  const reference = String(req.params.reference || '').trim();
  if (!reference) {
    res.status(400).json({ success: false, message: 'Reference required' });
    return;
  }

  const clientId = `guest-res-${reference}-${crypto.randomBytes(4).toString('hex')}`;
  const channels = [
    `reservation:${reference}`,
  ];

  realtimeService.registerClient(clientId, res, channels);
});

export default router;
