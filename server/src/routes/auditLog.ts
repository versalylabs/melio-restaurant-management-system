import { Router } from 'express';
import { getAuditLogsController } from '../controllers/auditLogController';
import { authenticate, authorize } from '../middleware/auth';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

router.use(authenticate);
router.use(authorize('OWNER', 'ADMIN'));

router.get('/', getAuditLogsController);

export default router;
