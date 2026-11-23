/*
 * Integration tests: the real API against a real Postgres database, including
 * concurrency (two cashiers paying at once, duplicate submits, double bookings).
 *
 * SAFETY: only runs against a LOCAL database given in TEST_DATABASE_URL, e.g.
 *   TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/melio_test npm run test:integration
 * The database must have the migrations applied (prisma migrate deploy) and be
 * seeded (prisma db seed). Tests create their own orders/reservations.
 */
import assert from 'assert';
import type { AddressInfo } from 'net';

const testUrl = process.env.TEST_DATABASE_URL || '';
let host = '';
try { host = new URL(testUrl).hostname; } catch { /* invalid */ }
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.log('Skipping integration tests: set TEST_DATABASE_URL to a LOCAL Postgres database (127.0.0.1/localhost).');
  process.exit(0);
}

// Must be set before any app module (and dotenv) loads.
const pooled = new URL(testUrl);
pooled.searchParams.set('connection_limit', '10');
process.env.DATABASE_URL = pooled.toString();
process.env.DIRECT_URL = testUrl;
process.env.VERCEL = '1'; // don't auto-listen; we listen on a random port
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-secret-0123456789';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.PAYMENT_SIMULATION;

/* eslint-disable @typescript-eslint/no-var-requires */
const app = require('../index').default;
const prisma = require('../config/database').default;
const { generateToken } = require('../utils/response');
const { deductInventoryForOrder } = require('../services/inventoryService');
const { settleOnlinePayment } = require('../services/onlinePaymentService');
/* eslint-enable @typescript-eslint/no-var-requires */

let base = '';
let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err: any) { console.error(`  ❌ FAIL: ${name}\n     ${err?.stack || err}`); failed++; }
}

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

