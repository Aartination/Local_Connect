import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR } from './config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const RING_SIZE = 1000;
const ring: string[] = [];

fs.mkdirSync(LOG_DIR, { recursive: true });

function logFileFor(date = new Date()) {
  const d = date.toISOString().slice(0, 10);
  return path.join(LOG_DIR, `localhub-${d}.log`);
}

function format(level: Level, msg: string, extra?: unknown) {
  const ts = new Date().toISOString();
  let line = `${ts} [${level.toUpperCase()}] ${msg}`;
  if (extra !== undefined) {
    if (extra instanceof Error) line += ` :: ${extra.stack || extra.message}`;
    else {
      try {
        line += ` ${JSON.stringify(extra)}`;
      } catch {
        line += ` ${String(extra)}`;
      }
    }
  }
  return line;
}

function write(level: Level, msg: string, extra?: unknown) {
  if (level === 'debug' && process.env.LOCALHUB_DEBUG !== '1') return;
  const line = format(level, msg, extra);
  ring.push(line);
  if (ring.length > RING_SIZE) ring.shift();
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(line);
  fs.appendFile(logFileFor(), line + '\n', () => {});
}

export const logger = {
  debug: (m: string, e?: unknown) => write('debug', m, e),
  info: (m: string, e?: unknown) => write('info', m, e),
  warn: (m: string, e?: unknown) => write('warn', m, e),
  error: (m: string, e?: unknown) => write('error', m, e),
  recent(lines = 300): string[] {
    return ring.slice(-lines);
  },
  /** Reads the tail of a log file on disk (defaults to today). */
  readTail(lines = 300, date?: string): string[] {
    const file = date ? path.join(LOG_DIR, `localhub-${date}.log`) : logFileFor();
    if (!file.startsWith(LOG_DIR) || !fs.existsSync(file)) return [];
    const stat = fs.statSync(file);
    const size = Math.min(stat.size, 512 * 1024);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, stat.size - size);
    fs.closeSync(fd);
    return buf.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-lines);
  },
  listFiles(): string[] {
    try {
      return fs
        .readdirSync(LOG_DIR)
        .filter((f) => /^localhub-\d{4}-\d{2}-\d{2}\.log$/.test(f))
        .map((f) => f.slice(9, 19))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  },
};

