const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Usage: node setup-neon.js [connection-string]
const connectionString = process.argv[2] || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString || !connectionString.startsWith('postgres')) {
  console.log(`
========================================================================
Melio RMS — Neon Database Setup Utility
========================================================================

Please provide your Neon PostgreSQL connection string:
  node server/scripts/setup-neon.js "postgresql://neondb_owner:***@ep-***-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"

Steps to get a free Neon database in 60 seconds:
  1. Go to https://neon.tech and sign up or log in.
  2. Create a new project (e.g. "melio-rms").
  3. Under Connection Details, select "Prisma" or "Connection string" (with pooled connection enabled).
  4. Copy the connection string and pass it to this command.
========================================================================
`);
  process.exit(1);
}

// 1. Ensure schema.prisma has provider = "postgresql"
const schemaPaths = [
  path.resolve(__dirname, '../prisma/schema.prisma'),
  path.resolve(__dirname, '../../prisma/schema.prisma'),
];

schemaPaths.forEach((schemaPath) => {
  if (fs.existsSync(schemaPath)) {
    let content = fs.readFileSync(schemaPath, 'utf8');
    content = content.replace(
      /datasource\s+db\s*\{[\s\S]*?\}/,
      `datasource db {\n  provider  = "postgresql"\n  url       = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")\n}`
    );
    fs.writeFileSync(schemaPath, content, 'utf8');
    console.log(`[Neon Setup] Configured ${schemaPath} for PostgreSQL provider`);
  }
});

// 2. Compute Direct URL (unpooled) if pooled URL was passed
let directUrl = connectionString;
if (connectionString.includes('-pooler.')) {
  directUrl = connectionString.replace('-pooler.', '.');
}

// 3. Update local .env and server/.env
const envPaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
];

envPaths.forEach((envPath) => {
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, 'utf8');
    if (/^DATABASE_URL=/m.test(envContent)) {
      envContent = envContent.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${connectionString}"`);
    } else {
      envContent += `\nDATABASE_URL="${connectionString}"\n`;
    }

    if (/^DIRECT_URL=/m.test(envContent)) {
      envContent = envContent.replace(/^DIRECT_URL=.*$/m, `DIRECT_URL="${directUrl}"`);
    } else {
      envContent += `\nDIRECT_URL="${directUrl}"\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log(`[Neon Setup] Updated DATABASE_URL in ${envPath}`);
  }
});

// 4. Regenerate Prisma Client
console.log('\n[Neon Setup] Generating Prisma Client for PostgreSQL...');
execSync('npx prisma generate', {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: connectionString, DIRECT_URL: directUrl },
});

// 5. Push Schema to Neon
console.log('\n[Neon Setup] Pushing database schema to Neon PostgreSQL...');
execSync('npx prisma db push --skip-generate', {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: connectionString, DIRECT_URL: directUrl },
});

// 6. Seed Neon Database
console.log('\n[Neon Setup] Seeding initial data (restaurants, branches, categories, food items, staff accounts)...');
execSync('npx ts-node --transpile-only prisma/seed.ts', {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: connectionString, DIRECT_URL: directUrl },
});

// 7. Ensure demo users exist with melio@2026 password
console.log('\n[Neon Setup] Ensuring pitch staff credentials (owner, manager, cashier, waiter, chef, delivery)...');
try {
  execSync('node scripts/ensure-users.js', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: connectionString, DIRECT_URL: directUrl },
  });
} catch (e) {
  console.warn('[Neon Setup] Note: ensure-users completed with notice:', e.message);
}

// 8. Update Vercel environment variable if logged in
console.log('\n[Neon Setup] Syncing DATABASE_URL with Vercel project...');
try {
  // Check if vercel cli is available
  execSync(`vercel env add DATABASE_URL production --project melio-restaurant-management-system-server --force`, {
    input: connectionString,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  console.log('[Neon Setup] Successfully updated DATABASE_URL on Vercel!');
} catch (err) {
  console.log('[Neon Setup] Note: To update Vercel manually, paste this connection string under your Vercel Project Settings > Environment Variables.');
}

console.log('\n========================================================================');
console.log('>>> NEON DATABASE SETUP COMPLETED SUCCESSFULLY! <<<');
console.log('========================================================================\n');
