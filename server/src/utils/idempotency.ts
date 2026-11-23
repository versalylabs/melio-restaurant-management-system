/**
 * Order idempotency keys.
 *
 * Clients (POS, offline sync, online checkout) send a `clientRequestId`
 * generated once per checkout attempt and reused on every retry. The server
 * stores it on the order (unique per restaurant), so a retry after a timeout,
 * or an offline re-sync, returns the existing order instead of creating a
 * second one (and a second kitchen ticket).
 */
export function normalizeClientRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(v) ? v : null;
}

/** True for a Prisma unique-constraint violation that involves `field`. */
export function isUniqueViolationOn(err: any, field: string): boolean {
  if (err?.code !== 'P2002') return false;
  const target = err?.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target || '').includes(field);
}
