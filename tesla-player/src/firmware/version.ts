/**
 * Firmware versions as the Syntherrupter reports them (0x204): main, sub,
 * bugfix and beta, a byte each from the top; a release has beta 255, so it
 * comes after all of its betas. A version string ("1.1.0", "1.1.0-beta.2")
 * reads like the firmware reads its own: its digit groups, in order.
 */

const RELEASE = 255;

/** The 0x204 number of a version string. */
export function versionNumber(text: string): number {
  const groups = (text.match(/\d+/g) ?? []).slice(0, 4).map((g) => Math.min(255, Number(g)));
  const [main = 0, sub = 0, bugfix = 0, beta = RELEASE] = groups;
  // multiplications: a shift would turn a main version past 127 negative
  return main * 0x1000000 + sub * 0x10000 + bugfix * 0x100 + beta;
}

/** "v4.2.2", "v1.1.0-beta.2" */
export function formatVersion(n: number): string {
  const beta = n & 0xff;
  const bugfix = (n >>> 8) & 0xff;
  const sub = (n >>> 16) & 0xff;
  const main = (n >>> 24) & 0xff;
  return `v${main}.${sub}.${bugfix}` + (beta === RELEASE ? '' : `-beta.${beta}`);
}

/** The board's own number, unsigned whatever way it was read. */
export const boardVersion = (valueInt: number): number => valueInt >>> 0;
