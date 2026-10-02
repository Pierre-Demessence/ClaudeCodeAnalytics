const ENDPOINT_RESULTS: Record<string, string> = {
  'bad-shape': 'the response format changed; manual readings still work',
  'expired': 'token expired; Claude Code refreshes it on its next start',
  'network': 'network error',
  'no-token': 'no Claude Code login found',
  'ok': 'OK',
};

/** What the last usage endpoint call returned, in words. */
export function endpointResultText(result: string): string {
  return ENDPOINT_RESULTS[result] ?? (result === 'http-429' ? 'rate limited; retried at the next run' : `failed (${result})`);
}
