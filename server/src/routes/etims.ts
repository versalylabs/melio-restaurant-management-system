import prisma from '../config/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { sendError, sendResponse } from '../utils/response';
import { safeRouter } from '../utils/safeRouter';
import { createAuditLog } from '../services/auditLogService';
import { etimsEnvironment, KraError, setUpEtimsDevice, signPendingEtims } from '../services/etimsService';

/** KRA eTIMS: each branch's device, and the receipts and credit notes KRA hasn't signed. */
const router = safeRouter();
router.use(authenticate);

/** Staff tied to a branch see only that branch; owners see all, or the top-bar branch. */
const branchScope = async (req: AuthRequest) =>
  (await prisma.user.findUnique({ where: { id: req.user!.id }, select: { branchId: true } }))?.branchId || req.user!.branchId || null;

router.get('/', authorize('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = await branchScope(req);
  const where = { restaurantId, ...(branchId ? { branchId } : {}) };
  const [restaurant, branches, devices, unsigned, signed, unsignedCount] = await Promise.all([
    prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { kraPin: true } }),
    prisma.branch.findMany({ where: { restaurantId, ...(branchId ? { id: branchId } : {}), status: { not: 'INACTIVE' } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    // Never the device key.
    prisma.etimsDevice.findMany({ where, select: { branchId: true, bhfId: true, serialNumber: true, itemClassCode: true, environment: true, sdcId: true, mrcNo: true, lastInvoiceNo: true, createdAt: true } }),
    prisma.etimsInvoice.findMany({
      where: { ...where, status: { in: ['PENDING', 'REJECTED'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, branchId: true, kind: true, status: true, attempts: true, lastError: true, nextTryAt: true, createdAt: true, invoiceNo: true, amount: true, sale: { select: { orderNumber: true, totalAmount: true } } },
    }),
    prisma.etimsInvoice.count({ where: { ...where, status: 'SIGNED' } }),
    prisma.etimsInvoice.count({ where: { ...where, status: { in: ['PENDING', 'REJECTED'] } } }),
  ]);
  return sendResponse(res, true, 'eTIMS status', {
    environment: etimsEnvironment(),
    hasKraPin: !!restaurant?.kraPin,
    branches: branches.map((b) => ({ ...b, device: devices.find((d) => d.branchId === b.id) || null })),
    unsigned,
    unsignedCount,
    signedCount: signed,
  });
});

/** Set up (or set up again) a branch's KRA device. */
router.post('/devices', authorize('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  const { branchId, bhfId, serialNumber, itemClassCode } = req.body || {};
  const branch = typeof branchId === 'string' ? await prisma.branch.findFirst({ where: { id: branchId, restaurantId: req.user!.restaurantId }, select: { id: true, name: true } }) : null;
  if (!branch) return sendError(res, 'Choose a branch');
  // Staff tied to a branch (custom roles with settings access) only set up their own.
  const own = (await prisma.user.findUnique({ where: { id: req.user!.id }, select: { branchId: true } }))?.branchId;
  if (own && own !== branch.id) return sendError(res, 'You can only set up your own branch', undefined, 403);
  if (!/^\d{2}$/.test(String(bhfId || ''))) return sendError(res, 'Enter the 2-digit KRA branch number (00 for the head office)');
  const serial = String(serialNumber || '').trim();
  if (!serial || serial.length > 100) return sendError(res, "Enter the device serial number you registered with KRA");
  if (!/^\d{10}$/.test(String(itemClassCode || ''))) return sendError(res, "Enter KRA's 10-digit item class code for your menu");
  try {
    await setUpEtimsDevice(req.user!.restaurantId, branch.id, { bhfId: String(bhfId), serialNumber: serial, itemClassCode: String(itemClassCode) });
  } catch (err: any) {
    if (err instanceof KraError) return sendError(res, err.message, undefined, err.permanent ? 400 : 502);
    throw err;
  }
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'Branch', branch.id, `Set up the KRA eTIMS device for ${branch.name} (KRA branch ${bhfId}, ${etimsEnvironment()})`);
  return sendResponse(res, true, `${branch.name} is connected to KRA eTIMS. New receipts will be sent to KRA.`);
});

/** Send what is waiting now; with { id }, send a refused one again (after fixing the cause). */
router.post('/retry', authorize('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = await branchScope(req);
  if (typeof req.body?.id === 'string') {
    const reset = await prisma.etimsInvoice.updateMany({
      where: { id: req.body.id, restaurantId, ...(branchId ? { branchId } : {}), status: 'REJECTED' },
      data: { status: 'PENDING', nextTryAt: new Date(), lastError: null },
    });
    if (!reset.count) return sendError(res, 'That invoice is not waiting to be sent again', undefined, 404);
    await createAuditLog(restaurantId, req.user!.id, 'UPDATE', 'EtimsInvoice', req.body.id, 'Sent a refused eTIMS invoice to KRA again');
  }
  await prisma.etimsInvoice.updateMany({ where: { restaurantId, ...(branchId ? { branchId } : {}), status: 'PENDING' }, data: { nextTryAt: new Date() } });
  // Short waits, and it stops at the first sign that KRA is down, so this answers quickly.
  const tried = await signPendingEtims(restaurantId, branchId, 10, 8_000);
  const left = await prisma.etimsInvoice.count({ where: { restaurantId, ...(branchId ? { branchId } : {}), status: { in: ['PENDING', 'REJECTED'] } } });
  return sendResponse(res, true, left ? `${left} still not signed` : 'Everything is signed by KRA', { tried, left });
});

export default router;
