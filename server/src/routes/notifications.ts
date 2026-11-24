import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getNotifications, markRead, markAllRead, getPreferences, updatePreferences } from '../controllers/notificationController';
import { safeRouter } from '../utils/safeRouter';
import { sendLicenceReminders } from '../services/licenceService';
import { afterResponse } from '../services/smsService';
const router = safeRouter(); router.use(authenticate);
router.get('/preferences', getPreferences); router.put('/preferences', updatePreferences);
// Opening notifications is also when licence expiry reminders are checked.
router.get('/', (req: any, _res, next) => { if (req.user?.restaurantId) afterResponse(sendLicenceReminders(req.user.restaurantId)); next(); }, getNotifications); router.post('/read-all', markAllRead); router.post('/:id/read', markRead);
export default router;
