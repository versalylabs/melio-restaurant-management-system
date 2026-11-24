import multer from 'multer';
import prisma from '../config/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { sendError, sendResponse } from '../utils/response';
import { createAuditLog } from '../services/auditLogService';
import { daysLeft, sendLicenceReminders } from '../services/licenceService';
import { afterResponse } from '../services/smsService';
import { safeRouter } from '../utils/safeRouter';

/** Licences and permits with expiry reminders (owners and managers). */
const router = safeRouter();
router.use(authenticate);
router.use(authorize('OWNER', 'ADMIN', 'MANAGER'));

const DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const multerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } }).single('document');
/** The optional scan: a PDF or photo up to 3 MB, refused with a clear message otherwise. */
const upload = (req: any, res: any, next: any) =>
  multerUpload(req, res, (err: any) => {
    if (err || (req.file && !DOC_TYPES.includes(req.file.mimetype))) return sendError(res, 'The document must be a PDF or a photo (JPG, PNG, WebP) under 3 MB');
    next();
  });

/**
 * The branch the person's account is tied to (not the branch picked in the top
 * bar): owners see every licence; a branch manager sees their branch's and the
 * ones that cover every branch.
 */
const ownBranch = async (req: AuthRequest) =>
  (await prisma.user.findUnique({ where: { id: req.user!.id }, select: { branchId: true } }))?.branchId || null;
const scope = async (req: AuthRequest) => {
  const branchId = await ownBranch(req);
  return { restaurantId: req.user!.restaurantId, ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}) };
};

/** Checks the form; returns the fields to save or an error message. */
async function readForm(req: AuthRequest): Promise<{ data: any } | { error: string }> {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return { error: 'Enter the licence name, for example "Single Business Permit"' };
  const expires = new Date(String(b.expiresAt || ''));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.expiresAt || '')) || Number.isNaN(expires.getTime())) return { error: 'Enter the expiry date' };
  let branchId: string | null = b.branchId ? String(b.branchId) : null;
  const own = await ownBranch(req);
  if (own) branchId = own;
  if (branchId && !(await prisma.branch.findFirst({ where: { id: branchId, restaurantId: req.user!.restaurantId }, select: { id: true } }))) return { error: 'Branch not found' };
  const text = (v: unknown, max: number) => (String(v ?? '').trim().slice(0, max) || null);
  return {
    data: {
      name: name.slice(0, 120),
      authority: text(b.authority, 120),
      number: text(b.number, 80),
      notes: text(b.notes, 500),
      branchId,
      // End of that day in Nairobi, so "expires 31 Dec" is still valid all of 31 Dec.
      expiresAt: new Date(`${b.expiresAt}T23:59:59+03:00`),
      ...(req.file ? { documentName: req.file.originalname.slice(0, 160), documentType: req.file.mimetype, documentData: req.file.buffer } : {}),
    },
  };
}

// Never the scan's bytes: they are only read by the document route.
const LIST_FIELDS = { id: true, name: true, authority: true, number: true, notes: true, branchId: true, expiresAt: true, documentName: true } as const;
const listShape = (l: any) => ({
  id: l.id, name: l.name, authority: l.authority, number: l.number, notes: l.notes, branchId: l.branchId,
  expiresAt: l.expiresAt, daysLeft: daysLeft(l.expiresAt), hasDocument: !!l.documentName, documentName: l.documentName,
});

router.get('/', async (req: AuthRequest, res) => {
  afterResponse(sendLicenceReminders(req.user!.restaurantId));
  const licences = await prisma.licence.findMany({
    where: await scope(req),
    orderBy: { expiresAt: 'asc' },
    select: LIST_FIELDS,
  });
  return sendResponse(res, true, 'Licences', { licences: licences.map(listShape) });
});

router.post('/', upload, async (req: AuthRequest, res) => {
  const form = await readForm(req);
  if ('error' in form) return sendError(res, form.error);
  const licence = await prisma.licence.create({ data: { ...form.data, restaurantId: req.user!.restaurantId, createdBy: req.user!.id }, select: LIST_FIELDS });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'CREATE', 'Licence', licence.id, `Added licence ${licence.name}, expires ${form.data.expiresAt.toISOString().slice(0, 10)}`);
  return sendResponse(res, true, 'Licence added', listShape(licence), 201);
});

router.put('/:id', upload, async (req: AuthRequest, res) => {
  const existing = await prisma.licence.findFirst({ where: { id: req.params.id, ...(await scope(req)) }, select: { id: true, expiresAt: true, branchId: true } });
  if (!existing) return sendError(res, 'Licence not found', undefined, 404);
  if (!existing.branchId && (await ownBranch(req))) return sendError(res, 'This licence covers every branch: only the owner or an admin can change it', undefined, 403);
  const form = await readForm(req);
  if ('error' in form) return sendError(res, form.error);
  const renewed = form.data.expiresAt.getTime() !== existing.expiresAt.getTime();
  const licence = await prisma.licence.update({
    where: { id: existing.id },
    data: {
      ...form.data,
      // A new expiry date (renewed) starts the reminders again.
      ...(renewed ? { reminded30At: null, reminded7At: null } : {}),
      ...(req.body?.removeDocument === 'true' && !req.file ? { documentName: null, documentType: null, documentData: null } : {}),
    },
    select: LIST_FIELDS,
  });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'Licence', licence.id, `Updated licence ${licence.name}${renewed ? `, now expires ${form.data.expiresAt.toISOString().slice(0, 10)}` : ''}`);
  return sendResponse(res, true, 'Licence updated', listShape(licence));
});

router.delete('/:id', async (req: AuthRequest, res) => {
  const existing = await prisma.licence.findFirst({ where: { id: req.params.id, ...(await scope(req)) }, select: { id: true, name: true, branchId: true } });
  if (!existing) return sendError(res, 'Licence not found', undefined, 404);
  if (!existing.branchId && (await ownBranch(req))) return sendError(res, 'This licence covers every branch: only the owner or an admin can remove it', undefined, 403);
  await prisma.licence.delete({ where: { id: existing.id }, select: { id: true } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'DELETE', 'Licence', existing.id, `Removed licence ${existing.name}`);
  return sendResponse(res, true, 'Licence removed');
});

/** The scanned licence, for viewing (never public). */
router.get('/:id/document', async (req: AuthRequest, res) => {
  const l = await prisma.licence.findFirst({ where: { id: req.params.id, ...(await scope(req)) }, select: { documentName: true, documentType: true, documentData: true } });
  if (!l?.documentData || !l.documentType) return sendError(res, 'No document for this licence', undefined, 404);
  res.setHeader('Content-Type', l.documentType);
  res.setHeader('Content-Disposition', `inline; filename="${(l.documentName || 'licence').replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(Buffer.from(l.documentData));
});

export default router;
