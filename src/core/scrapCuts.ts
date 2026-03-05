import { SheetLayout, ScrapConfig, ScrapCut } from './types';

const CELL_SIZE = 0.25; // grid resolution in inches

/**
 * Build a boolean occupancy grid for a sheet.
 * true = occupied (disc or margin zone), false = free space.
 */
function buildGrid(
  sheet: SheetLayout,
  edgeMargin: number,
  discMargin: number
): { grid: boolean[][]; cols: number; rows: number } {
  const cols = Math.ceil(sheet.width / CELL_SIZE);
  const rows = Math.ceil(sheet.height / CELL_SIZE);

  // Start all free
  const grid: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = new Array(cols).fill(false);
  }

  // Mark edge margins as occupied
  const edgeCells = Math.ceil(edgeMargin / CELL_SIZE);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r < edgeCells || r >= rows - edgeCells || c < edgeCells || c >= cols - edgeCells) {
        grid[r][c] = true;
      }
    }
  }

  // Mark disc zones as occupied (circle + discMargin)
  for (const disc of sheet.discs) {
    const exclusionRadius = disc.diameter / 2 + discMargin;
    const cx = disc.x;
    const cy = disc.y;

    // Bounding box in grid coords
    const minC = Math.max(0, Math.floor((cx - exclusionRadius) / CELL_SIZE));
    const maxC = Math.min(cols - 1, Math.ceil((cx + exclusionRadius) / CELL_SIZE));
    const minR = Math.max(0, Math.floor((cy - exclusionRadius) / CELL_SIZE));
    const maxR = Math.min(rows - 1, Math.ceil((cy + exclusionRadius) / CELL_SIZE));

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        // Cell center position in inches
        const cellX = (c + 0.5) * CELL_SIZE;
        const cellY = (r + 0.5) * CELL_SIZE;
        const dx = cellX - cx;
        const dy = cellY - cy;
        if (dx * dx + dy * dy <= exclusionRadius * exclusionRadius) {
          grid[r][c] = true;
        }
      }
    }
  }

  return { grid, cols, rows };
}

/**
 * Find the largest empty rectangle in the grid using the histogram method.
 * Returns { row, col, width, height } in grid coordinates, or null if none found.
 */
function findLargestRect(
  grid: boolean[][],
  rows: number,
  cols: number,
  minEdgeCells: number
): { row: number; col: number; w: number; h: number } | null {
  // Build height histogram: for each cell, how many consecutive free cells above (including itself)
  const heights: number[][] = [];
  for (let r = 0; r < rows; r++) {
    heights[r] = new Array(cols).fill(0);
    for (let c = 0; c < cols; c++) {
      if (!grid[r][c]) {
        heights[r][c] = r === 0 ? 1 : heights[r - 1][c] + 1;
      }
    }
  }

  let bestArea = 0;
  let bestRect: { row: number; col: number; w: number; h: number } | null = null;

  // For each row, use stack-based largest rectangle in histogram
  for (let r = 0; r < rows; r++) {
    const hist = heights[r];
    const stack: number[] = []; // stack of column indices
    const leftBound: number[] = new Array(cols).fill(0);
    const rightBound: number[] = new Array(cols).fill(cols);

    // Left boundaries
    for (let c = 0; c < cols; c++) {
      while (stack.length > 0 && hist[stack[stack.length - 1]] >= hist[c]) {
        stack.pop();
      }
      leftBound[c] = stack.length === 0 ? 0 : stack[stack.length - 1] + 1;
      stack.push(c);
    }

    // Right boundaries
    stack.length = 0;
    for (let c = cols - 1; c >= 0; c--) {
      while (stack.length > 0 && hist[stack[stack.length - 1]] >= hist[c]) {
        stack.pop();
      }
      rightBound[c] = stack.length === 0 ? cols : stack[stack.length - 1];
      stack.push(c);
    }

    for (let c = 0; c < cols; c++) {
      const h = hist[c];
      if (h === 0) continue;
      const w = rightBound[c] - leftBound[c];
      const area = w * h;
      if (area > bestArea && w >= minEdgeCells && h >= minEdgeCells) {
        bestArea = area;
        bestRect = {
          row: r - h + 1,
          col: leftBound[c],
          w,
          h,
        };
      }
    }
  }

  return bestRect;
}