const uid = () => `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

async function run() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const cashier = await prisma.user.findFirst({ where: { email: 'cashier@example.com' }, include: { role: true } });
  const owner = await prisma.user.findFirst({ where: { email: 'owner@example.com' } });
  assert.ok(cashier?.branchId && owner, 'seeded cashier (with branch) and owner are required');
  const restaurantId = cashier.restaurantId;
  const branchId = cashier.branchId!;
  const cashierToken = generateToken(cashier.id, restaurantId, cashier.tokenVersion);
  const ownerToken = generateToken(owner.id, restaurantId, owner.tokenVersion);
  const menuItem = await prisma.menuItem.findFirst({ where: { restaurantId, status: 'ACTIVE', available: true, sellingPrice: { gt: 0 } } });
  assert.ok(menuItem, 'an active menu item is required');

  const newOrder = (extra: Record<string, unknown> = {}) => call('POST', '/orders', cashierToken, {
    orderType: 'TAKEAWAY', status: 'SUBMITTED', items: [{ menuItemId: menuItem.id, quantity: 2, modifiers: [] }], ...extra,
  });

  console.log('\n--- Orders: duplicate protection ---');
  await test('the same clientRequestId sent twice at once creates one order', async () => {
    const key = uid();
    const [a, b] = await Promise.all([newOrder({ clientRequestId: key }), newOrder({ clientRequestId: key })]);
    assert.ok([200, 201].includes(a.status) && [200, 201].includes(b.status), `statuses ${a.status}/${b.status}`);
    assert.strictEqual(a.body.data.id, b.body.data.id);
    assert.strictEqual(await prisma.sale.count({ where: { restaurantId, clientRequestId: key } }), 1);
    assert.strictEqual(await prisma.kitchenTicket.count({ where: { orderId: a.body.data.id } }), 1);
  });
  await test('an offline order synced twice at once creates one order', async () => {
    const id = uid();
    const offline = { id, offlineOrderNumber: 'OFF-1', branchId, orderType: 'TAKEAWAY', status: 'SUBMITTED', items: [{ menuItemId: menuItem.id, quantity: 1, modifiers: [] }], discountAmount: 0, createdAt: new Date().toISOString() };
    const [a, b] = await Promise.all([
      call('POST', '/orders/sync-offline', cashierToken, { orders: [offline] }),
      call('POST', '/orders/sync-offline', cashierToken, { orders: [offline] }),
    ]);
    assert.strictEqual(a.status, 200); assert.strictEqual(b.status, 200);
    assert.strictEqual(await prisma.sale.count({ where: { restaurantId, clientRequestId: id } }), 1);
  });

  console.log('\n--- Payments: concurrency ---');
  await test('two cashiers paying the full bill at once: only one payment is accepted', async () => {
    const order = (await newOrder()).body.data;
    const pay = () => call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount, amountTendered: order.totalAmount });
    const results = await Promise.all([pay(), pay()]);
    const ok = results.filter((r) => r.status === 201).length;
    assert.strictEqual(ok, 1, `expected exactly one success, got statuses ${results.map((r) => r.status)}`);
    const sale = await prisma.sale.findUnique({ where: { id: order.id } });
    assert.strictEqual(sale.amountPaid, order.totalAmount);
    assert.strictEqual(await prisma.payment.count({ where: { saleId: order.id, status: 'COMPLETED' } }), 1);
  });
  await test('refunding the same payment twice at once refunds it once', async () => {
    const order = (await newOrder()).body.data;
    const pay = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
    const pid = pay.body.data.payment.id;
    const refund = () => call('POST', `/payments/${pid}/refund`, ownerToken, { reason: 'test' });
    const results = await Promise.all([refund(), refund()]);
    assert.strictEqual(results.filter((r) => r.status === 200).length, 1, `statuses ${results.map((r) => r.status)}`);
  });

  console.log('\n--- Cancellation ---');
  await test('an order with a payment cannot be cancelled until refunded', async () => {
    const order = (await newOrder()).body.data;
    await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: 1 });
    const res = await call('POST', `/orders/${order.id}/cancel`, cashierToken, { cancelReason: 'test' });
    assert.strictEqual(res.status, 409);
  });
  await test('cancelling an order cancels its kitchen ticket', async () => {
    const order = (await newOrder()).body.data;
    const res = await call('POST', `/orders/${order.id}/cancel`, cashierToken, { cancelReason: 'customer left' });
    assert.strictEqual(res.status, 200);
    const ticket = await prisma.kitchenTicket.findFirst({ where: { orderId: order.id } });
    assert.strictEqual(ticket.status, 'CANCELLED');
    const list = await call('GET', '/kitchen/tickets', cashierToken);
    const ids = (list.body.data?.tickets || list.body.data || []).map((t: any) => t.id);
    assert.ok(!ids.includes(ticket.id), 'cancelled ticket must not appear on the kitchen display');
  });
  await test('status endpoint CANCELLED goes through the same rules', async () => {
    const order = (await newOrder()).body.data;
    await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: 1 });
    const res = await call('PATCH', `/orders/${order.id}/status`, cashierToken, { status: 'CANCELLED' });
    assert.strictEqual(res.status, 409);
  });

  const placeOnlineMpesaOrder = async () => {
    const res = await call('POST', '/public/orders', null, {
      restaurantId, branchId, customerName: 'IT Online', contactPhone: '0712345678', fulfillmentType: 'PICKUP', paymentMethod: 'MOBILE_MONEY',
      items: [{ menuItemId: menuItem.id, quantity: 1 }], clientRequestId: uid(),
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const online = await prisma.onlineOrder.findUnique({ where: { trackingToken: res.body.data.trackingToken }, include: { sale: true } });
    const payment = await prisma.payment.findFirst({ where: { saleId: online.saleId, status: 'PENDING' } });
    return { online, payment };
  };
  await test('checkout quote equals the amount the order is charged', async () => {
    const items = [{ menuItemId: menuItem.id, quantity: 3 }];
    const quote = await call('POST', '/public/orders/quote', null, { restaurantId, branchId, items });
    assert.strictEqual(quote.status, 200, JSON.stringify(quote.body));
    const placed = await call('POST', '/public/orders', null, {
      restaurantId, branchId, customerName: 'IT Quote', contactPhone: '0712345678', fulfillmentType: 'PICKUP', paymentMethod: 'CASH', items, clientRequestId: uid(),
    });
    assert.strictEqual(placed.status, 201, JSON.stringify(placed.body));
    assert.ok(Math.abs(quote.body.data.totalAmount - placed.body.data.totalAmount) < 0.005, `quote ${quote.body.data.totalAmount} vs order ${placed.body.data.totalAmount}`);
  });
  await test('an invalid cart is rejected before any customer record is created', async () => {
    const phone = '0799' + String(Date.now()).slice(-6);
    const res = await call('POST', '/public/orders', null, {
      restaurantId, branchId, customerName: 'IT Ghost', contactPhone: phone, fulfillmentType: 'PICKUP', paymentMethod: 'CASH',
      items: [{ menuItemId: 'does-not-exist', quantity: 1 }], clientRequestId: uid(),
    });
    assert.strictEqual(res.status, 400);
    const ghost = await prisma.customer.findFirst({ where: { restaurantId, phone } });
    assert.strictEqual(ghost, null);
  });
  await test('cancel is refused while an M-Pesa payment awaits verification', async () => {
    const { online, payment } = await placeOnlineMpesaOrder();
    await prisma.payment.update({ where: { id: payment.id }, data: { reference: `ws_CO_${uid()}`, notes: '[AWAITING_VERIFICATION receipt=ABC123 amount=100]', createdAt: new Date(Date.now() - 3_600_000) } });
    const res = await call('POST', `/orders/${online.saleId}/cancel`, cashierToken, {});
    assert.strictEqual(res.status, 409);
  });
  await test('an M-Pesa payment confirmed after cancellation is recorded and flagged for refund', async () => {
    const { online, payment } = await placeOnlineMpesaOrder();
    // Prompt sent long ago (customer never finished), so staff may cancel...
    await prisma.payment.update({ where: { id: payment.id }, data: { reference: `ws_CO_${uid()}`, createdAt: new Date(Date.now() - 3_600_000) } });
    const cancel = await call('POST', `/orders/${online.saleId}/cancel`, cashierToken, {});
    assert.strictEqual(cancel.status, 200, JSON.stringify(cancel.body));
    const stillPending = await prisma.payment.findUnique({ where: { id: payment.id } });
    assert.strictEqual(stillPending.status, 'PENDING', 'a sent M-Pesa prompt must stay PENDING after cancel');
    // ...then Safaricom confirms the money arrived anyway.
    const out = await settleOnlinePayment({ onlineOrderId: online.id, paymentId: payment.id, method: 'MOBILE_MONEY', amount: online.sale.totalAmount, reference: 'QK12LATE', notes: 'M-Pesa receipt QK12LATE', displayMethod: 'M-Pesa' });
    assert.strictEqual(out.refundRequired, true);
    const recorded = await prisma.payment.findUnique({ where: { id: payment.id } });
    assert.strictEqual(recorded.status, 'COMPLETED');
    assert.ok(recorded.notes.includes('REFUND REQUIRED'));
  });

  console.log('\n--- Kitchen and completion ---');
  await test('kitchen SERVED on an unpaid order serves it but does not close it', async () => {
    const order = (await newOrder({ orderType: 'TAKEAWAY' })).body.data;
    const ticket = await prisma.kitchenTicket.findFirst({ where: { orderId: order.id } });
    const res = await call('PATCH', `/kitchen/tickets/${ticket.id}/status`, cashierToken, { status: 'SERVED' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const sale = await prisma.sale.findUnique({ where: { id: order.id } });
    assert.strictEqual(sale.status, 'SERVED');
    assert.ok(sale.inventoryDeductedAt, 'stock is deducted once food is served');
  });
  await test('paying a served order in full closes it, without deducting stock again', async () => {
    const order = (await newOrder()).body.data;
    const ticket = await prisma.kitchenTicket.findFirst({ where: { orderId: order.id } });
    await call('PATCH', `/kitchen/tickets/${ticket.id}/status`, cashierToken, { status: 'SERVED' });
    const movementsBefore = await prisma.stockMovement.count({ where: { referenceId: order.id, referenceType: 'ORDER_DEDUCTION' } });
    const pay = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
    assert.strictEqual(pay.status, 201);
    const sale = await prisma.sale.findUnique({ where: { id: order.id } });
    assert.strictEqual(sale.status, 'COMPLETED');
    assert.strictEqual(await prisma.stockMovement.count({ where: { referenceId: order.id, referenceType: 'ORDER_DEDUCTION' } }), movementsBefore);
  });
  await test('serving a cancelled order is refused', async () => {
    const order = (await newOrder()).body.data;
    const ticket = await prisma.kitchenTicket.findFirst({ where: { orderId: order.id } });
    await call('POST', `/orders/${order.id}/cancel`, cashierToken, {});
    const res = await call('PATCH', `/kitchen/tickets/${ticket.id}/status`, cashierToken, { status: 'SERVED' });
    assert.strictEqual(res.status, 409);
  });

  console.log('\n--- Inventory ---');
  await test('stock is deducted once (even concurrently), converted g -> kg, and may go negative', async () => {
    // Own fixtures: an ingredient stocked in kg, used by a recipe written in grams.
    const category = await prisma.ingredientCategory.findFirst({ where: { restaurantId } });
    assert.ok(category, 'an ingredient category is required');
    const ingredient = await prisma.ingredient.create({ data: { restaurantId, categoryId: category.id, name: `IT Beef ${uid()}`, unit: 'kg' } });
    const stock = await prisma.inventoryStock.create({ data: { restaurantId, branchId, ingredientId: ingredient.id, quantity: 0.5, unit: 'kg' } });
    const item = await prisma.menuItem.create({ data: { restaurantId, categoryId: menuItem.categoryId, name: `IT Burger ${uid()}`, sellingPrice: 500, status: 'ACTIVE', available: true } });
    await prisma.recipe.create({ data: { restaurantId, menuItemId: item.id, ingredients: { create: [{ ingredientId: ingredient.id, quantity: 250, unit: 'g' }] } } });
    try {
      const order = (await newOrder({ items: [{ menuItemId: item.id, quantity: 3, modifiers: [] }] })).body.data;
      await prisma.sale.update({ where: { id: order.id }, data: { status: 'SERVED' } });
      await Promise.all([1, 2, 3].map(() => deductInventoryForOrder(order.id, restaurantId, branchId)));
      const after = await prisma.inventoryStock.findUnique({ where: { id: stock.id } });
      // 3 x 250 g = 0.75 kg from 0.5 kg on hand -> -0.25 kg, deducted once.
      assert.ok(Math.abs(after.quantity - -0.25) < 1e-9, `expected -0.25 kg, got ${after.quantity}`);
      const moved = await prisma.stockMovement.aggregate({ where: { referenceId: order.id, ingredientId: ingredient.id }, _sum: { quantity: true } });
      assert.ok(Math.abs(Number(moved._sum.quantity) - -0.75) < 1e-9, `movements should total -0.75 kg, got ${moved._sum.quantity}`);
      await new Promise((r) => setTimeout(r, 300)); // alert is sent after the transaction
      const alerts = await prisma.notification.count({ where: { restaurantId, type: 'INVENTORY_ALERT', referenceId: order.id } });
      assert.ok(alerts > 0, 'staff should be alerted that stock went negative');
    } finally {
      await prisma.recipe.deleteMany({ where: { menuItemId: item.id } });
    }
  });

  console.log('\n--- Order edits ---');
  await test('items cannot be changed after an order is sent to the kitchen', async () => {
    const order = (await newOrder()).body.data;
    const res = await call('PATCH', `/orders/${order.id}`, cashierToken, { items: [{ menuItemId: menuItem.id, quantity: 9, modifiers: [] }] });
    assert.strictEqual(res.status, 409);
  });

  console.log('\n--- Reservations ---');
  const table = await prisma.table.findFirst({ where: { branchId, status: { notIn: ['OUT_OF_SERVICE', 'INACTIVE'] } }, orderBy: { capacity: 'desc' } });
  await test('two bookings for the same table and time at once: only one succeeds', async () => {
    const startAt = new Date(Date.now() + (40 + Math.floor(Math.random() * 300)) * 86_400_000);
    const book = () => call('POST', '/reservations', cashierToken, { customerName: 'IT Guest', partySize: 2, tableId: table.id, startAt: startAt.toISOString(), durationMinutes: 90 });
    const results = await Promise.all([book(), book(), book()]);
    assert.strictEqual(results.filter((r) => r.status === 201).length, 1, `statuses ${results.map((r) => r.status)}`);
  });
  await test('website bookings are stored in the restaurant time zone (19:00 Nairobi = 16:00 UTC)', async () => {
    // A different far-future day each run, so repeated runs never fill the slot.
    const d = new Date(Date.now() + (400 + Math.floor(Math.random() * 3000)) * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    const res = await call('POST', '/public/reservations', null, { restaurantId, branchId, customerName: 'TZ Guest', phone: '0712345678', partySize: 2, date, time: '19:00' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const r = await prisma.reservation.findUnique({ where: { id: res.body.data.reservationId } });
    assert.strictEqual(r.startAt.toISOString(), `${date}T16:00:00.000Z`);
  });
  await test('re-confirming a cancelled booking whose table was taken is refused', async () => {
    const startAt = new Date(Date.now() + (800 + Math.floor(Math.random() * 300)) * 86_400_000).toISOString();
    const first = await call('POST', '/reservations', cashierToken, { customerName: 'A', partySize: 2, tableId: table.id, startAt, durationMinutes: 90 });
    await call('PATCH', `/reservations/${first.body.data.id}/status`, cashierToken, { status: 'CANCELLED' });
    const second = await call('POST', '/reservations', cashierToken, { customerName: 'B', partySize: 2, tableId: table.id, startAt, durationMinutes: 90 });
    assert.strictEqual(second.status, 201);
    const reconfirm = await call('PATCH', `/reservations/${first.body.data.id}/status`, cashierToken, { status: 'CONFIRMED' });
    assert.strictEqual(reconfirm.status, 409);
  });

  console.log('\n--- Reports ---');
  await test('sales report includes refunds, net and unpaid figures', async () => {
    const res = await call('GET', '/reports/sales', ownerToken);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body).slice(0, 300));
    const s = res.body.data.summary;
    for (const k of ['totalRefunds', 'netSales', 'unpaidAmount', 'unpaidOrderCount', 'collectedSales']) assert.ok(k in s, `missing ${k}`);
  });
  await test('a fully refunded order is not also counted as unpaid', async () => {
    const order = (await newOrder()).body.data;
    const pay = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
    for (const st of ['PREPARING', 'READY', 'COMPLETED']) {
      const r = await call('PATCH', `/orders/${order.id}/status`, cashierToken, { status: st });
      assert.strictEqual(r.status, 200, `${st}: ${JSON.stringify(r.body)}`);
    }
    const before = (await call('GET', '/reports/sales', ownerToken)).body.data.summary;
    await call('POST', `/payments/${pay.body.data.payment.id}/refund`, ownerToken, { reason: 'test' });
    const after = (await call('GET', '/reports/sales', ownerToken)).body.data.summary;
    const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
    assert.ok(near(after.totalRefunds - before.totalRefunds, order.totalAmount), 'refund counted once');
    assert.ok(near(after.unpaidAmount, before.unpaidAmount), 'refunded order must not become "unpaid"');
    assert.ok(near(before.collectedSales - after.collectedSales, order.totalAmount), 'collected drops by the refund');
  });

  server.close();
  await prisma.$disconnect();
  console.log(`\n========================================\nIntegration Results: ${passed} Passed, ${failed} Failed\n========================================`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
