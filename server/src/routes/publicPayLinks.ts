import { payLinkIpRateLimiter, payLinkTokenRateLimiter, publicApiRateLimiter } from '../middleware/rateLimiter';
import { getPublicPaymentLink, getPublicPaymentLinkStatus, payPublicPaymentLink, simulatePublicPaymentLink } from '../services/paymentLinkService';
import { safeRouter } from '../utils/safeRouter';

/** Payment links customers open from WhatsApp: no sign-in, the unguessable token is the key. */
const router = safeRouter();
router.get('/:token', publicApiRateLimiter, getPublicPaymentLink);
router.post('/:token/mpesa', payLinkIpRateLimiter, payLinkTokenRateLimiter, payPublicPaymentLink);
router.get('/:token/status/:checkoutRequestId', publicApiRateLimiter, getPublicPaymentLinkStatus);
router.post('/:token/simulate/:checkoutRequestId', payLinkIpRateLimiter, simulatePublicPaymentLink);
export default router;
