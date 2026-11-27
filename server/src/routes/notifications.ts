import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getNotifications, markRead, markAllRead, getPreferences, updatePreferences } from '../controllers/notificationController';
import { safeRouter } from '../utils/safeRouter';
import { sendLicenceReminders } from '../services/licenceService';
import { signPendingEtims } from '../services/etimsService';
import { afterResponse } from '../services/smsService';
const router = safeRouter(); router.use(authenticate);
router.get('/preferences', getPreferences); router.put('/preferences', updatePreferences);
// Opening notifications is also when licence expiry reminders are checked.
// Piggybacked catch-up work (the daily cron also runs it): at most every 10 minutes
// per restaurant on this server instance, not on every bell check.
const lastSweep = new Map<string, number>();
router.get('/', (req: any, _res, next) => {
  const restaurantId = req.user?.restaurantId;
  if (restaurantId && Date.now() - (lastSweep.get(restaurantId) || 0) > 10 * 60_000) {
    lastSweep.set(restaurantId, Date.now());
    afterResponse(sendLicenceReminders(restaurantId));
    afterResponse(signPendingEtims(restaurantId));
  }
  next();
}, getNotifications); router.post('/read-all', markAllRead); router.post('/:id/read', markRead);
export default router;
