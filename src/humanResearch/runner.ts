import type { Message, Ollama } from 'ollama';
import { ResearchProgress, extractJson, mapLimit, normalizeQuery, parseArchetype, parseQuestion, slugify, stepLabel, uniqueQueries, uniqueQuestionQueries } from './helpers.js';
import { buildResearchPdf } from './pdf.js';
import { buildFallbackReport, buildResearchAppendixForArchetype, collectProfileCandidates, collectRecentActivity, formatSearchResult } from './insights.js';
import { FINAL_REPORT_PROMPT, FOLLOW_UP_PLAN_PROMPT, RESEARCH_ANSWER_PROMPT, researchPlanPrompt } from './prompts.js';
import type {
  HumanResearchSearchAdapter,
  ResearchAnswer,
  ResearchPlan,
  ResearchQuestion,
  ResearchReport,
  SearchResult,
} from './types.js';
import { sourceHintsText } from './sourceHints.js';
import type { TelegramDocumentArtifact } from '../tools/types.js';
import { truncateText } from '../util/text.js';

export interface HumanResearchRunOptions {
  query: string;
  country?: string;
  reportProgress?: (message: string) => Promise<void>;
  signal?: AbortSignal;
}

export interface HumanResearchRunResult {
  subjectLabel: string;
  plannedQueries: string[];
  answers: ResearchAnswer[];
  report: ResearchReport;
  artifact: TelegramDocumentArtifact;
}

export class HumanResearchRunner {
  constructor(
    private readonly client: Ollama,
    private readonly model: () => string,
    private readonly search: HumanResearchSearchAdapter,
  ) {}

  async run(options: HumanResearchRunOptions): Promise<HumanResearchRunResult> {
    this.throwIfAborted(options.signal);
    const progress = new ResearchProgress(options.reportProgress);
    const plan = await this.buildPlan(options.query, options.country, options.signal);
    const initialQueries = uniqueQueries(plan.questions.map((question) => question.searchQuery));
    progress.setTotal(4 + plan.questions.length * 2);
    await progress.step('Planning research');

    const firstPass = await this.answerQuestions(plan.subjectLabel, plan.questions, progress, options.signal);
    await progress.step('Evaluating follow-up research');
    this.throwIfAborted(options.signal);
    const followUpQuestions = await this.buildFollowUpQuestions(options.query, plan, firstPass.answers, options.signal);
    progress.setTotal(4 + plan.questions.length * 2 + followUpQuestions.length * 2);
    const secondPass = followUpQuestions.length > 0
      ? await this.answerQuestions(plan.subjectLabel, followUpQuestions, progress, options.signal)
      : { answers: [], results: [] as SearchResult[] };

    const allAnswers = [...firstPass.answers, ...secondPass.answers];
    const allResults = [...firstPass.results, ...secondPass.results];
    const plannedQueries = uniqueQueries([
      ...initialQueries,
      ...followUpQuestions.map((question) => question.searchQuery),
    ]);
    await progress.step('Building final report');
    this.throwIfAborted(options.signal);
    const report = await this.buildFinalReport(options.query, plan, allAnswers, allResults, options.signal);
    await progress.step('Generating PDF');
    this.throwIfAborted(options.signal);
    const artifact = await this.buildArtifact(report);

    return {
      subjectLabel: plan.subjectLabel,
      plannedQueries,
      answers: allAnswers,
      report,
      artifact,
    };
  }

  private async buildPlan(query: string, country?: string, signal?: AbortSignal): Promise<ResearchPlan> {
    const parsed = await this.chatJson<{ subjectLabel?: unknown; archetype?: unknown; country?: unknown; questions?: unknown }>([
      { role: 'system', content: researchPlanPrompt(country) },
      { role: 'user', content: query },
    ], 'high', 'human research plan JSON', signal);
    const subjectLabel = typeof parsed.subjectLabel === 'string' && parsed.subjectLabel.trim()
      ? parsed.subjectLabel.trim()
      : truncateText(query, 120);
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.flatMap((question, index) => parseQuestion(question, index))
      : [];
    if (questions.length === 0) {
      throw new Error('human research plan did not return any research questions');
    }
    return {
      subjectLabel,
      archetype: parseArchetype(parsed.archetype),
      ...(typeof parsed.country === 'string' && parsed.country.trim() ? { country: parsed.country.trim() } : {}),
      questions: uniqueQuestionQueries(questions).slice(0, 10),
    };
  }

