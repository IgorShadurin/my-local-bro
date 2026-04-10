import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Ollama } from 'ollama';
import { TRANSLATION_SYSTEM_PROMPT } from '../src/tools/translate.js';

interface Sample {
  id: string;
  from: 'Russian' | 'English';
  to: 'Russian' | 'English';
  text: string;
}

interface TranslationResult {
  model: string;
  sampleId: string;
  from: string;
  to: string;
  source: string;
  output: string;
  durationMs: number;
  checks: {
    hasLongDash: boolean;
    paragraphMismatch: boolean;
  };
}

const DEFAULT_MODELS = ['gemma4:26b', 'gemma4:e4b', 'gemma4:e2b', 'gpt-oss:20b'];
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

const SAMPLES: Sample[] = [
  {
    id: 'ru-01-personal-video-plan',
    from: 'Russian',
    to: 'English',
    text: 'Успешно провалил план по монтажу 15 видео.\n\nЗа вчерашний день отснял 15 шортов и рассчитывал смонтировать их. Отвел 2 часа на это, но отвлекся и получилось 3 из 15.\n\nСегодня все равно продолжаю съемки. Монтировать можно когда угодно - снимать только днем пока никого нет дома.',
  },
  {
    id: 'ru-02-focus-status',
    from: 'Russian',
    to: 'English',
    text: 'Я хотел быстро закрыть эту задачу, но в итоге весь день прыгал между мелочами. Сегодня нужно спокойно добить самое важное и не распыляться.',
  },
  {
    id: 'ru-03-product-note',
    from: 'Russian',
    to: 'English',
    text: 'В интерфейсе все вроде работает, но состояние после перезапуска выглядит неочевидно. Нужно сделать так, чтобы пользователь сразу понимал, какая модель сейчас активна.',
  },
  {
    id: 'ru-04-politeness-request',
    from: 'Russian',
    to: 'English',
    text: 'Сделай, пожалуйста, текст чуть спокойнее и не теряй смысл. Мне важно, чтобы он звучал по-человечески, а не как официальный отчет.',
  },
  {
    id: 'ru-05-travel-log',
    from: 'Russian',
    to: 'English',
    text: 'Вышел из дома поздно, но успел на поезд. В вагоне было тихо, поэтому я наконец разобрал заметки и составил план на неделю.',
  },
  {
    id: 'ru-06-technical-update',
    from: 'Russian',
    to: 'English',
    text: 'После обновления сервис стартует нормально, но один воркер иногда зависает на сетевом запросе. Логи показывают, что ошибка не критическая, но ее лучше обработать явно.',
  },
  {
    id: 'ru-07-question',
    from: 'Russian',
    to: 'English',
    text: 'Почему после выбора модели бот пишет, что настройка применится после перезапуска, если она уже должна работать сразу?',
  },
  {
    id: 'ru-08-short-message',
    from: 'Russian',
    to: 'English',
    text: 'Ок, давай без лишних объяснений. Просто покажи результат и что изменилось.',
  },
  {
    id: 'ru-09-business-casual',
    from: 'Russian',
    to: 'English',
    text: 'Клиент согласился на упрощенный вариант, но попросил оставить возможность расширить систему позже. Нужно зафиксировать это в документации.',
  },
  {
    id: 'ru-10-emotional',
    from: 'Russian',
    to: 'English',
    text: 'Немного злюсь на себя, потому что задача была простая, а я снова усложнил ее без причины. Завтра начну с самого маленького шага.',
  },
  {
    id: 'en-01-personal-editing',
    from: 'English',
    to: 'Russian',
    text: 'I completely missed my editing plan yesterday. I filmed enough material, but I kept switching tasks and only finished three short clips.',
  },
  {
    id: 'en-02-product-note',
    from: 'English',
    to: 'Russian',
    text: 'The UI technically works, but the current model state is not obvious after a restart. The user should see the active model immediately.',
  },
  {
    id: 'en-03-casual-request',
    from: 'English',
    to: 'Russian',
    text: 'Please make this sound calmer and more natural. Do not make it formal, and do not lose the original meaning.',
  },
  {
    id: 'en-04-question',
    from: 'English',
    to: 'Russian',
    text: 'Why does the bot say the model will apply after restart if the change is already active right now?',
  },
  {
    id: 'en-05-technical',
    from: 'English',
    to: 'Russian',
    text: 'The service starts correctly, but one worker sometimes hangs on a network request. The logs show it is not fatal, but we should handle it explicitly.',
  },
  {
    id: 'en-06-reflection',
    from: 'English',
    to: 'Russian',
    text: 'I wanted to finish the task quickly, but I spent the whole day bouncing between small details. Tonight I need to finish the most important part.',
  },
  {
    id: 'en-07-instruction',
    from: 'English',
    to: 'Russian',
    text: 'Keep the answer short. Mention the changed files, the commit hash, and whether the service is running.',
  },
  {
    id: 'en-08-story',
    from: 'English',
    to: 'Russian',
    text: 'I left home late, but I still caught the train. The carriage was quiet, so I finally cleaned up my notes and planned the week.',
  },
  {
    id: 'en-09-business',
    from: 'English',
    to: 'Russian',
    text: 'The client agreed to the simpler version, but asked us to keep the door open for expanding the system later. We should document that.',
  },
  {
    id: 'en-10-emotional',
    from: 'English',
    to: 'Russian',
    text: 'I am a bit annoyed with myself because the task was simple, and I made it more complicated for no reason. Tomorrow I will start with the smallest step.',
  },
];

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1];
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function outputDir(): string {
  return argValue('--out') || join(tmpdir(), `my-local-bro-translation-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}`);
}

