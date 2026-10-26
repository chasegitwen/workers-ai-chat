export function isUncertainSubmissionFailure(error, requestWasSent) {
  if (!requestWasSent) return false;
  const name = String(error?.name || "");
  const message = String(error?.message || error || "");
  return error?.requestSent === true
    || error?.requestDispatched === true
    || /timeout|timed out|closed|disconnect|socket|transport/i.test(`${name} ${message}`);
}
