import { DiscSpec, SheetConfig, SheetLayout, PlacedDisc, NestingResult, OptimizationMode, NestingConfig } from './types';
import { canPlace } from '../utils/geometry';

let nextSheetId = 0;

interface DiscJob {
  specId: string;
  diameter: number;
  centerHole: number | null;
}

function expandDiscs(specs: DiscSpec[]): DiscJob[] {
  const jobs: DiscJob[] = [];
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i++) {
      jobs.push({
        specId: spec.id,
        diameter: spec.diameter,
        centerHole: spec.centerHole,
      });
    }
  }
  return jobs;
}

/**
 * Place a circle on the sheet, scanning from the configured starting corner
 * in the configured primary direction.
 */
function findPlacement(
  radius: number,
  placed: PlacedDisc[],
  sheetWidth: number,
  sheetHeight: number,
  spacing: number,
  nestingConfig: NestingConfig
): { x: number; y: number } | null {
  const step = Math.max(radius / 3, 0.1);
  const margin = radius + spacing;

  const minX = margin;
  const maxX = sheetWidth - margin;
  const minY = margin;
  const maxY = sheetHeight - margin;

  // Determine scan directions based on corner
  const leftToRight = nestingConfig.corner === 'bottom-left' || nestingConfig.corner === 'top-left';
  const bottomToTop = nestingConfig.corner === 'bottom-left' || nestingConfig.corner === 'bottom-right';

  // Build scan ranges
  const xValues: number[] = [];
  const yValues: number[] = [];

  if (leftToRight) {
    for (let x = minX; x <= maxX; x += step) xValues.push(x);
  } else {
    for (let x = maxX; x >= minX; x -= step) xValues.push(x);
  }

  if (bottomToTop) {
    for (let y = maxY; y >= minY; y -= step) yValues.push(y);
  } else {
    for (let y = minY; y <= maxY; y += step) yValues.push(y);
  }

  // Primary and secondary axes based on direction
  const primaryIsHorizontal = nestingConfig.direction === 'horizontal';

  const outerValues = primaryIsHorizontal ? yValues : xValues;
  const innerValues = primaryIsHorizontal ? xValues : yValues;

  for (const outer of outerValues) {
    for (const inner of innerValues) {
      const x = primaryIsHorizontal ? inner : outer;
      const y = primaryIsHorizontal ? outer : inner;

      if (canPlace(x, y, radius, placed, sheetWidth, sheetHeight, spacing)) {
        // Settle: tighten position toward the starting corner.
        // The grid scan already found the right "slot" in scan order —
        // settling only nudges within that slot, it doesn't relocate.

        const settleAxis = (
          startVal: number,
          limitVal: number,
          getCanPlace: (v: number) => boolean,
          direction: 1 | -1
        ): number => {
          const coarseStep = step / 4;
          let best = startVal;
          let v = startVal + coarseStep * direction;
          while (direction === 1 ? v <= limitVal : v >= limitVal) {
            if (getCanPlace(v)) {
              best = v;
              v += coarseStep * direction;
            } else break;
          }
          // Binary search for precision
          let lo = best;
          let hi = best + coarseStep * direction;
          if (direction === 1) hi = Math.min(hi, limitVal);
          else hi = Math.max(hi, limitVal);
          for (let i = 0; i < 16; i++) {
            const mid = (lo + hi) / 2;
            if (getCanPlace(mid)) lo = mid;
            else hi = mid;
          }
          return lo;
        };

        let bestX = x;
        let bestY = y;
        const yDir = bottomToTop ? 1 : -1;
        const yLimit = bottomToTop ? maxY : minY;
        const xDir = leftToRight ? -1 : 1;
        const xLimit = leftToRight ? minX : maxX;

        // Settle primary axis first (the stacking direction), then secondary
        if (primaryIsHorizontal) {
          // Primary = X (horizontal), secondary = Y
          bestX = settleAxis(x, xLimit, (tx) => canPlace(tx, bestY, radius, placed, sheetWidth, sheetHeight, spacing), xDir as 1 | -1);
          bestY = settleAxis(y, yLimit, (ty) => canPlace(bestX, ty, radius, placed, sheetWidth, sheetHeight, spacing), yDir as 1 | -1);
          bestX = settleAxis(bestX, xLimit, (tx) => canPlace(tx, bestY, radius, placed, sheetWidth, sheetHeight, spacing), xDir as 1 | -1);
        } else {
          // Primary = Y (vertical), secondary = X
          bestY = settleAxis(y, yLimit, (ty) => canPlace(bestX, ty, radius, placed, sheetWidth, sheetHeight, spacing), yDir as 1 | -1);
          bestX = settleAxis(x, xLimit, (tx) => canPlace(tx, bestY, radius, placed, sheetWidth, sheetHeight, spacing), xDir as 1 | -1);
          bestY = settleAxis(bestY, yLimit, (ty) => canPlace(bestX, ty, radius, placed, sheetWidth, sheetHeight, spacing), yDir as 1 | -1);
        }

        // Perimeter tightening: try positions tangent to nearby discs
        // that are closer to the corner than the axis-settled result,
        // but only within the same scan cell (not relocating across the sheet)
        const maxDrift = radius * 2 + spacing;
        for (const disc of placed) {
          const dist = radius + disc.diameter / 2 + spacing;
          const dx = disc.x - bestX;
          const dy = disc.y - bestY;
          const centerDist = Math.sqrt(dx * dx + dy * dy);
          // Only consider nearby discs
          if (centerDist > dist + maxDrift) continue;

          for (let a = 0; a < 36; a++) {
            const angle = (a / 36) * Math.PI * 2;
            const cx = disc.x + Math.cos(angle) * dist;
            const cy = disc.y + Math.sin(angle) * dist;
            // Must stay near the original scan position (same slot)
            if (Math.abs(cx - x) > maxDrift || Math.abs(cy - y) > maxDrift) continue;
            if (!canPlace(cx, cy, radius, placed, sheetWidth, sheetHeight, spacing)) continue;

            // Score: primary axis first, then secondary (matches scan order)
            // "Better" means further along the primary stacking direction
            // and further along the secondary settle direction
            let dominated = false;
            if (primaryIsHorizontal) {
              // Primary = Y row, secondary = X within row
              const curPri = bestY * yDir;
              const candPri = cy * yDir;
              const curSec = bestX * xDir;
              const candSec = cx * xDir;
              if (candPri > curPri || (candPri === curPri && candSec > curSec)) dominated = true;
            } else {
              // Primary = X column, secondary = Y within column
              const curPri = bestX * xDir;
              const candPri = cx * xDir;
              const curSec = bestY * yDir;
              const candSec = cy * yDir;
              if (candPri > curPri || (candPri === curPri && candSec > curSec)) dominated = true;
            }
            if (dominated) {
              bestX = cx;
              bestY = cy;
            }
          }
        }

        return { x: bestX, y: bestY };
      }
    }
  }
  return null;
}

