import { Response as ExpressResponse } from 'express';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import {
  getTemplatesForRestaurant,
  updateSingleTemplate,
  AutomatedMessageTemplate,
} from '../services/automatedMessagingService';
import { notificationHistory, NotificationLog } from '../services/customerNotificationService';
import prisma from '../config/database';

export const getAutomatedMessageTemplatesController = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const restaurantId = req.user?.restaurantId;
    if (!restaurantId) return sendError(res, 'Authentication required', undefined, 401);

    const templates = getTemplatesForRestaurant(restaurantId);
    return sendResponse(res, true, 'Automated message templates retrieved', { templates });
  } catch (err: any) {
    return sendError(res, err.message || 'Failed to retrieve templates');
  }
};

export const updateAutomatedMessageTemplateController = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const restaurantId = req.user?.restaurantId;
    if (!restaurantId) return sendError(res, 'Authentication required', undefined, 401);

    const { action } = req.params;
    const { enabled, channel, subject, template } = req.body;

    const updated = updateSingleTemplate(restaurantId, action, {
      ...(enabled !== undefined && { enabled }),
      ...(channel && { channel }),
      ...(subject !== undefined && { subject }),
      ...(template !== undefined && { template }),
    });

    return sendResponse(res, true, 'Template updated successfully', {
      template: updated.find((t) => t.action === action),
    });
  } catch (err: any) {
    return sendError(res, err.message || 'Failed to update template');
  }
};

export const sendTestMessageController = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const restaurantId = req.user?.restaurantId;
    if (!restaurantId) return sendError(res, 'Authentication required', undefined, 401);

    const { action, recipientEmail, recipientPhone } = req.body;
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { name: true },
    });

    const restaurantName = restaurant?.name || 'Melio Restaurant';
    const templates = getTemplatesForRestaurant(restaurantId);
    const tmpl = templates.find((t) => t.action === action) || templates[0];

    // Sample context
    const sampleContext: Record<string, string> = {
      restaurantName,
      customerName: 'Alex Mercer',
      orderNumber: '#1042',
      status: action.replace('ORDER_', ''),
      totalAmount: 'KES 3,450',
      trackingLink: '/online-order/sample-tracking-token-123',
      deliveryAddress: 'Apartment 4B, 123 Westlands Road, Nairobi',
      reference: 'RES-8821',
      guestCount: '4',
      branchName: 'Kilimani Main',
      reservationDate: 'Tonight',
      reservationTime: '7:30 PM',
    };

    let body = tmpl.template;
    let subject = tmpl.subject;
    for (const [key, val] of Object.entries(sampleContext)) {
      body = body.split(`{${key}}`).join(val);
      subject = subject.split(`{${key}}`).join(val);
    }

    let emailTarget = recipientEmail;
    if (!emailTarget && req.user?.id) {
      const userRec = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true } });
      emailTarget = userRec?.email;
    }
    if (!emailTarget) {
      emailTarget = 'owner@example.com';
    }

    if (emailTarget) {
      const emailLog: NotificationLog = {
        id: `test-email-${Date.now()}`,
        type: 'EMAIL',
        recipient: emailTarget,
        subject: `[TEST] ${subject}`,
        message: body,
        status: process.env.SMTP_HOST ? 'SENT' : 'SIMULATED',
        createdAt: new Date(),
      };
      notificationHistory.unshift(emailLog);
      console.log(`[TEST EMAIL DISPATCH -> ${emailTarget}]: Subject "${emailLog.subject}"`);
    }

    if (recipientPhone) {
      const smsLog: NotificationLog = {
        id: `test-sms-${Date.now()}`,
        type: 'SMS',
        recipient: recipientPhone,
        message: body,
        status: process.env.SMS_API_KEY ? 'SENT' : 'SIMULATED',
        createdAt: new Date(),
      };
      notificationHistory.unshift(smsLog);
    }

    return sendResponse(res, true, 'Test message dispatched successfully', {
      subject: `[TEST] ${subject}`,
      body,
      recipient: emailTarget,
    });
  } catch (err: any) {
    return sendError(res, err.message || 'Failed to send test message');
  }
};
