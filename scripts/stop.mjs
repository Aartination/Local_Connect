import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pidFile = path.join(root, 'config', 'server.pid');

if (!fs.existsSync(pidFile)) {
  console.log('LOCAL HUB does not appear to be running (no config/server.pid found).');
  process.exit(0);
}

let info;
try {
  info = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
} catch {
  console.log('Could not read server PID file; removing stale file.');
  fs.unlinkSync(pidFile);
  process.exit(0);
}

const pid = Number(info.pid);
if (!Number.isInteger(pid) || pid <= 0) {
  fs.unlinkSync(pidFile);
  process.exit(0);
}

try {
  process.kill(pid, 0);
} catch {
  console.log(`LOCAL HUB (PID ${pid}) is already stopped. Cleaning up PID file.`);
  fs.unlinkSync(pidFile);
  process.exit(0);
}

console.log(`Stopping LOCAL HUB server (PID ${pid})...`);
try {
  if (process.platform === 'win32') {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
  } else {
    process.kill(pid, 'SIGTERM');
  }
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  console.log('LOCAL HUB stopped successfully.');
} catch (err) {
  console.error('Failed to stop server:', err.message);
  process.exit(1);
}

