export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  roleId: string;
  roleName: string;
  restaurantId: string;
  restaurantName: string;
  branchId?: string;
  branchName?: string;
  status: string;
  stations?: Array<{ id: string; name: string; branchId: string; branchName: string }>;
  employeeCode?: string;
  jobTitle?: string;
  hireDate?: string;
  notes?: string;
  permissions?: string[];
}

export interface Restaurant {
  id: string;
  name: string;
  legalName?: string;
  description?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  country: string;
  currency: string;
  logo?: string;
  timezone: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data: {
    token: string;
    user: User;
  };
}

export interface DashboardMetrics {
  metrics: {
    totalUsers: number;
    totalBranches: number;
    totalRoles: number;
    totalMenuItems: number;
    activeMenuItems: number;
    unavailableItems: number;
    totalCategories: number;
    branchesWithActiveMenus: number;
    totalTables: number;
    availableTables: number;
    occupiedTables: number;
    reservedTables: number;
    cleaningTables: number;
    outOfServiceTables: number;
    todaySales: number;
    todayOrders: number;
    totalCustomers: number;
    lowStock: number;
    pendingOrders: number;
    averageOrderValue: number;
  };
  salesTrend: Array<{ date: string; sales: number; orders: number }>;
  orderTypes: Array<{ type: string; count: number }>;
  topMenuItems: Array<{ id: string; name: string; image?: string | null; price: number; quantity: number }>;
  recentOrders: Array<{ id: string; orderNumber: string; customerName?: string | null; status: string; totalAmount: number; orderType: string; createdAt: string; items: Array<{ itemNameSnapshot: string; quantity: number }> }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entity: string;
    description?: string;
    userName: string;
    createdAt: string;
  }>;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  errors?: Record<string, string[]>;
}

