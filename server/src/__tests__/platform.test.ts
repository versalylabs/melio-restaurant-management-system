/*
 * Platform tests that run without a database: CORS, auth tickets, route
 * permissions, payment guards, inline media rewriting and rate limiting.
 * Run with: npm test (from server/)
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

// Environment must be set before the modules under test are loaded.
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef';
process.env.ALLOWED_ORIGINS = 'https://shop.example.com,*';
process.env.FRONTEND_URL = ''; // dotenv never overrides keys that already exist, so a local .env can't leak in
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@127.0.0.1:1/none';
process.env.MPESA_CALLBACK_SECRET = 'cb-secret-0123456789abcdef';
delete process.env.PAYMENT_SIMULATION;
delete process.env.MPESA_CONSUMER_KEY;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.VERCEL;

/* eslint-disable @typescript-eslint/no-var-requires */
const jwt = require('jsonwebtoken');
const { getCorsOptionsDelegate } = require('../middleware/security');
const { generateToken, generateStreamTicket } = require('../utils/response');
const { permissionForPath } = require('../middleware/auth');
const { PERMISSION_KEYS } = require('../middleware/permissions');
const { rewriteInlineImages, stripEchoedMediaUrls } = require('../middleware/inlineMedia');
const { createRateLimiter } = require('../middleware/rateLimiter');
const mpesa = require('../services/mpesaService');
const { processCardPayment } = require('../services/cardPaymentService');
/* eslint-enable @typescript-eslint/no-var-requires */

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}\n     ${err.message}`);
    failed++;
  }
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err: any) {
    assert.strictEqual(err.code, code);
    return;
  }
  assert.fail(`expected rejection with ${code}`);
}

const corsDelegate = getCorsOptionsDelegate({ credentials: true });
const corsOrigin = (origin: string | undefined, host = 'api.example.com') =>
  new Promise<unknown>((resolve) =>
    corsDelegate({ headers: { ...(origin ? { origin } : {}), host } }, (_e: unknown, o: any) => resolve(o.origin)));

async function run() {
  console.log('🧪 Platform test suite\n\n--- CORS ---');
  await test('rejects arbitrary *.vercel.app origins', async () => assert.strictEqual(await corsOrigin('https://attacker.vercel.app'), false));
  await test('ignores "*" in ALLOWED_ORIGINS', async () => assert.strictEqual(await corsOrigin('https://evil.com'), false));
  await test('allows configured origins', async () => assert.strictEqual(await corsOrigin('https://shop.example.com'), 'https://shop.example.com'));
  await test('allows the known Melio frontend', async () =>
    assert.notStrictEqual(await corsOrigin('https://melio-restaurant-management-system-nine.vercel.app'), false));
  await test('allows same-origin requests', async () => assert.notStrictEqual(await corsOrigin('https://app.example.ke', 'app.example.ke'), false));
  await test('rejects localhost in production', async () => assert.strictEqual(await corsOrigin('http://localhost:5173'), false));

  console.log('\n--- Auth tokens ---');
  await test('stream ticket is purpose-bound and expires in 60s', () => {
    const t = jwt.decode(generateStreamTicket('u1', 'r1', 0));
    assert.strictEqual(t.purpose, 'sse');
    assert.strictEqual(t.exp - t.iat, 60);
  });
  await test('login token has no purpose claim', () => assert.strictEqual(jwt.decode(generateToken('u1', 'r1', 0)).purpose, undefined));

  console.log('\n--- Route permissions ---');
  await test('paths with the /api mount prefix are mapped', () => {
    assert.strictEqual(permissionForPath('/api/orders', 'GET'), 'orders.view');
    assert.strictEqual(permissionForPath('/api/orders/abc/cancel', 'POST'), 'orders.manage');
    assert.strictEqual(permissionForPath('/api/inventory/purchase-orders', 'POST'), 'purchases.manage');
    assert.strictEqual(permissionForPath('/api/customers/c1/loyalty/adjust', 'POST'), 'loyalty.manage');
    assert.strictEqual(permissionForPath('/api/orders/pos/menu', 'GET'), 'pos.use');
  });
  await test('prefixes do not match longer names (/users vs /users-export)', () => assert.strictEqual(permissionForPath('/api/users-export', 'GET'), null));
  await test('every mapped permission is a real permission key', () => {
    const samples = ['/users', '/roles', '/audit-logs', '/reports', '/analytics', '/promotions', '/payments', '/shifts', '/expenses',
      '/inventory', '/inventory/purchase-orders', '/menu-items', '/categories', '/modifier-groups', '/customers', '/customers/x/loyalty',
      '/orders', '/orders/pos', '/kitchen', '/reservations', '/tables', '/sections', '/table-combinations', '/branches',
      '/restaurant', '/website', '/automated-messaging', '/dashboard'];
    for (const p of samples) for (const m of ['GET', 'POST']) {
      const perm = permissionForPath(`/api${p}`, m);
      assert.ok(perm && PERMISSION_KEYS.includes(perm), `${m} ${p} -> ${perm}`);
    }
  });
  await test('every mounted router that uses authorize() has a permission mapping', () => {
    const routesDir = path.resolve(__dirname, '../routes');
    const index = fs.readFileSync(path.join(routesDir, 'index.ts'), 'utf8');
    const imports = new Map<string, string>();
    for (const m of index.matchAll(/import (\w+) from '\.\/(\w+)'/g)) imports.set(m[1], m[2]);
    const missing: string[] = [];
    for (const m of index.matchAll(/router\.use\('([^']+)',\s*(\w+)\)/g)) {
      const file = imports.get(m[2]);
      if (!file) continue;
      const source = fs.readFileSync(path.join(routesDir, `${file}.ts`), 'utf8');
      if (!/authorize\(/.test(source) || m[1] === '/public/payments') continue;
      if (!permissionForPath(`/api${m[1]}`, 'GET')) missing.push(m[1]);
    }
    assert.deepStrictEqual(missing, [], `Add these prefixes to permissionForPath(): ${missing.join(', ')}`);
  });

  console.log('\n--- Payment guards (no simulation, M-Pesa not configured) ---');
  await test('callback with wrong secret is rejected', () => rejectsWith(mpesa.handleMpesaCallback({}, 'wrong'), 'UNAUTHORIZED'));
  await test('callback with no secret is rejected', () => rejectsWith(mpesa.handleMpesaCallback({}, undefined), 'UNAUTHORIZED'));
  await test('callback with correct secret passes auth', async () =>
    assert.strictEqual((await mpesa.handleMpesaCallback({}, process.env.MPESA_CALLBACK_SECRET)).handled, false));
  await test('simulated M-Pesa confirm is forbidden', () => rejectsWith(mpesa.confirmSimulatedMpesaPayment('SIM_x'), 'FORBIDDEN'));
  await test('STK push refuses when Daraja is not configured', () =>
    rejectsWith(mpesa.initiateMpesaStkPush({ trackingToken: 't', phoneNumber: '0712345678' }), 'MPESA_NOT_CONFIGURED'));
  await test('card payments are unavailable', () => rejectsWith(processCardPayment({ trackingToken: 't' }), 'CARD_PAYMENTS_UNAVAILABLE'));

  console.log('\n--- Inline media ---');
  const dataUri = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;
  await test('inline images become versioned media URLs', () => {
    const out: any = rewriteInlineImages({ data: { items: [{ id: 'abc', image: dataUri, name: 'X' }], restaurant: { id: 'r1', logo: dataUri } } }, 'https://api.example.com');
    assert.match(out.data.items[0].image, /^https:\/\/api\.example\.com\/api\/public\/media\/abc\?f=image&v=[0-9a-f]{12}$/);
    assert.match(out.data.restaurant.logo, /\/api\/public\/media\/r1\?f=logo&v=/);
    assert.strictEqual(out.data.items[0].name, 'X');
  });
  await test('regular image URLs, dates and objects without id are untouched', () => {
    const when = new Date();
    const out: any = rewriteInlineImages({ id: 'a', image: '/images/food/x.jpg', createdAt: when, nested: { image: dataUri } }, 'https://x');
    assert.strictEqual(out.image, '/images/food/x.jpg');
    assert.strictEqual(out.createdAt, when);
    assert.strictEqual(out.nested.image, dataUri);
  });
  await test('echoed media URLs are dropped from incoming forms', () => {
    const out: any = stripEchoedMediaUrls({ name: 'Burger', image: 'https://api.example.com/api/public/media/abc?f=image&v=1', logo: null });
    assert.ok(!('image' in out));
    assert.strictEqual(out.name, 'Burger');
    assert.strictEqual(out.logo, null);
  });

  console.log('\n--- Rate limiting (memory store) ---');
  await test('blocks after the limit and sets Retry-After', async () => {
    const limiter = createRateLimiter({ name: `test-${Date.now()}`, windowMs: 60_000, maxRequests: 2, keyGenerator: () => 'k' });
    const outcomes: Array<number | 'next'> = [];
    for (let i = 0; i < 3; i++) {
      const headers: Record<string, unknown> = {};
      const res: any = {
        setHeader: (k: string, v: unknown) => { headers[k] = v; },
        status: (code: number) => ({ json: () => outcomes.push(code) }),
      };
      await limiter({} as any, res, () => outcomes.push('next'));
      if (i === 2) assert.ok(headers['Retry-After']);
    }
    assert.deepStrictEqual(outcomes, ['next', 'next', 429]);
  });
  await test('keyGenerator returning null skips limiting', async () => {
    const limiter = createRateLimiter({ name: 'skip', windowMs: 60_000, maxRequests: 0, keyGenerator: () => null });
    let called = false;
    await limiter({} as any, {} as any, () => { called = true; });
    assert.ok(called);
  });

  console.log(`\n========================================\nPlatform Results: ${passed} Passed, ${failed} Failed\n========================================`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
