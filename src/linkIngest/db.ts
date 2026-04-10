import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { ExistingMediaRecord } from './types.js';

const execFileAsync = promisify(execFileCallback);
const SQLITE_BIN = process.env.SQLITE3_BIN?.trim() || 'sqlite3';

export async function findExistingMediaRecords(
  dbPath: string,
  mediaIds: string[],
  urls: string[],
): Promise<ExistingMediaRecord[]> {
  if (!existsSync(dbPath)) return [];
  const clauses: string[] = [];
  if (mediaIds.length) {
    clauses.push(`media_id IN (${mediaIds.map(sqlString).join(', ')})`);
  }
  if (urls.length) {
    clauses.push(`source_url IN (${urls.map(sqlString).join(', ')})`);
  }
  if (!clauses.length) return [];
  const sql = [
    'SELECT media_id, source_url, original_path',
    'FROM media_files',
    `WHERE ${clauses.join(' OR ')}`,
    ';',
  ].join(' ');
  const result = await execFileAsync(SQLITE_BIN, ['-batch', '-noheader', '-separator', '\t', dbPath, sql]);
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    const [mediaId = '', sourceUrl = '', originalPath = ''] = line.split('\t');
    return { mediaId, sourceUrl, originalPath };
  });
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
