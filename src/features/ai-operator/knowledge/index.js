import { BILLING_KNOWLEDGE } from './billing.js';
import { TARIFF_KNOWLEDGE } from './tariffs.js';
import { PROMOTION_KNOWLEDGE } from './promotions.js';
import { TECHNICAL_KNOWLEDGE } from './technical.js';
import { SERVICE_KNOWLEDGE } from './services.js';
import { CONNECTION_KNOWLEDGE } from './connection.js';

export const SIMNET_KNOWLEDGE_VERSION = 'simnet-encyclopedia-v3.1';
export const SIMNET_KNOWLEDGE = Object.freeze([
  ...BILLING_KNOWLEDGE,
  ...TARIFF_KNOWLEDGE,
  ...PROMOTION_KNOWLEDGE,
  ...TECHNICAL_KNOWLEDGE,
  ...SERVICE_KNOWLEDGE,
  ...CONNECTION_KNOWLEDGE
]);

function normalize(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-яіїєґ0-9]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return [...new Set(normalize(value).split(' ').filter(token => token.length >= 3))];
}

function scoreArticle(article, queryTokens) {
  if (!queryTokens.length) return 0;
  const hay = normalize([article.id, article.title, article.summary, ...(article.tags || []), article.text].join(' '));
  let score = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) score += 1;
  }
  return score;
}

export function searchKnowledgeLibrary(query, { limit = 3 } = {}) {
  const queryTokens = tokens(query);
  return SIMNET_KNOWLEDGE
    .map(article => ({ article, score: scoreArticle(article, queryTokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id))
    .slice(0, Math.max(1, Math.min(10, Number(limit) || 3)))
    .map(item => item.article);
}

export function knowledgeQueryFromUnderstanding(understanding = {}) {
  const parts = [
    understanding.whatUserWants,
    understanding.latestMessageMeans,
    understanding.knowledgeReason,
    ...(Array.isArray(understanding.unresolvedRequests) ? understanding.unresolvedRequests : [])
  ];
  return parts.filter(Boolean).join(' ');
}
