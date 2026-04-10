import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { Ollama } from 'ollama';
import { loadConfig } from '../src/config.js';
import { currentTimeContext } from '../src/util/date.js';
import { createReminderTool, reminderUsagePrompt } from '../src/tools/reminder.js';
import { ReminderStorage } from '../src/reminder/storage.js';

type Expectation = {
  request: string;
  acceptableTexts: string[];
  expectedDueAt: string;
  forbiddenTextIncludes?: string[];
};

const fixedNow = new Date('2026-04-09T14:00:00+03:00');
const model = 'gemma4:26b';
const outputDir = `/tmp/my-local-bro-reminder-tests-${Date.now()}`;

const cases: Expectation[] = [
  { request: 'remind me in 1 hour to call the store', acceptableTexts: ['Call the store.'], expectedDueAt: '2026-04-09T15:00:00+03:00' },
  { request: 'Напомни через 15 минут оплатить интернет', acceptableTexts: ['Pay for internet.', 'Pay for the internet.'], expectedDueAt: '2026-04-09T14:15:00+03:00' },
  { request: 'Remind me tomorrow at 9:30 to send the invoice', acceptableTexts: ['Send the invoice.'], expectedDueAt: '2026-04-10T09:30:00+03:00' },
  { request: 'напомни послезавтра в 18:45 позвонить маме', acceptableTexts: ['Call mom.', 'Call my mom.'], expectedDueAt: '2026-04-11T18:45:00+03:00' },
  { request: 'Set a reminder for April 12 at 07:10 to water the plants', acceptableTexts: ['Water the plants.'], expectedDueAt: '2026-04-12T07:10:00+03:00' },
  { request: 'Напомни 13 апреля в 22:05 выключить духовку', acceptableTexts: ['Turn off the oven.'], expectedDueAt: '2026-04-13T22:05:00+03:00' },
  { request: 'in two days at 6 pm remind me to join the design review', acceptableTexts: ['Join the design review.'], expectedDueAt: '2026-04-11T18:00:00+03:00' },
  { request: 'Через неделю в 8 утра напомни взять документы в банк', acceptableTexts: ['Take documents to the bank.', 'Take the documents to the bank.'], expectedDueAt: '2026-04-16T08:00:00+03:00' },
  { request: 'Remind me on Friday at 16:20 to reply to Alex', acceptableTexts: ['Reply to Alex.'], expectedDueAt: '2026-04-10T16:20:00+03:00' },
  { request: 'Напомни в 23:59 проверить отчёт', acceptableTexts: ['Check the report.'], expectedDueAt: '2026-04-09T23:59:00+03:00' },
  { request: 'Please remind me in 90 minutes to stretch and drink water', acceptableTexts: ['Stretch and drink water.'], expectedDueAt: '2026-04-09T15:30:00+03:00' },
  { request: 'Напомни 20 апреля в 14:00 встретить курьера у двери', acceptableTexts: ['Meet the courier at the door.', 'Meet the courier by the door.'], expectedDueAt: '2026-04-20T14:00:00+03:00' },
  { request: 'Sort of a reminder, in one hour, everything works okay.', acceptableTexts: ['Everything works okay.'], expectedDueAt: '2026-04-09T15:00:00+03:00', forbiddenTextIncludes: ['check', 'verify', 'confirm', 'is working'] },
  { request: 'Напомни через час всё работает нормально.', acceptableTexts: ['Everything works normally.', 'Everything is working normally.'], expectedDueAt: '2026-04-09T15:00:00+03:00', forbiddenTextIncludes: ['check', 'verify', 'confirm'] },
  { request: 'In 2 hours the deployment is stable', acceptableTexts: ['The deployment is stable.'], expectedDueAt: '2026-04-09T16:00:00+03:00', forbiddenTextIncludes: ['check', 'verify', 'confirm'] },
  { request: 'через 30 минут сервер доступен', acceptableTexts: ['The server is available.', 'Server is available.', 'Server available.'], expectedDueAt: '2026-04-09T14:30:00+03:00', forbiddenTextIncludes: ['check', 'verify', 'confirm'] },
  { request: 'Remind me in 3 hours: the migration is finished', acceptableTexts: ['The migration is finished.'], expectedDueAt: '2026-04-09T17:00:00+03:00', forbiddenTextIncludes: ['check', 'verify', 'confirm'] },
];

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new Ollama({ host: config.ollama.host, ...(config.ollama.apiKey ? { headers: { authorization: `Bearer ${config.ollama.apiKey}` } } : {}) });
  const tool = createReminderTool(new ReminderStorage('/tmp/my-local-bro-reminder-tool.json', '/tmp/my-local-bro-reminder-tool-done')).definition;
  await mkdir(outputDir, { recursive: true });

  const results: Array<Record<string, unknown>> = [];
  for (const testCase of cases) {
    const startedAt = Date.now();
    const response = await client.chat({
      model,
      think: 'high',
      tools: [tool],
      messages: [
        {
          role: 'system',
          content: [
            'You convert user requests into reminder tool calls.',
            currentTimeContext(fixedNow),
            reminderUsagePrompt(),
            'Always call the reminder tool for valid reminder requests.',
            'Use action=create.',
          ].join(' '),
        },
        { role: 'user', content: testCase.request },
      ],
      options: { num_ctx: 32768 },
    });
    const durationMs = Date.now() - startedAt;
    const call = response.message.tool_calls?.[0];
    if (!call) {
      throw new Error(`No reminder tool call for: ${testCase.request}`);
    }
    const args = call.function.arguments as Record<string, unknown>;
    const text = String(args.text ?? '');
    const dueAt = String(args.dueAt ?? '');
    const normalizedText = normalizeReminderText(text);
    if (!testCase.acceptableTexts.some((expected) => normalizeReminderText(expected) === normalizedText)) {
      throw new Error(`Reminder text mismatch for "${testCase.request}": expected one of ${JSON.stringify(testCase.acceptableTexts)}, got "${text}"`);
    }
    const lowerText = normalizedText.toLowerCase();
    const forbidden = testCase.forbiddenTextIncludes?.find((fragment) => lowerText.includes(fragment));
    if (forbidden) {
      throw new Error(`Reminder text mismatch for "${testCase.request}": forbidden fragment "${forbidden}" found in "${text}"`);
    }
    if (/[^\x00-\x7F]/.test(text)) {
      throw new Error(`Reminder text for "${testCase.request}" was not converted to English: "${text}"`);
    }
    const expectedIso = new Date(testCase.expectedDueAt).toISOString();
    const actualIso = new Date(dueAt).toISOString();
    if (actualIso !== expectedIso) {
      throw new Error(`Reminder dueAt mismatch for "${testCase.request}": expected ${expectedIso}, got ${actualIso}`);
    }
    results.push({ request: testCase.request, args, durationMs });
  }

  const summary = [
    `Model: ${model}`,
    `Current time context: ${currentTimeContext(fixedNow)}`,
    `Cases: ${cases.length}`,
    `Average duration: ${Math.round(results.reduce((sum, item) => sum + Number(item.durationMs), 0) / results.length)} ms`,
  ].join('\n');
  await writeFile(join(outputDir, 'summary.txt'), `${summary}\n`, 'utf8');
  await writeFile(join(outputDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(summary);
  console.log(`Results saved to ${outputDir}`);
}

function normalizeReminderText(text: string): string {
  return text.trim().replace(/[.!?]+$/g, '');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
