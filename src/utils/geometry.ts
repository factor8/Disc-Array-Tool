import { PlacedDisc } from '../core/types';

/** Check if two circles overlap (including spacing) */
export function circlesOverlap(
  x1: number, y1: number, r1: number,
  x2: number, y2: number, r2: number,
  spacing: number
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distSq = dx * dx + dy * dy;
  const minDist = r1 + r2 + spacing;
  return distSq < minDist * minDist;
}

/** Check if a circle fits within a rectangle (with spacing from edges) */
export function circleInBounds(
  cx: number, cy: number, radius: number,
  width: number, height: number,
  spacing: number
): boolean {
  const margin = radius + spacing;
  return cx >= margin && cy >= margin &&
         cx <= width - margin && cy <= height - margin;
}

/** Check if a disc can be placed without overlapping any existing discs */
export function canPlace(
  cx: number, cy: number, radius: number,
  placed: PlacedDisc[],
  sheetWidth: number, sheetHeight: number,
  spacing: number
): boolean {
  if (!circleInBounds(cx, cy, radius, sheetWidth, sheetHeight, spacing)) {
    return false;
  }

  for (const disc of placed) {
    if (circlesOverlap(cx, cy, radius, disc.x, disc.y, disc.diameter / 2, spacing)) {
      return false;
    }
  }

  return true;
}

/** Find the largest empty rectangle area in a sheet (approximate) */
export function estimateEmptyArea(
  placed: PlacedDisc[],
  sheetWidth: number,
  sheetHeight: number
): number {
  const totalDiscArea = placed.reduce((sum, d) => {
    return sum + Math.PI * (d.diameter / 2) ** 2;
  }, 0);
  return sheetWidth * sheetHeight - totalDiscArea;
}
