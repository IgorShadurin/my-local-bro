import type { TelegramStatusMessenger, TelegramStatusHandle } from './status.js';
import type { TelegramChatTarget } from './status.js';

export class TelegramRequestStatus {
  private status: TelegramStatusHandle | undefined;
  private readonly order: string[] = ['request'];
  private readonly lines = new Map<string, string>();
  private sequence = 0;

  constructor(
    private readonly messenger: TelegramStatusMessenger,
    private readonly target: TelegramChatTarget,
  ) {}

  async start(initialRequestLine: string): Promise<void> {
    this.lines.set('request', initialRequestLine);
    this.status = await this.messenger.startStatus(this.target, initialRequestLine);
  }

  async setRequest(line: string): Promise<void> {
    this.lines.set('request', line);
    await this.render();
  }

  async startTool(line: string): Promise<string> {
    const key = `tool:${++this.sequence}`;
    this.order.push(key);
    this.lines.set(key, line);
    await this.render();
    return key;
  }

  async updateTool(key: string, line: string): Promise<void> {
    if (!this.lines.has(key)) this.order.push(key);
    this.lines.set(key, line);
    await this.render();
  }

  async finishTool(key: string, line: string): Promise<void> {
    this.lines.set(key, line);
    await this.render();
  }

  private async render(): Promise<void> {
    const parts = this.order
      .map((key) => this.lines.get(key))
      .filter((line): line is string => Boolean(line));
    await this.messenger.finishStatus(this.target, this.status, parts.join('\n\n'), false);
  }
}
