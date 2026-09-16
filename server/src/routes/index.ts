import { Router } from 'express';
import authRoutes from './auth';
import restaurantRoutes from './restaurant';
import dashboardRoutes from './dashboard';
import auditLogRoutes from './auditLog';
import usersRoutes from './users';
import rolesRoutes from './roles';
import categoriesRoutes from './categories';
import menuItemsRoutes from './menuItems';
import modifierGroupsRoutes from './modifierGroups';
import sectionsRoutes from './sections';
import tablesRoutes from './tables';
import tableCombinationsRoutes from './tableCombinations';
import ordersRoutes from './orders';
import kitchenRoutes from './kitchen';
import kitchenTicketsRoutes from './kitchenTickets';
import inventoryRoutes from './inventory';
import branchesRoutes from './branches';
import customersRoutes from './customers';
import paymentsRoutes from './payments';
import reportsRoutes from './reports';
import reservationsRoutes from './reservations';
import promotionsRoutes from './promotions';
import publicOrderingRoutes from './publicOrdering';
import customerRoutes from './customer';
import notificationRoutes from './notifications';
import analyticsRoutes from './analytics';
import shiftsRoutes from './shifts';
import expensesRoutes from './expenses';
import websiteRoutes from './website';
import realtimeRoutes from './realtime';
import publicPaymentsRoutes from './publicPayments';
import { notFound } from '../middleware/errorHandler';
import { errorHandler } from '../middleware/errorHandler';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

router.use('/auth', authRoutes);
router.use('/restaurant', restaurantRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/audit-logs', auditLogRoutes);
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/categories', categoriesRoutes);
router.use('/menu-items', menuItemsRoutes);
router.use('/modifier-groups', modifierGroupsRoutes);
router.use('/sections', sectionsRoutes);
router.use('/tables', tablesRoutes);
router.use('/table-combinations', tableCombinationsRoutes);
router.use('/orders', ordersRoutes);
router.use('/kitchen', kitchenRoutes);
router.use('/kitchen', kitchenTicketsRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/branches', branchesRoutes);
router.use('/customers', customersRoutes);
router.use('/payments', paymentsRoutes);
router.use('/reports', reportsRoutes);
router.use('/reservations', reservationsRoutes);
router.use('/promotions', promotionsRoutes);
router.use('/public', publicOrderingRoutes);
router.use('/customer', customerRoutes);
router.use('/notifications', notificationRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/shifts', shiftsRoutes);
router.use('/expenses', expensesRoutes);
router.use('/website', websiteRoutes);
router.use('/realtime', realtimeRoutes);
router.use('/public/payments', publicPaymentsRoutes);

router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString(),
  });
});

router.use(notFound);
router.use(errorHandler);

export default router;
