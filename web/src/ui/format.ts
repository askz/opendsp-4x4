// Display formatting and tolerant parsing for numeric fields.

/** "40.3", "309", "2.02k", "10.2k" (unit shown separately). */
export function formatHz(hz: number): string {
  if (hz >= 10000) return `${(hz / 1000).toFixed(1)}k`;
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)}k`;
  if (hz >= 100) return hz.toFixed(0);
  return hz.toFixed(1);
}

/** Signed dB with a fixed number of decimals: "+3.0", "-6.5", "0.0". */
export function formatDb(db: number, decimals = 1): string {
  const text = Math.abs(db).toFixed(decimals);
  if (Number(text) === 0) return (0).toFixed(decimals);
  return `${db > 0 ? "+" : "-"}${text}`;
}

export function formatFixed(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

const UNIT_SUFFIX = /\s*(hz|db|ms|oct|q|%)$/i;

/**
 * Parse user input: accepts "," as decimal separator, a trailing unit, and a
 * "k" multiplier ("1.2k", "1k2" = 1200). Returns null when not a number.
 */
export function parseNumber(text: string): number | null {
  let source = text.trim().replace(",", ".").replace(UNIT_SUFFIX, "");
  let multiplier = 1;
  const embeddedK = /^(-?\d+)k(\d+)$/i.exec(source);
  if (embeddedK) {
    source = `${embeddedK[1]}.${embeddedK[2]}`;
    multiplier = 1000;
  } else if (/k$/i.test(source)) {
    source = source.slice(0, -1);
    multiplier = 1000;
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(source)) return null;
  return Number(source) * multiplier;
}
