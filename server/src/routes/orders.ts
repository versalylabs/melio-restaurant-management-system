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
  syncOfflineOrdersController,
} from '../controllers/orderController';
import { authenticate, authorize } from '../middleware/auth';
import { voidOrderItem } from '../services/orderVoidService';
import { updateOrderChannel } from '../services/orderService';
import prisma from '../config/database';
import { sendResponse } from '../utils/response';
import { AuthRequest } from '../middleware/auth';
import { moveOrderTable } from '../services/tableFloorService';

const router = safeRouter();

router.use(authenticate);

router.get('/', getOrdersController);
router.get('/pos/menu', getPosMenuController);
router.get('/pos/tables', getPosTablesController);
/** Front-of-house staff at this branch, for the POS "served by" picker. */
router.get('/pos/staff', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), async (req: AuthRequest, res) => {
  const branchId = req.user!.branchId;
  const users = await prisma.user.findMany({
    where: {
      restaurantId: req.user!.restaurantId,
      status: 'ACTIVE',
      role: { name: { in: ['WAITER', 'CASHIER', 'MANAGER', 'OWNER', 'ADMIN'] } },
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
    },
    select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  return sendResponse(res, true, 'Staff', {
    staff: users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), role: u.role.name })),
  });
});
router.post('/sync-offline', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), syncOfflineOrdersController);
router.get('/:id', getOrderController);
router.post('/', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), createOrderController);
router.patch('/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), updateOrderController);
router.post('/:id/hold', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), holdOrderController);
router.post('/:id/resume', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), resumeOrderController);
router.post('/:id/submit', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), submitOrderController);
router.patch('/:id/channel', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), updateOrderChannel);
router.post('/:id/move-table', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), moveOrderTable);
router.post('/:id/items/:itemId/void', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), voidOrderItem);
router.post('/:id/cancel', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'), cancelOrderController);
router.patch('/:id/status', authorize('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'DELIVERY'), updateOrderStatusController);

export default router;
