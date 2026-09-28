import { safeRouter } from '../utils/safeRouter';
import { authenticate, authorize } from '../middleware/auth';
import {
  getAutomatedMessageTemplatesController,
  updateAutomatedMessageTemplateController,
  sendTestMessageController,
} from '../controllers/automatedMessagingController';

const router = safeRouter();

router.use(authenticate);

router.get('/', authorize('OWNER', 'ADMIN'), getAutomatedMessageTemplatesController);
router.put('/:action', authorize('OWNER', 'ADMIN'), updateAutomatedMessageTemplateController);
router.post('/test', authorize('OWNER', 'ADMIN'), sendTestMessageController);

export default router;
