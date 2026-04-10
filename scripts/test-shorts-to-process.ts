import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const scriptPath = join(process.cwd(), 'scripts/shorts-to-process-video-dl.sh');
const ffmpegBin = process.env.FFMPEG_BIN?.trim() || '/opt/homebrew/bin/ffmpeg';
const ffprobeBin = process.env.FFPROBE_BIN?.trim() || '/opt/homebrew/bin/ffprobe';
const sqlite3Bin = process.env.SQLITE3_BIN?.trim() || '/Users/test/miniconda3/bin/sqlite3';
const nodeBin = process.execPath;

interface RunResult {
  stdout: string;
  stderr: string;
}

interface DbExpectations {
  dirPath: string;
  category: string;
  convertedPath: string;
  sourceUrl?: string;
}

async function main(): Promise<void> {
  const root = join(tmpdir(), `my-local-bro-shorts-${Date.now()}`);
  const binDir = join(root, 'bin');
  const fixtureDir = join(root, 'fixtures');
  const storageRoot = join(root, 'ShortsToProcess');
  const ytdlpLog = join(root, 'fake-ytdlp.log');
  await mkdir(binDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(storageRoot, { recursive: true });
  await writeFile(ytdlpLog, '', 'utf8');

  const sourceVideo = join(fixtureDir, 'source-hevc.mp4');
  await execFile(ffmpegBin, [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'testsrc=size=720x1280:rate=30',
    '-f', 'lavfi',
    '-i', 'sine=frequency=660:sample_rate=48000',
    '-t', '1.5',
    '-shortest',
    '-c:v', 'libx265',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    sourceVideo,
  ]);

  const fakeYtdlpPath = join(binDir, 'yt-dlp');
  await writeFile(fakeYtdlpPath, fakeYtdlpSource(), 'utf8');
  await chmod(fakeYtdlpPath, 0o755);

  const env = {
    ...process.env,
    SHORTS_ROOT_DIR: storageRoot,
    SHORTS_DATE_OVERRIDE: '2026-04-09',
    SHORTS_ENABLE_CONVERSION: 'true',
    YT_DLP_BIN: fakeYtdlpPath,
    FFMPEG_BIN: ffmpegBin,
    FFPROBE_BIN: ffprobeBin,
    SQLITE3_BIN: sqlite3Bin,
    NODE_BIN: nodeBin,
    FAKE_YTDLP_SOURCE: sourceVideo,
    FAKE_YTDLP_LOG: ytdlpLog,
  };

  const alphaFirst = await runScript(['https://example.com/alpha'], env);
  assertContains(alphaFirst.stdout, 'Status: downloaded');
  assertContains(alphaFirst.stdout, 'Title: Alpha Hook - Alice Dev');
  assertContains(alphaFirst.stdout, 'File ID: 2026/April/09/001');
  const datedDir = join(storageRoot, '2026', 'April', '09');
  const alphaSlot = join(datedDir, '001');
  const alphaOriginal = join(alphaSlot, 'reference_original.mp4');
  const alphaConverted = join(alphaSlot, 'reference.mp4');
  await assertFile(alphaOriginal);
  await assertFile(alphaConverted);
  await assertCodec(alphaOriginal, 'hevc', 'aac');
  await assertCodec(alphaConverted, 'h264', 'aac');
  await assertDbRow(env, 'alpha-id', {
    dirPath: alphaSlot,
    category: '',
    convertedPath: alphaConverted,
    sourceUrl: 'https://example.com/alpha',
  });

  const alphaSecond = await runScript(['https://example.com/alpha'], env);
  assertContains(alphaSecond.stdout, 'Status: existing');
  await assertDownloadCount(ytdlpLog, 'https://example.com/alpha', 1);

  const renamedAlphaSlot = join(datedDir, '001-hello-world');
  await rename(alphaSlot, renamedAlphaSlot);
  const alphaThird = await runScript(['https://example.com/alpha'], env);
  assertContains(alphaThird.stdout, 'File ID: 2026/April/09/001');
  await assertDownloadCount(ytdlpLog, 'https://example.com/alpha', 1);
  await assertDbRow(env, 'alpha-id', {
    dirPath: renamedAlphaSlot,
    category: '',
    convertedPath: join(renamedAlphaSlot, 'reference.mp4'),
    sourceUrl: 'https://example.com/alpha',
  });

  await rm(join(renamedAlphaSlot, 'reference.mp4'));
  const alphaFourth = await runScript(['https://example.com/alpha'], env);
  assertContains(alphaFourth.stdout, 'Status: converted');
  await assertFile(join(renamedAlphaSlot, 'reference.mp4'));
  await assertDownloadCount(ytdlpLog, 'https://example.com/alpha', 1);

  const betaRun = await runScript(['https://example.com/beta', 'hook'], env);
  assertContains(betaRun.stdout, 'Category: hook');
  assertContains(betaRun.stdout, 'File ID: hook/001');
  const hookSlot = join(storageRoot, 'hook', '001');
  await assertFile(join(hookSlot, 'reference_original.mp4'));
  await assertFile(join(hookSlot, 'reference.mp4'));
  await assertDbRow(env, 'beta-id', {
    dirPath: hookSlot,
    category: 'hook',
    convertedPath: join(hookSlot, 'reference.mp4'),
    sourceUrl: 'https://example.com/beta',
  });
  await assertDownloadCount(ytdlpLog, 'https://example.com/beta', 1);

  const otherRun = await runScript(['https://example.com/gamma', 'other'], env);
  assertContains(otherRun.stdout, 'Category: other');
  assertContains(otherRun.stdout, 'File ID: other/001');
  const otherSlot = join(storageRoot, 'other', '001');
  await assertFile(join(otherSlot, 'reference_original.mp4'));
  await assertFile(join(otherSlot, 'reference.mp4'));
  await assertDbRow(env, 'gamma-id', {
    dirPath: otherSlot,
    category: 'other',
    convertedPath: join(otherSlot, 'reference.mp4'),
    sourceUrl: 'https://example.com/gamma',
  });
  await assertDownloadCount(ytdlpLog, 'https://example.com/gamma', 1);

  const noConvertRoot = join(root, 'ShortsToProcessNoConvert');
  await mkdir(noConvertRoot, { recursive: true });
  const envNoConvert = {
    ...env,
    SHORTS_ROOT_DIR: noConvertRoot,
    SHORTS_ENABLE_CONVERSION: 'false',
  };
  const noConvertRun = await runScript(['https://example.com/alpha'], envNoConvert);
  assertContains(noConvertRun.stdout, 'Original size:');
  const noConvertSlot = join(noConvertRoot, '2026', 'April', '09', '001');
  await assertFile(join(noConvertSlot, 'reference_original.mp4'));
  await assertMissing(join(noConvertSlot, 'reference.mp4'));
  await assertDbRow(envNoConvert, 'alpha-id', {
    dirPath: noConvertSlot,
    category: '',
    convertedPath: join(noConvertSlot, 'reference.mp4'),
    sourceUrl: 'https://example.com/alpha',
  });
  await assertConvertedSize(envNoConvert, 'alpha-id', 0);

  const summary = [
    `Output root: ${root}`,
    'Cases passed:',
    '- initial date-grouped download with conversion',
    '- idempotent rerun without redownload',
    '- renamed slot directory still resolved by numeric prefix',
    '- missing converted file gets regenerated without redownload',
    '- hook category stores under hook/001 with metadata row',
    '- other category stores under other/001 with metadata row',
    '- default disabled conversion mode stores only reference_original.mp4 and skips converted validation',
  ].join('\n');
  await writeFile(join(root, 'summary.txt'), `${summary}\n`, 'utf8');
  console.log(summary);
}

function fakeYtdlpSource(): string {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const logFile = process.env.FAKE_YTDLP_LOG;
const fixture = process.env.FAKE_YTDLP_SOURCE;
const metadataMap = {
  'https://example.com/alpha': { id: 'alpha-id', title: 'Alpha Hook', uploader: 'Alice Dev', webpage_url: 'https://example.com/alpha?resolved=1', extractor_key: 'Instagram' },
  'https://example.com/beta': { id: 'beta-id', title: 'Beta Hook', uploader: 'Bob Maker', webpage_url: 'https://example.com/beta?resolved=1', extractor_key: 'TikTok' },
  'https://example.com/gamma': { id: 'gamma-id', title: 'Gamma Other', uploader: 'Gina Ops', webpage_url: 'https://example.com/gamma?resolved=1', extractor_key: 'YouTube' },
};
const url = args[args.length - 1];
if (!metadataMap[url]) {
  console.error('Unknown URL: ' + url);
  process.exit(2);
}
fs.appendFileSync(logFile, (args.includes('--dump-single-json') ? 'metadata::' : 'download::') + url + '\\n');
if (args.includes('--dump-single-json')) {
  process.stdout.write(JSON.stringify(metadataMap[url]));
  process.exit(0);
}
const outputIndex = args.indexOf('-o');
if (outputIndex === -1 || !args[outputIndex + 1]) {
  console.error('Missing -o output template');
  process.exit(2);
}
const outputTemplate = args[outputIndex + 1];
const targetPath = outputTemplate.replace('%(ext)s', 'mp4');
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.copyFileSync(fixture, targetPath);
process.stdout.write('after_move:' + targetPath + '\\n');
process.stdout.write('after_move:' + metadataMap[url].webpage_url + '\\n');
`;
}

async function runScript(args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  const result = await execFile(scriptPath, args, { env, maxBuffer: 10 * 1024 * 1024 });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function assertFile(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0) {
    throw new Error(`Expected non-empty file at ${path}`);
  }
}

async function assertCodec(path: string, expectedVideo: string, expectedAudio: string): Promise<void> {
  const result = await execFile(ffprobeBin, [
    '-v', 'error',
    '-show_entries', 'stream=index,codec_type,codec_name',
    '-of', 'json',
    path,
  ]);
  const parsed = JSON.parse(result.stdout) as { streams?: Array<{ codec_type?: string; codec_name?: string }> };
  const videoCodec = parsed.streams?.find((stream) => stream.codec_type === 'video')?.codec_name;
  const audioCodec = parsed.streams?.find((stream) => stream.codec_type === 'audio')?.codec_name;
  if (videoCodec !== expectedVideo || audioCodec !== expectedAudio) {
    throw new Error(`Unexpected codecs for ${path}: video=${videoCodec} audio=${audioCodec}`);
  }
}

async function assertDbRow(env: NodeJS.ProcessEnv, mediaId: string, expected: DbExpectations): Promise<void> {
  const dbPath = join(env.SHORTS_ROOT_DIR!, 'shorts.sqlite3');
  const sql = `SELECT dir_path, ifnull(category,''), converted_path, source_url FROM media_files WHERE media_id = '${mediaId}' LIMIT 1;`;
  const result = await execFile(sqlite3Bin, ['-batch', '-noheader', '-separator', '\t', dbPath, sql]);
  const [dirPath, category, convertedPath, sourceUrl] = result.stdout.trim().split('\t');
  if (dirPath !== expected.dirPath) {
    throw new Error(`Unexpected dir_path for ${mediaId}: ${dirPath}`);
  }
  if (category !== expected.category) {
    throw new Error(`Unexpected category for ${mediaId}: ${category}`);
  }
  if (convertedPath !== expected.convertedPath) {
    throw new Error(`Unexpected converted_path for ${mediaId}: ${convertedPath}`);
  }
  if (expected.sourceUrl !== undefined && sourceUrl !== expected.sourceUrl) {
    throw new Error(`Unexpected source_url for ${mediaId}: ${sourceUrl}`);
  }
}

async function assertConvertedSize(env: NodeJS.ProcessEnv, mediaId: string, expectedSize: number): Promise<void> {
  const dbPath = join(env.SHORTS_ROOT_DIR!, 'shorts.sqlite3');
  const sql = `SELECT ifnull(converted_size_bytes, -1) FROM media_files WHERE media_id = '${mediaId}' LIMIT 1;`;
  const result = await execFile(sqlite3Bin, ['-batch', '-noheader', dbPath, sql]);
  const size = Number(result.stdout.trim());
  if (size !== expectedSize) {
    throw new Error(`Unexpected converted_size_bytes for ${mediaId}: ${size}`);
  }
}

async function assertDownloadCount(logPath: string, url: string, expectedDownloads: number): Promise<void> {
  const log = await readFile(logPath, 'utf8');
  const actualDownloads = log.split('\n').filter((line) => line === `download::${url}`).length;
  if (actualDownloads !== expectedDownloads) {
    throw new Error(`Expected ${expectedDownloads} downloads for ${url}, got ${actualDownloads}`);
  }
}

async function assertMissing(path: string): Promise<void> {
  try {
    await stat(path);
    throw new Error(`Expected file to be absent at ${path}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('ENOENT')) {
      throw error;
    }
  }
}

function assertContains(text: string, fragment: string): void {
  if (!text.includes(fragment)) {
    throw new Error(`Expected output to include "${fragment}", got:\n${text}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
