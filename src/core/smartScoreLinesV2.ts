import { SheetLayout, ScoreConfig, ScoreLine } from './types';
import { hitsDisc, hitsScrapCut, hitsSheetEdge, RAY_STEP } from './scoreLines';

// ── Distance Field ────────────────────────────────────────────────────

/** Grid resolution for negative-space sampling (inches) */
const GRID_STEP = 0.5;
/** Minimum distance between peaks before they get merged */
const PEAK_MERGE_RADIUS = 3.0;
/** Number of opposing ray PAIRS cast from each peak (4 pairs = 8 directions) */
const RAY_PAIR_COUNT = 4;
/** Max through-lines to keep per peak (only the longest) */
const MAX_LINES_PER_PEAK = 1;

interface GridPoint {
  x: number;
  y: number;
  distance: number; // distance to nearest obstacle edge
}

/**
 * Compute the minimum distance from a point to the nearest obstacle
 * (disc edge, scrap cut edge, sheet edge). Returns 0 if inside an obstacle.
 */
function distanceToNearestObstacle(
  px: number,
  py: number,
  sheet: SheetLayout
): number {
  let minDist = Infinity;

  // Distance to sheet edges
  minDist = Math.min(minDist, px, py, sheet.width - px, sheet.height - py);

  // Distance to disc edges
  for (const disc of sheet.discs) {
    const dx = px - disc.x;
    const dy = py - disc.y;
    const centerDist = Math.sqrt(dx * dx + dy * dy);
    const edgeDist = centerDist - disc.diameter / 2;
    if (edgeDist < minDist) minDist = edgeDist;
  }

  // Distance to scrap cut edges
  if (sheet.scrapCuts) {
    for (const cut of sheet.scrapCuts) {
      // Point inside rectangle → distance 0
      if (px >= cut.x && px <= cut.x + cut.width &&
          py >= cut.y && py <= cut.y + cut.height) {
        return 0;
      }
      // Nearest point on rectangle boundary
      const cx = Math.max(cut.x, Math.min(px, cut.x + cut.width));
      const cy = Math.max(cut.y, Math.min(py, cut.y + cut.height));
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) minDist = dist;
    }
  }

  return Math.max(0, minDist);
}

/**
 * Check if a point is inside any disc (not just exclusion zone).
 */
function isInsideDisc(px: number, py: number, sheet: SheetLayout): boolean {
  for (const disc of sheet.discs) {
    const dx = px - disc.x;
    const dy = py - disc.y;
    if (dx * dx + dy * dy <= (disc.diameter / 2) ** 2) return true;
  }
  return false;
}

// ── Peak Detection ────────────────────────────────────────────────────

/**
 * Build a distance field grid over the sheet and find local maxima
 * (centers of large open areas in the negative space).
 */
function findOpenAreaPeaks(
  sheet: SheetLayout,
  minGap: number
): GridPoint[] {
  const cols = Math.ceil(sheet.width / GRID_STEP) + 1;
  const rows = Math.ceil(sheet.height / GRID_STEP) + 1;

  // Build grid
  const grid: GridPoint[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: GridPoint[] = [];
    for (let c = 0; c < cols; c++) {
      const x = c * GRID_STEP;
      const y = r * GRID_STEP;
      row.push({ x, y, distance: distanceToNearestObstacle(x, y, sheet) });
    }
    grid.push(row);
  }

  // Find local maxima
  const peaks: GridPoint[] = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const p = grid[r][c];
      if (p.distance < minGap) continue;

      let isPeak = true;
      for (let dr = -1; dr <= 1 && isPeak; dr++) {
        for (let dc = -1; dc <= 1 && isPeak; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (grid[r + dr][c + dc].distance > p.distance) {
            isPeak = false;
          }
        }
      }

      if (isPeak) peaks.push(p);
    }
  }

  // Merge nearby peaks — keep the one with the larger distance value
  const sorted = peaks.slice().sort((a, b) => b.distance - a.distance);
  const merged: GridPoint[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    merged.push(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const dx = sorted[i].x - sorted[j].x;
      const dy = sorted[i].y - sorted[j].y;
      if (dx * dx + dy * dy < PEAK_MERGE_RADIUS * PEAK_MERGE_RADIUS) {
        used.add(j);
      }
    }
  }

  return merged;
}

// ── Bridge Scoring ────────────────────────────────────────────────────

/**
 * Find thin bridges between all obstacle pairs and place score lines.
 * Covers disc-disc, disc-sheet-edge, and disc-scrap-cut bridges.
 */
