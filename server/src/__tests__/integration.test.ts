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
  // Voids after the kitchen has an order and refunds need a manager's PIN.
  const TEST_PIN = '8642';
  await prisma.user.update({ where: { id: owner.id }, data: { pinHash: await require('bcryptjs').hash(TEST_PIN, 4) } });
  await prisma.user.update({ where: { id: owner.id }, data: { pinFailedCount: 0, pinLockedUntil: null } });
  const approval = { approverId: owner.id, pin: TEST_PIN };
  // A dish with no required options, so website orders can be placed without choosing any.
  const menuItem = await prisma.menuItem.findFirst({ where: { restaurantId, status: 'ACTIVE', available: true, sellingPrice: { gt: 0 }, modifierGroups: { none: { modifierGroup: { isRequired: true, status: 'ACTIVE' } } } } });
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
    const refund = () => call('POST', `/payments/${pid}/refund`, ownerToken, { reason: 'test', approval });
    const results = await Promise.all([refund(), refund()]);
    assert.strictEqual(results.filter((r) => r.status === 200).length, 1, `statuses ${results.map((r) => r.status)}`);
  });

  console.log('\n--- Cancellation ---');
  await test('an order with a payment cannot be cancelled until refunded', async () => {
    const order = (await newOrder()).body.data;
    await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: 1 });
    const res = await call('POST', `/orders/${order.id}/cancel`, cashierToken, { cancelReason: 'test', approval });
    assert.strictEqual(res.status, 409);
  });
  await test('cancelling an order cancels its kitchen ticket', async () => {
    const order = (await newOrder()).body.data;
    const res = await call('POST', `/orders/${order.id}/cancel`, cashierToken, { cancelReason: 'customer left', approval });
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
    const res = await call('POST', `/orders/${online.saleId}/cancel`, cashierToken, { cancelReason: 'test', approval });
    assert.strictEqual(res.status, 409);
  });
  await test('an M-Pesa payment confirmed after cancellation is recorded and flagged for refund', async () => {
    const { online, payment } = await placeOnlineMpesaOrder();
    // Prompt sent long ago (customer never finished), so staff may cancel...
    await prisma.payment.update({ where: { id: payment.id }, data: { reference: `ws_CO_${uid()}`, createdAt: new Date(Date.now() - 3_600_000) } });
    const cancel = await call('POST', `/orders/${online.saleId}/cancel`, cashierToken, { cancelReason: 'test', approval });
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

  console.log('\n--- Automated messages ---');
  await test('message templates are saved in the database and validated', async () => {
    const saved = await call('PUT', '/automated-messaging/ORDER_READY', ownerToken, { subject: 'Ready {orderNumber}', template: 'Come get {orderNumber}', channel: 'SMS' });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    const list = await call('GET', '/automated-messaging', ownerToken);
    const ready = list.body.data.templates.find((t: any) => t.action === 'ORDER_READY');
    assert.strictEqual(ready.template, 'Come get {orderNumber}');
    assert.strictEqual(ready.channel, 'SMS');
    const row = await prisma.messageTemplate.findUnique({ where: { restaurantId_action: { restaurantId, action: 'ORDER_READY' } } });
    assert.ok(row, 'stored in the database');
    const bad = await call('PUT', '/automated-messaging/ORDER_READY', ownerToken, { channel: 'FAX' });
    assert.strictEqual(bad.status, 400);
    const unknown = await call('PUT', '/automated-messaging/NOT_A_THING', ownerToken, { subject: 'x' });
    assert.strictEqual(unknown.status, 404);
    await prisma.messageTemplate.deleteMany({ where: { restaurantId, action: 'ORDER_READY' } });
  });
  await test('a switched-off message is not sent (no default fallback)', async () => {
    const { resolveMessage } = require('../services/automatedMessagingService');
    await call('PUT', '/automated-messaging/ORDER_PREPARING', ownerToken, { enabled: false });
    const msg = await resolveMessage(restaurantId, 'ORDER_PREPARING', { orderNumber: 'X1' });
    assert.ok(msg && msg.enabled === false, 'resolveMessage reports disabled');
    await call('PUT', '/automated-messaging/ORDER_PREPARING', ownerToken, { enabled: true });
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
    await call('POST', `/orders/${order.id}/cancel`, cashierToken, { cancelReason: 'test', approval });
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
    await call('POST', `/payments/${pay.body.data.payment.id}/refund`, ownerToken, { reason: 'test', approval });
    const after = (await call('GET', '/reports/sales', ownerToken)).body.data.summary;
    const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
    assert.ok(near(after.totalRefunds - before.totalRefunds, order.totalAmount), 'refund counted once');
    assert.ok(near(after.unpaidAmount, before.unpaidAmount), 'refunded order must not become "unpaid"');
    assert.ok(near(before.collectedSales - after.collectedSales, order.totalAmount), 'collected drops by the refund');
  });

  console.log('\n--- Loss prevention: manager approval ---');
  await test('cancelling an order the kitchen has needs a PIN, and is logged as a void', async () => {
    const order = (await newOrder()).body.data;
    const refused = await call('POST', `/orders/${order.id}/cancel`, cashierToken, { cancelReason: 'test' });
    assert.strictEqual(refused.status, 428);
    assert.deepStrictEqual(refused.body.errors?.approval, ['APPROVAL_REQUIRED']);
    const wrong = await call('POST', `/orders/${order.id}/cancel`, cashierToken, { cancelReason: 'test', approval: { ...approval, pin: '0000' } });
    assert.deepStrictEqual(wrong.body.errors?.approval, ['APPROVAL_INVALID']);
    await prisma.auditLog.deleteMany({ where: { restaurantId, action: 'APPROVAL_FAILED' } });
    const ok = await call('POST', `/orders/${order.id}/cancel`, cashierToken, { cancelReason: 'test', approval });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const log = await prisma.voidRecord.findFirst({ where: { saleId: order.id, kind: 'ORDER' } });
    assert.ok(log && log.approvedBy === owner.id && log.requestedBy === cashier.id);
  });
  await test('a held order (never sent to the kitchen) cancels without a PIN', async () => {
    const order = (await newOrder({ status: 'HELD' })).body.data;
    const res = await call('POST', `/orders/${order.id}/cancel`, cashierToken, { cancelReason: 'test' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(await prisma.voidRecord.count({ where: { saleId: order.id } }), 0);
  });
  await test('removing one of two items needs a PIN, lowers the bill and the kitchen line', async () => {
    const order = (await newOrder()).body.data;
    const item = order.items[0];
    const refused = await call('POST', `/orders/${order.id}/items/${item.id}/void`, cashierToken, { quantity: 1, reason: 'test' });
    assert.strictEqual(refused.status, 428);
    const res = await call('POST', `/orders/${order.id}/items/${item.id}/void`, cashierToken, { quantity: 1, reason: 'test', approval });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.data.totalAmount < order.totalAmount, 'total must drop');
    const kitchenLine = await prisma.kitchenTicketItem.findFirst({ where: { saleItemId: item.id } });
    assert.strictEqual(kitchenLine?.quantity, 1);
    const log = await prisma.voidRecord.findFirst({ where: { saleId: order.id, kind: 'ITEM' } });
    assert.ok(log && log.quantity === 1 && log.value === menuItem.sellingPrice);
  });
  await test('the last item cannot be removed (cancel the order instead)', async () => {
    const order = (await call('POST', '/orders', cashierToken, { orderType: 'TAKEAWAY', status: 'SUBMITTED', items: [{ menuItemId: menuItem.id, quantity: 1, modifiers: [] }] })).body.data;
    const res = await call('POST', `/orders/${order.id}/items/${order.items[0].id}/void`, cashierToken, { quantity: 1, reason: 'test', approval });
    assert.strictEqual(res.status, 400, JSON.stringify(res.body));
  });
  await test('a discount above the cashier limit needs an approver whose limit covers it', async () => {
    const big = { discountAmount: 50, discountType: 'PERCENTAGE', discountReason: 'test' };
    const refused = await newOrder(big);
    assert.strictEqual(refused.status, 428, JSON.stringify(refused.body));
    const ok = await newOrder({ ...big, approval });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.data.discountApprovedBy, owner.id);
  });
  await test('a cashier does not see expected cash while their shift is open', async () => {
    await prisma.shift.updateMany({ where: { userId: cashier.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
    await call('POST', '/shifts', cashierToken, { openingCash: 500 });
    const current = (await call('GET', '/shifts/current', cashierToken)).body.data.shift;
    assert.strictEqual(current.expectedCash, undefined);
    const closed = await call('POST', `/shifts/${current.id}/close`, cashierToken, { closingCash: 450, declaredMobileMoney: 0, declaredCard: 0 });
    assert.strictEqual(closed.status, 200, JSON.stringify(closed.body));
    assert.strictEqual(closed.body.data.shift.cashVariance, -50);
  });

  await test('editing a held order down to a smaller bill re-checks the discount', async () => {
    const price = menuItem.sellingPrice;
    const quantity = Math.min(10, Math.max(2, Math.ceil(10000 / price)));
    const discount = Math.floor(Math.min(1000, 0.1 * quantity * price));
    const held = await call('POST', '/orders', cashierToken, { orderType: 'TAKEAWAY', status: 'HELD', discountAmount: discount, discountType: 'FIXED', items: [{ menuItemId: menuItem.id, quantity, modifiers: [] }] });
    assert.strictEqual(held.status, 201, JSON.stringify(held.body));
    const shrink = await call('PATCH', `/orders/${held.body.data.id}`, cashierToken, { items: [{ menuItemId: menuItem.id, quantity: 1, modifiers: [] }] });
    assert.strictEqual(shrink.status, 428, `kept a ${discount} discount on a ${price} bill: ${JSON.stringify(shrink.body)}`);
  });
  await test('a burst of wrong PINs locks that PIN after five tries', async () => {
    const order = (await newOrder()).body.data;
    const guesses = ['1111', '2222', '3333', '4444', '5555', '6666', '7777', '9999'];
    const results = await Promise.all(guesses.map((pin) =>
      call('POST', `/orders/${order.id}/cancel`, cashierToken, { cancelReason: 'test', approval: { ...approval, pin } })));
    const wrong = results.filter((r) => r.body.errors?.approval?.[0] === 'APPROVAL_INVALID').length;
    assert.ok(wrong <= 4, `${wrong} guesses were checked before the lock`);
    const right = await call('POST', `/orders/${order.id}/cancel`, cashierToken, { cancelReason: 'test', approval });
    assert.strictEqual(right.status, 429, 'even the right PIN is refused while locked');
    await prisma.user.update({ where: { id: owner.id }, data: { pinFailedCount: 0, pinLockedUntil: null } });
  });

  console.log('\n--- M-Pesa at the till ---');
  const freshCode = () => `T${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`.slice(0, 10).padEnd(10, 'X');
  await test('an M-Pesa payment typed in by staff needs a real-looking code', async () => {
    const order = (await newOrder()).body.data;
    const res = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: order.totalAmount });
    assert.strictEqual(res.status, 400, JSON.stringify(res.body));
  });
  await test('the same M-Pesa code cannot pay two orders (any letter case)', async () => {
    const code = freshCode();
    const first = (await newOrder()).body.data;
    const ok = await call('POST', `/payments/orders/${first.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: first.totalAmount, reference: code });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    const second = (await newOrder()).body.data;
    const again = await call('POST', `/payments/orders/${second.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: second.totalAmount, reference: code.toLowerCase() });
    assert.strictEqual(again.status, 409, JSON.stringify(again.body));
    assert.ok(String(again.body.message).includes(first.orderNumber));
  });
  await test('two tills entering the same new code at once: only one is accepted', async () => {
    const code = freshCode();
    const a = (await newOrder()).body.data;
    const b = (await newOrder()).body.data;
    const results = await Promise.all([
      call('POST', `/payments/orders/${a.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: a.totalAmount, reference: code }),
      call('POST', `/payments/orders/${b.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: b.totalAmount, reference: code }),
    ]);
    assert.deepStrictEqual(results.map((r) => r.status).sort(), [201, 409]);
  });
  // Prompts need Daraja; these tests use the simulated M-Pesa (test mode) for this block only.
  process.env.PAYMENT_SIMULATION = 'true';
  await test('staff send a prompt for a bill; Safaricom confirming marks it paid against the cashier', async () => {
    const order = (await newOrder()).body.data;
    const sent = await call('POST', `/payments/orders/${order.id}/mpesa-prompt`, cashierToken, { phoneNumber: '0712345678' });
    assert.strictEqual(sent.status, 201, JSON.stringify(sent.body));
    const id = sent.body.data.checkoutRequestId;
    const tooSoon = await call('POST', `/payments/orders/${order.id}/mpesa-prompt`, cashierToken, { phoneNumber: '0712345678' });
    assert.strictEqual(tooSoon.status, 409, 'a second prompt right away is refused');
    assert.strictEqual((await call('GET', `/payments/mpesa/${id}`, cashierToken)).body.data.status, 'PENDING');
    const sim = await call('POST', `/payments/mpesa/${id}/simulate`, cashierToken);
    assert.strictEqual(sim.status, 200, JSON.stringify(sim.body));
    const status = (await call('GET', `/payments/mpesa/${id}`, cashierToken)).body.data;
    assert.strictEqual(status.status, 'SUCCESS');
    const sale = await prisma.sale.findUnique({ where: { id: order.id } });
    assert.strictEqual(sale?.paymentStatus, 'PAID');
    const payment = await prisma.payment.findFirst({ where: { saleId: order.id, status: 'COMPLETED' } });
    assert.strictEqual(payment?.createdBy, cashier.id, 'counts toward the cashier shift');
  });
  await test('a prompt for more than the balance is refused; a part payment splits the bill', async () => {
    const order = (await newOrder()).body.data;
    const tooMuch = await call('POST', `/payments/orders/${order.id}/mpesa-prompt`, cashierToken, { phoneNumber: '0712345678', amount: order.totalAmount + 100 });
    assert.strictEqual(tooMuch.status, 400);
    const half = Math.floor(order.totalAmount / 2);
    const sent = await call('POST', `/payments/orders/${order.id}/mpesa-prompt`, cashierToken, { phoneNumber: '0712345678', amount: half });
    await call('POST', `/payments/mpesa/${sent.body.data.checkoutRequestId}/simulate`, cashierToken);
    const sale = await prisma.sale.findUnique({ where: { id: order.id } });
    assert.strictEqual(sale?.paymentStatus, 'PARTIAL');
  });
  await test('a prompt paid after the bill was settled is kept and flagged for refund', async () => {
    const order = (await newOrder()).body.data;
    const sent = await call('POST', `/payments/orders/${order.id}/mpesa-prompt`, cashierToken, { phoneNumber: '0712345678' });
    const blocked = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
    assert.strictEqual(blocked.status, 409, 'no other payment while a prompt is on the phone');
    // Two minutes later the customer still hasn't paid; the cashier takes cash, then the late prompt is paid.
    await prisma.payment.updateMany({ where: { reference: sent.body.data.checkoutRequestId }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const cash = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
    assert.strictEqual(cash.status, 201, JSON.stringify(cash.body));
    await call('POST', `/payments/mpesa/${sent.body.data.checkoutRequestId}/simulate`, cashierToken);
    const status = (await call('GET', `/payments/mpesa/${sent.body.data.checkoutRequestId}`, cashierToken)).body.data;
    assert.strictEqual(status.status, 'REFUND_REQUIRED');
    const sale = await prisma.sale.findUnique({ where: { id: order.id } });
    assert.ok(Math.abs((sale?.amountPaid || 0) - order.totalAmount) < 0.01, 'the duplicate is not counted as paid');
  });
  await test('a receipt typed in by hand is not counted again when the prompt confirms it', async () => {
    const order = (await newOrder()).body.data;
    const sent = await call('POST', `/payments/orders/${order.id}/mpesa-prompt`, cashierToken, { phoneNumber: '0712345678' });
    const id = sent.body.data.checkoutRequestId;
    await prisma.payment.updateMany({ where: { reference: id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const code = freshCode();
    const manual = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: order.totalAmount, reference: code });
    assert.strictEqual(manual.status, 201, JSON.stringify(manual.body));
    // Safaricom now confirms the prompt with the very same receipt.
    const { settleStaffStkPayment } = require('../services/mpesaService');
    const pending = await prisma.payment.findFirst({ where: { reference: id } });
    const out = await settleStaffStkPayment(pending!.id, id, code, order.totalAmount);
    assert.strictEqual(out.status, 'ALREADY_RECORDED');
    const completed = await prisma.payment.count({ where: { saleId: order.id, status: 'COMPLETED' } });
    assert.strictEqual(completed, 1, 'the bill is paid once');
    assert.strictEqual((await prisma.payment.findUnique({ where: { id: pending!.id } }))?.status, 'CANCELLED');
  });
  await test('a part-amount prompt on a website order settles as a till payment', async () => {
    const { online } = await placeOnlineMpesaOrder();
    const sale = await prisma.sale.findUnique({ where: { id: online.saleId } });
    await prisma.payment.updateMany({ where: { saleId: online.saleId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    const half = Math.floor(sale!.totalAmount / 2);
    const sent = await call('POST', `/payments/orders/${online.saleId}/mpesa-prompt`, cashierToken, { phoneNumber: '0712345678', amount: half });
    assert.strictEqual(sent.status, 201, JSON.stringify(sent.body));
    await call('POST', `/payments/mpesa/${sent.body.data.checkoutRequestId}/simulate`, cashierToken);
    const after = await prisma.sale.findUnique({ where: { id: online.saleId } });
    assert.strictEqual(after?.paymentStatus, 'PARTIAL');
  });
  delete process.env.PAYMENT_SIMULATION;

  console.log('\n--- Tax: VAT, credit notes, monthly summary ---');
  const { calculateOrderTotals } = require('../services/orderCalculationService');
  const near2 = (a: number, b: number) => Math.abs(a - b) < 0.011;
  await test('VAT added on top: 16% on standard-rated items only', async () => {
    const t = await calculateOrderTotals({
      items: [
        { menuItemId: 'a', unitPrice: 1000, quantity: 1, taxCategory: 'STANDARD' },
        { menuItemId: 'b', unitPrice: 500, quantity: 1, taxCategory: 'ZERO_RATED' },
      ],
      taxRate: 0.16, serviceChargeRate: 0, pricesIncludeTax: false,
    });
    assert.ok(near2(t.taxAmount, 160) && near2(t.totalAmount, 1660) && near2(t.taxableAmount, 1000) && near2(t.zeroRatedAmount, 500), JSON.stringify(t));
  });
  await test('Prices include VAT: VAT is extracted, the total is the menu price', async () => {
    const t = await calculateOrderTotals({
      items: [{ menuItemId: 'a', unitPrice: 1160, quantity: 1, taxCategory: 'STANDARD' }],
      taxRate: 0.16, serviceChargeRate: 0, pricesIncludeTax: true,
    });
    assert.ok(near2(t.taxAmount, 160) && near2(t.totalAmount, 1160) && near2(t.taxableAmount, 1000) && t.taxInclusive, JSON.stringify(t));
  });
  await test('A discount is spread over VAT categories in proportion', async () => {
    const t = await calculateOrderTotals({
      items: [
        { menuItemId: 'a', unitPrice: 1000, quantity: 1, taxCategory: 'STANDARD' },
        { menuItemId: 'b', unitPrice: 1000, quantity: 1, taxCategory: 'EXEMPT' },
      ],
      discountAmount: 200, discountType: 'FIXED', taxRate: 0.16, serviceChargeRate: 0, pricesIncludeTax: false,
    });
    assert.ok(near2(t.taxableAmount, 900) && near2(t.exemptAmount, 900) && near2(t.taxAmount, 144), JSON.stringify(t));
  });

  const restaurantBefore = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  const itemBefore = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });
  try {
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { taxRate: 0.16, serviceChargeRate: 0, pricesIncludeTax: true, tourismLevyRate: 0.02, vatRegistered: true, kraPin: 'P051234567X' } });
    await test('A bill stores its VAT breakdown, frozen at the time', async () => {
      const order = (await newOrder()).body.data;
      const sale = await prisma.sale.findUnique({ where: { id: order.id } });
      assert.ok(sale?.taxInclusive, 'inclusive flag stored');
      assert.ok(near2(sale!.totalAmount, menuItem.sellingPrice * 2), 'total is the menu price');
      assert.ok(near2(sale!.taxableAmount + sale!.taxAmount, menuItem.sellingPrice * 2), JSON.stringify(sale));
    });
    await test('A zero-rated item carries no VAT', async () => {
      await prisma.menuItem.update({ where: { id: menuItem.id }, data: { taxCategory: 'ZERO_RATED' } });
      const order = (await newOrder()).body.data;
      const sale = await prisma.sale.findUnique({ where: { id: order.id } });
      assert.strictEqual(sale?.taxAmount, 0);
      assert.ok(near2(sale!.zeroRatedAmount, menuItem.sellingPrice * 2));
      await prisma.menuItem.update({ where: { id: menuItem.id }, data: { taxCategory: 'STANDARD' } });
    });
    await test('Refunding a closed sale issues numbered credit notes with the VAT share', async () => {
      const issue = async () => {
        const order = (await newOrder()).body.data;
        const pay = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
        await require('../services/orderCompletionService').completeOrder(order.id, restaurantId, owner.id);
        const refund = await call('POST', `/payments/${pay.body.data.payment.id}/refund`, ownerToken, { reason: 'test', approval });
        assert.strictEqual(refund.status, 200, JSON.stringify(refund.body));
        return { order, note: refund.body.data.creditNote };
      };
      const first = await issue();
      const second = await issue();
      assert.ok(first.note && second.note, 'credit notes issued');
      assert.ok(/^CN-\d{6}$/.test(first.note.number));
      assert.strictEqual(Number(second.note.number.slice(3)), Number(first.note.number.slice(3)) + 1, 'numbers run in sequence');
      const sale = await prisma.sale.findUnique({ where: { id: first.order.id } });
      assert.ok(near2(first.note.vatAmount, sale!.taxAmount), 'a full refund reverses all the VAT');
    });
    await test('A refund before the sale is closed issues no credit note', async () => {
      const order = (await newOrder()).body.data;
      const pay = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
      const refund = await call('POST', `/payments/${pay.body.data.payment.id}/refund`, ownerToken, { reason: 'test', approval });
      assert.strictEqual(refund.body.data.creditNote, null);
    });
    await test('Monthly tax summary: VAT, credit notes, levy and a CSV', async () => {
      const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }).slice(0, 7);
      const res = await call('GET', `/reports/tax-summary?month=${month}`, ownerToken);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const t = res.body.data.totals;
      assert.ok(t.bills >= 2 && t.outputVat > 0 && t.creditNotes > 0, JSON.stringify(t));
      assert.ok(near2(t.netVat, t.outputVat - t.creditNoteVat));
      assert.ok(res.body.data.tourismLevy.due > 0 && /-10$/.test(res.body.data.tourismLevy.dueDate));
      const csv = await fetch(`${base}/api/reports/tax-summary?month=${month}&format=csv`, { headers: { Authorization: `Bearer ${ownerToken}` } });
      assert.strictEqual(csv.status, 200);
      assert.ok((csv.headers.get('content-type') || '').includes('text/csv'));
      const text = await csv.text();
      assert.ok(text.includes('P051234567X') && text.includes('Net VAT'), 'CSV has the PIN and totals');
      const bad = await call('GET', '/reports/tax-summary?month=nope', ownerToken);
      assert.strictEqual(bad.status, 400);
    });
    await test('A refund that is paid again does not reduce VAT', async () => {
      const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }).slice(0, 7);
      const before = (await call('GET', `/reports/tax-summary?month=${month}`, ownerToken)).body.data.totals;
      const order = (await newOrder()).body.data;
      const pay = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
      await require('../services/orderCompletionService').completeOrder(order.id, restaurantId, owner.id);
      await call('POST', `/payments/${pay.body.data.payment.id}/refund`, ownerToken, { reason: 'wrong method', approval });
      await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CARD', amount: order.totalAmount });
      const after = (await call('GET', `/reports/tax-summary?month=${month}`, ownerToken)).body.data.totals;
      const sale = await prisma.sale.findUnique({ where: { id: order.id } });
      assert.ok(near2(after.outputVat - before.outputVat, sale!.taxAmount), 'the sale counts once');
      assert.ok(near2(after.creditNoteVat, before.creditNoteVat), 'the re-paid refund is not counted');
    });
    await test('A promotion on one zero-rated product does not lower VAT on the rest', async () => {
      const t = await calculateOrderTotals({
        items: [
          { menuItemId: 'z', unitPrice: 1000, quantity: 1, taxCategory: 'ZERO_RATED' },
          { menuItemId: 's', unitPrice: 1000, quantity: 1, taxCategory: 'STANDARD' },
        ],
        promotion: { discountType: 'PERCENTAGE', value: 50, scope: 'PRODUCT', menuItemId: 'z' },
        taxRate: 0.16, serviceChargeRate: 0, pricesIncludeTax: false,
      });
      assert.ok(near2(t.taxAmount, 160) && near2(t.zeroRatedAmount, 500) && near2(t.taxableAmount, 1000), JSON.stringify(t));
    });
    await test('Changing "prices include VAT" does not change an open bill', async () => {
      const held = (await newOrder({ status: 'HELD' })).body.data;
      const before = await prisma.sale.findUnique({ where: { id: held.id } });
      await prisma.restaurant.update({ where: { id: restaurantId }, data: { pricesIncludeTax: !before!.taxInclusive } });
      const edited = await call('PATCH', `/orders/${held.id}`, cashierToken, { notes: 'x', items: [{ menuItemId: menuItem.id, quantity: 2, modifiers: [] }] });
      assert.strictEqual(edited.status, 200, JSON.stringify(edited.body));
      const after = await prisma.sale.findUnique({ where: { id: held.id } });
      assert.strictEqual(after!.taxInclusive, before!.taxInclusive);
      assert.ok(near2(after!.totalAmount, before!.totalAmount));
      await prisma.restaurant.update({ where: { id: restaurantId }, data: { pricesIncludeTax: before!.taxInclusive } });
    });
    await test('An invalid KRA PIN is refused', async () => {
      const res = await call('PUT', '/restaurant', ownerToken, { kraPin: '12345' });
      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
    });
  } finally {
    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        taxRate: restaurantBefore!.taxRate, serviceChargeRate: restaurantBefore!.serviceChargeRate, pricesIncludeTax: restaurantBefore!.pricesIncludeTax,
        tourismLevyRate: restaurantBefore!.tourismLevyRate, vatRegistered: restaurantBefore!.vatRegistered, kraPin: restaurantBefore!.kraPin,
      },
    });
    await prisma.menuItem.update({ where: { id: menuItem.id }, data: { taxCategory: itemBefore!.taxCategory } });
  }

  console.log('\n--- Food cost: quick purchase, prices, margins, stocktake value ---');
  {
    const category = await prisma.ingredientCategory.create({ data: { restaurantId, name: `IT Veg ${uid()}` } });
    const beef = await prisma.ingredient.create({ data: { restaurantId, categoryId: category.id, name: `IT Beef ${uid()}`, unit: 'kg', costPerUnit: 600 } });
    const dish = await prisma.menuItem.create({
      data: { restaurantId, categoryId: menuItem.categoryId, name: `IT Stew ${uid()}`, sellingPrice: 1000, targetFoodCostPct: 30 },
    });
    // 250 g of beef per serving: 0.25 kg × KES 600 = KES 150, 15% of the price.
    await prisma.recipe.create({ data: { restaurantId, menuItemId: dish.id, servings: 1, ingredients: { create: [{ ingredientId: beef.id, quantity: 250, unit: 'g' }] } } });

    await test('Dish cost converts recipe grams into the per-kg price', async () => {
      const res = await call('GET', '/inventory/food-cost', ownerToken);
      const row = res.body.data.dishes.find((d: any) => d.menuItemId === dish.id);
      assert.ok(row && Math.abs(row.costPerServing - 150) < 0.01 && Math.abs(row.foodCostPct - 15) < 0.01 && !row.overTarget, JSON.stringify(row));
    });
    await test('Paying from the till needs an open shift', async () => {
      await prisma.shift.updateMany({ where: { userId: cashier.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
      const res = await call('POST', '/inventory/quick-purchase', cashierToken, { ingredientId: beef.id, quantity: 5, totalPaid: 4000, paidFrom: 'TILL_CASH' });
      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
    });
    await test('Quick purchase: stock, price, history, expense and a margin alert in one step', async () => {
      await call('POST', '/shifts', cashierToken, { openingCash: 0 });
      // 5 kg for KES 7,000 = KES 1,400/kg; the stew now costs 350 = 35%, over its 30% target.
      const res = await call('POST', '/inventory/quick-purchase', cashierToken, { ingredientId: beef.id, quantity: 5, unit: 'kg', totalPaid: 7000, paidFrom: 'TILL_CASH', vendor: 'Marikiti' });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      const d = res.body.data;
      assert.strictEqual(d.expenseStatus, 'PENDING', 'a cashier purchase waits for approval');
      assert.strictEqual(d.priceChange, null, 'cashiers are not shown costs');
      assert.deepStrictEqual(d.marginAlerts, []);
      const fresh = await prisma.ingredient.findUnique({ where: { id: beef.id } });
      assert.ok(Math.abs(fresh!.costPerUnit - 1400) < 0.01, String(fresh!.costPerUnit));
      const alert = await prisma.notification.findFirst({ where: { userId: owner.id, type: 'MARGIN_ALERT', message: { contains: dish.name } } });
      assert.ok(alert, 'the owner is told the dish went over target');
      const waiterAlert = await prisma.notification.findFirst({ where: { user: { role: { name: 'WAITER' } }, type: 'MARGIN_ALERT', message: { contains: dish.name } } });
      assert.strictEqual(waiterAlert, null, 'waiters are not sent costs');
      const stock = await prisma.inventoryStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId: beef.id } } });
      assert.ok(stock && Math.abs(stock.quantity - 5) < 0.001);
      assert.strictEqual(await prisma.ingredientPriceHistory.count({ where: { ingredientId: beef.id } }), 1);
      const expense = await prisma.expense.findUnique({ where: { id: d.expenseId } });
      assert.ok(expense && expense.shiftId && expense.paymentMethod === 'CASH' && expense.category === 'Food purchases');
    });
    await test('Buying in grams adds to stock counted in kg', async () => {
      const res = await call('POST', '/inventory/quick-purchase', ownerToken, { ingredientId: beef.id, quantity: 500, unit: 'g', totalPaid: 700, paidFrom: 'MPESA', branchId });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      assert.strictEqual(res.body.data.expenseStatus, 'APPROVED', "an owner's purchase is approved at once");
      const stock = await prisma.inventoryStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId: beef.id } } });
      assert.ok(Math.abs(stock!.quantity - 5.5) < 0.001, String(stock!.quantity));
    });
    await test('A unit that cannot be converted is refused', async () => {
      const res = await call('POST', '/inventory/quick-purchase', ownerToken, { ingredientId: beef.id, quantity: 2, unit: 'litres', totalPaid: 100, paidFrom: 'OTHER', branchId });
      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
    });
    await test('Cash taken for a pending purchase already counts against the shift', async () => {
      const current = await prisma.shift.findFirst({ where: { userId: cashier.id, status: 'OPEN' } });
      const managerView = (await call('GET', '/shifts', ownerToken)).body.data.shifts.find((x: any) => x.id === current!.id);
      assert.ok(Math.abs(managerView.cashExpenses - 7000) < 0.01, JSON.stringify(managerView));
    });
    await test('A price far from the last one needs confirming', async () => {
      const body = { ingredientId: beef.id, quantity: 1, unit: 'kg', totalPaid: 140000, paidFrom: 'OTHER', branchId };
      const check = await call('POST', '/inventory/quick-purchase', ownerToken, body);
      assert.strictEqual(check.status, 409, JSON.stringify(check.body));
      assert.deepStrictEqual(check.body.errors?.price, ['PRICE_CHECK']);
      assert.strictEqual(await prisma.ingredientPriceHistory.count({ where: { ingredientId: beef.id } }), 2, 'nothing saved before confirming');
    });
    await test('The same purchase sent twice is recorded once', async () => {
      const body = { ingredientId: beef.id, quantity: 1, unit: 'kg', totalPaid: 1400, paidFrom: 'OTHER', branchId, clientRequestId: uid() };
      const first = await call('POST', '/inventory/quick-purchase', ownerToken, body);
      const again = await call('POST', '/inventory/quick-purchase', ownerToken, body);
      assert.strictEqual(first.status, 201, JSON.stringify(first.body));
      assert.strictEqual(again.body.data.expenseId, first.body.data.expenseId);
      assert.strictEqual(await prisma.expense.count({ where: { reference: `QP:${body.clientRequestId}` } }), 1);
    });
    await test('Rejecting a quick purchase takes the stock back out and restores the price', async () => {
      const before = await prisma.inventoryStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId: beef.id } } });
      const priceBefore = (await prisma.ingredient.findUnique({ where: { id: beef.id } }))!.costPerUnit;
      const res = await call('POST', '/inventory/quick-purchase', cashierToken, { ingredientId: beef.id, quantity: 2, unit: 'kg', totalPaid: 4000, paidFrom: 'TILL_CASH' });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      const edit = await call('PUT', `/expenses/${res.body.data.expenseId}`, ownerToken, { amount: 10 });
      assert.strictEqual(edit.status, 400, 'a quick purchase cannot be edited');
      const reject = await call('PATCH', `/expenses/${res.body.data.expenseId}/status`, ownerToken, { status: 'REJECTED' });
      assert.strictEqual(reject.status, 200, JSON.stringify(reject.body));
      const after = await prisma.inventoryStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId: beef.id } } });
      assert.ok(Math.abs(after!.quantity - before!.quantity) < 0.001, `${before!.quantity} -> ${after!.quantity}`);
      const priceAfter = (await prisma.ingredient.findUnique({ where: { id: beef.id } }))!.costPerUnit;
      assert.ok(Math.abs(priceAfter - priceBefore) < 0.000001, `${priceBefore} -> ${priceAfter}`);
    });
    await test('Price history lists what was paid, newest first', async () => {
      const res = await call('GET', `/inventory/ingredients/${beef.id}/price-history`, ownerToken);
      assert.strictEqual(res.body.data.history.length, 3, 'the rejected purchase is not listed');
      assert.ok(res.body.data.history.every((h: any) => Math.abs(h.unitCost - 1400) < 0.01));
      const denied = await call('GET', `/inventory/ingredients/${beef.id}/price-history`, cashierToken);
      assert.strictEqual(denied.status, 403);
    });
    await test('A completed stocktake values the shortage in shillings', async () => {
      const st = await call('POST', '/inventory/stocktakes', ownerToken, { branchId });
      const line = st.body.data.items.find((i: any) => i.ingredientId === beef.id);
      await call('PUT', `/inventory/stocktakes/${st.body.data.id}`, ownerToken, { items: [{ ingredientId: beef.id, countedQty: line.expectedQty - 1 }] });
      const done = await call('POST', `/inventory/stocktakes/${st.body.data.id}/complete`, ownerToken);
      assert.strictEqual(done.status, 200, JSON.stringify(done.body));
      const item = await prisma.stocktakeItem.findFirst({ where: { stocktakeId: st.body.data.id, ingredientId: beef.id } });
      assert.ok(item && item.varianceValue !== null && item.varianceValue < 0 && Math.abs(item.varianceValue + item.unitCost!) < 0.01, JSON.stringify(item));
    });
    await test('A food-cost target outside 1–99% is refused', async () => {
      const res = await call('PUT', `/inventory/food-cost/${dish.id}/target`, ownerToken, { targetFoodCostPct: 150 });
      assert.strictEqual(res.status, 400);
    });
    await prisma.shift.updateMany({ where: { userId: cashier.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
    await prisma.menuItem.update({ where: { id: dish.id }, data: { status: 'INACTIVE' } });
  }

  console.log('\n--- Selling direct: channels, commission, payment links, dish options ---');
  {
    const before = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { channelCommissions: true, whatsappNumber: true } });
    const near = (a: number, b: number) => Math.abs(a - b) < 0.011;
    const completeOrder = (id: string) => require('../services/orderCompletionService').completeOrder(id, restaurantId, owner.id);
    try {
      await test('Settings: commission 0–60% per channel and a Kenyan WhatsApp number', async () => {
        assert.strictEqual((await call('PUT', '/restaurant', ownerToken, { channelCommissions: { GLOVO: 75 } })).status, 400);
        assert.strictEqual((await call('PUT', '/restaurant', ownerToken, { whatsappNumber: '12345' })).status, 400);
        const ok = await call('PUT', '/restaurant', ownerToken, { channelCommissions: { GLOVO: 30, UBER_EATS: '25', BOLT: 0, NOT_A_CHANNEL: 10 }, whatsappNumber: '0712 345 678' });
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
        const got = (await call('GET', '/restaurant', ownerToken)).body.data;
        assert.deepStrictEqual(got.channelCommissions, { GLOVO: 30, UBER_EATS: 25 });
        assert.strictEqual(got.whatsappNumber, '254712345678');
        const pub = (await call('GET', '/public/restaurants', null)).body.data.restaurants.find((r: any) => r.id === restaurantId);
        assert.strictEqual(pub?.whatsappNumber, '254712345678');
      });
      await test('An order records its channel; an unknown or Website channel from staff is refused', async () => {
        const pos = (await newOrder()).body.data;
        assert.strictEqual((await prisma.sale.findUnique({ where: { id: pos.id } })).channel, 'POS');
        assert.strictEqual((await newOrder({ channel: 'TELEGRAM' })).status, 400);
        assert.strictEqual((await newOrder({ channel: 'WEBSITE' })).status, 400);
      });
      await test('A Glovo order freezes its 30% commission; edits follow the bill at that rate', async () => {
        const held = await newOrder({ channel: 'GLOVO', status: 'HELD' });
        assert.strictEqual(held.status, 201, JSON.stringify(held.body));
        const sale = await prisma.sale.findUnique({ where: { id: held.body.data.id } });
        assert.strictEqual(sale.channel, 'GLOVO');
        assert.ok(near(sale.commissionRate, 0.3) && near(sale.commissionAmount, sale.totalAmount * 0.3), JSON.stringify(sale));
        // The rate changes later: this order keeps 30%.
        await call('PUT', '/restaurant', ownerToken, { channelCommissions: { GLOVO: 20, UBER_EATS: 25 } });
        const edit = await call('PATCH', `/orders/${sale.id}`, cashierToken, { items: [{ menuItemId: menuItem.id, quantity: 1, modifiers: [] }] });
        assert.strictEqual(edit.status, 200, JSON.stringify(edit.body));
        const after = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.ok(after.totalAmount < sale.totalAmount && near(after.commissionAmount, after.totalAmount * 0.3), JSON.stringify(after));
        await call('PUT', '/restaurant', ownerToken, { channelCommissions: { GLOVO: 30, UBER_EATS: 25 } });
      });
      await test('Voiding an item lowers the commission with the bill', async () => {
        const order = (await newOrder({ channel: 'UBER_EATS' })).body.data;
        const res = await call('POST', `/orders/${order.id}/items/${order.items[0].id}/void`, cashierToken, { quantity: 1, reason: 'test', approval });
        assert.strictEqual(res.status, 200, JSON.stringify(res.body));
        const sale = await prisma.sale.findUnique({ where: { id: order.id } });
        assert.ok(near(sale.commissionAmount, sale.totalAmount * 0.25), JSON.stringify(sale));
      });
      await test('Staff can correct the channel of an open order, not a closed one', async () => {
        const order = (await newOrder()).body.data;
        const res = await call('PATCH', `/orders/${order.id}/channel`, cashierToken, { channel: 'GLOVO' });
        assert.strictEqual(res.status, 200, JSON.stringify(res.body));
        assert.strictEqual(res.body.data.commissionAmount, undefined, 'cashiers are not shown commission');
        assert.ok(near((await prisma.sale.findUnique({ where: { id: order.id } })).commissionAmount, order.totalAmount * 0.3));
        const asCashier = (await call('GET', `/orders/${order.id}`, cashierToken)).body.data;
        assert.ok(asCashier.channel === 'GLOVO' && asCashier.commissionAmount === undefined && asCashier.commissionRate === undefined);
        assert.ok(near((await call('GET', `/orders/${order.id}`, ownerToken)).body.data.commissionAmount, order.totalAmount * 0.3));
        assert.strictEqual((await call('PATCH', `/orders/${order.id}/channel`, cashierToken, { channel: 'WEBSITE' })).status, 400);
        await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
        await completeOrder(order.id);
        assert.strictEqual((await call('PATCH', `/orders/${order.id}/channel`, cashierToken, { channel: 'POS' })).status, 400);
      });
      await test('Website orders are marked Website and keep that channel', async () => {
        const placed = await call('POST', '/public/orders', null, {
          restaurantId, branchId, customerName: 'IT Web', contactPhone: '0712345678', fulfillmentType: 'PICKUP', paymentMethod: 'CASH', items: [{ menuItemId: menuItem.id, quantity: 1 }], clientRequestId: uid(),
        });
        assert.strictEqual(placed.status, 201, JSON.stringify(placed.body));
        const online = await prisma.onlineOrder.findFirst({ where: { trackingToken: placed.body.data.trackingToken } });
        const sale = await prisma.sale.findUnique({ where: { id: online.saleId } });
        assert.strictEqual(sale.channel, 'WEBSITE');
        assert.strictEqual((await call('PATCH', `/orders/${sale.id}/channel`, cashierToken, { channel: 'POS' })).status, 400);
      });
      await test('Offline orders keep the channel picked at the till', async () => {
        const id = uid();
        const offline = { id, offlineOrderNumber: 'OFF-2', branchId, orderType: 'TAKEAWAY', status: 'SUBMITTED', channel: 'PHONE', items: [{ menuItemId: menuItem.id, quantity: 1, modifiers: [] }], discountAmount: 0, createdAt: new Date().toISOString() };
        const res = await call('POST', '/orders/sync-offline', cashierToken, { orders: [offline] });
        assert.strictEqual(res.status, 200, JSON.stringify(res.body));
        assert.strictEqual((await prisma.sale.findFirst({ where: { restaurantId, clientRequestId: id } })).channel, 'PHONE');
      });
      await test('Sales by channel: what each channel sold, its commission and what was kept', async () => {
        const order = (await newOrder({ channel: 'BOLT' })).body.data;
        await call('PUT', '/restaurant', ownerToken, { channelCommissions: { GLOVO: 30, UBER_EATS: 25, BOLT: 10 } });
        const glovo = (await newOrder({ channel: 'GLOVO' })).body.data;
        for (const o of [order, glovo]) {
          await call('POST', `/payments/orders/${o.id}`, cashierToken, { method: 'CASH', amount: o.totalAmount });
          await completeOrder(o.id);
        }
        const res = await call('GET', '/reports/channels', ownerToken);
        assert.strictEqual(res.status, 200, JSON.stringify(res.body));
        const rows = res.body.data.channels;
        const g = rows.find((r: any) => r.channel === 'GLOVO');
        const b = rows.find((r: any) => r.channel === 'BOLT');
        assert.ok(g && g.commission > 0 && near(g.kept, g.sales - g.commission), JSON.stringify(g));
        assert.ok(b && b.commission === 0, 'the Bolt order was placed before Bolt had a rate');
        const t = res.body.data.totals;
        assert.ok(near(t.kept, t.sales - t.commission));
        assert.strictEqual((await call('GET', '/reports/channels', cashierToken)).status, 403);
      });

      // Payment links (test-mode M-Pesa for this block).
      process.env.PAYMENT_SIMULATION = 'true';
      await test('A payment link is reused while valid and shows the bill without private details', async () => {
        const order = (await newOrder({ channel: 'WHATSAPP' })).body.data;
        const first = await call('POST', `/payments/orders/${order.id}/payment-link`, cashierToken, { phone: '0712345678' });
        assert.strictEqual(first.status, 200, JSON.stringify(first.body));
        assert.ok(first.body.data.phoneKnown && first.body.data.whatsappUrl.startsWith('https://wa.me/254712345678?text='));
        const again = await call('POST', `/payments/orders/${order.id}/payment-link`, cashierToken, {});
        assert.strictEqual(again.body.data.url, first.body.data.url);
        assert.ok(/^https?:\/\/[^/]+\/pay\/[A-Za-z0-9_-]+$/.test(first.body.data.url), first.body.data.url);
        const token = first.body.data.url.split('/pay/')[1];
        const bill = await call('GET', `/public/pay/${token}`, null);
        assert.strictEqual(bill.status, 200, JSON.stringify(bill.body));
        assert.ok(near(bill.body.data.balance, order.totalAmount));
        const text = JSON.stringify(bill.body.data);
        assert.ok(!text.includes(cashier.id) && !text.includes('0712345678'), 'no staff ids or phones on the public page');
      });
      await test('Paying through the link records the payment on the bill', async () => {
        const order = (await newOrder()).body.data;
        const link = (await call('POST', `/payments/orders/${order.id}/payment-link`, cashierToken, {})).body.data;
        const token = link.url.split('/pay/')[1];
        const sent = await call('POST', `/public/pay/${token}/mpesa`, null, { phoneNumber: '0712345678' });
        assert.strictEqual(sent.status, 201, JSON.stringify(sent.body));
        const id = sent.body.data.checkoutRequestId;
        assert.strictEqual((await call('GET', `/public/pay/${token}/status/${id}`, null)).body.data.status, 'PENDING');
        assert.strictEqual((await call('POST', `/public/pay/${token}/simulate/${id}`, null)).status, 200);
        assert.strictEqual((await call('GET', `/public/pay/${token}/status/${id}`, null)).body.data.status, 'SUCCESS');
        const sale = await prisma.sale.findUnique({ where: { id: order.id } });
        assert.strictEqual(sale.paymentStatus, 'PAID');
        const payment = await prisma.payment.findFirst({ where: { saleId: order.id, status: 'COMPLETED' } });
        assert.strictEqual(payment.createdBy, cashier.id, 'counts for the staff member who sent the link');
        assert.strictEqual((await call('POST', `/payments/orders/${order.id}/payment-link`, cashierToken, {})).status, 400, 'a paid bill gets no link');
      });
      await test("A link can't see another bill's prompt, and an expired link is gone", async () => {
        const a = (await newOrder()).body.data;
        const b = (await newOrder()).body.data;
        const tokenA = (await call('POST', `/payments/orders/${a.id}/payment-link`, cashierToken, {})).body.data.url.split('/pay/')[1];
        const sentB = await call('POST', `/payments/orders/${b.id}/mpesa-prompt`, cashierToken, { phoneNumber: '0712345678' });
        const idB = sentB.body.data.checkoutRequestId;
        assert.strictEqual((await call('GET', `/public/pay/${tokenA}/status/${idB}`, null)).status, 404);
        assert.strictEqual((await call('POST', `/public/pay/${tokenA}/simulate/${idB}`, null)).status, 404);
        await prisma.paymentLink.updateMany({ where: { token: tokenA }, data: { expiresAt: new Date(Date.now() - 1000) } });
        assert.strictEqual((await call('GET', `/public/pay/${tokenA}`, null)).status, 404);
        assert.strictEqual((await call('GET', '/public/pay/not-a-real-token-value', null)).status, 404);
      });
      delete process.env.PAYMENT_SIMULATION;

      // Dish options on the website.
      const group = await prisma.modifierGroup.create({
        data: {
          restaurantId, name: `IT Size ${uid()}`, selectionType: 'SINGLE', isRequired: true,
          options: { create: [{ name: 'Regular', priceAdjustment: 0 }, { name: 'Large', priceAdjustment: 150 }] },
        },
        include: { options: true },
      });
      const extras = await prisma.modifierGroup.create({
        data: { restaurantId, name: `IT Extras ${uid()}`, selectionType: 'MULTIPLE', isRequired: false, options: { create: [{ name: 'Cheese', priceAdjustment: 50 }, { name: 'Gone', priceAdjustment: 10, status: 'INACTIVE' }] } },
        include: { options: true },
      });
      const otherGroup = await prisma.modifierGroup.create({ data: { restaurantId, name: `IT Other ${uid()}`, options: { create: [{ name: 'Elsewhere', priceAdjustment: 5 }] } }, include: { options: true } });
      const optDish = await prisma.menuItem.create({ data: { restaurantId, categoryId: menuItem.categoryId, name: `IT Burger ${uid()}`, sellingPrice: 500 } });
      await prisma.menuItemModifierGroup.createMany({ data: [{ menuItemId: optDish.id, modifierGroupId: group.id }, { menuItemId: optDish.id, modifierGroupId: extras.id }] });
      const large = group.options.find((o: any) => o.name === 'Large');
      const cheese = extras.options.find((o: any) => o.name === 'Cheese');
      const gone = extras.options.find((o: any) => o.name === 'Gone');
      const quote = (modifiers: unknown) => call('POST', '/public/orders/quote', null, { restaurantId, branchId, items: [{ menuItemId: optDish.id, quantity: 2, modifiers }] });
      try {
        await test('The public menu lists active options and no cost price', async () => {
          const res = await call('GET', `/public/menu?restaurantId=${restaurantId}&branchId=${branchId}`, null);
          const dish = res.body.data.items.find((i: any) => i.id === optDish.id);
          assert.ok(dish, 'dish listed');
          assert.strictEqual(dish.costPrice, undefined);
          assert.strictEqual(dish.modifierGroups.length, 2);
          const ex = dish.modifierGroups.find((g: any) => g.id === extras.id);
          assert.deepStrictEqual(ex.options.map((o: any) => o.name), ['Cheese']);
        });
        await test('Options are checked: required, one-only, inactive and other dishes', async () => {
          assert.strictEqual((await quote([])).status, 400, 'size is required');
          assert.strictEqual((await quote([large.id, group.options.find((o: any) => o.name === 'Regular').id])).status, 400, 'one size only');
          assert.strictEqual((await quote([large.id, gone.id])).status, 400, 'inactive option');
          assert.strictEqual((await quote([large.id, otherGroup.options[0].id])).status, 400, "another dish's option");
        });
        await test('Option prices are charged and saved with the order', async () => {
          const q = await quote([large.id, cheese.id]);
          assert.strictEqual(q.status, 200, JSON.stringify(q.body));
          assert.ok(near(q.body.data.subtotal, (500 + 150 + 50) * 2), JSON.stringify(q.body.data));
          const placed = await call('POST', '/public/orders', null, {
            restaurantId, branchId, customerName: 'IT Options', contactPhone: '0712345678', fulfillmentType: 'PICKUP', paymentMethod: 'CASH', clientRequestId: uid(),
            items: [{ menuItemId: optDish.id, quantity: 2, modifiers: [{ modifierOptionId: large.id }, cheese.id] }],
          });
          assert.strictEqual(placed.status, 201, JSON.stringify(placed.body));
          assert.ok(near(placed.body.data.totalAmount, q.body.data.totalAmount));
          const online = await prisma.onlineOrder.findFirst({ where: { trackingToken: placed.body.data.trackingToken } });
          const line = await prisma.saleItem.findFirst({ where: { saleId: online.saleId }, include: { modifiers: true } });
          assert.ok(near(line.subtotal, 1400), String(line.subtotal));
          assert.deepStrictEqual(line.modifiers.map((m: any) => m.optionNameSnapshot).sort(), ['Cheese', 'Large']);
        });
      } finally {
        await prisma.menuItem.update({ where: { id: optDish.id }, data: { status: 'INACTIVE' } });
        await prisma.modifierGroup.updateMany({ where: { id: { in: [group.id, extras.id, otherGroup.id] } }, data: { status: 'INACTIVE' } });
      }
    } finally {
      delete process.env.PAYMENT_SIMULATION;
      await prisma.restaurant.update({ where: { id: restaurantId }, data: { channelCommissions: before!.channelCommissions, whatsappNumber: before!.whatsappNumber } });
    }
  }

  server.close();
  await prisma.$disconnect();
  console.log(`\n========================================\nIntegration Results: ${passed} Passed, ${failed} Failed\n========================================`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
