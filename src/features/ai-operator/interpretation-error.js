function cleanRateLimit(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const number = value => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  return {
    limitTokens: number(source.limitTokens),
    remainingTokens: number(source.remainingTokens),
    resetTokens: String(source.resetTokens || '').slice(0, 80),
    remainingRequests: number(source.remainingRequests),
    retryAfter: String(source.retryAfter || '').slice(0, 80)
  };
}

export function interpretationErrorDetails(error) {
  const message = String(error?.message || error || 'Unknown interpretation error').replace(/\s+/g, ' ').trim();
  const status = Number(error?.status || 0);
  return {
    code: 'INTERPRETATION_ERROR',
    message: message.slice(0, 900),
    status: Number.isFinite(status) && status > 0 ? status : 0,
    rateLimit: cleanRateLimit(error?.rateLimit)
  };
}
