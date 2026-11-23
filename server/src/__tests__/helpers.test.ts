/*
 * Database-free tests for time-zone, unit-conversion and idempotency helpers.
 * Run with: npm test (from server/)
 */
import assert from 'assert';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@127.0.0.1:1/none';

/* eslint-disable @typescript-eslint/no-var-requires */
const tz = require('../utils/timezone');
const { convertQuantity } = require('../utils/units');
const { normalizeClientRequestId, isUniqueViolationOn } = require('../utils/idempotency');
/* eslint-enable @typescript-eslint/no-var-requires */

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err: any) { console.error(`  ❌ FAIL: ${name}\n     ${err.message}`); failed++; }
}

console.log('\n--- Restaurant time zones ---');
test('Nairobi wall-clock time converts to UTC', () => {
  assert.strictEqual(tz.zonedDateTimeToUtc('2026-11-23', '19:00', 'Africa/Nairobi').toISOString(), '2026-11-23T16:00:00.000Z');
});
test('DST zones convert correctly', () => {
  assert.strictEqual(tz.zonedDateTimeToUtc('2026-07-01', '12:00', 'America/New_York').toISOString(), '2026-07-01T16:00:00.000Z');
  assert.strictEqual(tz.zonedDateTimeToUtc('2026-01-15', '12:00', 'America/New_York').toISOString(), '2026-01-15T17:00:00.000Z');
});
test('impossible dates and bad input are rejected', () => {
  assert.strictEqual(tz.zonedDateTimeToUtc('2026-02-31', '10:00', 'Africa/Nairobi'), null);
  assert.strictEqual(tz.zonedDateTimeToUtc('2026-11-23', '25:00', 'Africa/Nairobi'), null);
  assert.strictEqual(tz.zonedDateTimeToUtc('23/11/2026', '10:00', 'Africa/Nairobi'), null);
});
test('a local day maps to the right UTC range', () => {
  const r = tz.localDayRange('2026-11-23', 'Africa/Nairobi');
  assert.strictEqual(r.start.toISOString(), '2026-11-22T21:00:00.000Z');
  assert.strictEqual(r.end.toISOString(), '2026-11-23T20:59:59.999Z');
});
test('late evening UTC is already tomorrow in Nairobi', () => {
  const at = new Date('2026-11-23T22:30:00Z');
  assert.strictEqual(tz.localDateString('Africa/Nairobi', at), '2026-11-24');
  assert.strictEqual(tz.localMinutesOfDay('Africa/Nairobi', at), 90);
});
test('unknown time zones fall back to Africa/Nairobi', () => {
  assert.strictEqual(tz.zonedDateTimeToUtc('2026-11-23', '19:00', 'Not/AZone').toISOString(), '2026-11-23T16:00:00.000Z');
});

console.log('\n--- Unit conversion ---');
test('grams to kilograms and back', () => {
  assert.strictEqual(convertQuantity(250, 'g', 'kg'), 0.25);
  assert.strictEqual(convertQuantity(1.5, 'KG', 'grams'), 1500);
});
test('millilitres to litres', () => {
  assert.strictEqual(convertQuantity(330, 'ml', 'L'), 0.33);
});
test('same or aliased units are unchanged', () => {
  assert.strictEqual(convertQuantity(3, 'pcs', 'pieces'), 3);
  assert.strictEqual(convertQuantity(3, 'bunch', 'Bunch'), 3);
});
test('incompatible or unknown units are refused', () => {
  assert.strictEqual(convertQuantity(1, 'kg', 'l'), null);
  assert.strictEqual(convertQuantity(1, 'cup', 'g'), null);
});

console.log('\n--- Idempotency keys ---');
test('valid keys are accepted, junk is ignored', () => {
  assert.strictEqual(normalizeClientRequestId('3f2b1c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f'), '3f2b1c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f');
  assert.strictEqual(normalizeClientRequestId('melio_off_1700000000_abc123'), 'melio_off_1700000000_abc123');
  assert.strictEqual(normalizeClientRequestId('short'), null);
  assert.strictEqual(normalizeClientRequestId("x'; drop table orders; --"), null);
  assert.strictEqual(normalizeClientRequestId(42), null);
});
test('unique violations are recognised by field', () => {
  assert.strictEqual(isUniqueViolationOn({ code: 'P2002', meta: { target: ['restaurantId', 'clientRequestId'] } }, 'clientRequestId'), true);
  assert.strictEqual(isUniqueViolationOn({ code: 'P2002', meta: { target: ['branchId', 'orderNumber'] } }, 'clientRequestId'), false);
  assert.strictEqual(isUniqueViolationOn({ code: 'P2025' }, 'clientRequestId'), false);
});

console.log(`\n========================================\nHelper Results: ${passed} Passed, ${failed} Failed\n========================================`);
process.exit(failed > 0 ? 1 : 0);
