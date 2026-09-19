import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('live turns skip blind pre-tool answer synthesis', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/lab-background.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ planLiveDataNeeds \} from '\.\/live-need-recovery\.js'/);
  assert.match(source, /const liveNeeds = planLiveDataNeeds\(analysis\)/);
  assert.match(source, /if \(liveNeeds\.length\) \{\s*draft = evidenceFirstDraft\(analysis, lab\.behavior, liveNeeds\);/s);
  assert.match(source, /\} else \{\s*try \{\s*draft = await generateSubscriberReply\(/s);
  assert.match(source, /evidenceFirst: true/);

  const replyVariantStart = source.indexOf('async function replyVariant');
  const plan = source.indexOf('const liveNeeds = planLiveDataNeeds(analysis)', replyVariantStart);
  const branch = source.indexOf('if (liveNeeds.length)', plan);
  const generation = source.indexOf('draft = await generateSubscriberReply(', branch);
  const grounding = source.indexOf('const grounded = await groundSubscriberReply(', generation);

  assert.ok(replyVariantStart >= 0 && plan > replyVariantStart);
  assert.ok(branch > plan && generation > branch && grounding > generation);
  assert.match(
    source.slice(branch, generation),
    /draft = evidenceFirstDraft\(analysis, lab\.behavior, liveNeeds\)/,
    'live branch must create an evidence-first draft before the normal generation branch'
  );
});

test('non-live turns keep normal model answer generation', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/lab-background.js', import.meta.url), 'utf8');
  assert.match(source, /else \{\s*try \{\s*draft = await generateSubscriberReply\(/s);
  assert.match(source, /capabilities: CAPABILITIES/);
  assert.match(source, /groundSubscriberReply\(\{/);
});

test('diagnostics expose evidence-first route explicitly', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/lab-background.js', import.meta.url), 'utf8');
  assert.match(source, /UNDERSTANDING → KB при необходимости → evidence plan → READ → один финальный synthesis → локальная проверка/);
  assert.match(source, /evidenceFirst: Boolean\(item\.evidenceFirst\)/);
});
