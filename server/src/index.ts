import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routes from './routes';
import prisma from './config/database';
import path from 'path';
import fs from 'fs';
import { securityHeaders, sanitizeInputs, getCorsOptionsDelegate } from './middleware/security';
import { globalRateLimiter } from './middleware/rateLimiter';

const app = express();
const PORT = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  if (isProduction) throw new Error('JWT_SECRET must be configured with at least 16 characters in production.');
  console.warn('WARNING: JWT_SECRET is missing or too short for production.');
}

app.disable('x-powered-by');

// 1. Enterprise Security Headers (HSTS, CSP, X-Frame-Options, nosniff, X-Request-ID)
app.use(securityHeaders);

// 2. Global Request Burst Rate Limiter
app.use(globalRateLimiter);

// 3. Multi-Origin Dynamic CORS
app.use(cors(getCorsOptionsDelegate({
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // X-Refresh / X-Cache-Bypass: legacy client cache flags; accepted so older open tabs still work.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Branch-ID', 'X-Restaurant-ID', 'X-Refresh', 'X-Cache-Bypass'],
})));

// 4. Request Body Parsing & Payload Sanitization
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Never leave the browser waiting forever when an async route or database call fails.
// Express 4 does not automatically forward rejected async handler promises. This
// response timeout provides a final safety net while individual services report
// their own useful errors.
app.use((req, res, next) => {
  res.setTimeout(20000, () => {
    if (!res.headersSent) {
      console.error(`Request timed out: ${req.method} ${req.originalUrl}`);
      res.status(504).json({ success: false, message: 'The server took too long to complete this request. Please try again.' });
    }
  });
  next();
});

app.use(sanitizeInputs);

// 5. Enhanced Health Check Endpoint
app.get(['/health', '/api/health'], async (_req, res) => {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    res.json({
      success: true,
      status: 'healthy',
      database: 'connected',
      latencyMs,
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      database: 'unavailable',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.use('/api', routes);

// Serve the built React website so the entire platform runs as a unified service
const clientDistCandidates = [
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(__dirname, '../client/dist'),
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
];

let clientDistPath: string | null = null;
for (const cand of clientDistCandidates) {
  if (fs.existsSync(cand) && fs.existsSync(path.join(cand, 'index.html'))) {
    clientDistPath = cand;
    break;
  }
}

if (clientDistPath) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDistPath!, 'index.html'));
  });
}

if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(async () => { await prisma.$disconnect(); process.exit(1); }, 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => console.error('Unhandled promise rejection:', reason));
  process.on('uncaughtException', (error) => { console.error('Uncaught exception:', error); shutdown('uncaughtException'); });
}

export default app;
