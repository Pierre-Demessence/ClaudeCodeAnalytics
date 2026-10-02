/**
 * End of the meter scale: 100 % when everything fits, else the highest value
 * rounded up to 10 %, and at least 125 % to leave room past the cap.
 */
export function scaleMax(values: readonly number[]): number {
  const top = Math.max(100, ...values);
  return top <= 100 ? 100 : Math.max(125, Math.ceil(top / 10) * 10);
}
