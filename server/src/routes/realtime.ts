import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { authenticate, AuthRequest } from '../middleware/auth';
import { realtimeService } from '../services/realtimeService';
import prisma from '../config/database';
import { generateStreamTicket, sendResponse } from '../utils/response';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

// Issue a 60-second ticket for opening the staff stream (EventSource cannot send headers).
router.post('/ticket', authenticate, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { tokenVersion: true } });
  const ticket = generateStreamTicket(req.user!.id, req.user!.restaurantId, user?.tokenVersion ?? 0);
  return sendResponse(res, true, 'Stream ticket issued', { ticket, expiresInSeconds: 60 });
});

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

  // Extra branch-scoped channels may be requested, but only for branches this
  // user can access: their own branch, or (owners/admins/managers) any branch
  // of their own restaurant. Anything else is silently dropped.
  const BRANCH_CHANNEL = /^(branch|kitchen|orders|reservations):([A-Za-z0-9-]{1,64})$/;
  const requested = String(req.query.channels || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((c) => c.match(BRANCH_CHANNEL))
    .filter((m): m is RegExpMatchArray => m !== null);

  const requestedBranchIds = [...new Set(requested.map((m) => m[2]))];
  const canSwitchBranch = ['OWNER', 'ADMIN', 'MANAGER'].includes(user.roleName);
  const accessibleBranchIds = new Set<string>(user.branchId ? [user.branchId] : []);
  if (canSwitchBranch && requestedBranchIds.length > 0) {
    const branches = await prisma.branch.findMany({
      where: { id: { in: requestedBranchIds }, restaurantId: user.restaurantId },
      select: { id: true },
    });
    branches.forEach((b) => accessibleBranchIds.add(b.id));
  }
  for (const m of requested) {
    if (accessibleBranchIds.has(m[2])) channels.add(m[0]);
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
  // Requires the full reservation ID (random UUID). The short RES-XXXXXX code
  // is guessable and would let anyone follow strangers' bookings.
  const reservationId = String(req.params.reference || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(reservationId)) {
    res.status(400).json({ success: false, message: 'Valid reservation ID required' });
    return;
  }
  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { id: true } });
  if (!reservation) {
    res.status(404).json({ success: false, message: 'Reservation not found' });
    return;
  }
  const reference = `RES-${reservation.id.slice(-6).toUpperCase()}`;

  const clientId = `guest-res-${reference}-${crypto.randomBytes(4).toString('hex')}`;
  const channels = [
    `reservation:${reference}`,
  ];

  realtimeService.registerClient(clientId, res, channels);
});

export default router;
