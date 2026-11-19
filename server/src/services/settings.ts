import { prisma } from '../db.js';

export const DEFAULT_ALLOWED_EXTENSIONS = [
  // images
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif',
  // video
  'mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v',
  // audio
  'mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'weba',
  // documents
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp', 'rtf',
  'txt', 'csv', 'md', 'json', 'log',
  // archives
  'zip', 'rar', '7z', 'tar', 'gz',
];

export interface RuntimeSettings {
  workspaceName: string;
  maxFileSizeMB: number;
  allowedExtensions: string[];
  maxUsers: number;
}

const DEFAULTS: RuntimeSettings = {
  workspaceName: 'LOCAL HUB',
  maxFileSizeMB: 1024,
  allowedExtensions: DEFAULT_ALLOWED_EXTENSIONS,
  maxUsers: 5,
};

let cache: RuntimeSettings | null = null;

export async function getSettings(): Promise<RuntimeSettings> {
  if (cache) return cache;
  const rows = await prisma.setting.findMany();
  const s: RuntimeSettings = { ...DEFAULTS };
  for (const r of rows) {
    try {
      (s as any)[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore malformed */
    }
  }
  cache = s;
  return s;
}

export async function updateSettings(patch: Partial<RuntimeSettings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value) },
      update: { value: JSON.stringify(value) },
    });
  }
  cache = null;
  return getSettings();
}

export function invalidateSettingsCache() {
  cache = null;
}

