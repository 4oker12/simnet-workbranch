const BEHAVIOR_MIN = 1;
const BEHAVIOR_MAX = 5;

export const DEFAULT_AI_OPERATOR_BEHAVIOR = Object.freeze({
  humanLikeness: 3,
  depth: 3,
  initiative: 3
});

const LEGACY_HUMAN_POINTS = Object.freeze({ 1: 35, 2: 45, 3: 55, 4: 65, 5: 75 });
const LEGACY_DEPTH_POINTS = Object.freeze({ 1: 90, 2: 75, 3: 60, 4: 45, 5: 30 });
const LEGACY_INITIATIVE_POINTS = Object.freeze({ 1: 20, 2: 35, 3: 50, 4: 65, 5: 80 });

function clampLevel(value, fallback = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(BEHAVIOR_MIN, Math.min(BEHAVIOR_MAX, Math.round(numeric)));
}

function nearestLegacyLevel(value, points, fallback = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;

  let bestLevel = fallback;
  let bestDistance = Infinity;
  for (const [level, point] of Object.entries(points)) {
    const distance = Math.abs(numeric - Number(point));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestLevel = Number(level);
    }
  }
  return clampLevel(bestLevel, fallback);
}

function sourceObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeBehaviorProfile(value = {}) {
  const source = sourceObject(value);

  const humanLikeness = source.humanLikeness != null
    ? clampLevel(source.humanLikeness, DEFAULT_AI_OPERATOR_BEHAVIOR.humanLikeness)
    : nearestLegacyLevel(source.confidenceStyle, LEGACY_HUMAN_POINTS, DEFAULT_AI_OPERATOR_BEHAVIOR.humanLikeness);

  const depth = source.depth != null
    ? clampLevel(source.depth, DEFAULT_AI_OPERATOR_BEHAVIOR.depth)
    : nearestLegacyLevel(source.brevity, LEGACY_DEPTH_POINTS, DEFAULT_AI_OPERATOR_BEHAVIOR.depth);

  const initiative = source.initiative != null && Number(source.initiative) >= BEHAVIOR_MIN && Number(source.initiative) <= BEHAVIOR_MAX
    ? clampLevel(source.initiative, DEFAULT_AI_OPERATOR_BEHAVIOR.initiative)
    : nearestLegacyLevel(source.initiative, LEGACY_INITIATIVE_POINTS, DEFAULT_AI_OPERATOR_BEHAVIOR.initiative);

  return { humanLikeness, depth, initiative };
}

export function maxFollowUpQuestionsForDepth(value) {
  const depth = clampLevel(value, DEFAULT_AI_OPERATOR_BEHAVIOR.depth);
  if (depth <= 2) return 1;
  if (depth >= 5) return 3;
  return 2;
}

export function behaviorRuntimeHints(value = {}) {
  const profile = normalizeBehaviorProfile(value);
  return {
    ...profile,
    maxFollowUpQuestions: maxFollowUpQuestionsForDepth(profile.depth)
  };
}

export function isNativeBehaviorProfile(value = {}) {
  const source = sourceObject(value);
  return ['humanLikeness', 'depth', 'initiative'].every(key => {
    const numeric = Number(source[key]);
    return Number.isFinite(numeric) && numeric >= BEHAVIOR_MIN && numeric <= BEHAVIOR_MAX;
  });
}