function generateBridgeScores(
  sheet: SheetLayout,
  config: ScoreConfig
): ScoreLine[] {
  const lines: ScoreLine[] = [];
  const v2 = config.smartV2Settings;
  const minGap = v2.minHandBreakDistance;
  const maxGap = v2.maxBridgeWidth;
  const margin = config.scoreShapeMargin;

  // ── Disc-to-Disc bridges ──
  for (let i = 0; i < sheet.discs.length; i++) {
    for (let j = i + 1; j < sheet.discs.length; j++) {
      const a = sheet.discs[i];
      const b = sheet.discs[j];
      const ra = a.diameter / 2;
      const rb = b.diameter / 2;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const centerDist = Math.sqrt(dx * dx + dy * dy);
      if (centerDist === 0) continue;

      const gap = centerDist - ra - rb;
      if (gap <= minGap || gap > maxGap) continue;

      // Direction from a to b
      const dirX = dx / centerDist;
      const dirY = dy / centerDist;

      // Score line along the center axis through the bridge midpoint
      const midDist = ra + gap / 2;
      const mx = a.x + dirX * midDist;
      const my = a.y + dirY * midDist;

      // Line extends along the axis, clipped to stay within the bridge
      const halfLen = Math.max(0.125, (gap - margin * 2) / 2);
      const x1 = mx - dirX * halfLen;
      const y1 = my - dirY * halfLen;
      const x2 = mx + dirX * halfLen;
      const y2 = my + dirY * halfLen;

      // Skip if midpoint is inside a scrap cut
      if (hitsScrapCut(mx, my, sheet, 0)) continue;

      const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      if (len >= 0.1) {
        lines.push({ x1, y1, x2, y2 });
      }
    }
  }

  // ── Disc-to-Sheet-Edge bridges ──
  for (const disc of sheet.discs) {
    const r = disc.diameter / 2;

    // Check all 4 edges
    const edgeDistances: { gap: number; mx: number; my: number; dirX: number; dirY: number }[] = [
      { gap: disc.x - r, mx: disc.x - r - (disc.x - r) / 2, my: disc.y, dirX: -1, dirY: 0 },  // left
      { gap: disc.y - r, mx: disc.x, my: disc.y - r - (disc.y - r) / 2, dirX: 0, dirY: -1 },  // top
      { gap: sheet.width - (disc.x + r), mx: disc.x + r + (sheet.width - disc.x - r) / 2, my: disc.y, dirX: 1, dirY: 0 },  // right
      { gap: sheet.height - (disc.y + r), mx: disc.x, my: disc.y + r + (sheet.height - disc.y - r) / 2, dirX: 0, dirY: 1 },  // bottom
    ];

    for (const edge of edgeDistances) {
      if (edge.gap <= minGap || edge.gap > maxGap) continue;

      // Check if midpoint is occluded by another disc or scrap cut
      if (isInsideDisc(edge.mx, edge.my, sheet)) continue;
      if (hitsScrapCut(edge.mx, edge.my, sheet, 0)) continue;

      // Score line perpendicular to the edge direction through the midpoint
      const halfLen = Math.max(0.125, (edge.gap - margin * 2) / 2);
      let x1: number, y1: number, x2: number, y2: number;

      if (edge.dirX !== 0) {
        // Horizontal bridge → score is horizontal
        x1 = edge.mx - halfLen;
        y1 = edge.my;
        x2 = edge.mx + halfLen;
        y2 = edge.my;
      } else {
        // Vertical bridge → score is vertical
        x1 = edge.mx;
        y1 = edge.my - halfLen;
        x2 = edge.mx;
        y2 = edge.my + halfLen;
      }

      const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      if (len >= 0.1) {
        lines.push({ x1, y1, x2, y2 });
      }
    }
  }

  // ── Disc-to-Scrap-Cut bridges ──
  if (sheet.scrapCuts) {
    for (const disc of sheet.discs) {
      const dr = disc.diameter / 2;

      for (const cut of sheet.scrapCuts) {
        // Find nearest point on scrap rectangle to disc center
        const cx = Math.max(cut.x, Math.min(disc.x, cut.x + cut.width));
        const cy = Math.max(cut.y, Math.min(disc.y, cut.y + cut.height));
        const dx = disc.x - cx;
        const dy = disc.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) continue;

        const gap = dist - dr;
        if (gap <= minGap || gap > maxGap) continue;

        // Direction from scrap toward disc
        const dirX = dx / dist;
        const dirY = dy / dist;

        // Midpoint of bridge
        const mx = cx + dirX * (gap / 2);
        const my = cy + dirY * (gap / 2);

        // Skip if midpoint is inside another obstacle
        if (isInsideDisc(mx, my, sheet)) continue;
        if (hitsScrapCut(mx, my, sheet, 0)) continue;

        const halfLen = Math.max(0.125, (gap - margin * 2) / 2);
        const x1 = mx - dirX * halfLen;
        const y1 = my - dirY * halfLen;
        const x2 = mx + dirX * halfLen;
        const y2 = my + dirY * halfLen;

        const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        if (len >= 0.1) {
          lines.push({ x1, y1, x2, y2 });
        }
      }
    }
  }

  return lines;
}

// ── Area Subdivision ──────────────────────────────────────────────────

