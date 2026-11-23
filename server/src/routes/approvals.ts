import prisma from '../config/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { comparePassword, sendError, sendResponse } from '../utils/response';
import { authRateLimiter } from '../middleware/rateLimiter';
import { createAuditLog } from '../services/auditLogService';
import { APPROVER_ROLES, hashPin, isValidPin, listApprovers } from '../services/approvalService';
import { safeRouter } from '../utils/safeRouter';

const router = safeRouter();
router.use(authenticate);

/** Who can approve at the signed-in person's branch (names only, for the PIN dialog). */
router.get('/approvers', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), async (req: AuthRequest, res) => {
  // Staff tied to a branch only see their own branch's managers.
  const branchId = req.user!.branchId || (typeof req.query.branchId === 'string' && req.query.branchId ? req.query.branchId : null);
  const approvers = await listApprovers(req.user!.restaurantId, branchId);
  return sendResponse(res, true, 'Approvers', { approvers });
});

/** Whether the signed-in person has an approval PIN. */
router.get('/pin', authorize(...APPROVER_ROLES), async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { pinHash: true, pinUpdatedAt: true } });
  return sendResponse(res, true, 'PIN status', { hasPin: !!user?.pinHash, updatedAt: user?.pinUpdatedAt ?? null });
});

/** Set or change your own approval PIN. Needs your password, so a borrowed session can't set one. */
router.put('/pin', authRateLimiter, authorize(...APPROVER_ROLES), async (req: AuthRequest, res) => {
  const { currentPassword, pin } = req.body || {};
  if (!isValidPin(pin)) return sendError(res, 'The PIN must be 4 to 6 digits');
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
    return sendError(res, 'Choose a PIN that is harder to guess than repeated or consecutive digits');
  }
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { passwordHash: true } });
  if (!user || typeof currentPassword !== 'string' || !(await comparePassword(currentPassword, user.passwordHash))) {
    return sendError(res, 'Your password is not right', undefined, 403);
  }
  await prisma.user.update({ where: { id: req.user!.id }, data: { pinHash: await hashPin(pin), pinUpdatedAt: new Date() } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'User', req.user!.id, 'Set approval PIN');
  return sendResponse(res, true, 'PIN saved', { hasPin: true });
});

/** Owners and admins can clear someone's PIN (e.g. it was shared or the manager left). */
router.delete('/users/:id/pin', authorize('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  const target = await prisma.user.findFirst({ where: { id: req.params.id, restaurantId: req.user!.restaurantId }, select: { id: true, firstName: true, lastName: true } });
  if (!target) return sendError(res, 'User not found', undefined, 404);
  await prisma.user.update({ where: { id: target.id }, data: { pinHash: null, pinUpdatedAt: new Date() } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'User', target.id, `Cleared approval PIN for ${target.firstName} ${target.lastName}`);
  return sendResponse(res, true, 'PIN cleared', {});
});

export default router;
