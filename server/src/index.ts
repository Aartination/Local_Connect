import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { createApp } from './app.js';
import { ensureCertificates } from './certs.js';
import { config, PID_FILE } from './config.js';
import { initDatabase, prisma } from './db.js';
import { logger } from './logger.js';
import { getLanAddresses } from './network.js';
import { purgeExpiredSessions } from './services/auth.js';
import { ensureSetupToken } from './services/setup.js';
import { ensureStorageDirs, STORAGE_ROOT } from './services/storage.js';
import { initSocket } from './socket/index.js';

async function cleanupStaleUploads() {
  try {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
    const stale = await prisma.uploadSession.findMany({ where: { updatedAt: { lt: cutoff } } });
    for (const s of stale) {
      await fsp.unlink(path.join(STORAGE_ROOT, 'tmp', `${s.id}.part`)).catch(() => {});
    }
    if (stale.length) {
      await prisma.uploadSession.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    }
  } catch (e) {
    logger.warn('Stale upload cleanup error', e);
  }
}

async function main() {
  ensureStorageDirs();
  await initDatabase();
  await purgeExpiredSessions();
  await cleanupStaleUploads();

  const app = createApp();
  const httpServer = http.createServer(app);
  const servers: Array<http.Server | https.Server> = [httpServer];

  const lan = getLanAddresses();
  const lanIps = lan.map((l) => l.address);

  let httpsServer: https.Server | null = null;
  if (config.enableHttps) {
    try {
      const certs = ensureCertificates(lanIps);
      httpsServer = https.createServer({ key: certs.key, cert: certs.cert }, app);
      servers.push(httpsServer);
    } catch (e) {
      logger.warn('Could not initialize local HTTPS server; continuing with HTTP only.', e);
    }
  }

  const io = initSocket(servers);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });

  if (httpsServer) {
    await new Promise<void>((resolve) => {
      httpsServer!.once('error', (err) => {
        logger.warn(`HTTPS port ${config.httpsPort} unavailable (${err.message}); continuing with HTTP only.`);
        httpsServer = null;
        resolve();
      });
      httpsServer!.listen(config.httpsPort, config.host, () => resolve());
    });
  }

  // Record PID for stop-server.bat
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  fs.writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, port: config.port, httpsPort: httpsServer ? config.httpsPort : null, startedAt: new Date().toISOString() }));

  const setupToken = await ensureSetupToken();
  const primary = lan[0]?.address || '127.0.0.1';

  console.log('\n============================================================');
  console.log('  LOCAL HUB - Private LAN Communication & Collaboration');
  console.log('============================================================');
  console.log(`  Local access:     http://localhost:${config.port}`);
  if (httpsServer) {
    console.log(`  Local HTTPS:      https://localhost:${config.httpsPort}`);
  }
  console.log(`  LAN access:       http://${primary}:${config.port}`);
  if (httpsServer) {
    console.log(`  LAN HTTPS (Voice/Video/PWA): https://${primary}:${config.httpsPort}`);
  }
  if (lan.length > 1) {
    console.log('  Other interfaces:');
    for (const iface of lan.slice(1)) {
      console.log(`    - http://${iface.address}:${config.port} (${iface.iface})`);
    }
  }
  console.log(`  Storage folder:   ${STORAGE_ROOT}`);
  if (setupToken) {
    console.log('------------------------------------------------------------');
    console.log('  FIRST-TIME SETUP REQUIRED');
    console.log(`  Open http://localhost:${config.port} and enter Setup Code:`);
    console.log(`  >>>  ${setupToken}  <<<`);
  }
  console.log('============================================================\n');

  logger.info(`LOCAL HUB listening on ${config.host}:${config.port}${httpsServer ? ` and HTTPS :${config.httpsPort}` : ''}`);

  const maintenance = setInterval(() => {
    purgeExpiredSessions().catch(() => {});
    cleanupStaleUploads().catch(() => {});
  }, 15 * 60 * 1000);
  maintenance.unref();

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down LOCAL HUB...`);
    clearInterval(maintenance);
    io.close();
    httpServer.close();
    httpsServer?.close();
    await prisma.$disconnect().catch(() => {});
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});

