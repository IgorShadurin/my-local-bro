import type { IngestLinkItem } from './types.js';

export interface NormalizedLink extends IngestLinkItem {
  normalizedUrl: string;
  normalizedPlatform: string;
  dedupeKey: string;
}

export function normalizeLink(item: IngestLinkItem): NormalizedLink {
  const normalizedUrl = normalizeUrl(item.url);
  const normalizedPlatform = normalizePlatform(item.platform, normalizedUrl);
  const externalId = normalizeExternalId(normalizedPlatform, item.externalId, normalizedUrl);
  const dedupeKey = externalId
    ? `${normalizedPlatform}:id:${externalId}`
    : `${normalizedPlatform}:url:${normalizedUrl}`;
  return {
    ...item,
    url: normalizedUrl,
    normalizedUrl,
    normalizedPlatform,
    ...(externalId ? { externalId } : {}),
    dedupeKey,
  };
}

export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  parsed.hash = '';
  if (parsed.hostname === 'instagram.com') parsed.hostname = 'www.instagram.com';
  if (parsed.hostname === 'm.instagram.com') parsed.hostname = 'www.instagram.com';
  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/';
  }
  if (isInstagramHost(parsed.hostname)) {
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length >= 2 && ['reel', 'p', 'tv'].includes(segments[0]!)) {
      parsed.search = '';
      parsed.pathname = `/${segments[0]}/${segments[1]}/`;
    }
  }
  return parsed.toString();
}

function normalizePlatform(platform: string | undefined, normalizedUrl: string): string {
  if (platform?.trim()) return platform.trim().toLowerCase();
  const hostname = new URL(normalizedUrl).hostname.toLowerCase();
  if (isInstagramHost(hostname)) return 'instagram';
  if (hostname.includes('tiktok.com')) return 'tiktok';
  if (hostname.includes('youtube.com') || hostname === 'youtu.be') return 'youtube';
  return hostname;
}

function normalizeExternalId(platform: string, externalId: string | undefined, normalizedUrl: string): string | undefined {
  if (externalId?.trim()) return externalId.trim();
  if (platform === 'instagram') return extractInstagramCode(normalizedUrl);
  return undefined;
}

function extractInstagramCode(url: string): string | undefined {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && ['reel', 'p', 'tv'].includes(segments[0]!)) {
    return segments[1];
  }
  return undefined;
}

function isInstagramHost(hostname: string): boolean {
  return hostname === 'instagram.com' || hostname === 'www.instagram.com' || hostname === 'm.instagram.com';
}
