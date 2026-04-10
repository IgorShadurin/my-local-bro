import type { ResearchSourceHint } from './types.js';

const GLOBAL_HINTS: ResearchSourceHint[] = [
  { label: 'LinkedIn', reason: 'Professional roles, company, public career history, sometimes location.' },
  { label: 'GitHub or GitLab', reason: 'Repositories, projects, commit activity, public profile bio, organization links.' },
  { label: 'X or Twitter', reason: 'Recent public activity, product launches, links to other profiles, stated roles.' },
  { label: 'Personal site or company site', reason: 'Canonical identity match, biography, products, services, contact clues.' },
  { label: 'Product Hunt', reason: 'Maker profiles, launches, products, changelog-style activity.' },
  { label: 'Indie Hackers', reason: 'Public products, MRR or revenue notes, shipping logs, founder context.' },
  { label: 'App Store or Google Play', reason: 'App portfolio, pricing model, publisher name, recent releases.' },
  { label: 'Gumroad, Lemon Squeezy, Patreon, OpenCollective', reason: 'Publicly visible products, subscriptions, donations, pricing.' },
  { label: 'YouTube, Substack, Medium, DEV, Hacker News', reason: 'Recent writing, talks, launches, technical or creator activity.' },
];

const COUNTRY_HINTS: Record<string, ResearchSourceHint[]> = {
  uk: [{ label: 'Companies House', reason: 'Official UK company registry for directors and officers.' }],
  'united kingdom': [{ label: 'Companies House', reason: 'Official UK company registry for directors and officers.' }],
  india: [{ label: 'MCA', reason: 'Indian Ministry of Corporate Affairs registry for companies and directors.' }],
  estonia: [{ label: 'e-Business Register', reason: 'Public company registry useful for founder or officer matching.' }],
  germany: [{ label: 'Unternehmensregister', reason: 'German company registry for public corporate roles.' }],
};

export function sourceHints(country?: string): ResearchSourceHint[] {
  const key = country?.trim().toLowerCase();
  return key ? [...GLOBAL_HINTS, ...(COUNTRY_HINTS[key] ?? [])] : [...GLOBAL_HINTS];
}

export function sourceHintsText(country?: string): string {
  return sourceHints(country).map((hint) => `- ${hint.label}: ${hint.reason}`).join('\n');
}
