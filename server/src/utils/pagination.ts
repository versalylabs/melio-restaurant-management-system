/**
 * Reads a `?limit=` query value, defaulting and capping it so no list
 * endpoint can return an unbounded result set.
 */
export function boundedLimit(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
