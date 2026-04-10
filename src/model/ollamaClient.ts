import { Ollama } from 'ollama';
import type { AppConfig } from '../config.js';

export function createOllamaClient(config: AppConfig['ollama']): Ollama {
  const options = {
    host: config.host,
    ...(config.apiKey ? { headers: { Authorization: `Bearer ${config.apiKey}` } } : {}),
  };
  return new Ollama(options);
}