function models(): string[] {
  return (argValue('--models') || DEFAULT_MODELS.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function paragraphCount(text: string): number {
  return text.trim().split(/\n\s*\n/).filter(Boolean).length;
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '_');
}

async function translate(client: Ollama, model: string, sample: Sample): Promise<TranslationResult> {
  const started = performance.now();
  const response = await client.chat({
    model,
    think: 'high',
    messages: [
      { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
      { role: 'user', content: `Translate from ${sample.from} to ${sample.to}:\n\n${sample.text}` },
    ],
  });
  const durationMs = Math.round(performance.now() - started);
  const output = response.message.content.trim();
  return {
    model,
    sampleId: sample.id,
    from: sample.from,
    to: sample.to,
    source: sample.text,
    output,
    durationMs,
    checks: {
      hasLongDash: /[—–]/.test(output),
      paragraphMismatch: paragraphCount(sample.text) !== paragraphCount(output),
    },
  };
}

function modelSummary(results: TranslationResult[]): string {
  const totalMs = results.reduce((sum, item) => sum + item.durationMs, 0);
  const avgMs = Math.round(totalMs / results.length);
  const dashIssues = results.filter((item) => item.checks.hasLongDash).length;
  const paragraphIssues = results.filter((item) => item.checks.paragraphMismatch).length;
  return `total=${Math.round(totalMs / 1000)}s avg=${Math.round(avgMs / 1000)}s/sample dashIssues=${dashIssues} paragraphIssues=${paragraphIssues}`;
}

function markdown(results: TranslationResult[], modelList: string[]): string {
  const lines = ['# Translation Benchmark', '', `Generated: ${new Date().toISOString()}`, `Models: ${modelList.join(', ')}`, ''];
  lines.push('## Speed And Checks', '');
  for (const model of modelList) {
    lines.push(`- ${model}: ${modelSummary(results.filter((item) => item.model === model))}`);
  }
  lines.push('', '## Results', '');
  for (const result of results) {
    lines.push(`### ${result.model} / ${result.sampleId}`, '');
    lines.push(`Direction: ${result.from} -> ${result.to}`);
    lines.push(`Duration: ${Math.round(result.durationMs / 1000)}s`);
    lines.push(`Checks: longDash=${result.checks.hasLongDash}, paragraphMismatch=${result.checks.paragraphMismatch}`, '');
    lines.push('Source:', '```text', result.source, '```', '');
    lines.push('Output:', '```text', result.output, '```', '');
  }
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const out = outputDir();
  const modelList = models();
  const client = new Ollama({ host: OLLAMA_HOST });
  const results: TranslationResult[] = [];
  await mkdir(out, { recursive: true });
  await mkdir(join(out, 'models'), { recursive: true });

  console.log(`Output directory: ${out}`);
  for (const model of modelList) {
    const modelResults: TranslationResult[] = [];
    console.log(`\n== ${model} ==`);
    for (const sample of SAMPLES) {
      process.stdout.write(`${sample.id}... `);
      const result = await translate(client, model, sample);
      results.push(result);
      modelResults.push(result);
      console.log(`${Math.round(result.durationMs / 1000)}s`);
      await writeFile(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    }
    await writeFile(join(out, 'models', `${safeName(model)}.md`), markdown(modelResults, [model]), 'utf8');
    console.log(modelSummary(modelResults));
  }

  await writeFile(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  await writeFile(join(out, 'summary.md'), markdown(results, modelList), 'utf8');
  console.log(`\nDone. Summary: ${join(out, 'summary.md')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
