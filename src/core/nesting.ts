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
 * Compute the corner-distance score for a position.
 * Lower score = closer to the chosen corner = better.
 */
function cornerScore(
  x: number, y: number,
  sheetWidth: number, sheetHeight: number,
  nestingConfig: NestingConfig
): number {
  const leftToRight = nestingConfig.corner === 'bottom-left' || nestingConfig.corner === 'top-left';
  const bottomToTop = nestingConfig.corner === 'bottom-left' || nestingConfig.corner === 'bottom-right';

  // Distance from the target corner
  const cx = leftToRight ? x : sheetWidth - x;
  const cy = bottomToTop ? sheetHeight - y : y;

  // Weight primary axis (direction) more heavily
  const primaryIsHorizontal = nestingConfig.direction === 'horizontal';
  if (primaryIsHorizontal) {
    return cy * 1000 + cx;
  } else {
    return cx * 1000 + cy;
  }
}

/**
 * Generate candidate positions where a circle of given radius is tangent
 * to two objects (discs or walls). Returns all geometrically valid tangent points.
 */
function generateTangentCandidates(
  radius: number,
  placed: PlacedDisc[],
  sheetWidth: number,
  sheetHeight: number,
  spacing: number,
): { x: number; y: number }[] {
  const candidates: { x: number; y: number }[] = [];
  const margin = radius + spacing;

  // Wall positions: the center coordinate when tangent to each wall
  const wallLeft = margin;
  const wallRight = sheetWidth - margin;
  const wallTop = margin;
  const wallBottom = sheetHeight - margin;

  // 1. Corner positions (tangent to two walls)
  candidates.push({ x: wallLeft, y: wallTop });
  candidates.push({ x: wallLeft, y: wallBottom });
  candidates.push({ x: wallRight, y: wallTop });
  candidates.push({ x: wallRight, y: wallBottom });

  // 2. Tangent to one disc and one wall
  for (const disc of placed) {
    const dr = radius + disc.diameter / 2 + spacing;

    // Tangent to left wall (x = wallLeft)
    {
      const dx = wallLeft - disc.x;
      if (Math.abs(dx) <= dr) {
        const dyOffset = Math.sqrt(dr * dr - dx * dx);
        candidates.push({ x: wallLeft, y: disc.y + dyOffset });
        candidates.push({ x: wallLeft, y: disc.y - dyOffset });
      }
    }
    // Tangent to right wall (x = wallRight)
    {
      const dx = wallRight - disc.x;
      if (Math.abs(dx) <= dr) {
        const dyOffset = Math.sqrt(dr * dr - dx * dx);
        candidates.push({ x: wallRight, y: disc.y + dyOffset });
        candidates.push({ x: wallRight, y: disc.y - dyOffset });
      }
    }
    // Tangent to top wall (y = wallTop)
    {
      const dy = wallTop - disc.y;
      if (Math.abs(dy) <= dr) {
        const dxOffset = Math.sqrt(dr * dr - dy * dy);
        candidates.push({ x: disc.x + dxOffset, y: wallTop });
        candidates.push({ x: disc.x - dxOffset, y: wallTop });
      }
    }
    // Tangent to bottom wall (y = wallBottom)
    {
      const dy = wallBottom - disc.y;
      if (Math.abs(dy) <= dr) {
        const dxOffset = Math.sqrt(dr * dr - dy * dy);
        candidates.push({ x: disc.x + dxOffset, y: wallBottom });
        candidates.push({ x: disc.x - dxOffset, y: wallBottom });
      }
    }
  }

  // 3. Tangent to two discs — intersection of two circles
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const d1 = placed[i];
      const d2 = placed[j];
      const r1 = radius + d1.diameter / 2 + spacing;
      const r2 = radius + d2.diameter / 2 + spacing;

      const dx = d2.x - d1.x;
      const dy = d2.y - d1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // No intersection if too far or too close
      if (dist > r1 + r2 || dist < Math.abs(r1 - r2) || dist < 1e-9) continue;

      // Standard two-circle intersection formula
      const a = (r1 * r1 - r2 * r2 + dist * dist) / (2 * dist);
      const hSq = r1 * r1 - a * a;
      if (hSq < 0) continue;
      const h = Math.sqrt(hSq);

      // Midpoint along the line between centers
      const mx = d1.x + (dx * a) / dist;
      const my = d1.y + (dy * a) / dist;

      // Perpendicular offset
      const px = (-dy * h) / dist;
      const py = (dx * h) / dist;

      candidates.push({ x: mx + px, y: my + py });
      if (h > 1e-9) {
        candidates.push({ x: mx - px, y: my - py });
      }
    }
  }

  return candidates;
}

/**
 * Place a circle on the sheet using tangent-point based placement.
 * Finds positions where the disc nestles against walls and other discs,
 * then picks the position closest to the configured corner.
 */
function findPlacement(
  radius: number,
  placed: PlacedDisc[],
  sheetWidth: number,
  sheetHeight: number,
  spacing: number,
  nestingConfig: NestingConfig
): { x: number; y: number } | null {
  const candidates = generateTangentCandidates(radius, placed, sheetWidth, sheetHeight, spacing);

  let bestPos: { x: number; y: number } | null = null;
  let bestScore = Infinity;

  for (const cand of candidates) {
    if (!canPlace(cand.x, cand.y, radius, placed, sheetWidth, sheetHeight, spacing)) continue;
    const score = cornerScore(cand.x, cand.y, sheetWidth, sheetHeight, nestingConfig);
    if (score < bestScore) {
      bestScore = score;
      bestPos = cand;
    }
  }

  // Fallback: grid scan for cases where tangent candidates miss
  // (e.g., very first disc on empty sheet with no walls nearby, or unusual configurations)
  if (!bestPos) {
    const step = Math.max(radius / 3, 0.1);
    const margin = radius + spacing;
    const minX = margin;
    const maxX = sheetWidth - margin;
    const minY = margin;
    const maxY = sheetHeight - margin;

    const leftToRight = nestingConfig.corner === 'bottom-left' || nestingConfig.corner === 'top-left';
    const bottomToTop = nestingConfig.corner === 'bottom-left' || nestingConfig.corner === 'bottom-right';

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

    const primaryIsHorizontal = nestingConfig.direction === 'horizontal';
    const outerValues = primaryIsHorizontal ? yValues : xValues;
    const innerValues = primaryIsHorizontal ? xValues : yValues;

    for (const outer of outerValues) {
      for (const inner of innerValues) {
        const x = primaryIsHorizontal ? inner : outer;
        const y = primaryIsHorizontal ? outer : inner;
        if (canPlace(x, y, radius, placed, sheetWidth, sheetHeight, spacing)) {
          return { x, y };
        }
      }
    }
  }

  return bestPos;
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
