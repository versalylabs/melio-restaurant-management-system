import { timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import prisma from '../config/database';
import { safeRouter } from '../utils/safeRouter';
import { signPendingEtims } from '../services/etimsService';
import { sendLicenceReminders } from '../services/licenceService';

/**
 * Background work on a schedule (Vercel Cron, see vercel.json), so it also
 * happens when nobody has Melio open: KRA invoices waiting to be sent, and
 * licence reminders. Vercel sends `Authorization: Bearer <CRON_SECRET>`.
 */
const router = safeRouter();

const authorised = (req: Request) => {
  const secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) return false; // no secret set: the job is off
  const a = Buffer.from(String(req.headers.authorization || ''));
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
};

router.get('/sweep', async (req: Request, res: Response) => {
  if (!authorised(req)) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const started = Date.now();
  const etims = await prisma.etimsInvoice.findMany({ where: { status: 'PENDING', nextTryAt: { lte: new Date() } }, distinct: ['restaurantId'], select: { restaurantId: true }, take: 50 });
  let invoices = 0;
  for (const r of etims) invoices += await signPendingEtims(r.restaurantId, null, 20, 10_000);
  const licences = await prisma.licence.findMany({ distinct: ['restaurantId'], select: { restaurantId: true } });
  let reminders = 0;
  for (const r of licences) reminders += await sendLicenceReminders(r.restaurantId);
  return res.json({ success: true, data: { invoicesTried: invoices, remindersSent: reminders, ms: Date.now() - started } });
});

export default router;
