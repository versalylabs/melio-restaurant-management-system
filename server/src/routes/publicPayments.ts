import { Request, Response } from 'express';
import { sendResponse, sendError } from '../utils/response';
import {
  initiateMpesaStkPush,
  confirmSimulatedMpesaPayment,
  getMpesaStatus,
  handleMpesaCallback,
} from '../services/mpesaService';
import { processCardPayment } from '../services/cardPaymentService';
import { PaymentError } from '../services/onlinePaymentService';
import { notificationHistory } from '../services/customerNotificationService';
import { paymentRateLimiter } from '../middleware/rateLimiter';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { safeRouter } from '../utils/safeRouter';

const router = safeRouter();

const sendPaymentError = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof PaymentError) return sendError(res, err.message, undefined, err.statusCode);
  console.error(fallback, err);
  return sendError(res, fallback, undefined, 500);
};

// M-Pesa STK Push Initiation
router.post('/mpesa/stk-push', paymentRateLimiter, async (req: Request, res: Response) => {
  try {
    const { trackingToken, phoneNumber } = req.body || {};
    if (!trackingToken || !phoneNumber) return sendError(res, 'trackingToken and phoneNumber are required');
    const result = await initiateMpesaStkPush({ trackingToken: String(trackingToken).trim(), phoneNumber: String(phoneNumber).trim() });
    return sendResponse(res, true, result.message, result);
  } catch (err) {
    return sendPaymentError(res, err, 'Failed to initiate M-Pesa payment');
  }
});

// Safaricom Daraja STK callback. Authenticated by the ?token= secret that we
// append to CallBackURL when initiating the push.
router.post('/mpesa/callback', async (req: Request, res: Response) => {
  try {
    const result = await handleMpesaCallback(req.body, req.query.token);
    if (!result.handled) console.warn('[M-Pesa] Callback not applied:', result.reason);
  } catch (err) {
    if (err instanceof PaymentError && err.statusCode === 401) {
      console.warn('[M-Pesa] Rejected callback with invalid token from', req.ip);
      return res.status(401).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
    }
    console.error('[M-Pesa] Callback processing error:', err);
  }
  // Always acknowledge so Safaricom does not keep retrying.
  return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// Simulation-only manual confirmation (returns 403 unless PAYMENT_SIMULATION=true).
router.post('/mpesa/confirm', paymentRateLimiter, async (req: Request, res: Response) => {
  try {
    const { checkoutRequestId } = req.body || {};
    if (!checkoutRequestId) return sendError(res, 'checkoutRequestId is required');
    const result = await confirmSimulatedMpesaPayment(String(checkoutRequestId).trim());
    return sendResponse(res, true, 'Payment successfully confirmed', result);
  } catch (err) {
    return sendPaymentError(res, err, 'Failed to confirm M-Pesa payment');
  }
});

// M-Pesa Transaction Status Query (reads from the database, so it works across serverless instances)
router.get('/mpesa/status/:checkoutRequestId', async (req: Request, res: Response) => {
  const status = await getMpesaStatus(String(req.params.checkoutRequestId || '').trim());
  if (!status) return sendError(res, 'Transaction not found', undefined, 404);
  return sendResponse(res, true, 'Status retrieved', status);
});

// Card Payment (simulation only until a hosted card processor is integrated)
router.post('/card/process', paymentRateLimiter, async (req: Request, res: Response) => {
  try {
    const { trackingToken, cardNumber, cardName } = req.body || {};
    if (!trackingToken) return sendError(res, 'trackingToken is required');
    const result = await processCardPayment({
      trackingToken: String(trackingToken).trim(),
      cardNumber: cardNumber ? String(cardNumber) : undefined,
      cardName: cardName ? String(cardName).trim() : undefined,
    });
    return sendResponse(res, true, 'Card payment processed successfully', result);
  } catch (err) {
    return sendPaymentError(res, err, 'Failed to process card payment');
  }
});

// View Recent Customer Notifications (Staff Only)
router.get('/notifications/recent', authenticate, authorize('OWNER', 'ADMIN', 'MANAGER'), (_req: AuthRequest, res: Response) => {
  return sendResponse(res, true, 'Recent notification logs retrieved', {
    notifications: notificationHistory.slice(0, 30),
  });
});

export default router;
