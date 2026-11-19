import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Central configuration.
 * Precedence: environment variables > config/localhub.config.json > defaults.
 * Settings that can change at runtime without restart (file limits, workspace
 * name, ...) live in the database (see services/settings.ts).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// src/config.ts or dist/config.js -> server/ -> project root
export const SERVER_DIR = path.resolve(here, '..');
export const ROOT_DIR = path.resolve(SERVER_DIR, '..');

export const CONFIG_DIR = path.join(ROOT_DIR, 'config');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'localhub.config.json');
export const DATABASE_DIR = path.join(ROOT_DIR, 'database');
export const DATABASE_FILE = path.join(DATABASE_DIR, 'localhub.db');
export const BACKUP_DIR = path.join(ROOT_DIR, 'backups');
export const LOG_DIR = path.join(ROOT_DIR, 'logs');
export const CERT_DIR = path.join(CONFIG_DIR, 'certs');
export const PID_FILE = path.join(CONFIG_DIR, 'server.pid');
export const SETUP_TOKEN_FILE = path.join(CONFIG_DIR, 'setup-token.txt');
export const CLIENT_DIST = path.join(ROOT_DIR, 'client', 'dist');

export interface FileConfig {
  port: number;
  httpsPort: number;
  enableHttps: boolean;
  host: string;
  storageDir: string;
  sessionDays: number;
  /** Extra origins allowed to call the API (e.g. the Vite dev server). */
  extraOrigins: string[];
}

const DEFAULTS: FileConfig = {
  port: 3000,
  httpsPort: 3443,
  enableHttps: true,
  host: '0.0.0.0',
  storageDir: 'storage',
  sessionDays: 30,
  extraOrigins: [],
};

export function readFileConfig(): FileConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeFileConfig(patch: Partial<FileConfig>): FileConfig {
  const next = { ...readFileConfig(), ...patch };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

function intEnv(name: string): number | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function buildConfig() {
  if (!fs.existsSync(CONFIG_FILE)) writeFileConfig({});
  const file = readFileConfig();
  const port = intEnv('LOCALHUB_PORT') ?? intEnv('PORT') ?? file.port;
  const httpsPort = intEnv('LOCALHUB_HTTPS_PORT') ?? file.httpsPort;
  const enableHttps = process.env.LOCALHUB_HTTPS
    ? process.env.LOCALHUB_HTTPS !== '0' && process.env.LOCALHUB_HTTPS !== 'false'
    : file.enableHttps;
  const storageSetting = process.env.LOCALHUB_STORAGE_DIR || file.storageDir;
  const storageDir = path.isAbsolute(storageSetting)
    ? storageSetting
    : path.resolve(ROOT_DIR, storageSetting);
  return {
    port,
    httpsPort,
    enableHttps,
    host: process.env.LOCALHUB_HOST || file.host,
    storageDir,
    sessionDays: file.sessionDays,
    extraOrigins: file.extraOrigins,
    isDev: process.env.NODE_ENV === 'development',
    version: '1.0.0',
  };
}

export const config = buildConfig();
export type AppConfig = typeof config;

