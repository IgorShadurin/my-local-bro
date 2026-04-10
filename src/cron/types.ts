export interface CronTaskAuthor {
  userId: number;
  chatId: number;
  messageThreadId?: number;
}

export interface CronTask {
  id: number;
  enabled: boolean;
  schedule: string;
  command: string;
  args: string[];
  prompt: string;
  author: CronTaskAuthor;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunMinute?: string;
  lastRunStatus?: 'success' | 'error';
  lastRunSummary?: string;
}

export interface CronTaskCreateInput {
  schedule: string;
  command: string;
  args?: string[];
  prompt: string;
  author: CronTaskAuthor;
}

export interface CronTaskStoreData {
  nextId: number;
  tasks: CronTask[];
}
