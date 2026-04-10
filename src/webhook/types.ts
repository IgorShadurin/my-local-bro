export interface WebhookAudioRecord {
  id: number;
  createdAt: string;
  fileName: string;
  mimeType?: string;
  size: number;
  storedPath: string;
  source?: string;
  deletedAt?: string;
}

export interface WebhookAudioEvent {
  id: number;
  createdAt: string;
  type: 'audio.received';
  fileId: number;
  fileName: string;
  mimeType?: string;
  size: number;
  source?: string;
}

export interface WebhookState {
  nextFileId: number;
  nextEventId: number;
  files: WebhookAudioRecord[];
  events: WebhookAudioEvent[];
}

export interface WebhookUploadResult {
  file: WebhookAudioRecord;
  event: WebhookAudioEvent;
}

export interface WebhookInboundAudio {
  fileName?: string;
  mimeType?: string;
  source?: string;
  audio: Buffer;
}

export interface WebhookSubscriberEvent {
  eventId: number;
  fileId: number;
  fileName: string;
  mimeType?: string;
  source?: string;
  audio: Buffer;
}
