'use strict';

const SECRET_KEY = /^(?:pp|password|passwd|pass|token|secret|csrf|authorization)$/i;

function clipText(value, max) {
  const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

// Structure-preserving compaction. Unlike String(value), it never turns an object
// into "[object Object]": beyond the depth limit an object becomes a marker that still
// records its kind and keys, and primitives are kept as they are.
export function compactValue(input, {
  maxDepth = 5,
  maxArray = 16,
  maxKeys = 80,
  maxText = 300,
  dropSecrets = true
} = {}, depth = 0) {
  if (input == null || typeof input === 'number' || typeof input === 'boolean') return input;
  if (typeof input === 'string') return clipText(input, maxText);
  if (typeof input !== 'object') return clipText(input, maxText);
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.toISOString();
  const opts = { maxDepth, maxArray, maxKeys, maxText, dropSecrets };
  if (Array.isArray(input)) {
    if (depth >= maxDepth) return { _truncated: 'array', length: input.length };
    return input.slice(0, maxArray).map(item => compactValue(item, opts, depth + 1));
  }
  const entries = Object.entries(input).filter(([key]) => !(dropSecrets && SECRET_KEY.test(key)));
  if (depth >= maxDepth) return { _truncated: 'object', keys: entries.slice(0, 20).map(([key]) => key) };
  const output = {};
  for (const [key, raw] of entries.slice(0, maxKeys)) output[key] = compactValue(raw, opts, depth + 1);
  return output;
}

// Diagnostic one-line text for any value; objects are serialized instead of stringified.
export function compactText(value, max = 500) {
  if (value == null) return '';
  if (typeof value === 'object') {
    try { return clipText(JSON.stringify(value), max); } catch { return '[unserializable]'; }
  }
  return clipText(value, max);
}

// Working state must not pass through diagnostic truncation. State is JSON data;
// redact credentials without changing text, depth, collection size or scalar values.
export function preserveState(value) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(preserveState);
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !SECRET_KEY.test(key) || (key.toLowerCase() === 'authorization' && item && typeof item === 'object'))
    .map(([key, item]) => [key, preserveState(item)]));
}
