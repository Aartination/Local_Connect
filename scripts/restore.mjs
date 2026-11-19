import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = path.join(root, 'database', 'localhub.db');
const backupRoot = path.join(root, 'backups');
const pidFile = path.join(root, 'config', 'server.pid');
const configPath = path.join(root, 'config', 'localhub.config.json');

let storageSetting = 'storage';
try {
  storageSetting = JSON.parse(fs.readFileSync(configPath, 'utf8')).storageDir || 'storage';
} catch {
  /* default */
}
const storageDir = path.isAbsolute(storageSetting) ? storageSetting : path.resolve(root, storageSetting);

async function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fsp.copyFile(s, d);
  }
}

async function main() {
  // Refuse restore if server appears running
  if (fs.existsSync(pidFile)) {
    try {
      const { pid } = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
      process.kill(Number(pid), 0);
      console.error('LOCAL HUB server is currently running (PID ' + pid + ').');
      console.error('Stop it first with stop-server.bat, or restore from the Admin Dashboard.');
      process.exit(1);
    } catch {
      /* stale pid */
    }
  }

  if (!fs.existsSync(backupRoot)) {
    console.error('No backups directory found.');
    process.exit(1);
  }

  const dirs = (await fsp.readdir(backupRoot, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(backupRoot, d.name, 'localhub.db')))
    .map((d) => d.name)
    .sort()
    .reverse();

  if (dirs.length === 0) {
    console.error('No valid backups found in:', backupRoot);
    process.exit(1);
  }

  let chosen = process.argv[2];
  if (!chosen) {
    console.log('\nAvailable backups:');
    dirs.forEach((d, idx) => console.log(`  [${idx + 1}] ${d}`));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('\nEnter backup number or name to restore (or Ctrl+C to cancel): ')).trim();
    rl.close();
    const num = Number.parseInt(answer, 10);
    chosen = Number.isInteger(num) && num >= 1 && num <= dirs.length ? dirs[num - 1] : answer;
  }

  if (!dirs.includes(chosen)) {
    console.error(`Backup "${chosen}" not found.`);
    process.exit(1);
  }

  const target = path.join(backupRoot, chosen);
  const backupDb = path.join(target, 'localhub.db');

  // Verify checksum if manifest exists
  const manifestPath = path.join(target, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    if (manifest.dbSha256) {
      const actual = await sha256(backupDb);
      if (actual !== manifest.dbSha256) {
        console.error('ERROR: Backup SHA-256 checksum mismatch! Refusing to restore.');
        process.exit(1);
      }
    }
  }

  // Create pre-restore safety copy of existing DB
  if (fs.existsSync(dbFile)) {
    const safetyDir = path.join(backupRoot, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
    await fsp.mkdir(safetyDir, { recursive: true });
    await fsp.copyFile(dbFile, path.join(safetyDir, 'localhub.db'));
    console.log(`Saved pre-restore safety copy to: ${safetyDir}`);
  }

  await fsp.mkdir(path.dirname(dbFile), { recursive: true });
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    if (fs.existsSync(dbFile + suffix)) await fsp.unlink(dbFile + suffix).catch(() => {});
  }
  await fsp.copyFile(backupDb, dbFile);

  const backupStorage = path.join(target, 'storage');
  if (fs.existsSync(backupStorage)) {
    await copyDir(backupStorage, storageDir);
    console.log('Restored uploaded files to:', storageDir);
  }

  console.log(`\nSuccessfully restored LOCAL HUB from "${chosen}".`);
  console.log('You can now start the server with start-server.bat.');
}

main().catch((err) => {
  console.error('Restore failed:', err);
  process.exit(1);
});

