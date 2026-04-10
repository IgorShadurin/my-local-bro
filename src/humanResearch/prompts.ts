import { sourceHintsText } from './sourceHints.js';

export function researchPlanPrompt(country?: string): string {
  return [
    'You create a public-profile research plan for a person.',
    'Return strict JSON only.',
    'The input may contain a name, email, company, role, country, and free-form notes.',
    'Research only public professional or creator information. Do not look for home addresses, phone numbers, personal family details, government IDs, private financial data, or private purchase history.',
    'Prefer public profiles, products, projects, pricing pages, launch pages, public interviews, public writing, public talks, and public professional registries.',
    'Always include queries that help identify the correct public profiles and queries that look for public activity, products or services, and social profiles.',
    'Always try to find exact public profile URLs for relevant networks and platforms such as LinkedIn, GitHub, X, YouTube, Substack, Product Hunt, Indie Hackers, Dribbble, Behance, Gumroad, Lemon Squeezy, App Store, or Google Play when those platforms are relevant to the person.',
    'For commercial or audience-driven archetypes such as indie_developer, founder, creator, or agency_owner, also try to find public follower, subscriber, or audience counts for each relevant social or platform profile.',
    'The plan must cover these key points when public data exists: canonical identity match, current role or company, public location or country clues, public social or platform profiles, recent public activity, products or services, public pricing or monetization signals, public tools or platform signals, public content channels or audience signals, public collaboration or workshop signals, and ambiguity resolution when multiple profiles exist.',
    'First classify the person into one archetype: indie_developer, founder, creator, agency_owner, executive, employee, researcher, open_source_maintainer, investor, or unknown.',
    'Only emphasize pricing, MRR, product sales, subscriptions, sponsorships, or commercial package details when the archetype suggests they are relevant, such as indie_developer, founder, creator, or agency_owner.',
    'For archetypes such as researcher, employee, executive, or open_source_maintainer, focus more on role, projects, publications, talks, public code, communities, and recent activity unless commercial signals are explicitly part of the request.',
    'Use 6 to 10 questions. Each question must have one focused search query.',
    'One question equals one search query and one later summarized answer.',
    'Write concise search phrases, not long sentences.',
    'If the input names several clues, use them in the search queries to reduce ambiguity.',
    'JSON shape: {"subjectLabel":"...","archetype":"one_of_the_allowed_values","country":"optional","questions":[{"id":"q1","question":"...","searchQuery":"..."}]}.',
    'Suggested public sources and hints:',
    sourceHintsText(country),
  ].join('\n');
}

export const RESEARCH_ANSWER_PROMPT = [
  'You summarize one public-profile research question for a person.',
  'Return strict JSON only in the shape {"summary":"..."}.',
  'Use only the provided search results and do not invent facts.',
  'Summarize the answer to the question, mention ambiguity if several profiles conflict, and explain which profile seems most likely and why.',
  'If a search result reveals a public social or platform profile URL, products, pricing, recent activity, public MRR, or platform/tool usage, keep those details when relevant to the question.',
  'Keep it concise but information-dense. Mention public products, services, roles, or public revenue signals only when the data supports them.',
  'Do not include private or sensitive personal data.',
].join('\n');

export const FOLLOW_UP_PLAN_PROMPT = [
  'You decide whether more public-profile research queries are needed after the first pass.',
  'Return strict JSON only in the shape {"queries":[{"id":"f1","question":"...","searchQuery":"..."}]}',
  'Use 0 to 4 follow-up queries.',
  'Add follow-up queries when you need to verify the correct profile, resolve ambiguity between several profiles, inspect a likely social profile, or find public recent activity, products, pricing, public monetization signals, public audience or content channels, or public collaboration/workshop signals that are still missing.',
  'For indie_developer, founder, creator, or agency_owner archetypes, add follow-up queries when exact public social URLs were found but public follower or subscriber counts are still missing.',
  'If exact public profile URLs are still missing for relevant networks, add follow-up queries to find them.',
  'Respect the subject archetype: do not chase pricing or MRR follow-ups for non-commercial archetypes unless the request explicitly asked for that.',
  'Do not repeat an existing query unless it needs a more precise target.',
  'Use concise search phrases.',
].join('\n');

export const FINAL_REPORT_PROMPT = [
  'You write a final public-profile research report for a person.',
  'Write the report in English.',
  'Use only the provided research answers and hints.',
  'Do not add facts that are not grounded in the provided summaries.',
  'Respect the subject archetype.',
  'If the archetype is indie_developer, founder, creator, or agency_owner, do not omit public commercial facts that were found. If public pricing, product names, service packages, subscription amounts, launch offers, or public MRR figures were found, include them explicitly with the actual values.',
  'If the archetype is indie_developer, founder, creator, or agency_owner, include all relevant public social or platform profiles that were found and include their exact URLs plus any public follower, subscriber, or audience counts that were found for each profile.',
  'If the archetype is researcher, employee, executive, or open_source_maintainer, do not over-focus on commercial sections unless the request explicitly asked for them. In those cases, emphasize role, projects, publications, talks, repositories, communities, and recent work, and avoid mentioning MRR, pricing, subscriptions, or revenue unless they are clearly relevant and explicitly requested.',
  'Do not collapse concrete facts into generic wording. If the summaries contain specific prices, plans, products, projects, talks, repos, or public revenue figures, keep the actual details.',
  'Write Markdown with these sections in order:',
  '1. Subject',
  '2. Match confidence',
  '3. Public profile summary',
  '4. Public location and contact clues',
  '5. Public social and platform profiles',
  '6. Public products, services, and commercial signals',
  '7. Public tools, platforms, or stack signals',
  '8. Public content, audience, and collaboration signals',
  '9. Recent public activity, ordered by date descending',
  '10. Open questions',
  'For Public social and platform profiles, include exact URLs when available. For indie_developer, founder, creator, or agency_owner archetypes, include public follower, subscriber, or audience counts for each relevant profile when available.',
  'Also include a deterministic appendix section titled exactly "## Exact public profile URLs and audience counts" when those exact URLs or counts are present.',
  'Adapt the balance of sections to the archetype so irrelevant sections stay brief and relevant sections carry the detail.',
  'If there is ambiguity between multiple profiles, explain it clearly in Match confidence and Open questions.',
  'Do not include private or sensitive data.',
  'Use concise bullets and short paragraphs.',
].join('\n');
