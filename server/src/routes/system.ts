import fs from 'node:fs';
import os from 'node:os';
import { Router } from 'express';
import { CA_CERT_PATH } from '../certs.js';
import { config } from '../config.js';
import { getLanAddresses } from '../network.js';
import { getSettings } from '../services/settings.js';
import { needsSetup } from '../services/setup.js';
import { notFound } from '../utils/http.js';

export const systemRouter = Router();
const STARTED_AT = Date.now();

systemRouter.get('/health', (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000) });
});

systemRouter.get('/info', async (_req, res) => {
  const [setup, settings] = await Promise.all([needsSetup(), getSettings()]);
  res.json({
    version: config.version,
    workspaceName: settings.workspaceName,
    needsSetup: setup,
    hostname: os.hostname(),
    lanAddresses: getLanAddresses(),
    httpPort: config.port,
    httpsPort: config.httpsPort,
    httpsEnabled: config.enableHttps,
    hasCaCert: fs.existsSync(CA_CERT_PATH),
    maxFileSizeMB: settings.maxFileSizeMB,
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    serverTime: new Date().toISOString(),
  });
});

systemRouter.get('/ca.crt', (_req, res) => {
  if (!fs.existsSync(CA_CERT_PATH)) throw notFound('CA certificate is not available.');
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="LOCAL-HUB-CA.crt"');
  res.sendFile(CA_CERT_PATH);
});