export interface NavItem {
  title: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  children?: NavItem[];
  disabled?: boolean;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  displayOrder: number;
  status: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  image?: string;
  sku?: string;
  sellingPrice: number;
  costPrice?: number;
  taxRate: number;
  preparationTime?: number;
  status: string;
  available: boolean;
  displayOrder: number;
  categoryId: string;
  categoryName: string;
  branches: Array<{ id: string; name: string; available: boolean }>;
  modifierGroups: Array<{ id: string; name: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ModifierGroup {
  id: string;
  name: string;
  description?: string;
  selectionType: string;
  isRequired: boolean;
  displayOrder: number;
  status: string;
  optionCount: number;
  menuItemCount: number;
  options: ModifierOption[];
  createdAt: string;
  updatedAt: string;
}

export interface ModifierOption {
  id: string;
  name: string;
  priceAdjustment: number;
  status: string;
  displayOrder: number;
}

export interface Section {
  id: string;
  name: string;
  description?: string;
  displayOrder: number;
  status: string;
  branchId: string;
  tableCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Table {
  id: string;
  tableNumber: string;
  name?: string;
  capacity: number;
  shape: string;
  status: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  rotation: number;
  displayOrder: number;
  branchId: string;
  branchName: string;
  sectionId?: string;
  sectionName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TableCombination {
  id: string;
  name: string;
  tableIds: string[];
  status: string;
  branchId: string;
  branchName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleItemModifier {
  id?: string;
  modifierOptionId: string;
  optionNameSnapshot: string;
  priceAdjustment: number;
}

export interface SaleItem {
  id: string;
  menuItemId: string;
  itemNameSnapshot: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  notes?: string;
  modifiers: SaleItemModifier[];
}

export interface Sale {
  id: string;
  orderNumber: string;
  orderType: string;
  tableId?: string;
  tableNumber?: string;
  tableName?: string;
  customerName?: string;
  status: string;
  paymentStatus: string;
  amountPaid: number;
  subtotal: number;
  discountAmount: number;
  discountReason?: string;
  taxAmount: number;
  serviceChargeAmount: number;
  totalAmount: number;
  notes?: string;
  createdBy: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  items: SaleItem[];
  statusHistory: Array<{
    id: string;
    status: string;
    notes?: string;
    changedBy: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface PosCategory {
  id: string;
  name: string;
  description?: string;
  items: PosMenuItem[];
}

export interface PosMenuItem {
  id: string;
  name: string;
  description?: string;
  sellingPrice: number;
  taxRate: number;
  image?: string;
  modifierGroups: Array<{
    id: string;
    name: string;
    selectionType: string;
    isRequired: boolean;
    options: Array<{
      id: string;
      name: string;
      priceAdjustment: number;
    }>;
  }>;
}

export interface PosTable {
  id: string;
  tableNumber: string;
  name?: string;
  capacity: number;
  status: string;
  sectionName?: string;
  selectable: boolean;
}

export interface KitchenStation {
  id: string;
  name: string;
  description?: string;
  displayOrder: number;
  status: string;
  branchId: string;
  branchName?: string;
  menuItemCount: number;
  ticketCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KitchenTicket {
  id: string;
  restaurantId: string;
  branchId: string;
  branchName?: string;
  orderId: string;
  orderNumber?: string;
  orderType?: string;
  tableId?: string;
  tableNumber?: string;
  tableName?: string;
  customerName?: string;
  orderNotes?: string;
  stationId?: string;
  stationName?: string;
  stationIds?: string[];
  stationNames?: string[];
  status: string;
  priority: string;
  receivedAt: string;
  startedAt?: string;
  readyAt?: string;
  completedAt?: string;
  items: KitchenTicketItem[];
  createdAt: string;
  updatedAt: string;
}

export interface KitchenTicketItem {
  id: string;
  menuItemId: string;
  itemNameSnapshot: string;
  quantity: number;
  notes?: string;
  status: string;
  modifiers: Array<{
    optionNameSnapshot: string;
    priceAdjustment: number;
  }>;
  stationIds?: string[];
  stationNames?: string[];
}

export interface IngredientCategory {
  id: string;
  restaurantId: string;
  name: string;
  description?: string;
  displayOrder: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Ingredient {
  id: string;
  restaurantId: string;
  categoryId: string;
  categoryName?: string;
  name: string;
  code?: string;
  description?: string;
  unit: string;
  costPerUnit: number;
  minStockLevel: number;
  reorderLevel: number;
  status: string;
  available: boolean;
  displayOrder: number;
  currentStock?: number;
  stockValue?: number;
  stockStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryStock {
  id: string;
  restaurantId: string;
  branchId: string;
  branchName?: string;
  ingredientId: string;
  ingredientName?: string;
  ingredientCode?: string;
  unit: string;
  quantity: number;
  costPerUnit: number;
  minStockLevel: number;
  reorderLevel: number;
  lastRestockedAt?: string;
  isLowStock: boolean;
  isOutOfStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  restaurantId: string;
  branchId: string;
  branchName?: string;
  ingredientId: string;
  ingredientName?: string;
  quantity: number;
  unit: string;
  type: string;
  reason?: string;
  referenceId?: string;
  referenceType?: string;
  userId: string;
  userName?: string;
  notes?: string;
  createdAt: string;
}


export interface InventoryBatch {
  id: string;
  batchNumber?: string;
  expiryDate?: string;
  quantity: number;
  unit: string;
  costPerUnit?: number;
  receivedAt: string;
  status: string;
  ingredientId: string;
  ingredientName?: string;
  branchId: string;
  branchName?: string;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

export interface StocktakeItem {
  id: string;
  ingredientId: string;
  expectedQty: number;
  countedQty: number;
  variance: number;
  unit: string;
  notes?: string;
  ingredient?: { name: string; unit: string };
}

export interface Stocktake {
  id: string;
  reference: string;
  branchId: string;
  status: string;
  notes?: string;
  createdAt: string;
  completedAt?: string;
  items: StocktakeItem[];
  branch?: { name: string };
}

export interface Supplier {
  id: string;
  restaurantId: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  taxNumber?: string;
  businessRegNumber?: string;
  notes?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierIngredient {
  id: string;
  supplierId: string;
  supplierName?: string;
  ingredientId: string;
  ingredientName?: string;
  supplierItemCode?: string;
  preferredUnit?: string;
  lastPurchasePrice?: number;
  defaultPurchasePrice?: number;
  minOrderQuantity?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  ingredientId: string;
  ingredientName?: string;
  orderedQuantity: number;
  receivedQuantity: number;
  unit: string;
  unitPrice: number;
  tax: number;
  discount: number;
  totalPrice: number;
  notes?: string;
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  restaurantId: string;
  branchId: string;
  branchName?: string;
  supplierId: string;
  supplierName?: string;
  orderNumber: string;
  orderDate: string;
  expectedDeliveryDate?: string;
  status: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  notes?: string;
  receivedAt?: string;
  submittedAt?: string;
  approvedAt?: string;
  createdBy: string;
  createdByName?: string;
  items: PurchaseOrderItem[];
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseCorrection {
  id: string;
  purchaseOrderId: string;
  purchaseOrderItemId?: string;
  type: string;
  quantity: number;
  unit: string;
  reason?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface RecipeIngredient {
  id: string;
  recipeId: string;
  ingredientId: string;
  ingredientName?: string;
  quantity: number;
  unit: string;
  notes?: string;
  sortOrder: number;
  createdAt: string;
}

export interface Recipe {
  id: string;
  restaurantId: string;
  menuItemId: string;
  menuItemName?: string;
  menuItemPrice?: number;
  name?: string;
  description?: string;
  servings: number;
  status: string;
  ingredients: RecipeIngredient[];
  ingredientCount?: number;
  totalCost?: number;
  createdAt: string;
  updatedAt: string;
}

export interface WastageRecord {
  id: string;
  restaurantId: string;
  branchId: string;
  branchName?: string;
  ingredientId: string;
  ingredientName?: string;
  quantity: number;
  unit: string;
  reason: string;
  notes?: string;
  userId: string;
  userName?: string;
  createdAt: string;
}

export interface InventoryDashboard {
  totalIngredients: number;
  totalStockValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  recentMovements: StockMovement[];
  recentWastage: WastageRecord[];
  reorderItems: InventoryStock[];
}
