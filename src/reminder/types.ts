export interface ReminderAuthor {
  userId: number;
  chatId: number;
  messageThreadId?: number;
}

export interface ReminderTask {
  id: number;
  text: string;
  dueAt: string;
  author: ReminderAuthor;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}

export interface ReminderCreateInput {
  text: string;
  dueAt: string;
  author: ReminderAuthor;
}

export interface ReminderStoreData {
  nextId: number;
  reminders: ReminderTask[];
}
