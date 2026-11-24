import { Request, Response } from 'express';
import { safeRouter } from '../utils/safeRouter';
import { clientIp } from '../middleware/rateLimiter';
import { branchForCallbackToken, handleTillConfirmation } from '../services/tillService';

/**
 * Safaricom C2B callbacks for branch tills. Each registered branch has its own
 * secret address (/confirm/<token>); MPESA_CALLBACK_ALLOWED_IPS (required to
 * connect a live till) limits calls to Safaricom's addresses.
 */
const router = safeRouter();
const ipAllowed = (req: Request) => {
  const ips = (process.env.MPESA_CALLBACK_ALLOWED_IPS || '').split(',').map((ip) => ip.trim()).filter(Boolean);
  return !ips.length || ips.includes(clientIp(req));
};

// Validation: accept every payment (the till takes the money either way, and nothing is stored here).
router.post(['/validate', '/validate/:token'], (_req: Request, res: Response) => res.json({ ResultCode: '0', ResultDesc: 'Accepted' }));

router.post('/confirm/:token', async (req: Request, res: Response) => {
  if (!ipAllowed(req)) return res.status(401).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
  try {
    const branch = await branchForCallbackToken(req.params.token);
    if (!branch) return res.status(401).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
    const out = await handleTillConfirmation(branch, req.body || {});
    if (!out.stored && out.reason !== 'already stored') console.warn('[Till] Confirmation not stored:', out.reason);
    return res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (err) {
    // A failure here means the payment is not in Melio yet: say so, so it can be sent again.
    console.error('[Till] Confirmation failed:', err);
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Try again' });
  }
});

export default router;
