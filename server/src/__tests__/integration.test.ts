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
delete process.env.AT_USERNAME;
delete process.env.AT_API_KEY;
process.env.SMS_WEBHOOK_SECRET = 'it-sms-webhook-secret-0123456789';

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
  await test('website enquiries reach owners and managers, not cashiers', async () => {
    const note = `Lunch for 25 people, ${uid()}`;
    const res = await call('POST', '/public/enquiries', null, { restaurantId, name: 'Office Buyer', phone: '0712 345 678', subject: 'Office Lunch & Catering', message: note });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const sent = await prisma.notification.findMany({ where: { restaurantId, type: 'WEBSITE_ENQUIRY', message: { contains: note } }, select: { userId: true, title: true } });
    assert.ok(sent.some((n: any) => n.userId === owner.id), 'owner notified');
    assert.ok(!sent.some((n: any) => n.userId === cashier.id), 'cashier not notified');
    assert.strictEqual(sent[0].title, 'Website enquiry: Office Lunch & Catering');
    assert.strictEqual((await call('POST', '/public/enquiries', null, { restaurantId, name: 'X', phone: 'call me', message: 'hi' })).status, 400);
    assert.strictEqual((await call('POST', '/public/enquiries', null, { restaurantId, name: 'X', phone: '- - - - - - - - -', message: 'hi' })).status, 400, 'needs real digits');
    assert.strictEqual((await call('POST', '/public/enquiries', null, { restaurantId, name: 'X', phone: '(0712) 345 678', message: `brackets ${uid()}` })).status, 200, 'common phone formats accepted');
    assert.strictEqual((await call('POST', '/public/enquiries', null, { restaurantId: 'nope', name: 'X', phone: '0712345678', message: 'hi' })).status, 404);
  });
  await test('re-confirming a cancelled booking whose table was taken is refused', async () => {
    // Any moment in ~10 years: earlier runs' bookings on this table never collide.
    const startAt = new Date(Date.now() + (800 + Math.random() * 3600) * 86_400_000).toISOString();
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

  console.log('\n--- Tables: live floor, cleaning, moving guests ---');
  {
    const waiter = await prisma.user.findFirst({ where: { email: 'waiter@example.com' } });
    const waiterToken = generateToken(waiter.id, restaurantId, waiter.tokenVersion);
    const mk = (n: string) => prisma.table.create({ data: { restaurantId, branchId, tableNumber: `IT${n}-${uid().slice(-6)}`, capacity: 4 } });
    const [t1, t2, t3] = [await mk('A'), await mk('B'), await mk('C')];
    const live = async (token = cashierToken) => (await call('GET', `/tables/live?branchId=${branchId}`, token)).body.data;
    const row = async (id: string, token = cashierToken) => (await live(token)).tables.find((t: any) => t.id === id);
    const tableStatus = async (id: string) => (await prisma.table.findUnique({ where: { id } })).status;
    const completeOrder = (id: string) => require('../services/orderCompletionService').completeOrder(id, restaurantId, owner.id);
    try {
      await test('An order on a table shows it occupied with the bill, waiter and time', async () => {
        const order = (await newOrder({ orderType: 'DINE_IN', tableId: t1.id })).body.data;
        assert.strictEqual(await tableStatus(t1.id), 'OCCUPIED');
        const r = await row(t1.id);
        assert.strictEqual(r.state, 'ORDERED');
        assert.ok(Math.abs(r.balance - order.totalAmount) < 0.01 && r.minutes === 0 && r.orders.length === 1, JSON.stringify(r));
        const pay = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
        assert.strictEqual(pay.status, 201, JSON.stringify(pay.body));
        assert.strictEqual((await row(t1.id)).state, 'PAID');
        await completeOrder(order.id);
        assert.strictEqual(await tableStatus(t1.id), 'CLEANING');
        assert.strictEqual((await row(t1.id)).state, 'CLEANING');
      });
      await test('A waiter can mark a table clean; tapping twice is harmless', async () => {
        const first = await call('POST', `/tables/${t1.id}/service`, waiterToken, { action: 'MARK_CLEAN' });
        assert.strictEqual(first.status, 200, JSON.stringify(first.body));
        assert.strictEqual(await tableStatus(t1.id), 'AVAILABLE');
        assert.strictEqual((await call('POST', `/tables/${t1.id}/service`, waiterToken, { action: 'MARK_CLEAN' })).status, 200);
        assert.strictEqual((await call('POST', `/tables/${t1.id}/service`, waiterToken, { action: 'FLY' })).status, 400);
      });
      await test('Seating guests before they order, then they leave', async () => {
        assert.strictEqual((await call('POST', `/tables/${t3.id}/service`, waiterToken, { action: 'SEAT' })).status, 200);
        assert.strictEqual((await row(t3.id)).state, 'SEATED');
        assert.strictEqual((await call('POST', `/tables/${t3.id}/service`, waiterToken, { action: 'CLEAR' })).status, 200);
        assert.strictEqual(await tableStatus(t3.id), 'CLEANING');
        await call('POST', `/tables/${t3.id}/service`, waiterToken, { action: 'MARK_CLEAN' });
      });
      await test('Moving guests takes their orders along and frees the old table for cleaning', async () => {
        const a = (await newOrder({ orderType: 'DINE_IN', tableId: t1.id })).body.data;
        const b = (await newOrder({ orderType: 'DINE_IN', tableId: t1.id })).body.data;
        const res = await call('POST', `/orders/${a.id}/move-table`, cashierToken, { toTableId: t2.id });
        assert.strictEqual(res.status, 200, JSON.stringify(res.body));
        assert.strictEqual(res.body.data.moved.length, 2);
        assert.strictEqual((await prisma.sale.findUnique({ where: { id: b.id } })).tableId, t2.id);
        assert.strictEqual(await tableStatus(t1.id), 'CLEANING');
        assert.strictEqual(await tableStatus(t2.id), 'OCCUPIED');
        assert.strictEqual((await call('POST', `/orders/${a.id}/move-table`, cashierToken, { toTableId: t2.id })).status, 400, 'same table');
        assert.strictEqual((await call('POST', `/orders/${a.id}/move-table`, waiterToken, { toTableId: t3.id })).status, 403, 'not the waiter\'s orders');
        assert.strictEqual((await call('PUT', `/tables/${t2.id}/status`, ownerToken, { status: 'AVAILABLE' })).status, 409);
        assert.strictEqual((await call('PUT', `/tables/${t2.id}/status`, ownerToken, { status: 'OCCUPIED' })).status, 400);
        assert.strictEqual((await call('POST', `/tables/${t2.id}/service`, waiterToken, { action: 'CLEAR' })).status, 409);
        for (const o of [a, b]) {
          await call('POST', `/payments/orders/${o.id}`, cashierToken, { method: 'CASH', amount: o.totalAmount });
          await completeOrder(o.id);
        }
        assert.strictEqual(await tableStatus(t2.id), 'CLEANING', 'cleaning once the last order closes');
      });
      await test('An out-of-service table is not switched back on by an order closing', async () => {
        await call('POST', `/tables/${t2.id}/service`, waiterToken, { action: 'MARK_CLEAN' });
        const o = (await newOrder({ orderType: 'DINE_IN', tableId: t2.id })).body.data;
        assert.strictEqual((await call('PUT', `/tables/${t2.id}/status`, ownerToken, { status: 'OUT_OF_SERVICE' })).status, 200);
        await call('POST', `/payments/orders/${o.id}`, cashierToken, { method: 'CASH', amount: o.totalAmount });
        await completeOrder(o.id);
        assert.strictEqual(await tableStatus(t2.id), 'OUT_OF_SERVICE');
        const other = (await newOrder()).body.data;
        assert.strictEqual((await call('POST', `/orders/${other.id}/move-table`, cashierToken, { toTableId: t2.id })).status, 400);
      });
      await test('Back in service with an open order makes the table occupied again', async () => {
        await call('PUT', `/tables/${t2.id}/status`, ownerToken, { status: 'AVAILABLE' });
        const o = (await newOrder({ orderType: 'DINE_IN', tableId: t2.id })).body.data;
        assert.strictEqual((await call('PUT', `/tables/${t2.id}/status`, ownerToken, { status: 'OUT_OF_SERVICE' })).status, 200);
        assert.strictEqual((await call('PUT', `/tables/${t2.id}/status`, ownerToken, { status: 'AVAILABLE' })).status, 200);
        assert.strictEqual(await tableStatus(t2.id), 'OCCUPIED');
        await call('POST', `/payments/orders/${o.id}`, cashierToken, { method: 'CASH', amount: o.totalAmount });
        await completeOrder(o.id);
        await call('POST', `/tables/${t2.id}/service`, waiterToken, { action: 'MARK_CLEAN' });
      });
      await test('A waiter cannot move another waiter\'s order by editing it either', async () => {
        const o = (await call('POST', '/orders', cashierToken, { orderType: 'DINE_IN', status: 'HELD', tableId: t1.id, items: [{ menuItemId: menuItem.id, quantity: 1, modifiers: [] }] })).body.data;
        assert.strictEqual((await call('PATCH', `/orders/${o.id}`, waiterToken, { tableId: t3.id })).status, 403);
        await call('POST', `/orders/${o.id}/cancel`, cashierToken, { cancelReason: 'test' });
      });
      await test('Dropping a held order does not free a table where guests are seated', async () => {
        await call('POST', `/tables/${t3.id}/service`, waiterToken, { action: 'SEAT' });
        const held = (await call('POST', '/orders', cashierToken, { orderType: 'DINE_IN', status: 'HELD', tableId: t3.id, items: [{ menuItemId: menuItem.id, quantity: 1, modifiers: [] }] })).body.data;
        const res = await call('POST', `/orders/${held.id}/cancel`, cashierToken, { cancelReason: 'test' });
        assert.strictEqual(res.status, 200, JSON.stringify(res.body));
        assert.strictEqual(await tableStatus(t3.id), 'OCCUPIED');
        await call('POST', `/tables/${t3.id}/service`, waiterToken, { action: 'CLEAR' });
        await call('POST', `/tables/${t3.id}/service`, waiterToken, { action: 'MARK_CLEAN' });
      });
      await test('Staff see only their branch; managers also get the day so far', async () => {
        const other = await prisma.branch.findFirst({ where: { restaurantId, id: { not: branchId } } });
        if (other) {
          const res = await call('GET', `/tables/live?branchId=${other.id}`, cashierToken);
          assert.strictEqual(res.body.data.branchId, branchId);
          const layout = await call('GET', `/tables/floor?branchId=${other.id}`, cashierToken);
          assert.ok(layout.body.data.tables.every((t: any) => t.branchId === branchId));
        }
        assert.strictEqual((await live()).summary.today, undefined);
        const managerView = await live(ownerToken);
        assert.ok(managerView.summary.today && managerView.summary.today.tablesServed >= 3, JSON.stringify(managerView.summary));
      });
    } finally {
      await prisma.sale.updateMany({ where: { tableId: { in: [t1.id, t2.id, t3.id] }, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, data: { tableId: null } });
      await prisma.table.updateMany({ where: { id: { in: [t1.id, t2.id, t3.id] } }, data: { status: 'INACTIVE' } });
    }
  }

  console.log('\n--- Customers: receipts and points by SMS, consent, STOP ---');
  {
    const tail = String(Date.now()).slice(-7);
    const phoneLocal = `071${tail}`;
    const phoneIntl = `+25471${tail}`;
    const completeOrder = (id: string) => require('../services/orderCompletionService').completeOrder(id, restaurantId, owner.id);
    // Receipts go out after the response: wait for the SMS row to settle.
    const smsFor = async (saleId: string) => {
      for (let i = 0; i < 40; i++) {
        const rows = await prisma.smsMessage.findMany({ where: { saleId } });
        if (rows.length && rows.every((r: any) => r.status !== 'QUEUED')) return rows;
        await new Promise((r) => setTimeout(r, 100));
      }
      return prisma.smsMessage.findMany({ where: { saleId } });
    };
    let customerId = '';
    await test('A wrong number at the till is refused before anything is saved', async () => {
      const res = await newOrder({ smsReceipt: { phone: '12345', language: 'sw' } });
      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
    });
    await test('Asking for SMS at the till creates the customer, without offers consent', async () => {
      const res = await newOrder({ smsReceipt: { phone: phoneLocal, language: 'sw', marketing: false } });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      const sale = await prisma.sale.findUnique({ where: { id: res.body.data.id } });
      const c = await prisma.customer.findUnique({ where: { id: sale.customerId } });
      customerId = c.id;
      assert.ok(c.smsReceipts && c.language === 'sw' && !c.marketingConsent && c.phone === phoneLocal, JSON.stringify(c));
    });
    await test('The same number typed another way finds the same customer and records offers consent', async () => {
      const res = await newOrder({ smsReceipt: { phone: phoneIntl, language: 'sw', marketing: true } });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      const sale = await prisma.sale.findUnique({ where: { id: res.body.data.id } });
      assert.strictEqual(sale.customerId, customerId);
      const c = await prisma.customer.findUnique({ where: { id: customerId } });
      assert.ok(c.marketingConsent && c.marketingConsentSource === 'POS' && c.marketingConsentBy === cashier.id && c.marketingConsentAt, JSON.stringify(c));
    });
    await test('Closing the bill texts a Swahili receipt with points, once', async () => {
      const order = (await newOrder({ customerId })).body.data;
      await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
      await completeOrder(order.id);
      await completeOrder(order.id);
      const msgs = await smsFor(order.id);
      assert.strictEqual(msgs.length, 1, JSON.stringify(msgs));
      const m = msgs[0];
      assert.strictEqual(m.kind, 'RECEIPT');
      assert.strictEqual(m.status, 'SIMULATED', 'test mode without Africa\'s Talking keys');
      assert.ok(m.body.includes('Asante') && m.body.includes(order.orderNumber), m.body);
      assert.ok(!m.body.includes('STOP'), 'no "reply STOP" without a shortcode to reply to');
      const earned = Math.floor(order.totalAmount / 100);
      if (earned > 0) assert.ok(m.body.includes(`pointi ${earned}`), m.body);
    });
    await test('Replies need the webhook key; STOP turns all SMS off, START turns receipts back on', async () => {
      const denied = await fetch(`${base}/api/public/sms/inbound?key=wrong`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `from=${encodeURIComponent(phoneIntl)}&text=STOP` });
      assert.strictEqual(denied.status, 403);
      const stop = await fetch(`${base}/api/public/sms/inbound?key=it-sms-webhook-secret-0123456789`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `from=${encodeURIComponent(phoneIntl)}&text=stop please` });
      assert.strictEqual(stop.status, 200);
      const c = await prisma.customer.findUnique({ where: { id: customerId } });
      assert.ok(c.smsOptOutAt && !c.marketingConsent, JSON.stringify(c));
      const order = (await newOrder({ customerId })).body.data;
      await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
      await completeOrder(order.id);
      const [m] = await smsFor(order.id);
      assert.strictEqual(m?.status, 'SKIPPED', 'no SMS after STOP');
      const till = await newOrder({ smsReceipt: { phone: phoneLocal, language: 'en' } });
      assert.strictEqual(till.status, 409, 'the till cannot undo a STOP');
      const mgr = await call('PUT', `/customers/${customerId}`, ownerToken, { smsOptOut: false });
      assert.strictEqual(mgr.status, 409, 'staff cannot undo a STOP the customer texted');
      await fetch(`${base}/api/public/sms/inbound?key=it-sms-webhook-secret-0123456789`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `from=${encodeURIComponent(phoneLocal)}&text=START` });
      const back = await prisma.customer.findUnique({ where: { id: customerId } });
      assert.ok(!back.smsOptOutAt && !back.marketingConsent, 'offers stay off until they agree again');
    });
    await test('Two tills entering the same new number at once make one customer', async () => {
      const fresh = `+254 74${tail.slice(0, 1)} ${tail.slice(1, 4)} ${tail.slice(4)}`;
      const [a, b] = await Promise.all([newOrder({ smsReceipt: { phone: fresh } }), newOrder({ smsReceipt: { phone: `074${tail}` } })]);
      assert.ok(a.status === 201 && b.status === 201, `${a.status}/${b.status}`);
      const [sa, sb] = await Promise.all([prisma.sale.findUnique({ where: { id: a.body.data.id } }), prisma.sale.findUnique({ where: { id: b.body.data.id } })]);
      assert.strictEqual(sa.customerId, sb.customerId);
      const dupe = await call('POST', '/customers', cashierToken, { name: 'IT Dupe', phone: `+25474${tail}` });
      assert.strictEqual(dupe.status, 409, 'the same number written another way is the same customer');
    });
    await test("Africa's Talking opt-out notices are honoured", async () => {
      const num = `075${tail}`;
      const res = await fetch(`${base}/api/public/sms/inbound?key=it-sms-webhook-secret-0123456789`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `phoneNumber=${encodeURIComponent('+25475' + tail)}&senderId=MELIO` });
      assert.strictEqual(res.status, 200);
      assert.ok(await prisma.smsOptOut.findUnique({ where: { phone: `25475${tail}` } }));
      assert.strictEqual((await newOrder({ smsReceipt: { phone: num } })).status, 409);
    });
    await test('Staff record consent and language; the SMS history and status are visible', async () => {
      // Staff mark a customer "no SMS"; only a manager can lift that.
      const other = (await newOrder({ smsReceipt: { phone: `072${tail}`, language: 'en' } })).body.data;
      const otherId = (await prisma.sale.findUnique({ where: { id: other.id } })).customerId;
      assert.strictEqual((await call('PUT', `/customers/${otherId}`, cashierToken, { smsOptOut: true })).status, 200);
      assert.strictEqual((await call('PUT', `/customers/${otherId}`, cashierToken, { smsOptOut: false })).status, 403);
      assert.strictEqual((await call('PUT', `/customers/${otherId}`, ownerToken, { smsOptOut: false })).status, 200);
      const upd = await call('PUT', `/customers/${customerId}`, cashierToken, { marketingConsent: true, language: 'en' });
      assert.strictEqual(upd.status, 200, JSON.stringify(upd.body));
      const c = await prisma.customer.findUnique({ where: { id: customerId } });
      assert.ok(c.marketingConsent && c.marketingConsentSource === 'STAFF' && c.language === 'en');
      assert.strictEqual((await call('PUT', `/customers/${customerId}`, cashierToken, { language: 'fr' })).status, 400);
      const detail = await call('GET', `/customers/${customerId}`, cashierToken);
      assert.ok(detail.body.data.smsMessages.length >= 2);
      const status = await call('GET', '/customers/sms/status', ownerToken);
      assert.strictEqual(status.status, 200, JSON.stringify(status.body));
      assert.strictEqual(status.body.data.mode, 'TEST');
      assert.ok(status.body.data.recent.every((m: any) => m.phone.includes('***')), 'numbers are masked in the list');
      assert.strictEqual((await call('GET', '/customers/sms/status', cashierToken)).status, 403);
    });
  }

  console.log('\n--- Outages: M-Pesa taken while Safaricom is down ---');
  {
    const code = () => `L${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`.slice(0, 10).padEnd(10, 'Z');
    const later = (orderId: string, body: Record<string, unknown>) => call('POST', `/payments/orders/${orderId}`, cashierToken, { method: 'MOBILE_MONEY', checkLater: true, approval, ...body });
    let confirmedCode = '';
    await test('Without "check later", M-Pesa still needs a code', async () => {
      const order = (await newOrder()).body.data;
      assert.strictEqual((await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: order.totalAmount })).status, 400);
      assert.strictEqual((await later(order.id, { amount: order.totalAmount, reference: 'ABC' })).status, 400, 'a code, when given, must look real');
      assert.strictEqual((await later(order.id, { amount: order.totalAmount, payerPhone: '123' })).status, 400);
      const noPin = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'MOBILE_MONEY', checkLater: true, amount: order.totalAmount });
      assert.strictEqual(noPin.status, 428, 'marking a bill paid with unseen money needs a manager PIN');
    });
    let pendingId = '';
    let pendingOrder: any;
    await test('"M-Pesa down": the bill is paid now and listed for a check', async () => {
      pendingOrder = (await newOrder()).body.data;
      const res = await later(pendingOrder.id, { amount: pendingOrder.totalAmount, payerPhone: '0712 345 678', notes: 'paid to till' });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      pendingId = res.body.data.payment.id;
      const pay = await prisma.payment.findUnique({ where: { id: pendingId } });
      assert.ok(pay.verifyStatus === 'PENDING_CHECK' && pay.status === 'COMPLETED' && pay.payerPhone === '254712345678' && pay.reference === null, JSON.stringify(pay));
      assert.strictEqual((await prisma.sale.findUnique({ where: { id: pendingOrder.id } })).paymentStatus, 'PAID');
      const list = await call('GET', '/payments/mpesa-checks', cashierToken);
      assert.strictEqual(list.status, 200, JSON.stringify(list.body));
      const row = list.body.data.toCheck.find((c: any) => c.id === pendingId);
      assert.ok(row && row.payerPhone === '2547*****678' && row.notes === 'paid to till', JSON.stringify(row));
      const refund = await call('POST', `/payments/${pendingId}/refund`, ownerToken, { reason: 'test', approval });
      assert.strictEqual(refund.status, 409, 'no refund of money nobody has checked');
    });
    await test('Only a manager checks it, and "received" needs the M-Pesa code', async () => {
      assert.strictEqual((await call('POST', `/payments/${pendingId}/check`, cashierToken, { result: 'CONFIRMED', reference: code() })).status, 403);
      assert.strictEqual((await call('POST', `/payments/${pendingId}/check`, ownerToken, { result: 'CONFIRMED' })).status, 400);
      confirmedCode = code();
      const ok = await call('POST', `/payments/${pendingId}/check`, ownerToken, { result: 'CONFIRMED', reference: confirmedCode });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
      const pay = await prisma.payment.findUnique({ where: { id: pendingId } });
      assert.ok(pay.verifyStatus === 'CONFIRMED' && pay.reference === confirmedCode && pay.verifiedBy === owner.id);
      assert.strictEqual((await call('POST', `/payments/${pendingId}/check`, ownerToken, { result: 'NOT_RECEIVED' })).status, 404, 'checked once only');
    });
    await test('A code already used elsewhere cannot confirm another payment', async () => {
      const order = (await newOrder()).body.data;
      const res = await later(order.id, { amount: order.totalAmount });
      const again = await call('POST', `/payments/${res.body.data.payment.id}/check`, ownerToken, { result: 'CONFIRMED', reference: confirmedCode });
      assert.strictEqual(again.status, 409, JSON.stringify(again.body));
      const direct = await call('POST', `/payments/orders/${(await newOrder()).body.data.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: 1, reference: confirmedCode });
      assert.strictEqual(direct.status, 409, 'nor be typed in at the till');
      await call('POST', `/payments/${res.body.data.payment.id}/check`, ownerToken, { result: 'NOT_RECEIVED' });
    });
    await test('"Not received" takes it off the bill, which then shows what is owed', async () => {
      const order = (await newOrder()).body.data;
      const res = await later(order.id, { amount: order.totalAmount });
      await require('../services/orderCompletionService').completeOrder(order.id, restaurantId, owner.id);
      const out = await call('POST', `/payments/${res.body.data.payment.id}/check`, ownerToken, { result: 'NOT_RECEIVED' });
      assert.strictEqual(out.status, 200, JSON.stringify(out.body));
      assert.ok(Math.abs(out.body.data.balance - order.totalAmount) < 0.01, JSON.stringify(out.body));
      const pay = await prisma.payment.findUnique({ where: { id: res.body.data.payment.id } });
      assert.ok(pay.status === 'CANCELLED' && pay.verifyStatus === 'NOT_RECEIVED');
      const sale = await prisma.sale.findUnique({ where: { id: order.id } });
      assert.ok(sale.paymentStatus !== 'PAID' && sale.amountPaid === 0, JSON.stringify(sale));
      const report = await call('GET', '/reports/loss-prevention', ownerToken);
      assert.ok(report.body.data.summary.mpesaNotReceived.count >= 1, JSON.stringify(report.body.data.summary));
      const cashierRow = report.body.data.staff.find((r: any) => r.userId === cashier.id);
      assert.ok(cashierRow && cashierRow.mpesaNotReceived.value >= order.totalAmount - 0.01, 'the loss shows against whoever took it');
    });
    process.env.PAYMENT_SIMULATION = 'true';
    await test('A prompt answer that arrives after "M-Pesa down" replaces that entry instead of asking for a refund', async () => {
      const order = (await newOrder()).body.data;
      const sent = await call('POST', `/payments/orders/${order.id}/mpesa-prompt`, cashierToken, { phoneNumber: '0712345678' });
      assert.strictEqual(sent.status, 201, JSON.stringify(sent.body));
      await prisma.payment.updateMany({ where: { saleId: order.id, status: 'PENDING' }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
      const rec = await later(order.id, { amount: order.totalAmount });
      assert.strictEqual(rec.status, 201, JSON.stringify(rec.body));
      await call('POST', `/payments/mpesa/${sent.body.data.checkoutRequestId}/simulate`, cashierToken);
      const replaced = await prisma.payment.findUnique({ where: { id: rec.body.data.payment.id } });
      assert.ok(replaced.status === 'CANCELLED' && replaced.verifyStatus === 'SUPERSEDED', JSON.stringify(replaced));
      const real = await prisma.payment.findFirst({ where: { saleId: order.id, status: 'COMPLETED' } });
      assert.ok(real && !/REFUND/.test(real.notes || ''), JSON.stringify(real));
      assert.strictEqual((await prisma.sale.findUnique({ where: { id: order.id } })).paymentStatus, 'PAID');
    });
    await test('A prompt whose answer never came is listed until Safaricom answers', async () => {
      const order = (await newOrder()).body.data;
      const sent = await call('POST', `/payments/orders/${order.id}/mpesa-prompt`, cashierToken, { phoneNumber: '0712345678' });
      assert.strictEqual(sent.status, 201, JSON.stringify(sent.body));
      await prisma.payment.updateMany({ where: { saleId: order.id, status: 'PENDING' }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
      const list = await call('GET', '/payments/mpesa-checks', cashierToken);
      assert.ok(list.body.data.stuckPrompts.some((p: any) => p.order.orderNumber === order.orderNumber), JSON.stringify(list.body.data.stuckPrompts));
      await call('POST', `/payments/mpesa/${sent.body.data.checkoutRequestId}/simulate`, cashierToken);
      const after = await call('GET', '/payments/mpesa-checks', cashierToken);
      assert.ok(!after.body.data.stuckPrompts.some((p: any) => p.order.orderNumber === order.orderNumber));
    });
    delete process.env.PAYMENT_SIMULATION;
  }

  console.log('\n--- Licences and payroll hours ---');
  {
    const form = (fields: Record<string, string>, file?: { type: string; name: string; body: string }) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.append(k, v);
      if (file) f.append('document', new Blob([file.body], { type: file.type }), file.name);
      return f;
    };
    const send = (method: string, path: string, body: FormData, token = ownerToken) =>
      fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => null)) as any }));
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
    const { sendLicenceReminders, resetLicenceReminderThrottle } = require('../services/licenceService');
    let licenceId = '';
    await test('Licences are for owners and managers; the form is checked', async () => {
      assert.strictEqual((await call('GET', '/licences', cashierToken)).status, 403);
      assert.strictEqual((await send('POST', '/licences', form({ expiresAt: inDays(5) }))).status, 400, 'needs a name');
      assert.strictEqual((await send('POST', '/licences', form({ name: 'Fire', expiresAt: 'soon' }))).status, 400, 'needs a date');
      const bad = await send('POST', '/licences', form({ name: 'Fire', expiresAt: inDays(5) }, { type: 'application/x-msdownload', name: 'x.exe', body: 'MZ' }));
      assert.strictEqual(bad.status, 400, 'only PDFs and photos');
    });
    await test('A licence with its scan is listed with days left, and the scan opens for staff only', async () => {
      const res = await send('POST', '/licences', form({ name: `IT Fire Certificate ${uid()}`, authority: 'Nairobi County', expiresAt: inDays(5) }, { type: 'application/pdf', name: 'fire.pdf', body: '%PDF-1.4 test' }));
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      licenceId = res.body.data.id;
      const list = (await call('GET', '/licences', ownerToken)).body.data.licences;
      const row = list.find((l: any) => l.id === licenceId);
      assert.ok(row && row.hasDocument && row.daysLeft === 5 && row.documentData === undefined, JSON.stringify(row));
      const doc = await fetch(`${base}/api/licences/${licenceId}/document`, { headers: { Authorization: `Bearer ${ownerToken}` } });
      assert.strictEqual(doc.status, 200);
      assert.strictEqual(doc.headers.get('content-type'), 'application/pdf');
      assert.strictEqual(await doc.text(), '%PDF-1.4 test');
      assert.strictEqual((await fetch(`${base}/api/licences/${licenceId}/document`)).status, 401);
    });
    await test('An owner viewing one branch can still add a licence for every branch', async () => {
      const r = await fetch(`${base}/api/licences`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}`, 'x-branch-id': branchId }, body: form({ name: `IT All branches ${uid()}`, expiresAt: inDays(200) }) });
      const body: any = await r.json();
      assert.strictEqual(r.status, 201, JSON.stringify(body));
      assert.strictEqual((await prisma.licence.findUnique({ where: { id: body.data.id } })).branchId, null);
      await prisma.licence.delete({ where: { id: body.data.id } });
    });
    await test('A branch manager cannot change or remove a licence that covers every branch', async () => {
      const mgr = await prisma.user.findFirst({ where: { email: 'manager@example.com' } });
      const mgrToken = generateToken(mgr.id, restaurantId, mgr.tokenVersion);
      const all = await send('POST', '/licences', form({ name: `IT County permit ${uid()}`, expiresAt: inDays(90) }));
      assert.strictEqual(all.status, 201, JSON.stringify(all.body));
      assert.ok((await call('GET', '/licences', mgrToken)).body.data.licences.some((l: any) => l.id === all.body.data.id), 'they still see it');
      assert.strictEqual((await send('PUT', `/licences/${all.body.data.id}`, form({ name: 'x', expiresAt: inDays(90) }), mgrToken)).status, 403);
      assert.strictEqual((await call('DELETE', `/licences/${all.body.data.id}`, mgrToken)).status, 403);
      assert.strictEqual((await prisma.licence.findUnique({ where: { id: all.body.data.id } })).branchId, null);
      await prisma.licence.delete({ where: { id: all.body.data.id } });
    });
    await test('Managers are reminded once when a licence is within 7 days', async () => {
      // Opening the list already ran the check in the background: start from "not reminded".
      await new Promise((r) => setTimeout(r, 300));
      await prisma.licence.update({ where: { id: licenceId }, data: { reminded7At: null, reminded30At: null } });
      resetLicenceReminderThrottle();
      const before = await prisma.notification.count({ where: { userId: owner.id, type: 'LICENCE_EXPIRY', referenceId: licenceId } });
      await sendLicenceReminders(restaurantId);
      resetLicenceReminderThrottle();
      await sendLicenceReminders(restaurantId);
      const after = await prisma.notification.count({ where: { userId: owner.id, type: 'LICENCE_EXPIRY', referenceId: licenceId } });
      assert.strictEqual(after - before, 1, 'one reminder, not one per check');
      const l = await prisma.licence.findUnique({ where: { id: licenceId } });
      assert.ok(l.reminded7At && l.reminded30At);
      const waiterNote = await prisma.notification.findFirst({ where: { type: 'LICENCE_EXPIRY', referenceId: licenceId, user: { role: { name: 'WAITER' } } } });
      assert.strictEqual(waiterNote, null, 'only owners and managers');
    });
    await test('Renewing (a new expiry date) starts the reminders again; removing deletes it', async () => {
      const res = await send('PUT', `/licences/${licenceId}`, form({ name: 'IT Fire Certificate renewed', expiresAt: inDays(365), removeDocument: 'true' }));
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const l = await prisma.licence.findUnique({ where: { id: licenceId } });
      assert.ok(!l.reminded7At && !l.reminded30At && !l.documentData, JSON.stringify({ ...l, documentData: !!l.documentData }));
      assert.strictEqual((await call('DELETE', `/licences/${licenceId}`, ownerToken)).status, 200);
      assert.strictEqual(await prisma.licence.count({ where: { id: licenceId } }), 0);
    });
    await test('Payroll hours: closed till shifts per person, with a CSV', async () => {
      await prisma.shift.updateMany({ where: { userId: cashier.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
      const opened = await call('POST', '/shifts', cashierToken, { openingCash: 0 });
      const shiftId = opened.body.data?.shift?.id || opened.body.data?.id;
      await call('POST', `/shifts/${shiftId}/close`, cashierToken, { closingCash: 0, declaredMobileMoney: 0, declaredCard: 0 });
      // Make it a 2.5-hour shift that started three hours ago.
      const openedAt = new Date(Date.now() - 3 * 3_600_000);
      await prisma.shift.update({ where: { id: shiftId }, data: { openedAt, closedAt: new Date(openedAt.getTime() + 2.5 * 3_600_000) } });
      const res = await call('GET', '/shifts/hours', ownerToken);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const row = res.body.data.staff.find((r: any) => r.userId === cashier.id);
      assert.ok(row && row.hours >= 2.5 && row.days >= 1, JSON.stringify(row));
      const csv = await fetch(`${base}/api/shifts/hours?format=csv`, { headers: { Authorization: `Bearer ${ownerToken}` } });
      assert.ok((csv.headers.get('content-type') || '').includes('text/csv'));
      const text = await csv.text();
      assert.ok(text.includes('Staff member') && text.includes(row.name), text.slice(0, 200));
      assert.strictEqual((await call('GET', '/shifts/hours', cashierToken)).status, 403);
      const { toCsv } = require('../services/reportService');
      assert.ok(toCsv([{ n: '=HYPERLINK("x")', v: -5 }], [{ key: 'n', label: 'N' }, { key: 'v', label: 'V' }]).includes(`"'=HYPERLINK`), 'formulas from names are made plain text');
      assert.ok(toCsv([{ v: -5 }], [{ key: 'v', label: 'V' }]).endsWith('"-5"'), 'negative numbers stay numbers');
    });
  }

  console.log('\n--- M-Pesa statement check ---');
  {
    const mk = () => `S${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`.slice(0, 10).padEnd(10, 'Q');
    const nairobi = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', hour12: false }).replace(',', '');
    const upload = (csv: string, token = ownerToken, branch: string | null = branchId) => {
      const f = new FormData();
      f.append('statement', new Blob([csv], { type: 'text/csv' }), 'statement.csv');
      return fetch(`${base}/api/payments/mpesa-statement`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(branch ? { 'x-branch-id': branch } : {}) }, body: f }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
    };
    const { parseStatement, parseStatementTime } = require('../services/mpesaStatementService');
    await test('Statement times and amounts are read the way the M-Pesa portal writes them', async () => {
      assert.strictEqual(parseStatementTime('24/11/2026 14:02:11').toISOString(), '2026-11-24T11:02:11.000Z');
      assert.strictEqual(parseStatementTime('2026-11-24 14:02:11').toISOString(), '2026-11-24T11:02:11.000Z');
      assert.strictEqual(parseStatementTime('24-11-2026 02:02:11 PM').toISOString(), '2026-11-24T11:02:11.000Z', 'AM/PM');
      assert.strictEqual(parseStatementTime('11/24/2026 14:02'), null, 'month-first dates are refused, not guessed');
      assert.strictEqual(parseStatementTime('31/02/2026 10:00'), null);
      assert.ok(/can't be read/.test(parseStatement('Receipt No.,Completion Time,Paid In\nSKL7H2X9QD,11/24/2026 14:02,100\n').error), 'an unreadable time stops the check');
      const parsed = parseStatement('Receipt No.;Completion Time;Details;Transaction Status;Paid In;Withdrawn\nSKL7H2X9QD;24/11/2026 14:02:11;Pay Bill;Completed;"1,250.00";\nSKL7H2X9QE;24/11/2026 14:03:00;Withdraw;Completed;;500\nSKL7H2X9QF;24/11/2026 14:04:00;Pay;Failed;100;\n');
      assert.ok(parsed.lines.length === 1 && parsed.lines[0].amount === 1250 && parsed.lines[0].receipt === 'SKL7H2X9QD', JSON.stringify(parsed));
      assert.ok(parseStatement('name,age\nx,1').error);
    });
    await test('Checking a statement: matched, confirmed, possible, missing and fake-looking codes', async () => {
      const now = new Date();
      // 1. Typed in at the till with a real code.
      const o1 = (await newOrder()).body.data;
      const c1 = mk();
      await call('POST', `/payments/orders/${o1.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: o1.totalAmount, reference: c1 });
      // 2. "M-Pesa down" with the code: the statement proves it.
      const o2 = (await newOrder()).body.data;
      const c2 = mk();
      const p2 = (await call('POST', `/payments/orders/${o2.id}`, cashierToken, { method: 'MOBILE_MONEY', checkLater: true, approval, amount: o2.totalAmount, reference: c2 })).body.data.payment;
      // 3. "M-Pesa down" with no code, an unusual amount: a possible match.
      const o3 = (await newOrder()).body.data;
      const p3 = (await call('POST', `/payments/orders/${o3.id}`, cashierToken, { method: 'MOBILE_MONEY', checkLater: true, approval, amount: 7.77 })).body.data.payment;
      // 4. A code typed at the till that never reached the till (fake or reused message).
      const o4 = (await newOrder()).body.data;
      const c4 = mk();
      await call('POST', `/payments/orders/${o4.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: o4.totalAmount, reference: c4 });
      const c3 = mk();
      const stray = mk();
      // The statement runs from before these payments to after them.
      const t = nairobi(new Date(now.getTime() - 60_000));
      const tEnd = nairobi(new Date(Date.now() + 120_000));
      const csv = [
        '"Receipt No.","Completion Time","Initiation Time","Details","Transaction Status","Paid In","Withdrawn","Balance","Other Party Info"',
        `"${c1}","${t}","${t}","Pay Merchant","Completed","${o1.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}","","","2547*****678 - J DOE"`,
        `"${c2}","${t}","${t}","Pay Merchant","Completed","${o2.totalAmount}","","",""`,
        `"${c3}","${t}","${t}","Pay Merchant","Completed","7.77","","",""`,
        `"${stray}","${tEnd}","${tEnd}","Pay Merchant","Completed","4.21","","",""`,
      ].join('\r\n');
      assert.strictEqual((await upload(csv, cashierToken)).status, 403);
      const res = await upload(csv);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const d = res.body.data;
      const row = (code: string) => d.rows.find((r: any) => r.receipt === code);
      assert.ok(!row(c1) && !row(c2) && d.summary.matched >= 1 && d.summary.confirmedNow === 1, 'matched and confirmed lines are counted, not listed');
      assert.strictEqual((await prisma.payment.findUnique({ where: { id: p2.id } })).verifyStatus, 'CONFIRMED');
      assert.strictEqual(row(c3).result, 'POSSIBLE_MATCH');
      assert.ok(row(c3).candidates.some((c: any) => c.paymentId === p3.id));
      assert.strictEqual(row(stray).result, 'NOT_IN_MELIO');
      assert.ok(d.missingFromStatement.some((m: any) => m.reference === c4), 'the code nobody paid is flagged');
      assert.ok(!d.missingFromStatement.some((m: any) => m.reference === c1));
      // The manager confirms the possible match with the statement's code.
      const ok = await call('POST', `/payments/${p3.id}/check`, ownerToken, { result: 'CONFIRMED', reference: c3 });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
      assert.strictEqual((await upload('nothing here')).status, 400);
      assert.strictEqual((await upload(csv, ownerToken, null)).status, 400, 'an owner must pick the branch the till belongs to');
    });
    await test("A manager can't confirm their own \"M-Pesa to check\" payment with a statement", async () => {
      const o = (await newOrder()).body.data;
      const code = mk();
      const p = (await call('POST', `/payments/orders/${o.id}`, ownerToken, { method: 'MOBILE_MONEY', checkLater: true, approval, amount: o.totalAmount, reference: code })).body.data.payment;
      const t = nairobi(new Date());
      const res = await upload(`Receipt No.,Completion Time,Transaction Status,Paid In\n${code},${t},Completed,${o.totalAmount}\n`);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.data.rows.find((r: any) => r.receipt === code)?.result, 'NEEDS_OTHER_MANAGER');
      assert.strictEqual((await prisma.payment.findUnique({ where: { id: p.id } })).verifyStatus, 'PENDING_CHECK');
    });
  }

  console.log('\n--- K8: payments sent straight to the till ---');
  {
    const crypto = await import('crypto');
    const token = crypto.randomBytes(24).toString('hex');
    const till = `6${String(Date.now()).slice(-5)}`;
    const code = () => `K${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`.slice(0, 10).padEnd(10, 'Z');
    const darajaNow = () => new Date(Date.now() + 3 * 3_600_000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const confirm = (body: Record<string, unknown>, t = token) =>
      fetch(`${base}/api/public/till/confirm/${t}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
    const other = await prisma.branch.findFirst({ where: { restaurantId, id: { not: branchId } } });
    const mgr = await prisma.user.findFirst({ where: { email: 'manager@example.com' } });
    const managerToken = generateToken(mgr.id, restaurantId, mgr.tokenVersion);
    try {
      await test('A branch saves its till number; one till belongs to one branch; only owners change it', async () => {
        assert.strictEqual((await call('PUT', `/branches/${branchId}`, ownerToken, { mpesaShortcode: '12ab' })).status, 400);
        assert.strictEqual((await call('PUT', `/branches/${branchId}`, managerToken, { mpesaShortcode: till })).status, 403);
        const ok = await call('PUT', `/branches/${branchId}`, ownerToken, { mpesaShortcode: till, mpesaShortcodeType: 'TILL' });
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
        assert.ok(!('mpesaCallbackToken' in ok.body.data), 'the callback secret never leaves the server');
        if (other) assert.strictEqual((await call('PUT', `/branches/${other.id}`, ownerToken, { mpesaShortcode: till })).status, 409);
        assert.strictEqual((await call('POST', '/payments/till/register', ownerToken, { branchId })).status, 503, 'needs the M-Pesa callback address on the server');
        if (other) assert.strictEqual((await call('POST', '/payments/till/simulate', managerToken, { branchId: other.id, amount: 5 })).status, 400, 'a branch manager cannot pick another branch');
      });
      // What a successful registration leaves (Daraja itself isn't reachable from tests).
      await prisma.branch.update({ where: { id: branchId }, data: { mpesaRegisteredAt: new Date(Date.now() - 60_000), mpesaCallbackToken: crypto.createHash('sha256').update(token).digest('hex') } });
      let txCode = '';
      await test("Safaricom's confirmations need the branch's address, are stored once, and show at the POS", async () => {
        txCode = code();
        const body = { TransactionType: 'Buy Goods', TransID: txCode, TransTime: darajaNow(), TransAmount: '450.00', BusinessShortCode: till, MSISDN: '254712345678', FirstName: 'WANJIKU' };
        assert.strictEqual((await confirm(body, 'a'.repeat(48))).status, 401);
        assert.strictEqual((await confirm(body)).body.ResultCode, 0);
        assert.strictEqual((await confirm(body)).body.ResultCode, 0, 'Safaricom resending is harmless');
        assert.strictEqual(await prisma.mpesaTransaction.count({ where: { transId: txCode } }), 1);
        const stray = code();
        await confirm({ ...body, TransID: stray, BusinessShortCode: '999999' });
        assert.strictEqual(await prisma.mpesaTransaction.count({ where: { transId: stray } }), 0, "another till's payment is not stored under this branch");
        const list = await call('GET', '/payments/incoming', cashierToken);
        assert.strictEqual(list.status, 200, JSON.stringify(list.body));
        const row = list.body.data.payments.find((p: any) => p.transId === txCode);
        assert.ok(list.body.data.enabled && row && row.amount === 450 && row.firstName === 'WANJIKU' && row.msisdn === '2547*****678', JSON.stringify(row));
        assert.strictEqual((await prisma.mpesaTransaction.findUnique({ where: { transId: txCode } })).msisdn, '2547*****678', 'stored masked');
      });
      await test('Tapping a till payment puts it on the bill and takes it off the list', async () => {
        const o = (await newOrder()).body.data;
        const paid = code();
        await confirm({ TransID: paid, TransTime: darajaNow(), TransAmount: o.totalAmount, BusinessShortCode: till, FirstName: 'OTIENO' });
        const res = await call('POST', `/payments/orders/${o.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: o.totalAmount, reference: paid });
        assert.strictEqual(res.status, 201, JSON.stringify(res.body));
        const t = await prisma.mpesaTransaction.findUnique({ where: { transId: paid } });
        assert.strictEqual(t.paymentId, res.body.data.payment.id);
        const list = await call('GET', '/payments/incoming', cashierToken);
        assert.ok(!list.body.data.payments.some((p: any) => p.transId === paid));
        assert.strictEqual((await call('POST', `/payments/orders/${(await newOrder()).body.data.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: 1, reference: paid })).status, 409, 'a till payment goes on one bill only');
      });
      await test('A till payment cannot pay more than was sent; more than the bill is noted', async () => {
        const small = code();
        await confirm({ TransID: small, TransTime: darajaNow(), TransAmount: 5, BusinessShortCode: till });
        const o = (await newOrder()).body.data;
        const over = await call('POST', `/payments/orders/${o.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: o.totalAmount, reference: small });
        assert.strictEqual(over.status, 400, JSON.stringify(over.body));
        const big = code();
        await confirm({ TransID: big, TransTime: darajaNow(), TransAmount: o.totalAmount + 100, BusinessShortCode: till });
        const res = await call('POST', `/payments/orders/${o.id}`, cashierToken, { method: 'MOBILE_MONEY', amount: o.totalAmount, reference: big });
        assert.strictEqual(res.status, 201, JSON.stringify(res.body));
        assert.ok(/more than this bill/.test(res.body.data.payment.notes || ''), res.body.data.payment.notes);
      });
      await test('A payment recorded "M-Pesa down" is confirmed when Safaricom reports its code', async () => {
        const o = (await newOrder()).body.data;
        const c = code();
        const p = (await call('POST', `/payments/orders/${o.id}`, cashierToken, { method: 'MOBILE_MONEY', checkLater: true, approval, amount: o.totalAmount, reference: c })).body.data.payment;
        await confirm({ TransID: c, TransTime: darajaNow(), TransAmount: o.totalAmount, BusinessShortCode: till });
        const after = await prisma.payment.findUnique({ where: { id: p.id } });
        assert.strictEqual(after.verifyStatus, 'CONFIRMED');
        assert.strictEqual((await prisma.mpesaTransaction.findUnique({ where: { transId: c } })).paymentId, p.id);
        // Already reported by Safaricom when recorded: confirmed straight away.
        const o2 = (await newOrder()).body.data;
        const c2 = code();
        await confirm({ TransID: c2, TransTime: darajaNow(), TransAmount: o2.totalAmount, BusinessShortCode: till });
        const p2 = (await call('POST', `/payments/orders/${o2.id}`, cashierToken, { method: 'MOBILE_MONEY', checkLater: true, approval, amount: o2.totalAmount, reference: c2 })).body.data.payment;
        assert.strictEqual(p2.verifyStatus, 'CONFIRMED');
      });
      await test('Test payments (test mode) and the daily check from the till feed', async () => {
        process.env.PAYMENT_SIMULATION = 'true';
        const sim = await call('POST', '/payments/till/simulate', ownerToken, { branchId, amount: 9.13 });
        delete process.env.PAYMENT_SIMULATION;
        assert.strictEqual(sim.status, 200, JSON.stringify(sim.body));
        assert.ok(await prisma.mpesaTransaction.findUnique({ where: { transId: sim.body.data.transId } }));
        process.env.MPESA_ENVIRONMENT = 'production';
        process.env.PAYMENT_SIMULATION = 'true';
        const live = await call('POST', '/payments/till/simulate', ownerToken, { branchId, amount: 10 });
        delete process.env.MPESA_ENVIRONMENT;
        delete process.env.PAYMENT_SIMULATION;
        assert.strictEqual(live.status, 403, 'never on a live till, even with test mode on');
        const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
        const dayCheck = (date: string) => fetch(`${base}/api/payments/mpesa-day-check`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json', 'x-branch-id': branchId }, body: JSON.stringify({ date }) }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
        const res = await dayCheck(day);
        assert.strictEqual(res.status, 200, JSON.stringify(res.body));
        assert.ok(res.body.data.rows.some((r: any) => r.receipt === txCode && r.result === 'NOT_IN_MELIO'), 'the unattached payment is on no bill');
        assert.ok(!res.body.data.rows.some((r: any) => r.receipt === sim.body.data.transId), 'test payments are left out');
        assert.strictEqual((await dayCheck('2020-01-01')).status, 400, 'no check for days before the till was connected');
        assert.strictEqual((await call('POST', '/payments/mpesa-day-check', cashierToken, { date: day })).status, 403);
      });
    } finally {
      await prisma.branch.update({ where: { id: branchId }, data: { mpesaShortcode: null, mpesaShortcodeType: null, mpesaRegisteredAt: null, mpesaCallbackToken: null } });
    }
  }

  console.log('\n--- K9: KRA eTIMS (simulated KRA) ---');
  {
    const before = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    process.env.ETIMS_SIMULATION = 'true';
    const paidBill = async () => {
      const o = (await newOrder()).body.data;
      const pay = await call('POST', `/payments/orders/${o.id}`, cashierToken, { method: 'CASH', amount: o.totalAmount });
      assert.strictEqual(pay.status, 201, JSON.stringify(pay.body));
      return { order: o, paymentId: pay.body.data.payment.id };
    };
    const receipt = async (orderId: string) => {
      const r = await call('GET', `/payments/orders/${orderId}/receipt`, cashierToken);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      return r.body.data;
    };
    try {
      // VAT added on top and a service charge: the lines must still add up (the simulated KRA checks).
      await prisma.restaurant.update({ where: { id: restaurantId }, data: { kraPin: null, vatRegistered: true, taxRate: 0.16, pricesIncludeTax: false, serviceChargeRate: 0.1 } });
      await test('A branch sets up its KRA device (needs the KRA PIN); the device key stays on the server', async () => {
        const body = { branchId, bhfId: '00', serialNumber: 'MELIO-TEST-01', itemClassCode: '9010150000' };
        assert.strictEqual((await call('POST', '/etims/devices', ownerToken, body)).status, 400, 'no KRA PIN yet');
        await prisma.restaurant.update({ where: { id: restaurantId }, data: { kraPin: 'P051234567X' } });
        assert.strictEqual((await call('POST', '/etims/devices', ownerToken, { ...body, bhfId: '0' })).status, 400);
        const ok = await call('POST', '/etims/devices', ownerToken, body);
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
        const status = await call('GET', '/etims', ownerToken);
        assert.strictEqual(status.status, 200, JSON.stringify(status.body));
        assert.ok(status.body.data.branches.some((b: any) => b.id === branchId && b.device?.bhfId === '00'));
        const key = (await prisma.etimsDevice.findUnique({ where: { branchId } }))!.cmcKey;
        assert.ok(!JSON.stringify(status.body).includes(key) && !JSON.stringify(status.body).includes('cmcKey'), 'device key never sent');
        assert.strictEqual((await call('GET', '/etims', cashierToken)).status, 403);
        assert.strictEqual((await call('POST', '/etims/devices', cashierToken, body)).status, 403);
      });
      let first = { order: null as any, paymentId: '' };
      await test('A paid bill is signed by KRA; the receipt carries its numbers and QR code', async () => {
        first = await paidBill();
        const data = await receipt(first.order.id);
        assert.strictEqual(data.etims?.status, 'SIGNED', JSON.stringify(data.etims));
        assert.ok(data.etims.invoiceNo >= 1 && data.etims.cuInvoiceNo && data.etims.rcptSign && data.etims.testOnly === true);
        assert.ok(String(data.etims.qrSvg).startsWith('<svg') && data.etims.qrUrl.includes(encodeURIComponent(`P051234567X00${data.etims.rcptSign}`)));
        assert.strictEqual(await prisma.etimsItem.count({ where: { branchId } }) >= 2, true, 'the dish and the service charge were registered');
      });
      await test('KRA down: the receipt waits, shows on the list, and keeps its number when sent again', async () => {
        process.env.ETIMS_SIMULATE_DOWN = 'true';
        const { order } = await paidBill();
        const data = await receipt(order.id);
        assert.strictEqual(data.etims?.status, 'PENDING');
        const list = (await call('GET', '/etims', ownerToken)).body.data.unsigned;
        const row = list.find((u: any) => u.sale.orderNumber === order.orderNumber);
        assert.ok(row && /could not be reached/.test(row.lastError) && row.attempts >= 1, JSON.stringify(row));
        delete process.env.ETIMS_SIMULATE_DOWN;
        const retry = await call('POST', '/etims/retry', ownerToken, {});
        assert.strictEqual(retry.status, 200, JSON.stringify(retry.body));
        const inv = await prisma.etimsInvoice.findUnique({ where: { key: `S:${order.id}` } });
        assert.strictEqual(inv?.status, 'SIGNED');
        assert.strictEqual(inv?.invoiceNo, row.invoiceNo ?? inv?.invoiceNo, 'the same KRA number is reused');
        const numbers = (await prisma.etimsInvoice.findMany({ where: { branchId, invoiceNo: { not: null } }, orderBy: { invoiceNo: 'asc' } })).map((i: any) => i.invoiceNo as number);
        assert.deepStrictEqual(numbers, numbers.map((_: number, i: number) => i + 1), 'KRA numbers run 1, 2, 3 with no gaps');
      });
      await test('A refund of a signed bill sends a KRA credit note', async () => {
        await require('../services/orderCompletionService').completeOrder(first.order.id, restaurantId, owner.id);
        const refund = await call('POST', `/payments/${first.paymentId}/refund`, ownerToken, { reason: 'test', approval });
        assert.strictEqual(refund.status, 200, JSON.stringify(refund.body));
        assert.ok(refund.body.data.creditNote);
        await call('POST', '/etims/retry', ownerToken, {});
        // The refund may already be sending it in the background: give that a moment.
        for (let i = 0; i < 30 && (await prisma.etimsInvoice.count({ where: { saleId: first.order.id, kind: 'CREDIT_NOTE', status: 'PENDING' } })); i++) await new Promise((r) => setTimeout(r, 300));
        const notes = await prisma.etimsInvoice.findMany({ where: { saleId: first.order.id, kind: 'CREDIT_NOTE' } });
        assert.strictEqual(notes.length, 1);
        assert.strictEqual(notes[0].status, 'SIGNED', `${notes[0].lastError} attempts=${notes[0].attempts} locked=${notes[0].lockedUntil}`);
      });
      await test('A refund before the bill is closed still sends KRA a credit note', async () => {
        const { order, paymentId } = await paidBill();
        assert.strictEqual((await receipt(order.id)).etims?.status, 'SIGNED');
        const refund = await call('POST', `/payments/${paymentId}/refund`, ownerToken, { reason: 'test', approval });
        assert.strictEqual(refund.status, 200, JSON.stringify(refund.body));
        assert.strictEqual(refund.body.data.creditNote, null, 'no Melio credit note before the bill is closed');
        await call('POST', '/etims/retry', ownerToken, {});
        for (let i = 0; i < 30 && (await prisma.etimsInvoice.count({ where: { key: `P:${paymentId}`, status: 'PENDING' } })); i++) await new Promise((r) => setTimeout(r, 300));
        const credit = await prisma.etimsInvoice.findUnique({ where: { key: `P:${paymentId}` } });
        assert.strictEqual(credit?.status, 'SIGNED', credit?.lastError || 'missing');
        // Paid again after the refund: KRA gets a new invoice for the bill, and the receipt shows it.
        const again = await call('POST', `/payments/orders/${order.id}`, cashierToken, { method: 'CASH', amount: order.totalAmount });
        assert.strictEqual(again.status, 201, JSON.stringify(again.body));
        const resale = await prisma.etimsInvoice.findFirst({ where: { saleId: order.id, kind: 'SALE' }, orderBy: { createdAt: 'desc' } });
        assert.ok(resale && resale.key !== `S:${order.id}` && resale.amount === order.totalAmount, JSON.stringify(resale));
        const printed = await receipt(order.id);
        assert.strictEqual(printed.etims?.status, 'SIGNED', JSON.stringify(printed.etims));
        assert.strictEqual(printed.etims.invoiceNo, (await prisma.etimsInvoice.findUnique({ where: { id: resale!.id } }))?.invoiceNo, 'the receipt shows the new KRA invoice');
      });
      await test('The scheduled job needs its secret, then sends what is waiting', async () => {
        assert.strictEqual((await call('GET', '/cron/sweep', 'no-secret-set-yet')).status, 401, 'off without CRON_SECRET');
        process.env.CRON_SECRET = 'it-cron-secret-0123456789';
        try {
          assert.strictEqual((await call('GET', '/cron/sweep', 'wrong-secret-wrong-secret')).status, 401);
          process.env.ETIMS_SIMULATE_DOWN = 'true';
          const { order } = await paidBill();
          // Let the send started by the payment fail first (KRA down), so the job has something to do.
          const failedOnce = () => prisma.etimsInvoice.count({ where: { key: `S:${order.id}`, attempts: { gte: 1 }, lockedUntil: null } });
          for (let i = 0; i < 30 && !(await failedOnce()); i++) await new Promise((r) => setTimeout(r, 200));
          delete process.env.ETIMS_SIMULATE_DOWN;
          await prisma.etimsInvoice.updateMany({ where: { saleId: order.id }, data: { nextTryAt: new Date(), lockedUntil: null } });
          // Website enquiries (customer contact details) are kept 90 days.
          const oldEnquiry = await prisma.notification.create({ data: { restaurantId, userId: owner.id, type: 'WEBSITE_ENQUIRY', title: 'old', message: 'old', createdAt: new Date(Date.now() - 91 * 86_400_000) } });
          const newEnquiry = await prisma.notification.create({ data: { restaurantId, userId: owner.id, type: 'WEBSITE_ENQUIRY', title: 'new', message: 'new' } });
          const run = await call('GET', '/cron/sweep', 'it-cron-secret-0123456789');
          assert.strictEqual(run.status, 200, JSON.stringify(run.body));
          assert.strictEqual((await prisma.etimsInvoice.findUnique({ where: { key: `S:${order.id}` } }))?.status, 'SIGNED');
          assert.strictEqual(await prisma.notification.count({ where: { id: oldEnquiry.id } }), 0, 'enquiry older than 90 days deleted');
          assert.strictEqual(await prisma.notification.count({ where: { id: newEnquiry.id } }), 1, 'recent enquiry kept');
        } finally {
          delete process.env.CRON_SECRET;
        }
      });
      await test('KRA lines match the bill: promotions per VAT category, partial refunds, VAT added on top', async () => {
        const { etimsLines } = require('../services/etimsService');
        const sum = (ls: any[], k: string) => Math.round(ls.reduce((t, l) => t + l[k], 0) * 100) / 100;
        const items = [{ menuItemId: 'std', itemNameSnapshot: 'Steak', unitPrice: 1000, quantity: 1, modifiers: [] }, { menuItemId: 'zero', itemNameSnapshot: 'Milk', unitPrice: 500, quantity: 1, modifiers: [] }];
        const cats = (id: string) => (id === 'zero' ? 'ZERO_RATED' : 'STANDARD');
        // 250 off the zero-rated item only (prices include VAT): VAT stays 137.93.
        const promo = { subtotal: 1500, discountAmount: 250, serviceChargeAmount: 0, taxInclusive: true, taxAmount: 137.93, taxableAmount: 862.07, zeroRatedAmount: 250, exemptAmount: 0, totalAmount: 1250, items };
        const lines = etimsLines(promo, cats, true, 1250);
        assert.strictEqual(sum(lines, 'totAmt'), 1250);
        assert.strictEqual(sum(lines, 'taxAmt'), 137.93, JSON.stringify(lines));
        // A third of a 1500 bill refunded: the credit note is exactly 500.
        const one = { ...promo, discountAmount: 0, taxAmount: 206.9, taxableAmount: 1293.1, zeroRatedAmount: 0, totalAmount: 1500, items: [{ ...items[0], unitPrice: 1500 }] };
        assert.strictEqual(sum(etimsLines(one, cats, true, 500, 500 / 1500), 'totAmt'), 500);
        // VAT added on top plus a 10% service charge: lines add up to what was paid.
        const excl = { subtotal: 1000, discountAmount: 0, serviceChargeAmount: 100, taxInclusive: false, taxAmount: 160, taxableAmount: 1000, zeroRatedAmount: 0, exemptAmount: 0, totalAmount: 1260, items: [items[0]] };
        const exclLines = etimsLines(excl, cats, true, 1260);
        assert.strictEqual(sum(exclLines, 'totAmt'), 1260);
        assert.strictEqual(sum(exclLines, 'taxAmt'), 160);
        // A bill that doesn't match its lines is not sent.
        assert.throws(() => etimsLines({ ...excl, totalAmount: 2000 }, cats, true, 2000), /not sent/);
      });
      await test('Connecting to another KRA branch number keeps each number sequence apart', async () => {
        const before00 = (await prisma.etimsDevice.findUnique({ where: { branchId } }))!.lastInvoiceNo;
        const base = { branchId, serialNumber: 'MELIO-TEST-01', itemClassCode: '9010150000' };
        assert.strictEqual((await call('POST', '/etims/devices', ownerToken, { ...base, bhfId: '01' })).status, 200);
        assert.strictEqual((await prisma.etimsDevice.findUnique({ where: { branchId } }))!.lastInvoiceNo, 0, 'KRA branch 01 starts at 1');
        assert.strictEqual((await call('POST', '/etims/devices', ownerToken, { ...base, bhfId: '00' })).status, 200);
        assert.strictEqual((await prisma.etimsDevice.findUnique({ where: { branchId } }))!.lastInvoiceNo, before00, 'back on 00, numbers carry on');
      });
      await test('An invoice KRA refuses stays on the list until someone fixes it and sends it again', async () => {
        await prisma.restaurant.update({ where: { id: restaurantId }, data: { kraPin: null } });
        const { order } = await paidBill();
        await call('POST', '/etims/retry', ownerToken, {});
        for (let i = 0; i < 30 && (await prisma.etimsInvoice.count({ where: { key: `S:${order.id}`, status: 'PENDING' } })); i++) await new Promise((r) => setTimeout(r, 200));
        const inv = await prisma.etimsInvoice.findUnique({ where: { key: `S:${order.id}` } });
        assert.strictEqual(inv?.status, 'REJECTED', `${inv?.lastError} locked=${inv?.lockedUntil}`);
        await prisma.restaurant.update({ where: { id: restaurantId }, data: { kraPin: 'P051234567X' } });
        assert.strictEqual((await call('POST', '/etims/retry', cashierToken, { id: inv!.id })).status, 403);
        const again = await call('POST', '/etims/retry', ownerToken, { id: inv!.id });
        assert.strictEqual(again.status, 200, JSON.stringify(again.body));
        assert.strictEqual((await prisma.etimsInvoice.findUnique({ where: { id: inv!.id } }))?.status, 'SIGNED');
      });
    } finally {
      delete process.env.ETIMS_SIMULATION;
      delete process.env.ETIMS_SIMULATE_DOWN;
      await prisma.etimsInvoice.deleteMany({ where: { branchId } });
      await prisma.etimsItem.deleteMany({ where: { branchId } });
      await prisma.etimsDevice.deleteMany({ where: { branchId } });
      await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { kraPin: before!.kraPin, vatRegistered: before!.vatRegistered, taxRate: before!.taxRate, pricesIncludeTax: before!.pricesIncludeTax, serviceChargeRate: before!.serviceChargeRate },
      });
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
