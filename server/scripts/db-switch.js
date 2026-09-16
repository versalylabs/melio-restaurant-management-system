const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const target = process.argv[2]?.toLowerCase();

if (target !== 'postgres' && target !== 'postgresql' && target !== 'sqlite') {
  console.log(`
Usage: node db-switch.js <postgres|sqlite>

Examples:
  node db-switch.js postgres    # Switch Prisma to PostgreSQL provider
  node db-switch.js sqlite      # Switch Prisma to SQLite provider
`);
  process.exit(1);
}

const provider = (target === 'postgres' || target === 'postgresql') ? 'postgresql' : 'sqlite';

const schemaPaths = [
  path.resolve(__dirname, '../prisma/schema.prisma'),
  path.resolve(__dirname, '../../prisma/schema.prisma'),
];

schemaPaths.forEach((schemaPath) => {
  if (fs.existsSync(schemaPath)) {
    let content = fs.readFileSync(schemaPath, 'utf8');
    content = content.replace(
      /datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"[^"]+"[\s\S]*?\}/,
      `datasource db {\n  provider = "${provider}"\n  url      = env("DATABASE_URL")\n}`
    );
    fs.writeFileSync(schemaPath, content, 'utf8');
    console.log(`[DB Switch] Updated ${schemaPath} to provider: "${provider}"`);
  }
});

console.log(`[DB Switch] Regenerating Prisma Client for ${provider}...`);
try {
  execSync('npx prisma generate', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
  });
  console.log(`[DB Switch] Successfully switched database provider to "${provider}".`);
} catch (err) {
  console.error('[DB Switch] Failed to regenerate Prisma client:', err.message);
}
