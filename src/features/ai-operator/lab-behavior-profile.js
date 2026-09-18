'use strict';

export const LAB_BEHAVIOR_VERSION = 2;
export const DEFAULT_LAB_BEHAVIOR = Object.freeze({
  naturalness: 3,
  depth: 3,
  initiative: 3
});

function level(value, fallback = 3) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(5, Math.round(parsed))) : fallback;
}

function legacyLevel(value, fallback = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return level(1 + (Math.max(0, Math.min(100, parsed)) / 25), fallback);
}

function averageLegacy(values = [], fallback = 3) {
  const present = values.map(Number).filter(Number.isFinite);
  if (!present.length) return fallback;
  return legacyLevel(present.reduce((sum, value) => sum + value, 0) / present.length, fallback);
}

export function normalizeLabBehavior(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const legacyKeys = ['confidenceStyle', 'curiosity', 'skepticism', 'brevity', 'maxFollowUpQuestions'];
  const hasLegacyProfile = legacyKeys.some(key => source[key] != null);
  const hasNewProfile = !hasLegacyProfile && ['naturalness', 'depth'].some(key => source[key] != null);

  if (hasNewProfile) {
    return {
      naturalness: level(source.naturalness, DEFAULT_LAB_BEHAVIOR.naturalness),
      depth: level(source.depth, DEFAULT_LAB_BEHAVIOR.depth),
      initiative: level(source.initiative, DEFAULT_LAB_BEHAVIOR.initiative)
    };
  }

  // v1 Lab migration. `initiative` existed in both schemas, therefore legacy-only
  // keys decide the shape before the shared initiative field is interpreted.
  if (hasLegacyProfile) {
    return {
      naturalness: averageLegacy([source.confidenceStyle, source.brevity], DEFAULT_LAB_BEHAVIOR.naturalness),
      depth: averageLegacy([source.curiosity, source.skepticism], DEFAULT_LAB_BEHAVIOR.depth),
      initiative: legacyLevel(source.initiative, DEFAULT_LAB_BEHAVIOR.initiative)
    };
  }

  return { ...DEFAULT_LAB_BEHAVIOR };
}

export function behaviorInstruction(profile = {}) {
  const normalized = normalizeLabBehavior(profile);
  return [
    `Naturalness ${normalized.naturalness}/5: 1 = максимально сухо и служебно; 5 = естественно и по-человечески, без искусственной болтовни.`,
    `Depth ${normalized.depth}/5: 1 = только необходимый прямой ответ; 5 = добавляй полезное объяснение и контекст, когда они реально помогают.`,
    `Initiative ${normalized.initiative}/5: 1 = не уходи дальше вопроса; 5 = предлагай следующий полезный шаг, если он уместен.`
  ].join('\n');
}
