import { Request, Response } from 'express';
import { safeRouter } from '../utils/safeRouter';
import { publicApiRateLimiter } from '../middleware/rateLimiter';
import { handleInboundSms, kenyanPhone, optOutNumber, webhookKeyOk } from '../services/smsService';

/**
 * Africa's Talking posts here: replies to the shortcode ({ from, text }) and
 * its own opt-out notices ({ phoneNumber, senderId }).
 * Callback URL: /api/public/sms/inbound?key=<SMS_WEBHOOK_SECRET>
 */
const router = safeRouter();
router.post('/inbound', publicApiRateLimiter, async (req: Request, res: Response) => {
  if (!webhookKeyOk(String(req.query.key || ''))) return res.status(403).end();
  const b = req.body || {};
  if (b.phoneNumber && !b.text) {
    const phone = kenyanPhone(String(b.phoneNumber));
    if (phone) await optOutNumber(phone, 'SMS');
    return res.status(200).json({ ok: true, outcome: phone ? 'OPTED_OUT' : 'IGNORED' });
  }
  const outcome = await handleInboundSms(String(b.from || ''), String(b.text || ''));
  return res.status(200).json({ ok: true, outcome });
});
export default router;