  private async buildFollowUpQuestions(
    originalQuery: string,
    plan: ResearchPlan,
    answers: ResearchAnswer[],
    signal?: AbortSignal,
  ): Promise<ResearchQuestion[]> {
    const parsed = await this.chatJson<{ queries?: unknown } | unknown[]>([
      { role: 'system', content: FOLLOW_UP_PLAN_PROMPT },
      {
        role: 'user',
        content: [
          `Original request: ${originalQuery}`,
          `Subject: ${plan.subjectLabel}`,
          `Archetype: ${plan.archetype}`,
          `Country: ${plan.country ?? 'unknown'}`,
          'Initial answers:',
          answers.map((answer) => [
            `Question: ${answer.question}`,
            `Search query: ${answer.searchQuery}`,
            `Summary: ${answer.summary}`,
          ].join('\n')).join('\n\n'),
          'Return only JSON.',
        ].join('\n\n'),
      },
    ], 'medium', 'human research follow-up JSON', signal);
    const existing = new Set(plan.questions.map((question) => normalizeQuery(question.searchQuery)));
    const rawQueries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.queries)
        ? parsed.queries
        : [];
    const followUps = rawQueries.length > 0
      ? rawQueries.flatMap((question, index) => parseQuestion(question, index))
      : [];
    return uniqueQuestionQueries(followUps)
      .filter((question) => !existing.has(normalizeQuery(question.searchQuery)))
      .slice(0, 4);
  }

  private async answerQuestions(
    subjectLabel: string,
    questions: ResearchQuestion[],
    progress: ResearchProgress,
    signal?: AbortSignal,
  ): Promise<{
    answers: ResearchAnswer[];
    results: SearchResult[];
  }> {
    const results = await mapLimit(questions, 3, async (question) => {
      this.throwIfAborted(signal);
      await progress.step(`Searching ${stepLabel(question)}`);
      this.throwIfAborted(signal);
      return this.search.search(question.searchQuery, signal);
    });
    const answers = await mapLimit(questions, 2, async (question, index) => {
      this.throwIfAborted(signal);
      const result = results[index]!;
      await progress.step(`Summarizing ${stepLabel(question)}`);
      this.throwIfAborted(signal);
      const parsed = await this.chatJson<{ summary?: unknown }>([
        { role: 'system', content: RESEARCH_ANSWER_PROMPT },
        {
          role: 'user',
          content: [
            `Subject: ${subjectLabel}`,
            `Question: ${question.question}`,
            `Search query: ${question.searchQuery}`,
            'Search results:',
            formatSearchResult(result),
            'Return only JSON.',
          ].join('\n\n'),
        },
      ], false, 'human research answer JSON', signal);
      const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : 'No grounded public answer could be summarized from the provided search results.';
      return {
        questionId: question.id,
        question: question.question,
        searchQuery: question.searchQuery,
        summary,
      };
    });
    return { answers, results };
  }

  private async buildFinalReport(
    originalQuery: string,
    plan: ResearchPlan,
    answers: ResearchAnswer[],
    results: SearchResult[],
    signal?: AbortSignal,
  ): Promise<ResearchReport> {
    const prompt = [
      `Original request: ${originalQuery}`,
      `Subject: ${plan.subjectLabel}`,
      `Archetype: ${plan.archetype}`,
      `Country: ${plan.country ?? 'unknown'}`,
      'Suggested public sources:',
      sourceHintsText(plan.country),
      'Extracted public profile candidates:',
      collectProfileCandidates(results).join('\n') || '- none',
      'Recent dated public activity candidates:',
      collectRecentActivity(results).join('\n') || '- none',
      'Research answers:',
      answers.map((answer) => [
        `Question: ${answer.question}`,
        `Search query: ${answer.searchQuery}`,
        `Summary: ${answer.summary}`,
      ].join('\n')).join('\n\n'),
    ].join('\n\n');
    let content = '';
    try {
      content = await this.chat([
        { role: 'system', content: FINAL_REPORT_PROMPT },
        { role: 'user', content: prompt },
      ], 'high', signal);
    } catch {
      content = buildFallbackReport(plan.subjectLabel, plan.archetype, answers, results);
    }
    const appendix = buildResearchAppendixForArchetype(plan.archetype, results);
    return {
      subjectLabel: plan.subjectLabel,
      reportMarkdown: appendix && !content.includes('## Exact public profile URLs and audience counts') ? `${content.trim()}\n\n${appendix}` : content.trim(),
    };
  }

  private async buildArtifact(report: ResearchReport): Promise<TelegramDocumentArtifact> {
    const fileName = `${slugify(report.subjectLabel) || 'human-research'}-report.pdf`;
    return {
      kind: 'telegram_document',
      fileName,
      mimeType: 'application/pdf',
      data: await buildResearchPdf(`Human Research Report: ${report.subjectLabel}`, report.reportMarkdown),
      caption: `Human research report: **${report.subjectLabel}**`,
    };
  }

  private async chat(
    messages: Message[],
    think: boolean | 'high' | 'medium' | 'low',
    signal?: AbortSignal,
  ): Promise<string> {
    this.throwIfAborted(signal);
    const stream = await this.client.chat({
      model: this.model(),
      messages,
      think,
      stream: true,
      options: { num_ctx: 32768 },
    });
    const abortable = stream as AsyncIterable<{ message?: { content?: string } }> & { abort?: () => void };
    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      abortable.abort?.();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let content = '';
      for await (const chunk of abortable) {
        if (aborted) this.throwIfAborted(signal);
        content += chunk.message?.content ?? '';
      }
      this.throwIfAborted(signal);
      return content;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private async chatJson<T>(
    messages: Message[],
    think: boolean | 'high' | 'medium' | 'low',
    label: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const content = await this.chat(messages, think, signal);
    return this.parseJson<T>(content, label, signal);
  }

  private async parseJson<T>(content: string, label: string, signal?: AbortSignal): Promise<T> {
    const extracted = extractJson(content);
    if (!extracted) {
      const repaired = await this.repairJson(content, label, signal);
      return JSON.parse(repaired) as T;
    }
    try {
      return JSON.parse(extracted) as T;
    } catch {
      const repaired = await this.repairJson(extracted, label, signal);
      return JSON.parse(repaired) as T;
    }
  }

  private async repairJson(content: string, label: string, signal?: AbortSignal): Promise<string> {
    const repaired = await this.chat([
      {
        role: 'system',
        content: [
          'You repair malformed JSON.',
          'Return only valid JSON.',
          'Do not change the meaning.',
          'Do not add commentary.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Repair this malformed ${label}:`,
          content,
        ].join('\n\n'),
      },
    ], false, signal);
    const extracted = extractJson(repaired);
    if (!extracted) {
      throw new Error(`human research model did not return JSON: ${truncateText(content, 500)}`);
    }
    return extracted;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const error = new Error('human research cancelled');
      error.name = 'AbortError';
      throw error;
    }
  }
}
