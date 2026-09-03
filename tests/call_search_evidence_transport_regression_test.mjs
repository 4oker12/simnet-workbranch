import assert from 'node:assert/strict';
import fs from 'node:fs';

const storeClient = fs.readFileSync(new URL('../src/core/store-client.js', import.meta.url), 'utf8');
const messages = fs.readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/content/bootstrap.js', import.meta.url), 'utf8');

// Regression: v1.7.36.73 called request(undefined, evidence) because the content-side
// MessageType mirror forgot CALL_SEARCH_EVIDENCE.
assert.match(storeClient, /CALL_SEARCH_EVIDENCE:\s*['"]CALL_SEARCH_EVIDENCE['"]/);
assert.match(messages, /CALL_SEARCH_EVIDENCE:\s*['"]CALL_SEARCH_EVIDENCE['"]/);
assert.match(background, /\[MessageType\.CALL_SEARCH_EVIDENCE\]: recordCallSearchEvidence/);
assert.match(background, /callMessageRouter\.canHandle\(type\)/);
assert.match(bootstrap, /recordCallSearch\?\./);

// Search evidence is auxiliary: a failed write must not trigger the global fatal overlay.
assert.match(storeClient, /NON_FATAL_REQUEST_TYPES/);
assert.match(storeClient, /NON_FATAL_REQUEST_TYPES\.has\(type\)/);
assert.match(storeClient, /Не удалось сохранить evidence/);

// Error objects returned by the worker must not degrade to a bare [object Object].
assert.match(storeClient, /requestErrorText/);
assert.match(storeClient, /JSON\.stringify\(raw\)/);

console.log('call_search_evidence_transport_regression_test: PASS');
