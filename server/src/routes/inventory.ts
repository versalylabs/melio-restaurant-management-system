import { safeRouter } from '../utils/safeRouter';
import {
  getIngredientCategoriesController,
  createIngredientCategoryController,
  updateIngredientCategoryController,
  deleteIngredientCategoryController,
  getIngredientsController,
  getIngredientController,
  createIngredientController,
  updateIngredientController,
  deleteIngredientController,
  getInventoryStockController,
  getStockLevelController,
  updateStockLevelController,
  adjustStockController,
  getStockMovementsController,
  getWastageRecordsController,
  createWastageRecordController,
  getRecipesController,
  getRecipeController,
  createRecipeController,
  updateRecipeController,
  deleteRecipeController,
  getRecipeIngredientsController,
  addRecipeIngredientController,
  updateRecipeIngredientController,
  removeRecipeIngredientController,
  getFoodCostController,
  getInventoryDashboardController,
  getInventoryBatchesController,
  createInventoryBatchController,
  getStocktakesController,
  createStocktakeController,
  updateStocktakeController,
  completeStocktakeController,
  getSuppliersController,
  getSupplierController,
  createSupplierController,
  updateSupplierController,
  deleteSupplierController,
  getPurchaseOrdersController,
  getPurchaseOrderController,
  createPurchaseOrderController,
  updatePurchaseOrderController,
  receivePurchaseOrderController,
  submitPurchaseOrderController,
  approvePurchaseOrderController,
  cancelPurchaseOrderController,
  deletePurchaseOrderController,
  createPurchaseCorrectionController,
  getSupplierIngredientsController,
  createSupplierIngredientController,
  updateSupplierIngredientController,
  deleteSupplierIngredientController,
} from '../controllers/inventoryController';
import { authenticate, authorize } from '../middleware/auth';

import { createQuickPurchase, getIngredientPriceHistory } from '../services/quickPurchaseService';
import { COST_ROLES, DEFAULT_TARGET_FOOD_COST_PCT, foodCostOverview } from '../services/foodCostService';
import prisma from '../config/database';
import { sendError, sendResponse } from '../utils/response';
import { AuthRequest } from '../middleware/auth';
import { createAuditLog } from '../services/auditLogService';

const router = safeRouter();

router.use(authenticate);

// Dashboard
router.get('/dashboard', getInventoryDashboardController);

// Food cost: market buying, price history and dishes over their cost target.
router.post('/quick-purchase', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER', 'CASHIER'), createQuickPurchase);
router.get('/ingredients/:id/price-history', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), getIngredientPriceHistory);
router.get('/food-cost', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), async (req: AuthRequest, res) => {
  // Custom roles pass authorize() with inventory.view, but costs are for these roles only.
  if (!COST_ROLES.includes(req.user!.roleName)) return sendError(res, 'Only managers can see food costs', undefined, 403);
  const dishes = await foodCostOverview(req.user!.restaurantId);
  return sendResponse(res, true, 'Food cost overview', { dishes, defaultTargetPct: DEFAULT_TARGET_FOOD_COST_PCT });
});
router.put('/food-cost/:menuItemId/target', authorize('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res) => {
  const raw = req.body?.targetFoodCostPct;
  const target = raw === null || raw === '' || raw === undefined ? null : Number(raw);
  if (target !== null && (!Number.isFinite(target) || target < 1 || target > 99)) return sendError(res, 'The target must be between 1% and 99%');
  const item = await prisma.menuItem.findFirst({ where: { id: req.params.menuItemId, restaurantId: req.user!.restaurantId }, select: { id: true, name: true } });
  if (!item) return sendError(res, 'Dish not found', undefined, 404);
  await prisma.menuItem.update({ where: { id: item.id }, data: { targetFoodCostPct: target } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'MenuItem', item.id, `Set food-cost target for ${item.name} to ${target === null ? 'the default' : `${target}%`}`);
  return sendResponse(res, true, 'Target saved', { menuItemId: item.id, targetFoodCostPct: target });
});

// Batch & expiry tracking
router.get('/batches', getInventoryBatchesController);
router.post('/batches', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), createInventoryBatchController);

// Physical stocktakes
router.get('/stocktakes', getStocktakesController);
router.post('/stocktakes', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), createStocktakeController);
router.put('/stocktakes/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), updateStocktakeController);
router.post('/stocktakes/:id/complete', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), completeStocktakeController);

// Categories
router.get('/categories', getIngredientCategoriesController);
router.post('/categories', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), createIngredientCategoryController);
router.put('/categories/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), updateIngredientCategoryController);
router.delete('/categories/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), deleteIngredientCategoryController);

// Ingredients
router.get('/ingredients', getIngredientsController);
router.get('/ingredients/:id', getIngredientController);
router.post('/ingredients', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), createIngredientController);
router.put('/ingredients/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), updateIngredientController);
router.delete('/ingredients/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), deleteIngredientController);

// Inventory Stock
router.get('/stock', getInventoryStockController);
router.get('/stock/movements', getStockMovementsController);
router.get('/stock/:id', getStockLevelController);
router.put('/stock/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), updateStockLevelController);
router.post('/stock/:id/adjust', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), adjustStockController);

// Wastage
router.get('/wastage', getWastageRecordsController);
router.post('/wastage', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), createWastageRecordController);

// Recipes
router.get('/recipes', getRecipesController);
router.post('/recipes', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), createRecipeController);
router.get('/recipes/:menuItemId', getRecipeController);
router.get('/recipes/:menuItemId/ingredients', getRecipeIngredientsController);
router.post('/recipes/:menuItemId/ingredients', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), addRecipeIngredientController);
router.put('/recipes/:menuItemId/ingredients/:ingredientId', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), updateRecipeIngredientController);
router.delete('/recipes/:menuItemId/ingredients/:ingredientId', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), removeRecipeIngredientController);
router.put('/recipes/:menuItemId', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), updateRecipeController);
router.delete('/recipes/:menuItemId', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), deleteRecipeController);

// Food Cost
router.get('/food-cost/:menuItemId', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), getFoodCostController);

// Suppliers
router.get('/suppliers', getSuppliersController);
router.get('/suppliers/:id', getSupplierController);
router.post('/suppliers', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), createSupplierController);
router.put('/suppliers/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), updateSupplierController);
router.delete('/suppliers/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), deleteSupplierController);

// Supplier Ingredients
router.get('/supplier-ingredients', getSupplierIngredientsController);
router.post('/supplier-ingredients', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), createSupplierIngredientController);
router.put('/supplier-ingredients/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), updateSupplierIngredientController);
router.delete('/supplier-ingredients/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), deleteSupplierIngredientController);

// Purchase Orders
router.get('/purchase-orders', getPurchaseOrdersController);
router.get('/purchase-orders/:id', getPurchaseOrderController);
router.post('/purchase-orders', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), createPurchaseOrderController);
router.put('/purchase-orders/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), updatePurchaseOrderController);
router.post('/purchase-orders/:id/submit', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), submitPurchaseOrderController);
router.post('/purchase-orders/:id/approve', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), approvePurchaseOrderController);
router.post('/purchase-orders/:id/receive', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), receivePurchaseOrderController);
router.post('/purchase-orders/:id/cancel', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), cancelPurchaseOrderController);
router.delete('/purchase-orders/:id', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), deletePurchaseOrderController);
router.post('/purchase-orders/:id/corrections', authorize('OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'), createPurchaseCorrectionController);

export default router;
