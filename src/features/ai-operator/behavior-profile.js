const BEHAVIOR_MIN = 1;
const BEHAVIOR_MAX = 5;

export const DEFAULT_AI_OPERATOR_BEHAVIOR = Object.freeze({
  humanLikeness: 3,
  depth: 3,
  initiative: 3
});

const LEGACY_HUMAN_POINTS = Object.freeze({ 1: 35, 2: 45, 3: 55, 4: 65, 5: 75 });
const LEGACY_CURIOSITY_POINTS = Object.freeze({ 1: 45, 2: 50, 3: 55, 4: 60, 5: 65 });
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

export function isNativeBehaviorProfile(value = {}) {
  const source = sourceObject(value);
  return ['humanLikeness', 'depth', 'initiative'].every(key => {
    const numeric = Number(source[key]);
    return Number.isFinite(numeric) && numeric >= BEHAVIOR_MIN && numeric <= BEHAVIOR_MAX;
  });
}

export function normalizeBehaviorProfile(value = {}) {
  const source = sourceObject(value);
  const nativeShape = source.humanLikeness != null || source.depth != null;

  const humanLikeness = source.humanLikeness != null
    ? clampLevel(source.humanLikeness, DEFAULT_AI_OPERATOR_BEHAVIOR.humanLikeness)
    : nearestLegacyLevel(source.confidenceStyle, LEGACY_HUMAN_POINTS, DEFAULT_AI_OPERATOR_BEHAVIOR.humanLikeness);

  const depth = source.depth != null
    ? clampLevel(source.depth, DEFAULT_AI_OPERATOR_BEHAVIOR.depth)
    : nearestLegacyLevel(source.brevity, LEGACY_DEPTH_POINTS, DEFAULT_AI_OPERATOR_BEHAVIOR.depth);

  const initiative = nativeShape
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

export function behaviorPromptGuidance(value = {}) {
  const profile = behaviorRuntimeHints(value);
  return [
    'Поведенческий профиль влияет только на манеру и полезную форму ответа. Правила достоверности, evidence и запрет выдумывать факты неизменяемы.',
    `Человекоподобность=${profile.humanLikeness}/5: 1 — сухо и формально; 5 — естественно, как живой оператор. Естественность не даёт права изображать знания или выполненные проверки.`,
    `Полезная развернутость=${profile.depth}/5: 1 — только необходимый минимум; 5 — подробнее объяснять релевантные причины и связи. Не добавляй соседние данные ради объёма.`,
    `Инициативность=${profile.initiative}/5: 1 — закрыть только поставленный вопрос; 5 — после прямого ответа предложить уместный следующий шаг, если он действительно полезен.`,
    `За один ход — не более ${profile.maxFollowUpQuestions} уточняющих вопросов; задавай их только когда без конкретного ответа нельзя достоверно продолжить.`
  ].join('\n');
}

// Temporary adapter while lab-background/semantic-probe still persist the old 0..100 shape.
// Keep truth/evidence strictness outside the three user-facing style scales.
export function toLegacyBehaviorCompatibility(value = {}, current = {}) {
  const profile = normalizeBehaviorProfile(value);
  const source = sourceObject(current);
  return {
    confidenceStyle: LEGACY_HUMAN_POINTS[profile.humanLikeness],
    curiosity: LEGACY_CURIOSITY_POINTS[profile.humanLikeness],
    initiative: LEGACY_INITIATIVE_POINTS[profile.initiative],
    skepticism: Math.max(70, Number(source.skepticism || 75)),
    brevity: LEGACY_DEPTH_POINTS[profile.depth],
    maxFollowUpQuestions: maxFollowUpQuestionsForDepth(profile.depth)
  };
}
