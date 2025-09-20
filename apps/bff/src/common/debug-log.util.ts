import { appendFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';

export interface DebugLogEntry {
  timestamp?: string;
  [key: string]: unknown;
}

export async function appendDebugLog(
  directory: string | undefined,
  category: string,
  entry: DebugLogEntry
): Promise<void> {
  if (!directory) {
    return;
  }

  try {
    const resolvedDir = resolve(directory);
    await mkdir(resolvedDir, { recursive: true });

    const fileName = `${category}-${new Date().toISOString().slice(0, 10)}.log`;
    const filePath = join(resolvedDir, fileName);
    const payload = {
      timestamp: new Date().toISOString(),
      ...entry
    };

    await appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[BFF] Failed to append debug log entry', error);
  }
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase().includes('secret') || key.toLowerCase().includes('authorization')) {
      sanitized[key] = '[redacted]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
