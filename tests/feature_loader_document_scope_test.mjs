import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeatureLoader } from '../src/infrastructure/feature-loader.js';

function fakeChrome() {
  const calls = [];
  return {
    calls,
    api: {
      scripting: {
        async executeScript(spec) {
          calls.push(spec);
          return [];
        }
      }
    }
  };
}

test('same feature in same document is injected only once', async () => {
  const fake = fakeChrome();
  const loader = createFeatureLoader({ chromeApi: fake.api });
  const sender = { tab: { id: 7 }, documentId: 'doc-a' };

  await loader.inject('call', sender);
  const second = await loader.inject('call', sender);

  assert.equal(fake.calls.length, 1);
  assert.equal(second.already, true);
});

test('navigation in the same tab injects feature into the new document', async () => {
  const fake = fakeChrome();
  const loader = createFeatureLoader({ chromeApi: fake.api });

  await loader.inject('call', { tab: { id: 7 }, documentId: 'doc-a' });
  const secondDocument = await loader.inject('call', { tab: { id: 7 }, documentId: 'doc-b' });

  assert.equal(fake.calls.length, 2);
  assert.equal(secondDocument.already, false);
});

test('reload of same URL cannot be mistaken for the old document', async () => {
  const fake = fakeChrome();
  const loader = createFeatureLoader({ chromeApi: fake.api });

  await loader.inject('call', { tab: { id: 9 }, documentId: 'reload-1', url: 'https://admin.simnet.kiev.ua/a' });
  await loader.inject('call', { tab: { id: 9 }, documentId: 'reload-2', url: 'https://admin.simnet.kiev.ua/a' });

  assert.equal(fake.calls.length, 2);
});

test('sender without documentId favors reinjection instead of stale tab-only dedupe', async () => {
  const fake = fakeChrome();
  const loader = createFeatureLoader({ chromeApi: fake.api });
  const sender = { tab: { id: 11 } };

  await loader.inject('call', sender);
  await loader.inject('call', sender);

  assert.equal(fake.calls.length, 2);
});
