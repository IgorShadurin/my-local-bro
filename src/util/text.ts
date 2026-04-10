export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function telegramDraftText(value: string): string {
  const text = value.trim() || '...';
  if (text.length <= 4096) return text;
  return `…${text.slice(text.length - 4095)}`;
}

export function telegramHtml(value: string): string {
  return applySimpleMarkdown(escapeHtml(value));
}

export function chunkTelegramMessage(value: string, maxLength = 4096): string[] {
  if (!value.trim()) return ['I could not generate a response.'];
  const chunks: string[] = [];
  let remaining = value;
  while (remaining.length > maxLength) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function applySimpleMarkdown(value: string): string {
  return value
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, '<b>$1</b>');
}
