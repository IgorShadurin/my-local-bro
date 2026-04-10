import type { ShortsCategory } from '../downloader/shortsToProcess.js';

export interface IngestLinkItem {
  url: string;
  platform?: string;
  externalId?: string;
  title?: string;
  author?: string;
  takenAt?: number;
}

export interface IngestBatchRequest {
  source: string;
  links: IngestLinkItem[];
  category?: ShortsCategory;
}

export interface IngestBatchJob extends IngestBatchRequest {
  batchId: string;
  receivedAt: string;
}

export interface PrecheckSummary {
  source: string;
  totalReceived: number;
  uniqueLinks: number;
  duplicatesSkipped: number;
  willDownload: number;
}

export interface ExistingMediaRecord {
  mediaId: string;
  sourceUrl: string;
  originalPath: string;
}

export interface BatchImportSummary {
  batchId: string;
  source: string;
  totalReceived: number;
  uniqueLinks: number;
  duplicatesSkipped: number;
  downloaded: number;
  failed: number;
  cancelled: boolean;
}
