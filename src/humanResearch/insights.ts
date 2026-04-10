import type { PublicResearchLink, ResearchAnswer, ResearchArchetype, SearchDocument, SearchResult } from './types.js';
import { truncateText } from '../util/text.js';

const PROFILE_DOMAIN_LABELS: Array<{ match: string; label: string }> = [
  { match: 'linkedin.com', label: 'LinkedIn' },
  { match: 'github.com', label: 'GitHub' },
  { match: 'gitlab.com', label: 'GitLab' },
  { match: 'x.com', label: 'X' },
  { match: 'twitter.com', label: 'Twitter' },
  { match: 'youtube.com', label: 'YouTube' },
  { match: 'substack.com', label: 'Substack' },
  { match: 'medium.com', label: 'Medium' },
  { match: 'producthunt.com', label: 'Product Hunt' },
  { match: 'indiehackers.com', label: 'Indie Hackers' },
  { match: 'gumroad.com', label: 'Gumroad' },
  { match: 'lemonsqueezy.com', label: 'Lemon Squeezy' },
  { match: 'patreon.com', label: 'Patreon' },
  { match: 'dribbble.com', label: 'Dribbble' },
  { match: 'behance.net', label: 'Behance' },
  { match: 'apps.apple.com', label: 'App Store' },
  { match: 'play.google.com', label: 'Google Play' },
];

const PLATFORM_KEYWORDS = [
  'github', 'gitlab', 'product hunt', 'indie hackers', 'gumroad', 'lemon squeezy', 'patreon',
  'app store', 'google play', 'quickbooks', 'stripe', 'substack', 'youtube', 'linkedin', 'x ',
];

const AUDIENCE_KEYWORDS = [
  'newsletter', 'youtube', 'workshop', 'talk', 'interview', 'case study', 'community',
  'launch', 'maker', 'customers', 'customer interviews', 'comments', 'building in public',
];

export function buildResearchAppendix(results: SearchResult[]): string {
  return buildResearchAppendixForArchetype('unknown', results);
}

export function buildResearchAppendixForArchetype(
  archetype: ResearchArchetype,
  results: SearchResult[],
): string {
  const sections = [
    formatLinkSection(collectProfileLinks(results)),
    formatSimpleSection('Public contact and location clues', collectContactLocationClues(results)),
    isCommercialArchetype(archetype)
      ? formatSimpleSection('Public products, services, and commercial signals', collectCommercialSignals(results))
      : formatSimpleSection('Public projects, work artifacts, and role signals', collectWorkSignals(results)),
    formatSimpleSection('Public tools, platforms, and distribution channels', collectPlatformSignals(results)),
    formatSimpleSection('Public audience, content, and collaboration signals', collectAudienceSignals(results)),
    formatSimpleSection('Recent public references', collectRecentActivity(results)),
    formatSimpleSection('Possible ambiguity candidates', collectAmbiguityCandidates(results)),
  ].filter(Boolean);

  return sections.join('\n\n');
}

