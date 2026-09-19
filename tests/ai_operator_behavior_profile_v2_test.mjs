import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_AI_OPERATOR_BEHAVIOR,
  behaviorPromptGuidance,
  behaviorRuntimeHints,
  isNativeBehaviorProfile,
  maxFollowUpQuestionsForDepth,
  mergeBehaviorProfile,
  normalizeBehaviorProfile,
  toLegacyBehaviorCompatibility
} from '../src/features/ai-operator/behavior-profile.js';

test('behavior v2 defaults to three neutral 1..5 scales only', () => {
  assert.deepEqual(normalizeBehaviorProfile(), DEFAULT_AI_OPERATOR_BEHAVIOR);
  assert.deepEqual(Object.keys(normalizeBehaviorProfile()).sort(), ['depth', 'humanLikeness', 'initiative']);
  assert.equal('skepticism' in normalizeBehaviorProfile(), false, 'truth/evidence strictness must not be a user style knob');
  assert.equal('brevity' in normalizeBehaviorProfile(), false);
  assert.equal('curiosity' in normalizeBehaviorProfile(), false);
  assert.equal('confidenceStyle' in normalizeBehaviorProfile(), false);
});

test('behavior v2 clamps native values and derives follow-up budget from depth', () => {
  assert.deepEqual(
    normalizeBehaviorProfile({ humanLikeness: 9, depth: -4, initiative: 4.4 }),
    { humanLikeness: 5, depth: 1, initiative: 4 }
  );
  assert.equal(maxFollowUpQuestionsForDepth(1), 1);
  assert.equal(maxFollowUpQuestionsForDepth(2), 1);
  assert.equal(maxFollowUpQuestionsForDepth(3), 2);
  assert.equal(maxFollowUpQuestionsForDepth(4), 2);
  assert.equal(maxFollowUpQuestionsForDepth(5), 3);
  assert.deepEqual(
    behaviorRuntimeHints({ humanLikeness: 4, depth: 5, initiative: 2 }),
    { humanLikeness: 4, depth: 5, initiative: 2, maxFollowUpQuestions: 3 }
  );
});

test('legacy behavior migrates to the same visible v2 levels used by the current UI bridge', () => {
  assert.deepEqual(
    normalizeBehaviorProfile({
      confidenceStyle: 35,
      curiosity: 45,
      initiative: 20,
      skepticism: 99,
      brevity: 90,
      maxFollowUpQuestions: 1
    }),
    { humanLikeness: 1, depth: 1, initiative: 1 }
  );

  assert.deepEqual(
    normalizeBehaviorProfile({ confidenceStyle: 55, initiative: 50, brevity: 60 }),
    { humanLikeness: 3, depth: 3, initiative: 3 }
  );

  assert.deepEqual(
    normalizeBehaviorProfile({ confidenceStyle: 75, initiative: 80, brevity: 30 }),
    { humanLikeness: 5, depth: 5, initiative: 5 }
  );
});

test('legacy initiative values 1..5 are not mistaken for native values without the native shape', () => {
  assert.deepEqual(
    normalizeBehaviorProfile({ confidenceStyle: 55, brevity: 60, initiative: 5 }),
    { humanLikeness: 3, depth: 3, initiative: 1 }
  );
});

test('native fields take precedence over leftover legacy compatibility fields', () => {
  const mixed = {
    humanLikeness: 4,
    depth: 2,
    initiative: 5,
    confidenceStyle: 35,
    curiosity: 100,
    skepticism: 0,
    brevity: 90,
    maxFollowUpQuestions: 1
  };
  assert.equal(isNativeBehaviorProfile(mixed), true);
  assert.deepEqual(normalizeBehaviorProfile(mixed), { humanLikeness: 4, depth: 2, initiative: 5 });
});

test('behavior merge accepts native partial updates and complete legacy payloads without initiative collision', () => {
  assert.deepEqual(
    mergeBehaviorProfile(
      { humanLikeness: 2, depth: 4, initiative: 3 },
      { humanLikeness: 5, initiative: 1 }
    ),
    { humanLikeness: 5, depth: 4, initiative: 1 }
  );

  assert.deepEqual(
    mergeBehaviorProfile(
      { humanLikeness: 2, depth: 4, initiative: 3 },
      { confidenceStyle: 75, curiosity: 65, initiative: 65, skepticism: 80, brevity: 90, maxFollowUpQuestions: 1 }
    ),
    { humanLikeness: 5, depth: 1, initiative: 4 }
  );

  assert.deepEqual(
    mergeBehaviorProfile(
      { humanLikeness: 2, depth: 4, initiative: 3 },
      { initiative: 5 }
    ),
    { humanLikeness: 2, depth: 4, initiative: 5 }
  );
});

test('temporary legacy adapter exactly preserves current runtime semantics', () => {
  assert.deepEqual(
    toLegacyBehaviorCompatibility(
      { humanLikeness: 5, depth: 1, initiative: 4 },
      { skepticism: 82 }
    ),
    {
      confidenceStyle: 75,
      curiosity: 65,
      initiative: 65,
      skepticism: 82,
      brevity: 90,
      maxFollowUpQuestions: 1
    }
  );

  assert.equal(
    toLegacyBehaviorCompatibility({ humanLikeness: 3, depth: 3, initiative: 3 }, { skepticism: 10 }).skepticism,
    70,
    'style migration must never lower evidence strictness'
  );
  assert.equal(
    toLegacyBehaviorCompatibility({ humanLikeness: 3, depth: 3, initiative: 3 }, { skepticism: 'broken' }).skepticism,
    75,
    'corrupted legacy style data must fall back safely instead of producing NaN'
  );
});

test('native behavior prompt keeps truthfulness invariant and describes only the three scales', () => {
  const prompt = behaviorPromptGuidance({ humanLikeness: 5, depth: 4, initiative: 2 });
  assert.match(prompt, /Человекоподобность=5\/5/);
  assert.match(prompt, /Полезная развернутость=4\/5/);
  assert.match(prompt, /Инициативность=2\/5/);
  assert.match(prompt, /достоверности.*неизменяемы/i);
  assert.match(prompt, /не более 2 уточняющих вопросов/);
  assert.doesNotMatch(prompt, /Скепсис=|Любопытство=|Краткость=|Решительность=/);
});

test('behavior v2 UI bridge uses the central contract instead of its own mapping tables', async () => {
  const source = await readFile(new URL('../src/ui/ai-operator-behavior-v2.js', import.meta.url), 'utf8');
  assert.match(source, /behavior-profile\.js/);
  assert.match(source, /normalizeBehaviorProfile/);
  assert.match(source, /toLegacyBehaviorCompatibility/);
  assert.doesNotMatch(source, /INITIATIVE_TO_LEGACY|DEPTH_TO_BREVITY|levelFromRange/);
});
