import { SheetLayout, ExportColors } from './types';

/** Built-in export colors, matching the tool's original hard-coded palette. */
export const DEFAULT_EXPORT_COLORS: ExportColors = {
  boundary: '#00FFFF',    // cyan
  cuts: '#FF0000',        // red
  disassembly: '#FF00FF', // magenta
  score: '#00FF00',       // green
};

/** Convert a '#RRGGBB' hex string to an integer 0xRRGGBB (for DXF true color). */
export function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** Convert a '#RRGGBB' hex string to an [r, g, b] triple, 0–255 (for PDF). */
export function hexToRgb(hex: string): [number, number, number] {
  const n = hexToInt(hex);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

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