/**
 * Pack discs onto sheets using greedy bin-packing (largest first).
 */
function packGreedy(
  discs: DiscJob[],
  config: SheetConfig,
  nestingConfig: NestingConfig
): SheetLayout[] {
  // Sort largest first
  const sorted = [...discs].sort((a, b) => b.diameter - a.diameter);
  const sheets: SheetLayout[] = [];

  for (const disc of sorted) {
    let placed = false;
    const radius = disc.diameter / 2;

    // Try existing sheets
    for (const sheet of sheets) {
      const pos = findPlacement(radius, sheet.discs, config.width, config.height, config.spacing, nestingConfig);
      if (pos) {
        sheet.discs.push({
          x: pos.x,
          y: pos.y,
          diameter: disc.diameter,
          centerHole: disc.centerHole,
          specId: disc.specId,
        });
        placed = true;
        break;
      }
    }

    // New sheet
    if (!placed) {
      const id = `sheet-${nextSheetId++}`;
      const newSheet: SheetLayout = {
        id,
        templateId: id, // unique for greedy mode
        width: config.width,
        height: config.height,
        discs: [],
      };
      const pos = findPlacement(radius, newSheet.discs, config.width, config.height, config.spacing, nestingConfig);
      if (pos) {
        newSheet.discs.push({
          x: pos.x,
          y: pos.y,
          diameter: disc.diameter,
          centerHole: disc.centerHole,
          specId: disc.specId,
        });
      }
      sheets.push(newSheet);
    }
  }

  return sheets;
}