export function buildFallbackReport(
  subjectLabel: string,
  archetype: ResearchArchetype,
  answers: ResearchAnswer[],
  results: SearchResult[],
): string {
  const profileLinks = collectProfileLinks(results);
  const contactLocation = collectContactLocationClues(results);
  const commercial = collectCommercialSignals(results);
  const platform = collectPlatformSignals(results);
  const audience = collectAudienceSignals(results);
  const recent = collectRecentActivity(results);
  const ambiguity = collectAmbiguityCandidates(results);

  return [
    '# Subject',
    subjectLabel,
    '',
    '## Match confidence',
    ambiguity.length > 0 ? 'Moderate. There are multiple public profiles, and the most likely match is selected from source overlap.' : 'High. Public source overlap is consistent.',
    '',
    '## Archetype',
    archetype,
    '',
    '## Public profile summary',
    ...answers.map((answer) => `- ${answer.summary}`),
    '',
    '## Public location and contact clues',
    ...(contactLocation.length > 0 ? contactLocation.map((line) => `- ${line}`) : ['- No strong public location or contact clues were found.']),
    '',
    '## Public social and platform profiles',
    ...(profileLinks.length > 0
      ? profileLinks.map((link) => `- ${link.label}: ${link.url}${link.audienceCount ? ` | audience: ${link.audienceCount}` : ''}`)
      : ['- No exact public profile URLs were found.']),
    '',
    isCommercialArchetype(archetype) ? '## Public products, services, and commercial signals' : '## Public projects, work artifacts, and role signals',
    ...(isCommercialArchetype(archetype)
      ? (commercial.length > 0 ? commercial.map((line) => `- ${line}`) : ['- No strong public commercial signals were found.'])
      : ((collectWorkSignals(results).length > 0 ? collectWorkSignals(results).map((line) => `- ${line}`) : ['- Public work signals are limited in the current sources.']))),
    '',
    '## Public tools, platforms, or stack signals',
    ...(platform.length > 0 ? platform.map((line) => `- ${line}`) : ['- No clear public tool or platform signals were found.']),
    '',
    '## Public content, audience, and collaboration signals',
    ...(audience.length > 0 ? audience.map((line) => `- ${line}`) : ['- No strong public audience or collaboration signals were found.']),
    '',
    '## Recent public activity, ordered by date descending',
    ...(recent.length > 0 ? recent.map((line) => `- ${line}`) : ['- No dated recent activity was found.']),
    '',
    '## Open questions',
    ...(ambiguity.length > 0 ? ambiguity.map((line) => `- ${line}`) : ['- No major ambiguity remained after the gathered public signals.']),
    '',
    buildResearchAppendixForArchetype(archetype, results),
  ].filter(Boolean).join('\n');
}

export function collectProfileCandidates(results: SearchResult[]): string[] {
  return collectProfileLinks(results).map((link) => `${link.label}: ${link.url}${link.audienceCount ? ` | audience: ${link.audienceCount}` : ''} | ${truncateText(link.title, 90)}`);
}

export function collectRecentActivity(results: SearchResult[]): string[] {
  return uniqueDocuments(results)
    .filter((document) => Boolean(document.publishedAt))
    .sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)))
    .slice(0, 16)
    .map((document) => `${document.publishedAt} | ${document.title} | ${document.url} | ${truncateText(document.snippet, 140)}`);
}

export function formatSearchResult(result: SearchResult): string {
  if (result.documents.length === 0) return `Query: ${result.query}\nNo results found.`;
  return [
    `Query: ${result.query}`,
    ...result.documents.map((document, index) => [
      `${index + 1}. ${document.title}`,
      `URL: ${document.url}`,
      ...(document.publishedAt ? [`Published: ${document.publishedAt}`] : []),
      `Snippet: ${document.snippet}`,
      `Body: ${document.body}`,
    ].join('\n')),
  ].join('\n\n');
}

function collectProfileLinks(results: SearchResult[]): PublicResearchLink[] {
  const links = new Map<string, PublicResearchLink>();
  for (const document of uniqueDocuments(results)) {
    const label = profileLabel(document.url);
    if (!label || links.has(document.url)) continue;
    const audienceCount = extractAudienceCount(document);
    links.set(document.url, {
      label,
      url: document.url,
      title: document.title,
      ...(audienceCount ? { audienceCount } : {}),
    });
  }
  return [...links.values()];
}

function collectContactLocationClues(results: SearchResult[]): string[] {
  return uniqueDocuments(results)
    .flatMap((document) => {
      const text = `${document.snippet} ${document.body}`;
      const lines: string[] = [];
      const emailMatches = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0]);
      if (emailMatches.length > 0) {
        lines.push(`${document.title} | public contact: ${uniqueStrings(emailMatches).join(', ')} | ${document.url}`);
      }
      const locationMatch = text.match(/(?:based in|location says|is based in)\s+([^.,;]+(?:, [^.,;]+){0,2})/i);
      if (locationMatch?.[1]) {
        lines.push(`${document.title} | location clue: ${locationMatch[1].trim()} | ${document.url}`);
      }
      return lines;
    })
    .slice(0, 10);
}

