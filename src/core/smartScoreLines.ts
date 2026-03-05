import { SheetLayout, ScoreConfig, ScoreLine } from './types';
import { hitsDisc, hitsScrapCut, hitsSheetEdge, RAY_STEP } from './scoreLines';

/**
 * Generate strategically-placed score lines optimized for breaking the sheet by hand.
 *   - Gap marks: short axial ticks between close discs
 *   - Diagonal lines: 45-degree rays from each disc that break the large waste pockets
 */
export function generateSmartScoreLines(sheet: SheetLayout, config: ScoreConfig): ScoreLine[] {
  const lines: ScoreLine[] = [];
  const toggles = config.smartToggles;

  if (toggles.gapMarks) {
    lines.push(...generateGapMarks(sheet, config));
  }
  if (toggles.diagonalLines) {
    lines.push(...generateDiagonalLines(sheet, config));
  }

  return lines;
}

// ── Gap Marks ──────────────────────────────────────────────────────────

/**
 * For each pair of close discs, place a short mark along the center-to-center
 * axis at the thinnest point between them. Scores through the bridge material.
 */
function generateGapMarks(sheet: SheetLayout, config: ScoreConfig): ScoreLine[] {
  const lines: ScoreLine[] = [];
  const settings = config.smartSettings;
  const discs = sheet.discs;

  for (let i = 0; i < discs.length; i++) {
    for (let j = i + 1; j < discs.length; j++) {
      const a = discs[i];
      const b = discs[j];
      const ra = a.diameter / 2;
      const rb = b.diameter / 2;

      const cx = b.x - a.x;
      const cy = b.y - a.y;
      const centerDist = Math.sqrt(cx * cx + cy * cy);
      if (centerDist === 0) continue;

      const gap = centerDist - ra - rb;
      if (gap <= 0 || gap > settings.gapMaxThreshold) continue;

      // Direction from a to b (normalized)
      const dirX = cx / centerDist;
      const dirY = cy / centerDist;

      // Midpoint of the gap along the center-to-center axis
      const midDist = ra + gap / 2;
      const mx = a.x + dirX * midDist;
      const my = a.y + dirY * midDist;

      // Mark along the center-to-center axis (scores through the bridge)
      // Mark half-length: proportional to gap, min 0.125"
      const markHalf = Math.max(0.125, gap * settings.gapMarkLengthRatio / 2);

      let x1 = mx - dirX * markHalf;
      let y1 = my - dirY * markHalf;
      let x2 = mx + dirX * markHalf;
      let y2 = my + dirY * markHalf;

      // Clip to sheet bounds
      if (x1 < 0 || x1 > sheet.width || y1 < 0 || y1 > sheet.height) {
        x1 = mx; y1 = my;
      }
      if (x2 < 0 || x2 > sheet.width || y2 < 0 || y2 > sheet.height) {
        x2 = mx; y2 = my;
      }

      // Skip if both endpoints collapsed to midpoint
      const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      if (len < 0.1) continue;

      // Skip if midpoint lands inside a scrap cut
      if (hitsScrapCut(mx, my, sheet, config.scoreShapeMargin)) continue;

      lines.push({ x1, y1, x2, y2 });
    }
  }

  return lines;
}

// ── Diagonal Lines ─────────────────────────────────────────────────────

// 45-degree angles: NE, SE, SW, NW
const DIAGONAL_ANGLES = [
  Math.PI * 0.25,   // 45°  — NE
  Math.PI * 0.75,   // 135° — SE
  Math.PI * 1.25,   // 225° — SW
  Math.PI * 1.75,   // 315° — NW
];

/**
 * Cast 4 diagonal (45°) rays from each disc outward. These cut through the
 * large curved waste pockets that form in the corners between four adjacent discs.
 * Uses the same ray-march approach as the radial generator.
 */
function generateDiagonalLines(sheet: SheetLayout, config: ScoreConfig): ScoreLine[] {
  const lines: ScoreLine[] = [];

  for (let di = 0; di < sheet.discs.length; di++) {
    const disc = sheet.discs[di];
    const radius = disc.diameter / 2;
    const startDist = radius + config.scoreDiscMargin;

    for (const angle of DIAGONAL_ANGLES) {
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);

      const x1 = disc.x + dirX * startDist;
      const y1 = disc.y + dirY * startDist;

      // Skip if start is invalid
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

      const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      if (length >= config.minScoreLength) {
        lines.push({ x1, y1, x2, y2 });
      }
    }
  }

  return lines;
}