/**
 * Template-based nesting: try to build sheets that can be repeated.
 */
function packTemplated(
  discs: DiscJob[],
  specs: DiscSpec[],
  config: SheetConfig,
  nestingConfig: NestingConfig
): SheetLayout[] {
  const relevantSpecs = specs.filter(s => s.count > 0);

  let bestResult: SheetLayout[] | null = null;
  let bestUniqueCount = Infinity;

  const candidateRepeats = new Set<number>();
  for (const spec of relevantSpecs) {
    for (let k = 1; k <= spec.count; k++) {
      candidateRepeats.add(k);
    }
  }

  for (const repeatCount of Array.from(candidateRepeats).sort((a, b) => b - a)) {
    const templateCounts = new Map<string, number>();
    let totalPerTemplate = 0;

    for (const spec of relevantSpecs) {
      const perTemplate = Math.floor(spec.count / repeatCount);
      if (perTemplate > 0) {
        templateCounts.set(spec.id, perTemplate);
        totalPerTemplate += perTemplate;
      }
    }

    if (totalPerTemplate === 0) continue;

    const templateDiscs: DiscJob[] = [];
    for (const spec of relevantSpecs) {
      const count = templateCounts.get(spec.id) || 0;
      for (let i = 0; i < count; i++) {
        templateDiscs.push({
          specId: spec.id,
          diameter: spec.diameter,
          centerHole: spec.centerHole,
        });
      }
    }

    const templateSheets = packGreedy(templateDiscs, config, nestingConfig);
    if (templateSheets.length !== 1) continue;

    const templateSheet = templateSheets[0];
    const templateId = `template-${nextSheetId++}`;

    const sheets: SheetLayout[] = [];
    for (let i = 0; i < repeatCount; i++) {
      sheets.push({
        id: `sheet-${nextSheetId++}`,
        templateId,
        width: config.width,
        height: config.height,
        discs: templateSheet.discs.map(d => ({ ...d })),
      });
    }

    const remainderDiscs: DiscJob[] = [];
    for (const spec of relevantSpecs) {
      const used = (templateCounts.get(spec.id) || 0) * repeatCount;
      const remaining = spec.count - used;
      for (let i = 0; i < remaining; i++) {
        remainderDiscs.push({
          specId: spec.id,
          diameter: spec.diameter,
          centerHole: spec.centerHole,
        });
      }
    }

    if (remainderDiscs.length > 0) {
      const remainderSheets = packGreedy(remainderDiscs, config, nestingConfig);
      sheets.push(...remainderSheets);
    }

    const uniqueTemplates = new Set(sheets.map(s => s.templateId)).size;
    if (uniqueTemplates < bestUniqueCount) {
      bestUniqueCount = uniqueTemplates;
      bestResult = sheets;
    }
  }

  if (bestResult) return bestResult;

  return packGreedy(discs, config, nestingConfig);
}

export function nestDiscs(
  specs: DiscSpec[],
  config: SheetConfig,
  mode: OptimizationMode,
  nestingConfig: NestingConfig = { corner: 'bottom-left', direction: 'horizontal' }
): NestingResult {
  nextSheetId = 0;

  const discs = expandDiscs(specs);
  let allSheets: SheetLayout[] = [];

  if (discs.length > 0) {
    if (mode === 'minimize-sheets') {
      allSheets = packGreedy(discs, config, nestingConfig);
    } else {
      allSheets = packTemplated(discs, specs, config, nestingConfig);
    }
  }

  const uniqueTemplates = new Set(allSheets.map(s => s.templateId)).size;
  const totalDiscs = specs.reduce((sum, s) => sum + s.count, 0);
  const placedDiscs = allSheets.reduce((sum, s) => sum + s.discs.length, 0);

  return {
    sheets: allSheets,
    totalSheets: allSheets.length,
    uniqueTemplates,
    unplacedDiscs: totalDiscs - placedDiscs,
  };
}
