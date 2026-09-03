'use strict';

import { SCORING_VERSION } from '../config.js';

/**
 * Absolute confidence calibration for the v1 weights inherited from .75.
 * It is intentionally independent of neighbouring candidates.
 */
export function confidenceFromScore(rawScore, options = {}) {
  if (options.hardConflict === true) return 0;
  if (options.authoritative === true) return 100;
  const score = Math.max(0, Number(rawScore || 0));
  if (!score) return 0;
  if (score < 50) return Math.min(34, Math.round(score * 0.68));
  if (score < 90) return Math.min(54, Math.round(35 + (score - 50) * 0.5));
  if (score < 140) return Math.min(79, Math.round(55 + (score - 90) * 0.5));
  if (score < 220) return Math.min(92, Math.round(80 + (score - 140) * 0.15));
  return Math.min(99, Math.round(93 + Math.min(6, (score - 220) / 35)));
}

export const confidenceCalibration = Object.freeze({ scoringVersion: SCORING_VERSION });
