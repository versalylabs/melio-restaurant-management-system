import { safeRouter } from '../utils/safeRouter';
import {
  getKitchenTickets,
  getKitchenTicket,
  updateKitchenTicketStatus,
  updateKitchenTicketItemStatus,
} from '../services/kitchenService';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

const router = safeRouter();

router.use(authenticate);

router.get('/tickets', getKitchenTickets);
router.get('/tickets/:id', getKitchenTicket);
router.patch('/tickets/:id/status', authorize('OWNER', 'ADMIN', 'MANAGER', 'CHEF', 'CASHIER', 'WAITER', 'STAFF', 'COOK', 'BARISTA', 'KITCHEN'), updateKitchenTicketStatus);
router.patch('/tickets/:ticketId/items/:itemId/status', authorize('OWNER', 'ADMIN', 'MANAGER', 'CHEF', 'CASHIER', 'WAITER', 'STAFF', 'COOK', 'BARISTA', 'KITCHEN'), updateKitchenTicketItemStatus);

export default router;
