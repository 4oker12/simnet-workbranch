import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { behaviorInstruction, normalizeLabBehavior } from '../src/features/ai-operator/lab-behavior-profile.js';

test('AI Lab behavior profile has exactly three persisted 1-to-5 axes', () => {
  assert.deepEqual(normalizeLabBehavior(), { naturalness: 3, depth: 3, initiative: 3 });
  assert.deepEqual(normalizeLabBehavior({ naturalness: -10, depth: 8, initiative: 4.4 }), {
    naturalness: 1,
    depth: 5,
    initiative: 4
  });
  assert.deepEqual(Object.keys(normalizeLabBehavior({ naturalness: 4, depth: 2, initiative: 5 })).sort(), ['depth', 'initiative', 'naturalness']);
});

test('legacy five-axis Lab profile migrates deterministically to the new profile', () => {
  assert.deepEqual(normalizeLabBehavior({
    confidenceStyle: 25,
    curiosity: 80,
    initiative: 35,
    skepticism: 90,
    brevity: 70,
    maxFollowUpQuestions: 1
  }), { naturalness: 3, depth: 4, initiative: 2 });
});

test('subscriber prompt exposes only Naturalness Depth Initiative as behavior controls', () => {
  const instruction = behaviorInstruction({ naturalness: 5, depth: 4, initiative: 2 });
  assert.match(instruction, /Naturalness 5\/5/);
  assert.match(instruction, /Depth 4\/5/);
  assert.match(instruction, /Initiative 2\/5/);
  assert.doesNotMatch(instruction, /confidenceStyle|curiosity|skepticism|brevity|maxFollowUpQuestions/);

  const semantic = fs.readFileSync(new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../src/ui/ai-operator-lab.js', import.meta.url), 'utf8');
  assert.match(semantic, /behaviorInstruction\(profile\)/);
  assert.doesNotMatch(semantic, /profile\.confidenceStyle|profile\.curiosity|profile\.skepticism|profile\.brevity|profile\.maxFollowUpQuestions/);
  assert.match(ui, /\['naturalness', 'Naturalness'/);
  assert.match(ui, /\['depth', 'Depth'/);
  assert.match(ui, /\['initiative', 'Initiative'/);
  assert.doesNotMatch(ui, /Решительность|Любопытство|Скепсис к фактам|Макс\. уточнений/);
});
