const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../prisma/dev.db');
if (!fs.existsSync(dbPath)) {
  console.error(`[DB Verify] Database not found at ${dbPath}`);
  process.exit(1);
}

try {
  const result = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', 'db', 'execute', '--schema=prisma/schema.prisma', '--stdin'], {
    cwd: path.resolve(__dirname, '..'),
    input: 'SELECT 1;',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  console.log('[DB Verify] SQLite database is accessible.');
  if (result.trim()) console.log(result.trim());
} catch (error) {
  console.error('[DB Verify] Database check failed.');
  process.exit(error.status || 1);
}
