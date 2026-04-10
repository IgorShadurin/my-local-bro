import { truncateText } from '../util/text.js';
import type { HumanResearchSearchAdapter, SearchDocument, SearchResult } from './types.js';

const SYNTHETIC_DOCUMENTS: SearchDocument[] = [
  {
    title: 'Nora Vale, BlueBirch developer profile',
    url: 'https://bluebirch.dev/about',
    snippet: 'Nora Vale builds indie iOS and macOS tools at BlueBirch. Based in Tallinn, Estonia. Contact: nora@bluebirch.dev.',
    body: 'Nora Vale is the solo founder of BlueBirch, an indie app studio based in Tallinn, Estonia. She builds iOS and macOS productivity apps, writes a weekly shipping log, and shares product lessons in public. Her public contact address is nora@bluebirch.dev. BlueBirch products include FocusLeaf, DraftRadar, and Birch Clipper. She lists GitHub, X, Product Hunt, Indie Hackers, Gumroad, and the Apple App Store as her main public channels.',
    publishedAt: '2026-02-10',
  },
  {
    title: 'Nora Vale on Indie Hackers',
    url: 'https://www.indiehackers.com/post/nora-vale-mrr-update',
    snippet: 'Nora Vale says FocusLeaf and DraftRadar now make €4.2k MRR combined.',
    body: 'Indie developer Nora Vale posted a public update saying that FocusLeaf and DraftRadar now make about €4.2k MRR combined. She sells a Figma template pack on Gumroad and uses Product Hunt and X for launches. She links back to bluebirch.dev and github.com/noravale. Recent activity mentioned a January 2026 FocusLeaf 2.0 launch and a February 2026 DraftRadar pricing refresh.',
    publishedAt: '2026-02-03',
  },
  {
    title: 'GitHub - noravale',
    url: 'https://github.com/noravale',
    snippet: 'Public repositories for FocusLeaf, Birch Clipper, and DraftRadar. About 2.4k followers.',
    body: 'GitHub profile for Nora Vale. Bio: solo founder at BlueBirch, shipping calm productivity software. Repositories include focusleaf-ios, birch-clipper, and draftradar. The profile links to bluebirch.dev and X handle @noravale_dev, and shows about 2.4k followers. Recent commits in March 2026 mention sync fixes and a paywall cleanup.',
    publishedAt: '2026-03-21',
  },
  {
    title: 'Product Hunt launch - FocusLeaf 2.0',
    url: 'https://www.producthunt.com/posts/focusleaf-2-0',
    snippet: 'Maker Nora Vale launched FocusLeaf 2.0.',
    body: 'FocusLeaf 2.0 launched on Product Hunt by maker Nora Vale. The launch page links to bluebirch.dev, the App Store listing, and @noravale_dev. Comments mention a yearly subscription and a lifetime launch discount. The maker answer says she is based in Estonia and is building in public.',
    publishedAt: '2026-01-14',
  },
  {
    title: 'Gumroad - Birch Systems Pack',
    url: 'https://gumroad.com/l/birch-systems-pack',
    snippet: 'Nora Vale sells a systems template pack for €49.',
    body: 'The Birch Systems Pack is a Gumroad product sold by Nora Vale for €49. The product page links to bluebirch.dev and describes it as the same planning system used to run FocusLeaf launches. Public seller information matches BlueBirch and nora@bluebirch.dev.',
    publishedAt: '2025-12-09',
  },
  {
    title: 'X profile - @noravale_dev',
    url: 'https://x.com/noravale_dev',
    snippet: 'Shipping FocusLeaf and DraftRadar in public. Around 8.1k followers.',
    body: 'X profile for Nora Vale, handle @noravale_dev. Bio says solo founder at BlueBirch, building FocusLeaf and DraftRadar in Tallinn. The profile shows around 8.1k followers. Recent public posts mention shipping a March 2026 sync fix, a February 2026 pricing update, and experimenting with Lemon Squeezy for web sales.',
    publishedAt: '2026-03-18',
  },
  {
    title: 'BlueBirch newsletter archive',
    url: 'https://bluebirch.dev/newsletter',
    snippet: 'Nora Vale publishes a weekly shipping log and launch notes.',
    body: 'BlueBirch newsletter archive by Nora Vale. It includes weekly shipping logs, launch retrospectives, and short audience notes from productivity-app users. The newsletter signup page says roughly 3.2k subscribers. Public links point to FocusLeaf, DraftRadar, Product Hunt, and @noravale_dev.',
    publishedAt: '2026-03-11',
  },
  {
    title: 'FocusLeaf on the App Store',
    url: 'https://apps.apple.com/app/focusleaf/id123456789',
    snippet: 'FocusLeaf subscription app by BlueBirch.',
    body: 'App Store listing for FocusLeaf by BlueBirch. The store page shows Nora Vale as the publisher, links to bluebirch.dev/support, and mentions subscription billing with a yearly plan.',
    publishedAt: '2026-01-14',
  },
  {
    title: 'Nora Vale, product designer',
    url: 'https://www.linkedin.com/in/nora-vale-design/',
    snippet: 'Freelance product designer in Toronto.',
    body: 'This is a different Nora Vale, a freelance product designer in Toronto. No references to BlueBirch, Estonia, productivity apps, or nora@bluebirch.dev.',
    publishedAt: '2025-11-01',
  },
  {
    title: 'Omar Reed, Patchworks Studio',
    url: 'https://patchworks.studio/about',
    snippet: 'Omar Reed runs Patchworks Studio and sells design audits and UI systems.',
    body: 'Omar Reed is the founder of Patchworks Studio. He publishes case studies, sells design audits, and offers a UI kit subscription. Public contact address is omar@patchworks.studio. He links to Dribbble, Behance, LinkedIn, and a Substack newsletter. He is based in Manchester, United Kingdom.',
    publishedAt: '2026-01-05',
  },
  {
    title: 'Patchworks Studio pricing',
    url: 'https://patchworks.studio/pricing',
    snippet: 'Design audit from £600, UI system package from £2,400.',
    body: 'Patchworks Studio pricing page lists a design audit at £600 and a UI system package starting at £2,400. Omar Reed also sells a monthly component library subscription for £29. The page links to omar@patchworks.studio and a Gumroad pack called Interface Notes.',
    publishedAt: '2026-02-11',
  },
  {
    title: 'Omar Reed on Substack',
    url: 'https://omarreed.substack.com/p/march-notes',
    snippet: 'Recent notes on client work, component systems, and new kit release.',
    body: 'Omar Reed writes a monthly Substack with roughly 4.8k subscribers. In March 2026 he wrote about shipping a new interface kit, redesigning a SaaS billing screen, and preparing a London workshop. He linked to Dribbble shots and a Behance case study.',
    publishedAt: '2026-03-07',
  },
  {
    title: 'LinkedIn - Omar Reed',
    url: 'https://www.linkedin.com/in/omarreed/',
    snippet: 'Founder at Patchworks Studio in Manchester.',
    body: 'LinkedIn profile for Omar Reed. Founder of Patchworks Studio in Manchester, United Kingdom. The profile shows about 12k followers and links to patchworks.studio, Dribbble, and Behance. Recent updates mention a London workshop and a billing redesign case study.',
    publishedAt: '2026-02-28',
  },
  {
    title: 'Dribbble - Omar Reed',
    url: 'https://dribbble.com/omarreed',
    snippet: 'Interface systems, billing redesign, SaaS flows.',
    body: 'Dribbble profile for Omar Reed showing interface systems, billing redesign shots, and public links back to Patchworks Studio. The profile shows around 9.2k followers and promotes a component library subscription and workshop seats.',
    publishedAt: '2026-03-02',
  },
  {
    title: 'Behance - Patchworks billing case study',
    url: 'https://www.behance.net/gallery/patchworks-billing-redesign',
    snippet: 'Detailed SaaS billing redesign by Omar Reed.',
    body: 'Behance case study by Omar Reed on a SaaS billing redesign. The public page links to Patchworks Studio, Dribbble, and the March workshop signup. Omar Reed has around 18k followers on Behance. It highlights design-system work, client collaboration, and reusable billing components.',
    publishedAt: '2026-03-04',
  },
  {
    title: 'Mira Doss, LedgerLane AI founder',
    url: 'https://ledgerlane.ai/founder',
    snippet: 'Mira Doss is founder and CEO of LedgerLane AI.',
    body: 'Mira Doss is the founder and CEO of LedgerLane AI, a finance operations SaaS company. Public contact is mira@ledgerlane.ai. She shares product updates on LinkedIn and YouTube, lists integrations with Stripe and QuickBooks, and publishes pricing publicly. She is based in Berlin, Germany.',
    publishedAt: '2026-02-20',
  },
  {
    title: 'LedgerLane AI pricing',
    url: 'https://ledgerlane.ai/pricing',
    snippet: 'Starter €79, Growth €249, public team plan by quote.',
    body: 'LedgerLane AI pricing page lists Starter at €79, Growth at €249, and a public enterprise tier by quote. A founder interview linked on the page mentions roughly €12k MRR in public as of February 2026. The site also links to Product Hunt and a public changelog.',
    publishedAt: '2026-02-22',
  },
  {
    title: 'Mira Doss on LinkedIn',
    url: 'https://www.linkedin.com/in/miradoss/',
    snippet: 'Founder at LedgerLane AI, former finance systems lead.',
    body: 'LinkedIn profile for Mira Doss. Founder at LedgerLane AI. The profile shows around 14k followers. Recent public posts mention a Product Hunt launch, customer interviews, and a new QuickBooks sync. Profile location says Berlin, Germany.',
    publishedAt: '2026-03-02',
  },
  {
    title: 'YouTube - LedgerLane AI demo',
    url: 'https://youtube.com/watch?v=ledgerlane-demo',
    snippet: 'Mira Doss demos invoice reconciliation workflows.',
    body: 'A public YouTube demo by Mira Doss shows LedgerLane AI invoice reconciliation, anomaly flags, and QuickBooks syncing. Mira Doss has about 5.4k subscribers on YouTube. The description links to ledgerlane.ai, Product Hunt, and LinkedIn.',
    publishedAt: '2026-03-18',
  },
  {
    title: 'Product Hunt - LedgerLane AI',
    url: 'https://www.producthunt.com/posts/ledgerlane-ai',
    snippet: 'Mira Doss launched LedgerLane AI on Product Hunt.',
    body: 'Product Hunt launch page for LedgerLane AI by maker Mira Doss. The maker profile has about 1.3k followers on Product Hunt. The page links to ledgerlane.ai, LinkedIn, and a public changelog. Comments mention finance operators as the target audience and a launch discount on the Growth plan.',
    publishedAt: '2026-02-25',
  },
  {
    title: 'LedgerLane AI changelog',
    url: 'https://ledgerlane.ai/changelog',
    snippet: 'Public changelog with QuickBooks sync, anomaly flags, and Stripe import.',
    body: 'LedgerLane AI public changelog includes a QuickBooks sync release, Stripe import support, and a March 2026 anomaly-flag update. It links to the pricing page and YouTube demo.',
    publishedAt: '2026-03-16',
  },
  {
    title: 'Mira Doss, recruiter profile',
    url: 'https://www.linkedin.com/in/mira-doss-recruiting/',
    snippet: 'Talent partner in Austin.',
    body: 'This is a different Mira Doss with no reference to LedgerLane AI, Berlin, finance SaaS, or mira@ledgerlane.ai.',
    publishedAt: '2025-10-02',
  },
  {
    title: 'Lena Hart, OSS maintainer',
    url: 'https://lenahart.dev/about',
    snippet: 'Lena Hart is an open-source maintainer and systems researcher based in Helsinki, Finland.',
    body: 'Lena Hart is an open-source maintainer and systems researcher based in Helsinki, Finland. Public contact address is lena@lenahart.dev. She maintains the Aurora Queue project, speaks at reliability meetups, and publishes technical notes and benchmarks. The profile links to GitHub, Mastodon, YouTube, and a conference talk archive.',
    publishedAt: '2026-02-09',
  },
  {
    title: 'GitHub - lenahart',
    url: 'https://github.com/lenahart',
    snippet: 'Maintainer of Aurora Queue and related systems tooling.',
    body: 'GitHub profile for Lena Hart. Bio: open-source maintainer, systems researcher, and conference speaker. Repositories include aurora-queue, queuebench, and retry-lab. Public links point to lenahart.dev, Mastodon, and YouTube. Recent commits in March 2026 mention queue latency charts and test harness work.',
    publishedAt: '2026-03-19',
  },
  {
    title: 'Mastodon - @lena@fosstodon.org',
    url: 'https://fosstodon.org/@lena',
    snippet: 'Distributed systems notes, conference talks, and release links.',
    body: 'Mastodon profile for Lena Hart with public release notes, conference updates, and reliability charts. Recent posts mention a talk in Berlin, an Aurora Queue release candidate, and benchmark writeups.',
    publishedAt: '2026-03-14',
  },
  {
    title: 'Lena Hart conference talk archive',
    url: 'https://lenahart.dev/talks',
    snippet: 'Talks on distributed queues, reliability, and test harnesses.',
    body: 'Public talk archive for Lena Hart. Includes talks in Helsinki, Berlin, and online reliability meetups. Slides link to GitHub repositories and benchmark dashboards. No public pricing, subscriptions, products sold, or revenue claims appear on the page.',
    publishedAt: '2026-02-20',
  },
  {
    title: 'YouTube - Aurora Queue deep dive',
    url: 'https://youtube.com/watch?v=aurora-queue-deep-dive',
    snippet: 'Lena Hart explains Aurora Queue internals and benchmark methodology.',
    body: 'A public YouTube technical talk by Lena Hart about Aurora Queue internals, benchmark methodology, and release tradeoffs. The description links to GitHub, Mastodon, and her talks page.',
    publishedAt: '2026-03-25',
  },
];

export function createSyntheticHumanResearchSearchAdapter(): HumanResearchSearchAdapter {
  return {
    providerName: 'synthetic',
    async search(query: string): Promise<SearchResult> {
      const ranked = SYNTHETIC_DOCUMENTS
        .map((document) => ({ document, score: scoreDocument(query, document) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((entry) => entry.document);
      return { query, documents: ranked };
    },
  };
}

function scoreDocument(query: string, document: SearchDocument): number {
  const tokens = tokenize(query);
  const haystack = tokenize([document.title, document.url, document.snippet, document.body, document.publishedAt ?? ''].join(' '));
  let score = 0;
  for (const token of tokens) {
    if (haystack.has(token)) score += token.length > 6 ? 3 : 2;
    if (document.url.toLowerCase().includes(token)) score += 1;
  }
  return score;
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9@._-]+/i).map((token) => token.trim()).filter((token) => token.length >= 2));
}

export function syntheticDatasetSummary(): string {
  return SYNTHETIC_DOCUMENTS.map((document) => `${document.title} | ${truncateText(document.body, 140)}`).join('\n');
}
