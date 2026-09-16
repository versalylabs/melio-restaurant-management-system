import { Router, Request, Response } from 'express';
import { sendResponse, sendError } from '../utils/response';
import { initiateMpesaStkPush, confirmMpesaPayment, getMpesaStatus } from '../services/mpesaService';
import { processCardPayment } from '../services/cardPaymentService';
import { notificationHistory } from '../services/customerNotificationService';
import { paymentRateLimiter } from '../middleware/rateLimiter';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

// M-Pesa STK Push Initiation
router.post('/mpesa/stk-push', paymentRateLimiter, async (req: Request, res: Response) => {
  try {
    const { trackingToken, phoneNumber, amount } = req.body || {};
    if (!trackingToken || !phoneNumber) {
      return sendError(res, 'trackingToken and phoneNumber are required');
    }

    const result = await initiateMpesaStkPush({
      trackingToken: String(trackingToken).trim(),
      phoneNumber: String(phoneNumber).trim(),
      amount: amount ? Number(amount) : undefined,
    });

    return sendResponse(res, true, result.message, result);
  } catch (err: any) {
    console.error('STK Push Error:', err);
    return sendError(res, err.message || 'Failed to initiate M-Pesa STK Push');
  }
});

// M-Pesa Payment Confirmation / Webhook
router.post('/mpesa/confirm', async (req: Request, res: Response) => {
  try {
    const { checkoutRequestId, mpesaReceiptNumber } = req.body || {};
    if (!checkoutRequestId) {
      return sendError(res, 'checkoutRequestId is required');
    }

    const result = await confirmMpesaPayment({
      checkoutRequestId: String(checkoutRequestId).trim(),
      mpesaReceiptNumber: mpesaReceiptNumber ? String(mpesaReceiptNumber).trim() : undefined,
    });

    return sendResponse(res, true, 'Payment successfully confirmed', result);
  } catch (err: any) {
    console.error('M-Pesa Confirmation Error:', err);
    return sendError(res, err.message || 'Failed to confirm M-Pesa payment');
  }
});

// M-Pesa Transaction Status Query
router.get('/mpesa/status/:checkoutRequestId', (req: Request, res: Response) => {
  const checkoutRequestId = String(req.params.checkoutRequestId || '').trim();
  const status = getMpesaStatus(checkoutRequestId);
  if (!status) {
    return sendError(res, 'Transaction not found', undefined, 404);
  }
  return sendResponse(res, true, 'Status retrieved', status);
});

// Card Payment Processing
router.post('/card/process', paymentRateLimiter, async (req: Request, res: Response) => {
  try {
    const { trackingToken, cardNumber, cardExp, cardCvc, cardName, amount } = req.body || {};
    if (!trackingToken) {
      return sendError(res, 'trackingToken is required');
    }

    const result = await processCardPayment({
      trackingToken: String(trackingToken).trim(),
      cardNumber: cardNumber ? String(cardNumber).trim() : undefined,
      cardExp: cardExp ? String(cardExp).trim() : undefined,
      cardCvc: cardCvc ? String(cardCvc).trim() : undefined,
      cardName: cardName ? String(cardName).trim() : undefined,
      amount: amount ? Number(amount) : undefined,
    });

    return sendResponse(res, true, 'Card payment processed successfully', result);
  } catch (err: any) {
    console.error('Card Payment Error:', err);
    return sendError(res, err.message || 'Failed to process card payment');
  }
});

import { authenticate, authorize, AuthRequest } from '../middleware/auth';

// View Recent Customer Notifications (Staff Only)
router.get('/notifications/recent', authenticate, authorize('OWNER', 'ADMIN', 'MANAGER'), (_req: AuthRequest, res: Response) => {
  return sendResponse(res, true, 'Recent notification logs retrieved', {
    notifications: notificationHistory.slice(0, 30),
  });
});

export default router;