function collectCommercialSignals(results: SearchResult[]): string[] {
  return uniqueDocuments(results)
    .flatMap((document) => {
      const text = `${document.snippet} ${document.body}`;
      if (!/pricing|mrr|subscription|sells|sold|package|plan|price|revenue|discount|enterprise|audit/i.test(text)) {
        return [];
      }
      return [`${document.title} | ${truncateText(text.replace(/\s+/g, ' ').trim(), 200)} | ${document.url}`];
    })
    .slice(0, 12);
}

function collectWorkSignals(results: SearchResult[]): string[] {
  return uniqueDocuments(results)
    .flatMap((document) => {
      const text = `${document.snippet} ${document.body}`;
      if (!/repository|repositories|maintainer|open-source|speaker|talk|benchmark|case study|project|release|research|workshop|demo|conference|role/i.test(text)) {
        return [];
      }
      if (/pricing|mrr|subscription|revenue|discount|enterprise tier|growth plan|starter €/i.test(text)) {
        return [];
      }
      return [`${document.title} | ${truncateText(text.replace(/\s+/g, ' ').trim(), 200)} | ${document.url}`];
    })
    .slice(0, 12);
}

function collectPlatformSignals(results: SearchResult[]): string[] {
  return uniqueDocuments(results)
    .flatMap((document) => {
      const text = `${document.snippet} ${document.body}`.toLowerCase();
      const matches = PLATFORM_KEYWORDS.filter((keyword) => text.includes(keyword));
      if (matches.length === 0) return [];
      return [`${document.title} | platforms: ${uniqueStrings(matches).join(', ')} | ${document.url}`];
    })
    .slice(0, 12);
}

function collectAudienceSignals(results: SearchResult[]): string[] {
  return uniqueDocuments(results)
    .flatMap((document) => {
      const text = `${document.snippet} ${document.body}`.toLowerCase();
      const matches = AUDIENCE_KEYWORDS.filter((keyword) => text.includes(keyword));
      if (matches.length === 0) return [];
      return [`${document.title} | public reach/activity: ${uniqueStrings(matches).join(', ')} | ${document.url}`];
    })
    .slice(0, 12);
}

function collectAmbiguityCandidates(results: SearchResult[]): string[] {
  return uniqueDocuments(results)
    .filter((document) => /different .*no references to|different .*with no reference/i.test(`${document.snippet} ${document.body}`))
    .map((document) => `${document.title} | ${truncateText(document.snippet, 140)} | ${document.url}`)
    .slice(0, 8);
}

function formatLinkSection(links: PublicResearchLink[]): string {
  if (links.length === 0) return '';
  return [
    '## Exact public profile URLs and audience counts',
    ...links.map((link) => `- ${link.label}: ${link.url}${link.audienceCount ? ` | audience: ${link.audienceCount}` : ''}`),
  ].join('\n');
}

function extractAudienceCount(document: SearchDocument): string | undefined {
  const text = `${document.title} ${document.snippet} ${document.body}`.replace(/\s+/g, ' ').trim();
  const match = text.match(/(\d[\d.,]*(?:\s?[kKmM])?\+?)\s*(followers|subscriber(?:s)?|readers)/i);
  if (!match) return undefined;
  const count = match[1];
  const unit = match[2];
  if (!count || !unit) return undefined;
  return `${count.trim()} ${unit.toLowerCase()}`;
}

function formatSimpleSection(title: string, lines: string[]): string {
  if (lines.length === 0) return '';
  return [
    `## ${title}`,
    ...lines.map((line) => `- ${line}`),
  ].join('\n');
}

function profileLabel(url: string): string | undefined {
  const lowered = url.toLowerCase();
  return PROFILE_DOMAIN_LABELS.find((item) => lowered.includes(item.match))?.label;
}

function uniqueDocuments(results: SearchResult[]): SearchDocument[] {
  const seen = new Set<string>();
  const documents: SearchDocument[] = [];
  for (const result of results) {
    for (const document of result.documents) {
      if (seen.has(document.url)) continue;
      seen.add(document.url);
      documents.push(document);
    }
  }
  return documents;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isCommercialArchetype(archetype: ResearchArchetype): boolean {
  return archetype === 'indie_developer'
    || archetype === 'founder'
    || archetype === 'creator'
    || archetype === 'agency_owner';
}
