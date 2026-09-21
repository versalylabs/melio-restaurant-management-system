import { PrismaClient } from '@prisma/client';

/**
 * Normalizes connection string for Supabase / Serverless PgBouncer pooler.
 * - Switches port 5432 (session mode) to 6543 (transaction mode) when using Supabase poolers.
 * - Appends pgbouncer=true and connection_limit=1 to prevent EMAXCONNSESSION pool exhaustion in serverless lambdas.
 */
function getOptimizedDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    // If using Supabase pooler on session port 5432, switch to transaction pooler port 6543
    if (parsed.hostname.includes('pooler.supabase.com')) {
      if (parsed.port === '5432') {
        parsed.port = '6543';
      }
      if (!parsed.searchParams.has('pgbouncer')) {
        parsed.searchParams.set('pgbouncer', 'true');
      }
      if (!parsed.searchParams.has('connection_limit')) {
        parsed.searchParams.set('connection_limit', '1');
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const optimizedUrl = getOptimizedDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    ...(optimizedUrl
      ? {
          datasources: {
            db: {
              url: optimizedUrl,
            },
          },
        }
      : {}),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production' || typeof globalThis !== 'undefined') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
