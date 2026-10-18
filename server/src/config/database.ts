import { PrismaClient } from '@prisma/client';

import path from 'path';
import fs from 'fs';

/**
 * Normalizes connection string for Supabase / Serverless PgBouncer pooler or SQLite local path.
 * - For SQLite: resolves relative file path to an absolute path so it works regardless of process.cwd().
 * - For Postgres: switches port 5432 to 6543 when using Supabase poolers and configures pgbouncer.
 */
function getOptimizedDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  // Handle SQLite file URLs
  if (url.startsWith('file:')) {
    const rawPath = url.replace(/^file:/, '');
    if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) {
      return `file:${rawPath.replace(/\\/g, '/')}`;
    }

    const candidates = [
      path.resolve(__dirname, '../../prisma/dev.db'),
      path.resolve(__dirname, '../prisma/dev.db'),
      path.resolve(process.cwd(), 'server/prisma/dev.db'),
      path.resolve(process.cwd(), 'prisma/dev.db'),
      path.resolve(process.cwd(), 'server/dev.db'),
      path.resolve(process.cwd(), 'dev.db'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return `file:${candidate.replace(/\\/g, '/')}`;
      }
    }

    const defaultFallback = path.resolve(__dirname, '../../prisma/dev.db');
    return `file:${defaultFallback.replace(/\\/g, '/')}`;
  }

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
