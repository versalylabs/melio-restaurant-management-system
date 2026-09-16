import { safeRouter } from '../utils/safeRouter';
import {
  getKitchenStationsController,
  getKitchenStationController,
  createKitchenStationController,
  updateKitchenStationController,
  deleteKitchenStationController,
  assignMenuItemToStationController,
  removeMenuItemFromStationController,
} from '../controllers/kitchenController';
import { authenticate, authorize } from '../middleware/auth';

const router = safeRouter();

router.use(authenticate);

router.get('/stations', getKitchenStationsController);
router.get('/stations/:id', getKitchenStationController);
router.post('/stations', authorize('OWNER', 'ADMIN', 'MANAGER'), createKitchenStationController);
router.patch('/stations/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), updateKitchenStationController);
router.delete('/stations/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), deleteKitchenStationController);
router.post('/stations/:stationId/items', authorize('OWNER', 'ADMIN', 'MANAGER'), assignMenuItemToStationController);
router.delete('/stations/:stationId/items/:menuItemId', authorize('OWNER', 'ADMIN', 'MANAGER'), removeMenuItemFromStationController);

export default router;
