import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getNotifications, markRead, markAllRead, getPreferences, updatePreferences } from '../controllers/notificationController';
import { safeRouter } from '../utils/safeRouter';
const router = safeRouter(); router.use(authenticate);
router.get('/preferences', getPreferences); router.put('/preferences', updatePreferences);
router.get('/', getNotifications); router.post('/read-all', markAllRead); router.post('/:id/read', markRead);
export default router;
