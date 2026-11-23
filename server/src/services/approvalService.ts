import bcrypt from 'bcryptjs';
import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/response';
import { createAuditLog } from './auditLogService';
import { createNotification } from './notificationService';

const notifyUser = (restaurantId: string, userId: string, message: string) =>
  createNotification({ restaurantId, userId, type: 'SECURITY', title: 'Approval PIN locked', message }).catch((err: unknown) =>
    console.error('PIN lock notification failed:', err)
  );

/**
 * Manager approval by PIN.
 *
 * Risky till actions (a void after the kitchen has the order, a discount above
 * the person's limit, a refund) need a manager to pick their name and enter
 * their PIN on the device in front of them. The approval is recorded against
 * the manager, so the loss prevention report shows who allowed what.
 *
 * The client sends `approval: { approverId, pin }`. Without it the server
 * answers 428 with errors.approval = ['APPROVAL_REQUIRED'] and the client asks.
 */

export const APPROVER_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];
const PIN_PATTERN = /^\d{4,6}$/;
/** Wrong PINs allowed per approver before their PIN is locked. */
const MAX_FAILURES = 5;
/** Each further run of wrong PINs locks for longer: 15 minutes, 1 hour, then 24 hours. */
const LOCK_STEPS_MS = [15 * 60_000, 60 * 60_000, 24 * 60 * 60_000];

export type ApprovalCode = 'APPROVAL_REQUIRED' | 'APPROVAL_INVALID' | 'APPROVAL_LOCKED' | 'APPROVAL_NOT_ALLOWED';

export class ApprovalError extends Error {
  constructor(public code: ApprovalCode, message: string, public statusCode: number) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export interface Approver {
  id: string;
  name: string;
  roleName: string;
  role: { maxDiscountPercent: number; maxDiscountAmount: number };
}

export const isValidPin = (pin: unknown): pin is string => typeof pin === 'string' && PIN_PATTERN.test(pin);
export const hashPin = (pin: string) => bcrypt.hash(pin, 10);

/** People at this branch who can approve: owner/admin/manager, active, with a PIN set. */
export async function listApprovers(restaurantId: string, branchId?: string | null) {
  const users = await prisma.user.findMany({
    where: {
      restaurantId,
      status: 'ACTIVE',
      pinHash: { not: null },
      role: { name: { in: APPROVER_ROLES } },
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
    },
    select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  return users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), role: u.role.name }));
}

/**
 * Checks the approval sent with a request. `action` describes what is being
 * approved (for the audit log); `allow` can refuse an approver whose own
 * limits don't cover the action (e.g. a manager approving a bigger discount).
 */
export async function verifyApproval(
  req: AuthRequest,
  action: string,
  options: { branchId?: string | null; allow?: (approver: Approver) => string | null } = {}
): Promise<Approver> {
  const approval = req.body?.approval;
  const restaurantId = req.user!.restaurantId;
  if (!approval || typeof approval !== 'object' || !approval.approverId || approval.pin === undefined) {
    throw new ApprovalError('APPROVAL_REQUIRED', `A manager's approval is needed to ${action}.`, 428);
  }

  const branchId = options.branchId ?? req.user!.branchId ?? null;
  const user = await prisma.user.findFirst({
    where: {
      id: String(approval.approverId),
      restaurantId,
      status: 'ACTIVE',
      role: { name: { in: APPROVER_ROLES } },
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      pinHash: true,
      pinLockedUntil: true,
      role: { select: { name: true, maxDiscountPercent: true, maxDiscountAmount: true } },
    },
  });

  if (!user || !user.pinHash) {
    throw new ApprovalError('APPROVAL_INVALID', 'That manager has no approval PIN set. Choose another manager.', 428);
  }

  // Reserve the attempt atomically before checking the PIN, so a burst of
  // parallel guesses can't all slip under the limit. Locked PINs reserve nothing.
  // The attempt that reaches a multiple of MAX_FAILURES locks the PIN in the
  // same statement, so parallel guesses behind it are refused straight away.
  // If that attempt turns out to be the right PIN, the lock is lifted below.
  const now = new Date();
  const [lockShort, lockMedium, lockLong] = LOCK_STEPS_MS.map((ms) => new Date(now.getTime() + ms));
  const reserved = await prisma.$queryRaw<{ pinFailedCount: number }[]>`
    UPDATE "users" SET
      "pinFailedCount" = "pinFailedCount" + 1,
      "pinLockedUntil" = CASE
        WHEN ("pinFailedCount" + 1) % ${MAX_FAILURES} <> 0 THEN "pinLockedUntil"
        WHEN ("pinFailedCount" + 1) / ${MAX_FAILURES} <= 1 THEN ${lockShort}
        WHEN ("pinFailedCount" + 1) / ${MAX_FAILURES} = 2 THEN ${lockMedium}
        ELSE ${lockLong}
      END
    WHERE "id" = ${user.id} AND ("pinLockedUntil" IS NULL OR "pinLockedUntil" <= ${now})
    RETURNING "pinFailedCount"`;
  if (!reserved.length) {
    throw new ApprovalError('APPROVAL_LOCKED', `${user.firstName}'s PIN is locked after too many wrong tries. Try again later or ask another manager.`, 429);
  }
  const attempt = reserved[0].pinFailedCount;
  const runPosition = ((attempt - 1) % MAX_FAILURES) + 1;

  const pinOk = typeof approval.pin === 'string' && PIN_PATTERN.test(approval.pin) && (await bcrypt.compare(approval.pin, user.pinHash));
  if (!pinOk) {
    await createAuditLog(restaurantId, req.user!.id, 'APPROVAL_FAILED', 'Approval', user.id, `Wrong approval PIN for ${user.firstName} ${user.lastName} while trying to ${action}`);
    if (runPosition >= MAX_FAILURES) {
      // (The lock was already set when this attempt was reserved.) Tell the manager someone was guessing their PIN.
      const requester = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { firstName: true, lastName: true } });
      void notifyUser(restaurantId, user.id, `Your approval PIN was locked after ${MAX_FAILURES} wrong tries on ${requester ? `${requester.firstName} ${requester.lastName}`.trim() : 'a staff member'}'s screen. If that wasn't expected, change your PIN.`);
      throw new ApprovalError('APPROVAL_LOCKED', `Too many wrong PINs. ${user.firstName}'s PIN is locked for a while; ask another manager.`, 429);
    }
    const left = MAX_FAILURES - runPosition;
    throw new ApprovalError('APPROVAL_INVALID', `That PIN is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, 428);
  }
  // Right PIN: start counting afresh and lift a lock this very attempt may have set.
  await prisma.user.update({ where: { id: user.id }, data: { pinFailedCount: 0, pinLockedUntil: null } });

  const approver: Approver = {
    id: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    roleName: user.role.name,
    role: { maxDiscountPercent: user.role.maxDiscountPercent, maxDiscountAmount: user.role.maxDiscountAmount },
  };
  const refusal = options.allow?.(approver);
  if (refusal) throw new ApprovalError('APPROVAL_NOT_ALLOWED', refusal, 403);
  return approver;
}

/** Sends an ApprovalError in the shape the client understands; returns false for other errors. */
export function sendApprovalError(res: Response, err: unknown): boolean {
  if (!(err instanceof ApprovalError)) return false;
  sendError(res, err.message, { approval: [err.code] }, err.statusCode);
  return true;
}
