// Internal Workbench AI configuration. This file is background-only.
// The operator UI must never read, display, log, or export the API key.
export const AI_CONFIG = Object.freeze({
  provider: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'qwen/qwen3.6-27b',
  temperature: 0.2,
  maxTokens: 1200,
  timeoutMs: 45000,
  apiKey: ''
});
