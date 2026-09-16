export function interpretationErrorDetails(error) {
  const message = String(error?.message || error || 'Unknown interpretation error').replace(/\s+/g, ' ').trim();
  const status = Number(error?.status || 0);
  return {
    code: 'INTERPRETATION_ERROR',
    message: message.slice(0, 900),
    status: Number.isFinite(status) && status > 0 ? status : 0
  };
}