/**
 * Mark a rectangle as occupied in the grid.
 */
function markOccupied(
  grid: boolean[][],
  rect: { row: number; col: number; w: number; h: number }
) {
  for (let r = rect.row; r < rect.row + rect.h; r++) {
    for (let c = rect.col; c < rect.col + rect.w; c++) {
      grid[r][c] = true;
    }
  }
}

/**
 * Generate scrap cut rectangles for a single sheet.
 */
export function generateScrapCuts(sheet: SheetLayout, config: ScrapConfig): ScrapCut[] {
  const { grid, cols, rows } = buildGrid(sheet, config.scrapEdgeMargin, config.scrapDiscMargin);

  const minEdgeCells = Math.ceil(config.minScrapEdge / CELL_SIZE);

  // Density controls max rectangles to find
  const maxRects = config.scrapDensity === 'low' ? 4
    : config.scrapDensity === 'medium' ? 12
    : 30;

  const cuts: ScrapCut[] = [];

  for (let i = 0; i < maxRects; i++) {
    const rect = findLargestRect(grid, rows, cols, minEdgeCells);
    if (!rect) break;

    // Convert grid coords to inches
    const x = rect.col * CELL_SIZE;
    const y = rect.row * CELL_SIZE;
    const w = rect.w * CELL_SIZE;
    const h = rect.h * CELL_SIZE;

    if (w < config.minScrapEdge || h < config.minScrapEdge) break;

    // Determine which edges coincide with the sheet boundary (within margin tolerance)
    const edgeTol = config.scrapEdgeMargin + CELL_SIZE;
    const edges = {
      top: y > edgeTol,                                          // not at top edge
      bottom: (y + h) < (sheet.height - edgeTol),               // not at bottom edge
      left: x > edgeTol,                                         // not at left edge
      right: (x + w) < (sheet.width - edgeTol),                 // not at right edge
    };

    cuts.push({ x, y, width: w, height: h, edges });
    markOccupied(grid, rect);
  }

  // Post-process: when two scrap rects share an edge, suppress the duplicate
  // so only one line is drawn instead of two overlapping lines.
  // We only suppress if the shared span covers the FULL extent of the edge
  // being suppressed (otherwise we'd lose a line that only partially overlaps).
  const tol = CELL_SIZE * 1.5;
  for (let i = 0; i < cuts.length; i++) {
    for (let j = i + 1; j < cuts.length; j++) {
      const a = cuts[i];
      const b = cuts[j];

      const aRight = a.x + a.width;
      const bRight = b.x + b.width;
      const aBottom = a.y + a.height;
      const bBottom = b.y + b.height;

      // Shared vertical edge: a's right == b's left (or vice versa)
      // Only suppress if the other rect fully covers the y-span of this edge
      if (Math.abs(aRight - b.x) < tol) {
        // a's right touches b's left — suppress a's right only if b fully covers a's y-span
        if (b.y <= a.y + tol && bBottom >= aBottom - tol) {
          a.edges.right = false;
        }
        // also suppress b's left only if a fully covers b's y-span
        if (a.y <= b.y + tol && aBottom >= bBottom - tol) {
          b.edges.left = false;
        }
      }
      if (Math.abs(bRight - a.x) < tol) {
        // b's right touches a's left
        if (a.y <= b.y + tol && aBottom >= bBottom - tol) {
          b.edges.right = false;
        }
        if (b.y <= a.y + tol && bBottom >= aBottom - tol) {
          a.edges.left = false;
        }
      }

      // Shared horizontal edge: a's bottom == b's top (or vice versa)
      if (Math.abs(aBottom - b.y) < tol) {
        // a's bottom touches b's top — suppress a's bottom only if b fully covers a's x-span
        if (b.x <= a.x + tol && bRight >= aRight - tol) {
          a.edges.bottom = false;
        }
        if (a.x <= b.x + tol && aRight >= bRight - tol) {
          b.edges.top = false;
        }
      }
      if (Math.abs(bBottom - a.y) < tol) {
        // b's bottom touches a's top
        if (a.x <= b.x + tol && aRight >= bRight - tol) {
          b.edges.bottom = false;
        }
        if (b.x <= a.x + tol && bRight >= aRight - tol) {
          a.edges.top = false;
        }
      }
    }
  }

  return cuts;
}
