let forcedEnabled: boolean | undefined;

/** Called once from index.ts after parsing --no-color. */
export function setColorEnabled(setEnabled: boolean): void {
  forcedEnabled = setEnabled;
}

function enabled(): boolean {
  if (forcedEnabled !== undefined) return forcedEnabled;
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY;
}

function wrap(code: string): (s: string) => string {
  return (s: string) => (enabled() ? `\x1b[${code}m${s}\x1b[0m` : s);
}

export const bold = wrap('1');
export const dim = wrap('2');
export const red = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');
export const cyan = wrap('36');
