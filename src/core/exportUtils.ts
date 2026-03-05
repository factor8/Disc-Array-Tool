import { SheetLayout } from './types';

/** Build a disc legend string grouping discs by diameter, e.g. "4x Ø12\" | 2x Ø8\"" */
export function buildDiscLegend(sheet: SheetLayout): string {
  const counts = new Map<number, number>();
  for (const disc of sheet.discs) {
    counts.set(disc.diameter, (counts.get(disc.diameter) || 0) + 1);
  }

  // Sort largest first
  const entries = [...counts.entries()].sort((a, b) => b[0] - a[0]);
  return entries.map(([dia, count]) => `${count}x ${dia}"`).join(' | ');
}
