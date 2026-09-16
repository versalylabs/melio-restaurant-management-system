const fs = require('fs');
const path = require('path');

// Prisma resolves file:./dev.db relative to server/prisma/schema.prisma.
// Remove the local SQLite file explicitly so stale schemas cannot survive a reset.
const dbFiles = [
  path.resolve(__dirname, '../prisma/dev.db'),
  path.resolve(__dirname, '../dev.db'),
];

for (const file of dbFiles) {
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
    console.log(`[DB Reset] Removed ${file}`);
  }
}
console.log('[DB Reset] Local SQLite files cleared. Prisma will recreate a clean database.');
