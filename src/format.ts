// Tiny, dependency-free output helpers: ANSI colour, number/money formatting,
// and a column-aligned table. Colour auto-disables when stdout isn't a TTY or
// NO_COLOR is set.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = wrap("1");
export const dim = wrap("2");
export const green = wrap("32");
export const yellow = wrap("33");
export const red = wrap("31");
export const cyan = wrap("36");

export function money(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(3)}`;
}

export function num(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

// Visible length (ANSI codes don't take horizontal space).
function vlen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function pad(s: string, width: number, right: boolean): string {
  const gap = Math.max(0, width - vlen(s));
  return right ? " ".repeat(gap) + s : s + " ".repeat(gap);
}

export interface Column {
  header: string;
  right?: boolean;
}

export function table(cols: Column[], rows: string[][]): string {
  const widths = cols.map((c, i) =>
    Math.max(vlen(c.header), ...rows.map((r) => vlen(r[i] ?? ""))),
  );
  const head = cols.map((c, i) => bold(pad(c.header, widths[i], c.right ?? false))).join("  ");
  const body = rows.map((r) =>
    r.map((cell, i) => pad(cell ?? "", widths[i], cols[i].right ?? false)).join("  "),
  );
  return [head, ...body].join("\n");
}
