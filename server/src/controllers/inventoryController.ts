import { Response as ExpressResponse } from 'express';
import {
  getIngredientCategories,
  createIngredientCategory,
  updateIngredientCategory,
  deleteIngredientCategory,
  getIngredients,
  getIngredient,
  createIngredient,
  updateIngredient,
  deleteIngredient,
  getInventoryStock,
  getStockLevel,
  updateStockLevel,
  adjustStock,
  getStockMovements,
  getWastageRecords,
  createWastageRecord,
  getRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  getRecipeIngredients,
  addRecipeIngredient,
  updateRecipeIngredient,
  removeRecipeIngredient,
  getFoodCost,
  getInventoryDashboard,
  getInventoryBatches,
  createInventoryBatch,
  getStocktakes,
  createStocktake,
  updateStocktake,
  completeStocktake,
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  receivePurchaseOrder,
  submitPurchaseOrder,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
  createPurchaseCorrection,
  getSupplierIngredients,
  createSupplierIngredient,
  updateSupplierIngredient,
  deleteSupplierIngredient,
} from '../services/inventoryService';
import { AuthRequest } from '../middleware/auth';

// Categories
export const getIngredientCategoriesController = async (req: AuthRequest, res: ExpressResponse) => getIngredientCategories(req, res);
export const createIngredientCategoryController = async (req: AuthRequest, res: ExpressResponse) => createIngredientCategory(req, res);
export const updateIngredientCategoryController = async (req: AuthRequest, res: ExpressResponse) => updateIngredientCategory(req, res);
export const deleteIngredientCategoryController = async (req: AuthRequest, res: ExpressResponse) => deleteIngredientCategory(req, res);

// Ingredients
export const getIngredientsController = async (req: AuthRequest, res: ExpressResponse) => getIngredients(req, res);
export const getIngredientController = async (req: AuthRequest, res: ExpressResponse) => getIngredient(req, res);
export const createIngredientController = async (req: AuthRequest, res: ExpressResponse) => createIngredient(req, res);
export const updateIngredientController = async (req: AuthRequest, res: ExpressResponse) => updateIngredient(req, res);
export const deleteIngredientController = async (req: AuthRequest, res: ExpressResponse) => deleteIngredient(req, res);

// Inventory Stock
export const getInventoryStockController = async (req: AuthRequest, res: ExpressResponse) => getInventoryStock(req, res);
export const getStockLevelController = async (req: AuthRequest, res: ExpressResponse) => getStockLevel(req, res);
export const updateStockLevelController = async (req: AuthRequest, res: ExpressResponse) => updateStockLevel(req, res);
export const adjustStockController = async (req: AuthRequest, res: ExpressResponse) => adjustStock(req, res);
export const getStockMovementsController = async (req: AuthRequest, res: ExpressResponse) => getStockMovements(req, res);

// Wastage
export const getWastageRecordsController = async (req: AuthRequest, res: ExpressResponse) => getWastageRecords(req, res);
export const createWastageRecordController = async (req: AuthRequest, res: ExpressResponse) => createWastageRecord(req, res);

// Recipes
export const getRecipesController = async (req: AuthRequest, res: ExpressResponse) => getRecipes(req, res);
export const getRecipeController = async (req: AuthRequest, res: ExpressResponse) => getRecipe(req, res);
export const createRecipeController = async (req: AuthRequest, res: ExpressResponse) => createRecipe(req, res);
export const updateRecipeController = async (req: AuthRequest, res: ExpressResponse) => updateRecipe(req, res);
export const deleteRecipeController = async (req: AuthRequest, res: ExpressResponse) => deleteRecipe(req, res);

// Recipe Ingredients
export const getRecipeIngredientsController = async (req: AuthRequest, res: ExpressResponse) => getRecipeIngredients(req, res);
export const addRecipeIngredientController = async (req: AuthRequest, res: ExpressResponse) => addRecipeIngredient(req, res);
export const updateRecipeIngredientController = async (req: AuthRequest, res: ExpressResponse) => updateRecipeIngredient(req, res);
export const removeRecipeIngredientController = async (req: AuthRequest, res: ExpressResponse) => removeRecipeIngredient(req, res);

// Food Cost
export const getFoodCostController = async (req: AuthRequest, res: ExpressResponse) => getFoodCost(req, res);

// Dashboard
export const getInventoryDashboardController = async (req: AuthRequest, res: ExpressResponse) => getInventoryDashboard(req, res);

// Suppliers
export const getSuppliersController = async (req: AuthRequest, res: ExpressResponse) => getSuppliers(req, res);
export const getSupplierController = async (req: AuthRequest, res: ExpressResponse) => getSupplier(req, res);
export const createSupplierController = async (req: AuthRequest, res: ExpressResponse) => createSupplier(req, res);
export const updateSupplierController = async (req: AuthRequest, res: ExpressResponse) => updateSupplier(req, res);
export const deleteSupplierController = async (req: AuthRequest, res: ExpressResponse) => deleteSupplier(req, res);

// Supplier Ingredients
export const getSupplierIngredientsController = async (req: AuthRequest, res: ExpressResponse) => getSupplierIngredients(req, res);
export const createSupplierIngredientController = async (req: AuthRequest, res: ExpressResponse) => createSupplierIngredient(req, res);
export const updateSupplierIngredientController = async (req: AuthRequest, res: ExpressResponse) => updateSupplierIngredient(req, res);
export const deleteSupplierIngredientController = async (req: AuthRequest, res: ExpressResponse) => deleteSupplierIngredient(req, res);

// Purchase Orders
export const getPurchaseOrdersController = async (req: AuthRequest, res: ExpressResponse) => getPurchaseOrders(req, res);
export const getPurchaseOrderController = async (req: AuthRequest, res: ExpressResponse) => getPurchaseOrder(req, res);
export const createPurchaseOrderController = async (req: AuthRequest, res: ExpressResponse) => createPurchaseOrder(req, res);
export const updatePurchaseOrderController = async (req: AuthRequest, res: ExpressResponse) => updatePurchaseOrder(req, res);
export const receivePurchaseOrderController = async (req: AuthRequest, res: ExpressResponse) => receivePurchaseOrder(req, res);
export const submitPurchaseOrderController = async (req: AuthRequest, res: ExpressResponse) => submitPurchaseOrder(req, res);
export const approvePurchaseOrderController = async (req: AuthRequest, res: ExpressResponse) => approvePurchaseOrder(req, res);
export const cancelPurchaseOrderController = async (req: AuthRequest, res: ExpressResponse) => cancelPurchaseOrder(req, res);
export const deletePurchaseOrderController = async (req: AuthRequest, res: ExpressResponse) => deletePurchaseOrder(req, res);
export const createPurchaseCorrectionController = async (req: AuthRequest, res: ExpressResponse) => createPurchaseCorrection(req, res);

export const getInventoryBatchesController = async (req: AuthRequest, res: ExpressResponse) => getInventoryBatches(req, res);
export const createInventoryBatchController = async (req: AuthRequest, res: ExpressResponse) => createInventoryBatch(req, res);
export const getStocktakesController = async (req: AuthRequest, res: ExpressResponse) => getStocktakes(req, res);
export const createStocktakeController = async (req: AuthRequest, res: ExpressResponse) => createStocktake(req, res);
export const updateStocktakeController = async (req: AuthRequest, res: ExpressResponse) => updateStocktake(req, res);
export const completeStocktakeController = async (req: AuthRequest, res: ExpressResponse) => completeStocktake(req, res);
