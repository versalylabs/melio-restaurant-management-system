import { safeRouter } from '../utils/safeRouter';
import {
  getOrdersController,
  getOrderController,
  createOrderController,
  updateOrderController,
  updateOrderStatusController,
  holdOrderController,
  resumeOrderController,
  submitOrderController,
  cancelOrderController,
  getPosMenuController,
  getPosTablesController,
} from '../controllers/orderController';
import { authenticate, authorize } from '../middleware/auth';

const router = safeRouter();

router.use(authenticate);

router.get('/', getOrdersController);
router.get('/pos/menu', getPosMenuController);
router.get('/pos/tables', getPosTablesController);
router.get('/:id', getOrderController);
router.post('/', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), createOrderController);
router.patch('/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), updateOrderController);
router.post('/:id/hold', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), holdOrderController);
router.post('/:id/resume', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), resumeOrderController);
router.post('/:id/submit', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), submitOrderController);
router.post('/:id/cancel', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), cancelOrderController);
router.patch('/:id/status', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), updateOrderStatusController);

export default router;
