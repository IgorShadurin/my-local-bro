import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Ollama } from 'ollama';
import { HumanResearchRunner } from '../src/humanResearch/runner.js';
import { createSyntheticHumanResearchSearchAdapter } from '../src/humanResearch/synthetic.js';

interface TestCase {
  name: string;
  request: string;
  checks: string[];
  exactUrls: string[];
  audienceChecks?: string[];
  plannedAtLeast: number;
  forbidden?: string[];
}

const MODEL = 'gemma4:26b';
const HOST = process.env.OLLAMA_HOST?.trim() || 'http://127.0.0.1:11434';

const TEST_CASES: TestCase[] = [
  {
    name: 'nora-vale',
    request: 'Research Nora Vale with email nora@bluebirch.dev. Find public profiles, products, recent activity, pricing or MRR signals, and likely tools or platforms she uses.',
    checks: ['BlueBirch', 'FocusLeaf', 'MRR'],
    exactUrls: ['https://github.com/noravale', 'https://x.com/noravale_dev', 'https://www.producthunt.com/posts/focusleaf-2-0'],
    audienceChecks: ['2.4k followers', '8.1k followers'],
    plannedAtLeast: 6,
  },
  {
    name: 'omar-reed',
    request: 'Research Omar Reed and omar@patchworks.studio. Find public profiles, services sold, pricing, recent activity, and likely public platforms he uses.',
    checks: ['Patchworks Studio', 'design audit', 'Dribbble'],
    exactUrls: ['https://www.linkedin.com/in/omarreed/', 'https://dribbble.com/omarreed'],
    audienceChecks: ['12k followers', '9.2k followers'],
    plannedAtLeast: 6,
  },
  {
    name: 'mira-doss',
    request: 'Research Mira Doss with mira@ledgerlane.ai. Find public profiles, pricing, public MRR signals, recent activity, and likely tools or integrations.',
    checks: ['LedgerLane AI', 'QuickBooks', 'MRR'],
    exactUrls: ['https://www.linkedin.com/in/miradoss/', 'https://www.producthunt.com/posts/ledgerlane-ai'],
    audienceChecks: ['14k followers', '5.4k subscribers', '1.3k followers'],
    plannedAtLeast: 6,
  },
];

async function main(): Promise<void> {
  const outputDir = join(tmpdir(), `my-local-bro-human-research-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });

  const client = new Ollama({ host: HOST });
  const runner = new HumanResearchRunner(client, () => MODEL, createSyntheticHumanResearchSearchAdapter());
  const summaryLines = [
    `Model: ${MODEL}`,
    `Host: ${HOST}`,
    `Output: ${outputDir}`,
    '',
  ];

  for (const testCase of TEST_CASES) {
    console.log(`Running ${testCase.name}...`);
    const start = Date.now();
    const result = await runner.run({
      query: testCase.request,
      reportProgress: async (message) => {
        const firstLine = message.split('\n')[0] ?? message;
        console.log(`[${testCase.name}] ${firstLine}`);
      },
    });
    const durationMs = Date.now() - start;
    const report = result.report.reportMarkdown;
    const normalized = report.toLowerCase();

    if (result.plannedQueries.length < testCase.plannedAtLeast) {
      throw new Error(`${testCase.name}: expected at least ${testCase.plannedAtLeast} planned queries, got ${result.plannedQueries.length}`);
    }
    for (const check of testCase.checks) {
      if (!normalized.includes(check.toLowerCase())) {
        throw new Error(`${testCase.name}: final report missing required fragment "${check}"`);
      }
    }
    for (const exactUrl of testCase.exactUrls) {
      if (!report.includes(exactUrl)) {
        throw new Error(`${testCase.name}: final report missing exact URL "${exactUrl}"`);
      }
    }
    for (const audienceCheck of testCase.audienceChecks ?? []) {
      if (!report.includes(audienceCheck)) {
        throw new Error(`${testCase.name}: final report missing audience count "${audienceCheck}"`);
      }
    }
    for (const forbidden of testCase.forbidden ?? []) {
      if (normalized.includes(forbidden.toLowerCase())) {
        throw new Error(`${testCase.name}: final report contains forbidden fragment "${forbidden}"`);
      }
    }
    if (!normalized.includes('exact public profile urls and audience counts')) {
      throw new Error(`${testCase.name}: final report missing exact public profile URL and audience count section`);
    }

    await writeFile(join(outputDir, `${testCase.name}.md`), `${report}\n`, 'utf8');
    await writeFile(join(outputDir, `${testCase.name}.json`), `${JSON.stringify({
      request: testCase.request,
      subjectLabel: result.subjectLabel,
      plannedQueries: result.plannedQueries,
      answers: result.answers,
      artifact: {
        fileName: result.artifact.fileName,
        mimeType: result.artifact.mimeType,
        bytes: result.artifact.data.length,
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(join(outputDir, `${testCase.name}.pdf`), result.artifact.data);

    summaryLines.push(
      `${testCase.name}: ok`,
      `  duration_ms=${durationMs}`,
      `  subject=${result.subjectLabel}`,
      `  planned_queries=${result.plannedQueries.length}`,
      ...result.plannedQueries.map((query, index) => `  q${index + 1}=${query}`),
      '',
    );
  }

  await writeFile(join(outputDir, 'summary.txt'), `${summaryLines.join('\n')}\n`, 'utf8');
  console.log(`Human research tests passed. Output: ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
