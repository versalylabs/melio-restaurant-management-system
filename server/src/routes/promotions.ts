import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getPromotionsController, getActivePromotionsController, createPromotionController, updatePromotionController, deletePromotionController } from '../controllers/promotionController';
import { safeRouter } from '../utils/safeRouter';

const router = safeRouter();
router.use(authenticate);
router.get('/active', getActivePromotionsController);
router.get('/', getPromotionsController);
router.post('/', authorize('OWNER', 'ADMIN', 'MANAGER'), createPromotionController);
router.put('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), updatePromotionController);
router.delete('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), deletePromotionController);
export default router;
