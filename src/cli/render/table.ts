import { bold } from './color.ts';

export interface Column<T> {
  header: string;
  value: (row: T) => string;
}

export function renderTable<T>(rows: readonly T[], columns: ReadonlyArray<Column<T>>): string {
  const cell = (c: Column<T>, r: T): string => c.value(r);
  const widths = columns.map((c) => Math.max(c.header.length, ...rows.map((r) => cell(c, r).length)));
  const line = (cells: readonly string[]): string =>
    cells
      .map((s, i) => s.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();

  const header = bold(line(columns.map((c) => c.header)));
  const body = rows.map((r) => line(columns.map((c) => cell(c, r))));
  return [header, ...body].join('\n');
}
