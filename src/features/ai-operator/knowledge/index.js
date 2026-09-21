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

function articleSearchText(article) {
  return normalize([article.id, article.title, article.summary, ...(article.tags || [])].join(' '));
}

function scoreArticle(article, queryText) {
  const haystack = articleSearchText(article);
  const query = normalize(queryText);
  const queryTokens = tokens(query);
  let score = 0;

  for (const tag of article.tags || []) {
    const normalizedTag = normalize(tag);
    if (normalizedTag && query.includes(normalizedTag)) score += 10;
  }
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += token.length >= 7 ? 3 : 1;
  }
  if (query && normalize(article.title).split(' ').some(part => part.length >= 4 && query.includes(part))) score += 3;
  return score;
}

export function knowledgeQueryFromUnderstanding({ probe = {}, latestCustomer = {} } = {}) {
  return [
    probe.whatUserWants,
    probe.latestMessageMeans,
    probe.refersTo,
    probe.underlyingGoal,
    ...(probe.factsSaidByUser || []),
    latestCustomer?.text
  ].filter(Boolean).join(' ');
}

// This is retrieval, not a decision rule. It only offers candidate encyclopedia pages.
// The model is explicitly allowed to ignore all candidates when they are not useful.
export function searchKnowledgeLibrary(queryText, { limit = 6, minScore = 1 } = {}) {
  return SIMNET_KNOWLEDGE
    .map(article => ({ article, score: scoreArticle(article, queryText) }))
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id))
    .slice(0, Math.max(1, Math.min(10, Number(limit) || 6)))
    .map(({ article, score }) => ({ ...article, score }));
}

export function knowledgeIndex() {
  return SIMNET_KNOWLEDGE.map(({ id, title, summary, tags }) => ({ id, title, summary, tags }));
}
