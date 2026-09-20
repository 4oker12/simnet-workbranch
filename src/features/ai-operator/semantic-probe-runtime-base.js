import { recordApiUsage } from './api-cost.js';
import { AI_CONFIG, readAiRuntimeConfig } from '../../config/ai-config.js';
import { SIMNET_KNOWLEDGE_VERSION, knowledgeQueryFromUnderstanding, searchKnowledgeLibrary } from './knowledge/index.js';
import { autonomousOperatorSystemMessages } from './instructions/autonomous-operator-instruction.generated.js';
import { behaviorRuntimeHints } from './behavior-profile.js';
import { CANONICAL_FACT_PATHS, normalizeCanonicalFacts } from './canonical-fact-catalog.js';

const GENERATION_FALLBACK_MODELS = Object.freeze([
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b'
]);
const RETIRED_MODELS = new Set(['qwen/qwen3.6-27b']);
const PROMPT_GUARD_MODEL = 'meta-llama/llama-prompt-guard-2-86m';
const MODEL_COOLDOWNS = new Map();
const KNOWLEDGE_NEEDS = new Set(['none', 'maybe', 'needed']);
const LIVE_DATA_NEEDS = new Set(['none', 'needed']);
const KNOWLEDGE_MODES = new Set(['off', 'auto', 'on']);
const JSON_REPAIR_TOKENS = 1400;

function oneLine(value, max = 1000) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function block(value, max = 7000) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