/**
 * Find large open areas in the negative space and place a single
 * long score line through each one.
 *
 * For each peak (pocket center), find the nearest disc and cast a ray
 * FROM that disc's edge THROUGH the peak to the far side. This produces
 * long lines spanning the full crescent/pocket, like the best radial
 * lines but limited to one per open area.
 */
function generateAreaSlices(
  sheet: SheetLayout,
  config: ScoreConfig
): ScoreLine[] {
  const lines: ScoreLine[] = [];
  const v2 = config.smartV2Settings;
  const margin = config.scoreShapeMargin;

  const peaks = findOpenAreaPeaks(sheet, v2.areaSliceMinGap);

  for (const peak of peaks) {
    // Find the nearest disc to this pocket center
    let nearestIdx = -1;
    let nearestEdgeDist = Infinity;
    for (let i = 0; i < sheet.discs.length; i++) {
      const disc = sheet.discs[i];
      const dx = peak.x - disc.x;
      const dy = peak.y - disc.y;
      const edgeDist = Math.sqrt(dx * dx + dy * dy) - disc.diameter / 2;
      if (edgeDist < nearestEdgeDist) {
        nearestEdgeDist = edgeDist;
        nearestIdx = i;
      }
    }

    if (nearestIdx < 0) continue;

    const disc = sheet.discs[nearestIdx];
    const dx = peak.x - disc.x;
    const dy = peak.y - disc.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) continue;

    // Direction from disc center through the peak
    const dirX = dx / dist;
    const dirY = dy / dist;

    // Start ray at disc edge + margin
    const startDist = disc.diameter / 2 + margin;
    const x1 = disc.x + dirX * startDist;
    const y1 = disc.y + dirY * startDist;

    // Skip if start is already invalid
    if (hitsSheetEdge(x1, y1, sheet, margin) ||
        hitsDisc(x1, y1, sheet, margin, nearestIdx) ||
        hitsScrapCut(x1, y1, sheet, margin)) {
      continue;
    }

    // March outward from disc edge through the peak until hitting far obstacle
    let x2 = x1;
    let y2 = y1;
    let marchDist = startDist + RAY_STEP;

    while (true) {
      const px = disc.x + dirX * marchDist;
      const py = disc.y + dirY * marchDist;

      if (hitsSheetEdge(px, py, sheet, margin) ||
          hitsDisc(px, py, sheet, margin, nearestIdx) ||
          hitsScrapCut(px, py, sheet, margin)) {
        break;
      }

      x2 = px;
      y2 = py;
      marchDist += RAY_STEP;
    }

    const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    if (length >= config.minScoreLength) {
      lines.push({ x1, y1, x2, y2 });
    }
  }

  return deduplicateLines(lines);
}

/**
 * Remove near-duplicate lines (from adjacent peaks casting overlapping rays).
 * Two lines are considered duplicates if their midpoints and angles are close.
 */
function deduplicateLines(lines: ScoreLine[]): ScoreLine[] {
  const MIDPOINT_THRESHOLD = 1.0; // inches
  const ANGLE_THRESHOLD = 0.15;   // radians (~8.5°)

  const kept: ScoreLine[] = [];

  for (const line of lines) {
    const mx = (line.x1 + line.x2) / 2;
    const my = (line.y1 + line.y2) / 2;
    const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
    // Normalize angle to [0, PI) since lines are undirected
    const normAngle = ((angle % Math.PI) + Math.PI) % Math.PI;

    let isDuplicate = false;
    for (const existing of kept) {
      const emx = (existing.x1 + existing.x2) / 2;
      const emy = (existing.y1 + existing.y2) / 2;
      const eAngle = Math.atan2(existing.y2 - existing.y1, existing.x2 - existing.x1);
      const eNormAngle = ((eAngle % Math.PI) + Math.PI) % Math.PI;

      const distSq = (mx - emx) ** 2 + (my - emy) ** 2;
      const angleDiff = Math.abs(normAngle - eNormAngle);
      const wrappedAngleDiff = Math.min(angleDiff, Math.PI - angleDiff);

      if (distSq < MIDPOINT_THRESHOLD ** 2 && wrappedAngleDiff < ANGLE_THRESHOLD) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(line);
    }
  }

  return kept;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Smart v2 score line generation: negative-space-first approach.
 * 1. Bridge scoring: finds thin material bridges between obstacles and scores them
 * 2. Area subdivision: finds large open areas and slices them with radial lines
 */
export function generateSmartV2ScoreLines(
  sheet: SheetLayout,
  config: ScoreConfig
): ScoreLine[] {
  const lines: ScoreLine[] = [];
  const toggles = config.smartV2Toggles;

  if (toggles.bridgeScoring) {
    lines.push(...generateBridgeScores(sheet, config));
  }
  if (toggles.areaSubdivision) {
    lines.push(...generateAreaSlices(sheet, config));
  }

  return lines;
}
