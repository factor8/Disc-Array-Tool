import { SheetLayout, ScoreConfig, ScoreLine } from './types';
import { generateSmartScoreLines } from './smartScoreLines';
import { generateSmartV2ScoreLines } from './smartScoreLinesV2';

export const RAY_STEP = 0.125; // march step in inches

/**
 * Check if a point is inside any disc's exclusion zone.
 */
export function hitsDisc(
  px: number,
  py: number,
  sheet: SheetLayout,
  margin: number,
  sourceDiscIndex: number
): boolean {
  for (let i = 0; i < sheet.discs.length; i++) {
    if (i === sourceDiscIndex) continue;
    const disc = sheet.discs[i];
    const exclusion = disc.diameter / 2 + margin;
    const dx = px - disc.x;
    const dy = py - disc.y;
    if (dx * dx + dy * dy <= exclusion * exclusion) return true;
  }
  return false;
}

/**
 * Check if a point is inside any scrap cut rectangle (with margin).
 */
export function hitsScrapCut(px: number, py: number, sheet: SheetLayout, margin: number): boolean {
  if (!sheet.scrapCuts) return false;
  for (const cut of sheet.scrapCuts) {
    if (px >= cut.x - margin && px <= cut.x + cut.width + margin &&
        py >= cut.y - margin && py <= cut.y + cut.height + margin) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a point is within margin of the sheet edge.
 */
export function hitsSheetEdge(px: number, py: number, sheet: SheetLayout, margin: number): boolean {
  return px < margin || px > sheet.width - margin ||
         py < margin || py > sheet.height - margin;
}

/**
 * Generate score lines — dispatches to radial or smart mode.
 */
export function generateScoreLines(sheet: SheetLayout, config: ScoreConfig): ScoreLine[] {
  if (config.mode === 'smart') {
    return generateSmartScoreLines(sheet, config);
  }
  if (config.mode === 'smart-v2') {
    return generateSmartV2ScoreLines(sheet, config);
  }
  return generateRadialScoreLines(sheet, config);
}

/**
 * Generate radial score lines for all discs on a sheet.
 * Lines radiate outward from each disc and stop when they hit
 * another disc, a scrap rectangle, or the sheet edge.
 */
function generateRadialScoreLines(sheet: SheetLayout, config: ScoreConfig): ScoreLine[] {
  const numRays = config.scoreDensity === 'low' ? 4
    : config.scoreDensity === 'medium' ? 8
    : 16;

  const lines: ScoreLine[] = [];

  for (let di = 0; di < sheet.discs.length; di++) {
    const disc = sheet.discs[di];
    const discRadius = disc.diameter / 2;
    const startDist = discRadius + config.scoreDiscMargin;

    for (let r = 0; r < numRays; r++) {
      const angle = (r / numRays) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);

      // Ray start point (just outside disc + disc margin)
      const x1 = disc.x + dirX * startDist;
      const y1 = disc.y + dirY * startDist;

      // If start is already invalid, skip
      if (hitsSheetEdge(x1, y1, sheet, config.scoreShapeMargin) ||
          hitsDisc(x1, y1, sheet, config.scoreShapeMargin, di) ||
          hitsScrapCut(x1, y1, sheet, config.scoreShapeMargin)) {
        continue;
      }

      // March outward
      let dist = startDist + RAY_STEP;
      let x2 = x1;
      let y2 = y1;

      while (true) {
        const px = disc.x + dirX * dist;
        const py = disc.y + dirY * dist;

        if (hitsSheetEdge(px, py, sheet, config.scoreShapeMargin) ||
            hitsDisc(px, py, sheet, config.scoreShapeMargin, di) ||
            hitsScrapCut(px, py, sheet, config.scoreShapeMargin)) {
          break;
        }

        x2 = px;
        y2 = py;
        dist += RAY_STEP;
      }

      // Check minimum length
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy);

      if (length >= config.minScoreLength) {
        lines.push({ x1, y1, x2, y2 });
      }
    }
  }

  return lines;
}
