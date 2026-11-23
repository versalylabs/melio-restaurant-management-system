/**
 * Returns a message that is safe to show to API clients.
 *
 * Handlers often `throw new Error('Friendly message')` on purpose, and those
 * messages are meant for users. Anything else (Prisma/database errors,
 * TypeErrors, library errors) can reveal table names, queries or internals,
 * so it is replaced by the fallback and logged server-side instead.
 */
export function safeErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const deliberate = err.constructor === Error || err.name === 'PaymentError' || err.name === 'AppError';
  const looksInternal =
    err.name.startsWith('Prisma') ||
    /prisma|invalid `|\bat \w+ \(|ECONN|ENOTFOUND|timeout|syntax error|column|relation "/i.test(err.message) ||
    err.message.length > 200 ||
    err.message.includes('\n');
  if (deliberate && !looksInternal && err.message.trim()) return err.message;
  console.error(`[error] ${fallback}:`, err);
  return fallback;
}
