import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = path.join(root, 'database', 'localhub.db');
const backupRoot = path.join(root, 'backups');
const configPath = path.join(root, 'config', 'localhub.config.json');

let storageSetting = 'storage';
try {
  storageSetting = JSON.parse(fs.readFileSync(configPath, 'utf8')).storageDir || 'storage';
} catch {
  /* default */
}
const storageDir = path.isAbsolute(storageSetting) ? storageSetting : path.resolve(root, storageSetting);

const includeFiles = !process.argv.includes('--db-only');
const noteIdx = process.argv.indexOf('--note');
const note = noteIdx !== -1 ? process.argv[noteIdx + 1] || '' : 'Created via backup script';

if (!fs.existsSync(dbFile)) {
  console.error('Database not found at:', dbFile);
  process.exit(1);
}

async function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function copyDir(src, dest, skip = new Set()) {
  await fsp.mkdir(dest, { recursive: true });
  let entries = [];
  try {
    entries = await fsp.readdir(src, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0 };
  }
  let bytes = 0;
  let files = 0;
  for (const e of entries) {
    if (e.isDirectory() && skip.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      const sub = await copyDir(s, d, skip);
      bytes += sub.bytes;
      files += sub.files;
    } else if (e.isFile()) {
      await fsp.copyFile(s, d);
      bytes += (await fsp.stat(d)).size;
      files++;
    }
  }
  return { bytes, files };
}

async function main() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `backup-${stamp}${includeFiles ? '-full' : '-db'}`;
  const target = path.join(backupRoot, name);
  await fsp.mkdir(target, { recursive: true });

  const dbDest = path.join(target, 'localhub.db');
  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, '/')}`;
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    const escaped = dbDest.replace(/\\/g, '/').replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
  } finally {
    await prisma.$disconnect();
  }

  const dbSize = (await fsp.stat(dbDest)).size;
  const dbSha256 = await sha256(dbDest);

  let filesSize = 0;
  let fileCount = 0;
  if (includeFiles && fs.existsSync(storageDir)) {
    const res = await copyDir(storageDir, path.join(target, 'storage'), new Set(['tmp']));
    filesSize = res.bytes;
    fileCount = res.files;
  }

  const manifest = {
    name,
    createdAt: now.toISOString(),
    includeFiles,
    dbSize,
    dbSha256,
    filesSize,
    fileCount,
    totalSize: dbSize + filesSize,
    note,
  };
  await fsp.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Backup created: ${target}`);
  console.log(`  Database: ${(dbSize / 1024).toFixed(1)} KB (SHA-256: ${dbSha256.slice(0, 12)}...)`);
  if (includeFiles) {
    console.log(`  Storage:  ${fileCount} files (${(filesSize / 1024 / 1024).toFixed(2)} MB)`);
  }
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});

