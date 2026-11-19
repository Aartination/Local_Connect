import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BACKUP_DIR, DATABASE_FILE } from '../config.js';
import { prisma, withDatabaseDetached } from '../db.js';
import { logger } from '../logger.js';
import { badRequest, notFound } from '../utils/http.js';
import { invalidateSettingsCache } from './settings.js';
import { dirSize, ensureStorageDirs, sha256File, STORAGE_ROOT } from './storage.js';

fs.mkdirSync(BACKUP_DIR, { recursive: true });

export interface BackupManifest {
  name: string;
  createdAt: string;
  includeFiles: boolean;
  dbSize: number;
  dbSha256: string;
  filesSize: number;
  fileCount: number;
  totalSize: number;
  note: string;
}

const BACKUP_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,80}$/;

function backupDir(name: string): string {
  if (!BACKUP_NAME_RE.test(name)) throw badRequest('Invalid backup name.');
  const target = path.resolve(BACKUP_DIR, name);
  const root = path.resolve(BACKUP_DIR);
  if (!target.startsWith(root + path.sep)) throw badRequest('Invalid backup path.');
  return target;
}

async function copyDirRecursive(src: string, dest: string, skipDirs = new Set<string>()) {
  await fsp.mkdir(dest, { recursive: true });
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory() && skipDirs.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDirRecursive(s, d, skipDirs);
    } else if (e.isFile()) {
      await fsp.copyFile(s, d);
    }
  }
}

export async function createBackup(opts: { includeFiles?: boolean; note?: string } = {}): Promise<BackupManifest> {
  const includeFiles = opts.includeFiles !== false;
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `backup-${stamp}${includeFiles ? '-full' : '-db'}`;
  const target = backupDir(name);
  await fsp.mkdir(target, { recursive: true });

  const dbDest = path.join(target, 'localhub.db');
  const escaped = dbDest.replace(/\\/g, '/').replace(/'/g, "''");
  // VACUUM INTO creates a clean, self-contained, consistent snapshot even under active connections.
  await prisma.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);

  const dbStat = await fsp.stat(dbDest);
  const dbSha256 = await sha256File(dbDest);

  let filesSize = 0;
  let fileCount = 0;
  if (includeFiles) {
    const storageDest = path.join(target, 'storage');
    await copyDirRecursive(STORAGE_ROOT, storageDest, new Set(['tmp']));
    const stats = await dirSize(storageDest);
    filesSize = stats.bytes;
    fileCount = stats.files;
  }

  const manifest: BackupManifest = {
    name,
    createdAt: now.toISOString(),
    includeFiles,
    dbSize: dbStat.size,
    dbSha256,
    filesSize,
    fileCount,
    totalSize: dbStat.size + filesSize,
    note: (opts.note || '').trim().slice(0, 200),
  };
  await fsp.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  logger.info(`Created backup ${name} (${manifest.totalSize} bytes)`);
  return manifest;
}

export async function listBackups(): Promise<BackupManifest[]> {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const entries = await fsp.readdir(BACKUP_DIR, { withFileTypes: true });
  const result: BackupManifest[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !BACKUP_NAME_RE.test(e.name)) continue;
    const manifestPath = path.join(BACKUP_DIR, e.name, 'manifest.json');
    try {
      const m = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) as BackupManifest;
      result.push(m);
    } catch {
      const dbPath = path.join(BACKUP_DIR, e.name, 'localhub.db');
      if (fs.existsSync(dbPath)) {
        const st = await fsp.stat(dbPath);
        result.push({
          name: e.name,
          createdAt: st.mtime.toISOString(),
          includeFiles: fs.existsSync(path.join(BACKUP_DIR, e.name, 'storage')),
          dbSize: st.size,
          dbSha256: '',
          filesSize: 0,
          fileCount: 0,
          totalSize: st.size,
          note: '',
        });
      }
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function restoreBackup(name: string): Promise<{ restored: string; restoredFiles: boolean }> {
  const target = backupDir(name);
  const backupDb = path.join(target, 'localhub.db');
  if (!fs.existsSync(backupDb)) throw notFound('Backup database file not found.');

  // Verify integrity if manifest has checksum
  try {
    const manifest = JSON.parse(await fsp.readFile(path.join(target, 'manifest.json'), 'utf8')) as BackupManifest;
    if (manifest.dbSha256) {
      const actual = await sha256File(backupDb);
      if (actual !== manifest.dbSha256) throw badRequest('Backup integrity check failed (SHA-256 mismatch).');
    }
  } catch (e: any) {
    if (e.status) throw e;
  }

  // Create a safety snapshot before overwriting the live DB
  try {
    await createBackup({ includeFiles: false, note: `Auto safety snapshot before restoring ${name}` });
  } catch (e) {
    logger.warn('Pre-restore safety backup failed', e);
  }

  const backupStorage = path.join(target, 'storage');
  const hasStorage = fs.existsSync(backupStorage);

  await withDatabaseDetached(async () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const f = DATABASE_FILE + suffix;
      if (fs.existsSync(f)) await fsp.unlink(f).catch(() => {});
    }
    await fsp.copyFile(backupDb, DATABASE_FILE);
    if (hasStorage) {
      ensureStorageDirs();
      await copyDirRecursive(backupStorage, STORAGE_ROOT, new Set(['tmp']));
    }
  });

  invalidateSettingsCache();
  logger.info(`Restored backup ${name} (files: ${hasStorage})`);
  return { restored: name, restoredFiles: hasStorage };
}

export async function deleteBackup(name: string) {
  const target = backupDir(name);
  if (!fs.existsSync(target)) throw notFound('Backup not found.');
  await fsp.rm(target, { recursive: true, force: true });
}

