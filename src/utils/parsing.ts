/**
 * Parse a fractional inch string into a decimal number.
 * Supports formats like:
 *   "31 31/32"  → 31.96875
 *   "0.5"       → 0.5
 *   "1/2"       → 0.5
 *   "12"        → 12
 *   "31 31/32"" → 31.96875 (strips trailing quote)
 */
export function parseInches(input: string): number | null {
  const s = input.trim().replace(/["″'']/g, '').trim();
  if (!s) return null;

  // Try plain decimal (allows leading dot like ".5")
  if (/^\d*\.?\d+$/.test(s)) {
    return parseFloat(s);
  }

  // Try fraction only: "31/32"
  const fractionOnly = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fractionOnly) {
    const num = parseInt(fractionOnly[1]);
    const den = parseInt(fractionOnly[2]);
    if (den === 0) return null;
    return num / den;
  }

  // Try mixed number: "31 31/32"
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = parseInt(mixed[1]);
    const num = parseInt(mixed[2]);
    const den = parseInt(mixed[3]);
    if (den === 0) return null;
    return whole + num / den;
  }

  return null;
}

export function formatInches(value: number): string {
  // Common fractions to check
  const fractions = [
    [1, 32], [1, 16], [3, 32], [1, 8], [5, 32], [3, 16], [7, 32],
    [1, 4], [9, 32], [5, 16], [11, 32], [3, 8], [13, 32], [7, 16],
    [15, 32], [1, 2], [17, 32], [9, 16], [19, 32], [5, 8], [21, 32],
    [11, 16], [23, 32], [3, 4], [25, 32], [13, 16], [27, 32], [7, 8],
    [29, 32], [15, 16], [31, 32]
  ] as [number, number][];

  const whole = Math.floor(value);
  const frac = value - whole;

  if (Math.abs(frac) < 0.001) {
    return `${whole}`;
  }

  for (const [num, den] of fractions) {
    if (Math.abs(frac - num / den) < 0.001) {
      return whole > 0 ? `${whole} ${num}/${den}` : `${num}/${den}`;
    }
  }

  return value.toFixed(4);
}
