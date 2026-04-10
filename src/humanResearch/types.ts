export interface ResearchSourceHint {
  label: string;
  reason: string;
}

export interface ResearchQuestion {
  id: string;
  question: string;
  searchQuery: string;
}

export type ResearchArchetype =
  | 'indie_developer'
  | 'founder'
  | 'creator'
  | 'agency_owner'
  | 'executive'
  | 'employee'
  | 'researcher'
  | 'open_source_maintainer'
  | 'investor'
  | 'unknown';

export interface ResearchPlan {
  subjectLabel: string;
  archetype: ResearchArchetype;
  country?: string;
  questions: ResearchQuestion[];
}

export interface SearchDocument {
  title: string;
  url: string;
  snippet: string;
  body: string;
  publishedAt?: string;
}

export interface SearchResult {
  query: string;
  documents: SearchDocument[];
}

export interface ResearchAnswer {
  questionId: string;
  question: string;
  searchQuery: string;
  summary: string;
}

export interface ResearchReport {
  subjectLabel: string;
  reportMarkdown: string;
}

export interface HumanResearchSearchAdapter {
  providerName: string;
  search(query: string, signal?: AbortSignal): Promise<SearchResult>;
}

export interface PublicResearchLink {
  label: string;
  url: string;
  title: string;
  audienceCount?: string;
}
