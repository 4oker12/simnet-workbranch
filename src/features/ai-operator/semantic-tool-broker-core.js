'use strict';

import * as base from './semantic-tool-broker-core-runtime-base.js';
import {
  compactFactResolutionForSynthesis,
  compactRuntimeAnalysis,
  compactRuntimeTranscript
} from './runtime-projection.js';

export * from './semantic-tool-broker-core-runtime-base.js';

export async function groundSubscriberReply(options = {}) {
  const originalFactResolution = options?.factResolution || null;
  const result = await base.groundSubscriberReply({
    ...options,
    transcript: compactRuntimeTranscript(options?.transcript, { maxTurns: 10, maxChars: 520 }),
    analysis: compactRuntimeAnalysis(options?.analysis),
    factResolution: compactFactResolutionForSynthesis(originalFactResolution)
  });

  if (!originalFactResolution) return result;
  return {
    ...result,
    factDiagnostics: originalFactResolution?.diagnostics || result?.factDiagnostics || {}
  };
}
