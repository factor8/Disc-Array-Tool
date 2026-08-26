import { SheetLayout, ScoreConfig, ScoreLine } from './types';

/**
 * Negative-space ("web") score generation.
 *
 * The working area is the scrap web left after the discs are cut out — not the
 * discs themselves. Marks are crack guides, not full severing cuts: a short
 * score at the right feature starts a break that runs on through the thin
 * material on its own. Each mark is emitted at `markFraction` of its natural
 * crossing, centred on the feature; internally the full crossing is what
 * models where the web comes apart.
 *
 * Features, in the order they are generated:
 *
 *   1. Throats — narrow necks of material between two cut edges (disc/disc or
 *      disc/sheet-edge) with a gap between `minHandBreak` and `maxNeckWidth`.
 *      One tick across the throat at its thinnest point. Thinner than
 *      `minHandBreak` snaps by hand; wider isn't a throat. Scrap rects spawn
 *      no throats — they are cut fully free and fall out.
 *
 *   2. Pinch openings — where two discs (or a disc and the sheet edge) all but
 *      touch, the pinch itself needs no score, but the pockets flaring out on
 *      either side of it do. Each pocket that opens toward the sheet edge gets
 *      a chevron: vertex at the edge, a pair of 45° arms reaching back in
 *      toward the discs — or a single dash down the middle where the channel
 *      is too tight for arms.
 *
 *   3. Corner separators — a 45° mark across each sheet corner pocket,
 *      splitting the corner triangle off the rest of the web.
 *
 *   4. Oversized pieces — after the feature marks, the web is partitioned into
 *      pockets. An enclosed pocket bigger than `maxPieceSpan` takes an X
 *      through its middle; open areas that big get divided by long scores on
 *      a rough grid until every piece is hand-sized.
 */

// ── Tunables that aren't worth exposing in the UI ──────────────────────

/** Region-analysis grid resolution (inches). */
const GRID = 0.5;
/** Orientations tested when looking for a way across a pocket. 12 puts a
 *  candidate on every 15°, so 45° diagonals are always available. */
const CUT_ANGLES = 12;
/** Offsets tried per orientation when placing a cut across a pocket. */
const OFFSET_SAMPLES = 40;
/** A cut must leave at least this share of the pocket on its smaller side. */
const MIN_SPLIT_SHARE = 0.15;
/** How strongly a cut is pulled toward the middle of the pocket. */
const CENTRALITY_WEIGHT = 0.6;
/**
 * Surcharge on cuts that are not square to the sheet. Small enough that a
 * diagonal still wins wherever it is genuinely the short way across — a sheet
 * corner, the pocket between two stacked discs — but enough that open ground
 * with no features gets broken down on a square grid, the way it would be by
 * hand, rather than on whichever angle happened to tie.
 */
const OFF_AXIS_PENALTY = 0.12;
/** How far a bounding box may be walked back out to the true material edge. */
const MAX_EXTENT_WALK = 12;
/** Safety cap on subdivision passes. */
const MAX_SUBDIVIDE_PASSES = 10;
/** Safety cap on total generated lines. */
const MAX_LINES = 600;
/** Samples taken along a candidate neck to prove it crosses open material. */
const NECK_SAMPLES = 7;
/** Marching step for feature ray casts (inches). */
const CAST_STEP = 0.125;

interface Pt { x: number; y: number }

interface Rect { x: number; y: number; w: number; h: number }

// ── Geometry helpers ──────────────────────────────────────────────────

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Nearest point on an axis-aligned rectangle (or the point itself if inside). */
function clampToRect(p: Pt, r: Rect): Pt {
  return {
    x: Math.max(r.x, Math.min(p.x, r.x + r.w)),
    y: Math.max(r.y, Math.min(p.y, r.y + r.h)),
  };
}

function scrapRects(sheet: SheetLayout): Rect[] {
  return (sheet.scrapCuts ?? []).map(c => ({ x: c.x, y: c.y, w: c.width, h: c.height }));
}

/**
 * Is this point in the scrap web — inside the sheet, outside every disc, and
 * outside every already-cut scrap rectangle?
 *
 * `clearance` grows every obstacle before testing. Region rasterization passes
 * half the hand-break gap so that material too thin to need a score reads as
 * already broken, which keeps a pocket's shape independent of how the analysis
 * grid happens to land on a near-tangency.
 */
function isFree(p: Pt, sheet: SheetLayout, rects: Rect[], clearance = 0): boolean {
  if (p.x < clearance || p.y < clearance ||
      p.x > sheet.width - clearance || p.y > sheet.height - clearance) return false;
  for (const d of sheet.discs) {
    const r = d.diameter / 2 + clearance;
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    if (dx * dx + dy * dy < r * r) return false;
  }
  for (const r of rects) {
    if (p.x > r.x - clearance && p.x < r.x + r.w + clearance &&
        p.y > r.y - clearance && p.y < r.y + r.h + clearance) return false;
  }
  return true;
}

/**
 * Would a cut spanning `a`–`b` still be worth making once the end margin is
 * taken off both ends?
 *
 * Cuts are carried full-length internally, because they double as the model of
 * where the web comes apart — a line held back from the material would leave
 * the pocket joined and send the subdivision round again on the same piece.
 * The margin is applied once, on the way out.
 */
function fits(a: Pt, b: Pt, margin: number, minLength: number): boolean {
  const remaining = dist(a, b) - margin * 2;
  return remaining > 0 && remaining >= minLength;
}

/** Shorten a segment by `margin` at each end. Returns null if nothing is left. */
function trim(a: Pt, b: Pt, margin: number, minLength: number): ScoreLine | null {
  const len = dist(a, b);
  const remaining = len - margin * 2;
  if (remaining < minLength || remaining <= 0) return null;
  const t = margin / len;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    x1: a.x + dx * t,
    y1: a.y + dy * t,
    x2: b.x - dx * t,
    y2: b.y - dy * t,
  };
}

/**
 * Emitted length of a mark across a crossing of length `L`: the mark fraction,
 * capped so both ends keep at least `margin` clearance from the cut edges.
 * Taking the shorter of the two lets both controls act as limits instead of
 * stacking — an end margin never trims a mark the fraction already shortened
 * past it.
 */
function effectiveLength(L: number, f: number, margin: number): number {
  return Math.min(L * f, L - margin * 2);
}

/** The emitted mark for a full crossing `a`–`b`, centred, or null if nothing survives. */
function markFrom(a: Pt, b: Pt, f: number, margin: number): ScoreLine | null {
  const L = dist(a, b);
  if (L <= 0) return null;
  const m = effectiveLength(L, f, margin);
  if (m < 0.2) return null;
  const t0 = 0.5 - m / (2 * L);
  const t1 = 1 - t0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    x1: a.x + dx * t0,
    y1: a.y + dy * t0,
    x2: a.x + dx * t1,
    y2: a.y + dy * t1,
  };
}

interface Cast {
  end: Pt;
  length: number;
  /**
   * What stopped the cast: the sheet boundary, a scrap rectangle (both are
   * places the material is already cut free, so a pocket facing one can be
   * broken toward it), or null for a disc.
   */
  opening: 'edge' | 'rect' | null;
  /** Inward normal of the opening (undefined when blocked by a disc). */
  normal?: Pt;
}

/** March from `p` along a direction until leaving free material. */
function castFree(p: Pt, ux: number, uy: number, sheet: SheetLayout, rects: Rect[]): Cast {
  const maxDist = Math.hypot(sheet.width, sheet.height);
  let last = p;
  let d = CAST_STEP;
  for (; d <= maxDist; d += CAST_STEP) {
    const q = { x: p.x + ux * d, y: p.y + uy * d };
    if (!isFree(q, sheet, rects)) break;
    last = q;
  }

  // Classify the first blocked sample.
  const q = { x: p.x + ux * d, y: p.y + uy * d };
  let opening: 'edge' | 'rect' | null = null;
  let normal: Pt | undefined;
  if (q.x < 0) { opening = 'edge'; normal = { x: 1, y: 0 }; }
  else if (q.x > sheet.width) { opening = 'edge'; normal = { x: -1, y: 0 }; }
  else if (q.y < 0) { opening = 'edge'; normal = { x: 0, y: 1 }; }
  else if (q.y > sheet.height) { opening = 'edge'; normal = { x: 0, y: -1 }; }
  else {
    for (const r of rects) {
      if (q.x > r.x && q.x < r.x + r.w && q.y > r.y && q.y < r.y + r.h) {
        // Nearest face of the rect, normal pointing back into the material.
        const faces: [number, Pt][] = [
          [q.x - r.x, { x: -1, y: 0 }],
          [r.x + r.w - q.x, { x: 1, y: 0 }],
          [q.y - r.y, { x: 0, y: -1 }],
          [r.y + r.h - q.y, { x: 0, y: 1 }],
        ];
        faces.sort((a, b) => a[0] - b[0]);
        opening = 'rect';
        normal = faces[0][1];
        break;
      }
    }
  }

  return { end: last, length: dist(p, last), opening, normal };
}

// ── Step 1: necks ─────────────────────────────────────────────────────

/** A candidate throat: the shortest segment spanning the material between two cut edges. */
interface Neck { a: Pt; b: Pt; gap: number }

/**
 * Verify the throat actually passes through open material — i.e. no third
 * obstacle sits between the two we measured against. Endpoints lie exactly on
 * their own obstacles, so only the interior is sampled.
 */
function neckIsClear(neck: Neck, sheet: SheetLayout, rects: Rect[]): boolean {
  for (let i = 1; i <= NECK_SAMPLES; i++) {
    const t = i / (NECK_SAMPLES + 1);
    const p = {
      x: neck.a.x + (neck.b.x - neck.a.x) * t,
      y: neck.a.y + (neck.b.y - neck.a.y) * t,
    };
    if (!isFree(p, sheet, rects)) return false;
  }
  return true;
}

function collectNecks(sheet: SheetLayout, minGap: number, maxGap: number): Neck[] {
  const rects = scrapRects(sheet);
  const found: Neck[] = [];

  const consider = (a: Pt, b: Pt, gap: number) => {
    if (!(gap > minGap) || gap > maxGap) return;
    const neck = { a, b, gap };
    if (!neckIsClear(neck, sheet, rects)) return;
    found.push(neck);
  };

  // Disc ↔ disc: the throat lies on the center-to-center axis.
  for (let i = 0; i < sheet.discs.length; i++) {
    for (let j = i + 1; j < sheet.discs.length; j++) {
      const p = sheet.discs[i];
      const q = sheet.discs[j];
      const rp = p.diameter / 2;
      const rq = q.diameter / 2;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d === 0) continue;
      const ux = dx / d;
      const uy = dy / d;
      consider(
        { x: p.x + ux * rp, y: p.y + uy * rp },
        { x: q.x - ux * rq, y: q.y - uy * rq },
        d - rp - rq
      );
    }
  }

  // Disc ↔ sheet edge: drawn as a 45° tick through the middle of the strip
  // rather than a perpendicular one — the diagonal is how these get marked by
  // hand, starting the crack along the direction the strip actually breaks.
  for (const d of sheet.discs) {
    const r = d.diameter / 2;
    const edges = [
      { gap: d.x - r, M: { x: (d.x - r) / 2, y: d.y }, tx: 0, ty: 1, nx: 1, ny: 0 },
      { gap: sheet.width - d.x - r, M: { x: (sheet.width + d.x + r) / 2, y: d.y }, tx: 0, ty: 1, nx: -1, ny: 0 },
      { gap: d.y - r, M: { x: d.x, y: (d.y - r) / 2 }, tx: 1, ty: 0, nx: 0, ny: 1 },
      { gap: sheet.height - d.y - r, M: { x: d.x, y: (sheet.height + d.y + r) / 2 }, tx: 1, ty: 0, nx: 0, ny: -1 },
    ];
    for (const e of edges) {
      if (!(e.gap > minGap) || e.gap > maxGap) continue;
      if (!isFree(e.M, sheet, rects)) continue;
      const ux = (e.nx - e.tx) * SIN45;
      const uy = (e.ny - e.ty) * SIN45;
      const one = castFree(e.M, ux, uy, sheet, rects);
      const two = castFree(e.M, -ux, -uy, sheet, rects);
      consider(one.end, two.end, e.gap);
    }
  }

  // No throats against scrap rectangles: a rect is cut fully free, so the
  // web beside it already has an open border and breaks toward the void.

  return found;
}

// ── Pinch openings ────────────────────────────────────────────────────

interface FeatureMark { a: Pt; b: Pt }

const SIN45 = Math.SQRT1_2;

/**
 * Marks that open the pockets around a pinch — a near-tangency (gap at or
 * under the hand-break threshold) between two discs, or between a disc and the
 * sheet edge. The pinch itself snaps by hand, but the pockets flaring out on
 * either side of it are where the waste hangs together.
 *
 * For each side of a disc/disc pinch whose pocket opens to the sheet edge:
 * a pair of legs from the pinch at ±45° to the pocket direction — the
 * chevron/V. Where the channel is too tight for the legs to reach useful
 * length, a single dash down the channel centre instead.
 *
 * A pocket side that runs into another disc is enclosed; the X/diamond logic
 * owns those.
 */
function collectPinchMarks(
  sheet: SheetLayout,
  rects: Rect[],
  handBreak: number,
  maxDash: number,
  f: number,
  margin: number,
  minLen: number
): FeatureMark[] {
  const marks: FeatureMark[] = [];

  const legsFrom = (P: Pt, vx: number, vy: number) => {
    const probe = castFree(P, vx, vy, sheet, rects);
    if (!probe.opening) return;

    // The chevron's vertex sits where the pocket meets the sheet edge, arms
    // angling back in toward the two discs — it opens away from the edge, so
    // the wedge between the arms comes off the edge strip first and the two
    // crescents follow. (Vertex at the pinch pointed the other way and read
    // wrong to the hand.)
    const V = probe.end;
    const bx = -vx;
    const by = -vy;
    const legs: FeatureMark[] = [];
    // Chevron arms only where the pocket meets the sheet edge; a pocket facing
    // a scrap-rect void gets at most the single dash below — the hand-marked
    // references never chevron against a rect.
    if (probe.opening === 'edge') for (const sgn of [1, -1]) {
      // The inward direction rotated by ±45°.
      const lx = (bx - sgn * by) * SIN45;
      const ly = (sgn * bx + by) * SIN45;
      const cast = castFree(V, lx, ly, sheet, rects);
      // The length cap rejects an arm that tunnels down a long thin strip —
      // a cut nearly parallel to the material it should cross severs nothing.
      if (cast.length <= maxDash &&
          effectiveLength(cast.length, f, margin) >= minLen) {
        legs.push({ a: V, b: cast.end });
      }
    }

    if (legs.length > 0) {
      marks.push(...legs);
    } else if (effectiveLength(probe.length, f, margin) >= minLen && probe.length <= maxDash) {
      // Channel too tight for angled legs — one dash down its centre, but
      // only when the channel faces its edge squarely. A dash on a strongly
      // tilted bisector lands at an odd angle near a corner and reads wrong;
      // the capped probe also keeps a chain of tangencies from becoming a
      // sheet-length line.
      const n = probe.normal!;
      if (Math.abs(vx * n.x + vy * n.y) >= 0.92) {
        marks.push({ a: P, b: probe.end });
      }
    }
  };

  // Disc ↔ disc pinches.
  for (let i = 0; i < sheet.discs.length; i++) {
    for (let j = i + 1; j < sheet.discs.length; j++) {
      const a = sheet.discs[i];
      const b = sheet.discs[j];
      const ra = a.diameter / 2;
      const rb = b.diameter / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d === 0) continue;
      const w = d - ra - rb;
      if (w > handBreak || w < -0.01) continue;

      const ux = dx / d;
      const uy = dy / d;
      const P = { x: a.x + ux * (ra + w / 2), y: a.y + uy * (ra + w / 2) };
      if (!isFree(P, sheet, rects)) continue;

      legsFrom(P, -uy, ux);
      legsFrom(P, uy, -ux);
    }
  }

  // No marks for disc ↔ sheet-edge tangencies: the crescents beside a
  // tangency are slivers that fall off on their own once their neighbours
  // break — the hand-marked references never score them.

  return marks;
}

/**
 * A 45° separator across each sheet corner pocket — the mark that lets the
 * corner triangle snap off. Placed halfway between the corner and the nearest
 * disc, perpendicular to the corner bisector. Corners buried in open space
 * (nearest disc further than `maxReach`) are left to area subdivision or the
 * scrap cutter.
 */
function collectCornerMarks(
  sheet: SheetLayout,
  rects: Rect[],
  handBreak: number,
  maxReach: number,
  f: number,
  margin: number,
  minLen: number
): FeatureMark[] {
  const marks: FeatureMark[] = [];
  if (sheet.discs.length === 0) return marks;

  const corners = [
    { p: { x: 0, y: 0 }, bx: SIN45, by: SIN45 },
    { p: { x: sheet.width, y: 0 }, bx: -SIN45, by: SIN45 },
    { p: { x: 0, y: sheet.height }, bx: SIN45, by: -SIN45 },
    { p: { x: sheet.width, y: sheet.height }, bx: -SIN45, by: -SIN45 },
  ];

  for (const corner of corners) {
    let d = Infinity;
    for (const disc of sheet.discs) {
      const dd = dist(corner.p, { x: disc.x, y: disc.y }) - disc.diameter / 2;
      if (dd < d) d = dd;
    }
    if (!(d > handBreak) || d > maxReach) continue;

    const M = { x: corner.p.x + corner.bx * (d / 2), y: corner.p.y + corner.by * (d / 2) };
    if (!isFree(M, sheet, rects)) continue;

    // Mark along the corner bisector — from the corner in toward the disc.
    const one = castFree(M, corner.bx, corner.by, sheet, rects);
    const other = castFree(M, -corner.bx, -corner.by, sheet, rects);
    if (effectiveLength(dist(one.end, other.end), f, margin) >= minLen) {
      marks.push({ a: one.end, b: other.end });
    }
  }

  return marks;
}

// ── Step 2: region analysis ───────────────────────────────────────────

interface Grid {
  cols: number;
  rows: number;
  /** -1 = obstacle or barrier, otherwise the region id. */
  region: Int32Array;
  /** 1 where any score line severed material that would otherwise be open. */
  barrier: Uint8Array;
  /** 1 where a subdivision cut (not a feature mark) severed material. */
  cutBarrier: Uint8Array;
  /** 1 where the cell sits inside a scrap-rect void. */
  rectMask: Uint8Array;
}

function cellCenter(c: number, r: number): Pt {
  return { x: (c + 0.5) * GRID, y: (r + 0.5) * GRID };
}

/**
 * Rasterize the web with the already-placed score lines acting as barriers,
 * then label 4-connected regions. Each region is one piece that would come away
 * if the operator broke along every score.
 */
function buildRegions(
  sheet: SheetLayout,
  featureLines: ScoreLine[],
  cutLines: ScoreLine[],
  clearance: number
): Grid {
  const rects = scrapRects(sheet);
  const cols = Math.ceil(sheet.width / GRID);
  const rows = Math.ceil(sheet.height / GRID);
  const region = new Int32Array(cols * rows).fill(-1);
  const barrier = new Uint8Array(cols * rows);
  const cutBarrier = new Uint8Array(cols * rows);
  const rectMask = new Uint8Array(cols * rows);

  const open: boolean[] = new Array(cols * rows).fill(false);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = cellCenter(c, r);
      open[r * cols + c] = isFree(p, sheet, rects, clearance);
      for (const rect of rects) {
        if (p.x > rect.x && p.x < rect.x + rect.w && p.y > rect.y && p.y < rect.y + rect.h) {
          rectMask[r * cols + c] = 1;
          break;
        }
      }
    }
  }

  // Close cells straddling a score line. The band is slightly over one cell
  // wide so a diagonal barrier can't be leaked through by 4-connected fill.
  const band = GRID * 0.6;
  const closeAlong = (line: ScoreLine, isCut: boolean) => {
    const minC = Math.max(0, Math.floor((Math.min(line.x1, line.x2) - band) / GRID));
    const maxC = Math.min(cols - 1, Math.ceil((Math.max(line.x1, line.x2) + band) / GRID));
    const minR = Math.max(0, Math.floor((Math.min(line.y1, line.y2) - band) / GRID));
    const maxR = Math.min(rows - 1, Math.ceil((Math.max(line.y1, line.y2) + band) / GRID));
    const vx = line.x2 - line.x1;
    const vy = line.y2 - line.y1;
    const vlen2 = vx * vx + vy * vy;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const idx = r * cols + c;
        if (!open[idx] && !barrier[idx]) continue;
        const p = cellCenter(c, r);
        const t = vlen2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - line.x1) * vx + (p.y - line.y1) * vy) / vlen2));
        const dx = p.x - (line.x1 + vx * t);
        const dy = p.y - (line.y1 + vy * t);
        if (dx * dx + dy * dy <= band * band) {
          open[idx] = false;
          barrier[idx] = 1;
          if (isCut) cutBarrier[idx] = 1;
        }
      }
    }
  };
  for (const line of featureLines) closeAlong(line, false);
  for (const line of cutLines) closeAlong(line, true);

  // 4-connected flood fill.
  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < open.length; start++) {
    if (!open[start] || region[start] !== -1) continue;
    const id = next++;
    region[start] = id;
    stack.push(start);
    while (stack.length) {
      const idx = stack.pop()!;
      const c = idx % cols;
      const r = (idx - c) / cols;
      if (c > 0) pushCell(idx - 1);
      if (c < cols - 1) pushCell(idx + 1);
      if (r > 0) pushCell(idx - cols);
      if (r < rows - 1) pushCell(idx + cols);
    }
    function pushCell(n: number) {
      if (open[n] && region[n] === -1) {
        region[n] = id;
        stack.push(n);
      }
    }
  }

  return { cols, rows, region, barrier, cutBarrier, rectMask };
}

interface RegionInfo {
  id: number;
  cells: number[];
  minX: number; maxX: number;
  minY: number; maxY: number;
  centroid: Pt;
}

function summarizeRegions(grid: Grid, sheet: SheetLayout, rects: Rect[]): RegionInfo[] {
  const byId = new Map<number, RegionInfo>();
  // The cell at each bbox extreme, so the bounds can be pushed back out to the
  // real material afterwards.
  const extremes = new Map<number, { minX: Pt; maxX: Pt; minY: Pt; maxY: Pt }>();

  for (let idx = 0; idx < grid.region.length; idx++) {
    const id = grid.region[idx];
    if (id < 0) continue;
    const c = idx % grid.cols;
    const r = (idx - c) / grid.cols;
    const p = cellCenter(c, r);
    let info = byId.get(id);
    if (!info) {
      info = { id, cells: [], minX: p.x, maxX: p.x, minY: p.y, maxY: p.y, centroid: { x: 0, y: 0 } };
      byId.set(id, info);
      extremes.set(id, { minX: p, maxX: p, minY: p, maxY: p });
    }
    const ext = extremes.get(id)!;
    info.cells.push(idx);
    if (p.x < info.minX) { info.minX = p.x; ext.minX = p; }
    if (p.x > info.maxX) { info.maxX = p.x; ext.maxX = p; }
    if (p.y < info.minY) { info.minY = p.y; ext.minY = p; }
    if (p.y > info.maxY) { info.maxY = p.y; ext.maxY = p; }
    info.centroid.x += p.x;
    info.centroid.y += p.y;
  }

  for (const info of byId.values()) {
    info.centroid.x /= info.cells.length;
    info.centroid.y /= info.cells.length;

    // Cells stop short of the true boundary, by the clearance and by up to a
    // cell. That gap is small along a straight edge but large where a pocket
    // tapers to a cusp between two near-touching discs, which is exactly where
    // a scrap piece is at its longest. Walk each extreme back out to the real
    // material so the piece is measured at the size it will actually be.
    const ext = extremes.get(info.id)!;
    info.minX = Math.min(info.minX, walkOut(ext.minX, -1, 0, sheet, rects, grid).x);
    info.maxX = Math.max(info.maxX, walkOut(ext.maxX, 1, 0, sheet, rects, grid).x);
    info.minY = Math.min(info.minY, walkOut(ext.minY, 0, -1, sheet, rects, grid).y);
    info.maxY = Math.max(info.maxY, walkOut(ext.maxY, 0, 1, sheet, rects, grid).y);
  }

  return [...byId.values()];
}

/**
 * Slide a point along a direction while it stays in real (unclearanced)
 * material, stopping at any score line already placed — those are breaks, and
 * a piece does not extend past one.
 */
function walkOut(
  from: Pt,
  ux: number,
  uy: number,
  sheet: SheetLayout,
  rects: Rect[],
  grid: Grid
): Pt {
  const step = GRID / 4;
  let last = from;
  for (let d = step; d <= MAX_EXTENT_WALK; d += step) {
    const q = { x: from.x + ux * d, y: from.y + uy * d };
    if (!isFree(q, sheet, rects)) break;
    const c = Math.floor(q.x / GRID);
    const r = Math.floor(q.y / GRID);
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) break;
    if (grid.barrier[r * grid.cols + c]) break;
    last = q;
  }
  return last;
}

function regionSpan(info: RegionInfo): number {
  return Math.max(info.maxX - info.minX, info.maxY - info.minY);
}

/**
 * Push an endpoint outward from the last known-free grid position until it
 * meets the real cut edge, so the score lands on the disc/sheet boundary
 * rather than on a grid cell centre.
 */
function refineEndpoint(
  from: Pt,
  ux: number,
  uy: number,
  sheet: SheetLayout,
  rects: Rect[],
  clearance: number
): Pt {
  const step = GRID / 8;
  const reach = GRID * 1.5 + clearance;
  let last = from;
  for (let d = step; d <= reach; d += step) {
    const q = { x: from.x + ux * d, y: from.y + uy * d };
    if (!isFree(q, sheet, rects)) break;
    last = q;
  }
  return last;
}

/**
 * Is this a true pocket of the web — ringed by disc edges, with no way to
 * break it toward anything already open?
 *
 * Such a pocket comes away as one closed piece, so it wants an X through the
 * middle rather than being sliced off one side. Three things disqualify it:
 * reaching the sheet edge, bordering a scrap-rect void (both are open — the
 * pocket breaks toward them), and bordering a subdivision cut (then it is a
 * piece of open ground already being broken down on a grid, not a diamond).
 * Feature marks nearby do NOT disqualify — every real diamond has throat
 * ticks and dashes around it.
 */
function isEnclosed(info: RegionInfo, grid: Grid, sheet: SheetLayout): boolean {
  const edge = GRID * 1.5;
  if (info.minX <= edge || info.minY <= edge ||
      info.maxX >= sheet.width - edge || info.maxY >= sheet.height - edge) {
    return false;
  }

  // Diagonal neighbours count too: a 45° cut leaves a diagonal chain of
  // severed cells, which a region can sit against without ever being
  // orthogonally adjacent to it.
  for (const idx of info.cells) {
    const c = idx % grid.cols;
    const r = (idx - c) / grid.cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
        const n = nr * grid.cols + nc;
        if (grid.cutBarrier[n] || grid.rectMask[n]) return false;
      }
    }
  }
  return true;
}

/**
 * Does this region wrap around a disc — an annulus of lobes joined through
 * their throats, like the ring of waste around a filler disc in a diamond?
 * A ring must not be X'd: its throat ticks already divide it, and each lobe
 * then breaks out by hand. X-ing it cascades — every X splits the ring into
 * pieces that still wrap the disc and get X'd again next pass.
 */
function wrapsDisc(info: RegionInfo, grid: Grid, sheet: SheetLayout): boolean {
  for (const disc of sheet.discs) {
    const reach = disc.diameter / 2 + GRID * 1.5;
    if (disc.x + reach < info.minX || disc.x - reach > info.maxX ||
        disc.y + reach < info.minY || disc.y - reach > info.maxY) continue;

    let sides = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const px = disc.x + dx * reach;
      const py = disc.y + dy * reach;
      const c = Math.floor(px / GRID);
      const r = Math.floor(py / GRID);
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      if (grid.region[r * grid.cols + c] === info.id) sides++;
    }
    if (sides >= 3) return true;
  }
  return false;
}

/** March from `p` along `(ux, uy)` to the far side of the region. */
function castWithinRegion(
  p: Pt,
  ux: number,
  uy: number,
  cells: Uint8Array,
  grid: Grid,
  sheet: SheetLayout,
  rects: Rect[],
  clearance: number
): Pt {
  let last = p;
  for (let d = GRID; ; d += GRID) {
    const q = { x: p.x + ux * d, y: p.y + uy * d };
    const c = Math.floor(q.x / GRID);
    const r = Math.floor(q.y / GRID);
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) break;
    if (cells[r * grid.cols + c] === 0) break;
    last = q;
  }
  return refineEndpoint(last, ux, uy, sheet, rects, clearance);
}

/** Membership mask over the whole grid for one region's cells. */
function cellMask(info: RegionInfo, grid: Grid): Uint8Array {
  const mask = new Uint8Array(grid.cols * grid.rows);
  for (const idx of info.cells) mask[idx] = 1;
  return mask;
}

/** The region cell closest to the centroid — the centroid itself can fall outside a concave pocket. */
function interiorPoint(info: RegionInfo, grid: Grid): Pt {
  let best = cellCenter(info.cells[0] % grid.cols, Math.floor(info.cells[0] / grid.cols));
  let bestDist = Infinity;
  for (const idx of info.cells) {
    const c = idx % grid.cols;
    const p = cellCenter(c, (idx - c) / grid.cols);
    const d = dist(p, info.centroid);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/**
 * Every crossing of this region by the line `dot(p, n) === offset`.
 *
 * A pocket can wrap around a disc, so one line may cut it in several places;
 * each contiguous run becomes its own score. Cutting the whole line rather than
 * a single chord is what guarantees the piece actually comes apart — a lone
 * chord through a pinch severs nothing if the web simply flows around it.
 */
function crossingsAlongLine(
  info: RegionInfo,
  grid: Grid,
  ux: number,
  uy: number,
  nx: number,
  ny: number,
  offset: number,
  sheet: SheetLayout,
  rects: Rect[],
  clearance: number,
  minLength: number,
  endMargin: number
): ScoreLine[] {
  // Walk the line across the region's bounding box.
  const corners: Pt[] = [
    { x: info.minX, y: info.minY }, { x: info.maxX, y: info.minY },
    { x: info.minX, y: info.maxY }, { x: info.maxX, y: info.maxY },
  ];
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const c of corners) {
    const t = c.x * ux + c.y * uy;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }

  const step = GRID / 2;
  const cuts: ScoreLine[] = [];
  let runStart: Pt | null = null;
  let runEnd: Pt | null = null;

  const flush = () => {
    if (!runStart || !runEnd) return;
    const a = refineEndpoint(runStart, -ux, -uy, sheet, rects, clearance);
    const b = refineEndpoint(runEnd, ux, uy, sheet, rects, clearance);
    if (fits(a, b, endMargin, minLength)) {
      cuts.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    runStart = null;
    runEnd = null;
  };

  for (let t = tMin; t <= tMax; t += step) {
    const p = { x: nx * offset + ux * t, y: ny * offset + uy * t };
    const c = Math.floor(p.x / GRID);
    const r = Math.floor(p.y / GRID);
    const inside = c >= 0 && r >= 0 && c < grid.cols && r < grid.rows &&
                   grid.region[r * grid.cols + c] === info.id;
    if (inside) {
      if (!runStart) runStart = p;
      runEnd = p;
    } else {
      flush();
    }
  }
  flush();

  return cuts;
}

/**
 * Break an oversized pocket with one straight line, chosen over all
 * orientations rather than just the two axes.
 *
 * The winner is the line that severs the least material while still leaving a
 * worthwhile piece on each side. Searching angles is what produces the cuts you
 * would draw by hand: across a sheet corner the cheapest line is its 45°
 * diagonal, and through the pocket between two stacked discs it is a diagonal
 * out to the edge rather than a square chop.
 */
function lineCut(
  info: RegionInfo,
  grid: Grid,
  sheet: SheetLayout,
  rects: Rect[],
  clearance: number,
  minLength: number,
  endMargin: number
): ScoreLine[] {
  const halfSpan = Math.max(regionSpan(info) / 2, GRID);
  const total = info.cells.length;

  let best: ScoreLine[] | null = null;
  let bestCost = Infinity;

  // A strip-shaped region only accepts cuts across its long axis — a score
  // running along a thin strip is parallel to the break it should cause.
  const bboxW = info.maxX - info.minX;
  const bboxH = info.maxY - info.minY;
  const ELONGATED = 2.5;

  for (let k = 0; k < CUT_ANGLES; k++) {
    const angle = (k / CUT_ANGLES) * Math.PI;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    if (bboxH > bboxW * ELONGATED && Math.abs(uy) > Math.abs(ux)) continue;
    if (bboxW > bboxH * ELONGATED && Math.abs(ux) > Math.abs(uy)) continue;
    const nx = -uy;
    const ny = ux;
    const squareToSheet = k === 0 || k * 2 === CUT_ANGLES;

    // Project every cell onto the normal once, so the split ratio at any offset
    // is a lookup rather than another sweep over the region.
    const projected = new Float64Array(total);
    for (let i = 0; i < total; i++) {
      const idx = info.cells[i];
      const c = idx % grid.cols;
      const p = cellCenter(c, (idx - c) / grid.cols);
      projected[i] = p.x * nx + p.y * ny;
    }
    projected.sort();

    const lo = projected[0];
    const hi = projected[total - 1];
    if (hi - lo < GRID) continue;

    const centroidOffset = info.centroid.x * nx + info.centroid.y * ny;
    const step = Math.max(GRID, (hi - lo) / OFFSET_SAMPLES);

    for (let offset = lo + step; offset < hi; offset += step) {
      // Exact share of the pocket on the thinner side of the line.
      let below = 0;
      let high = total;
      while (below < high) {
        const mid = (below + high) >> 1;
        if (projected[mid] < offset) below = mid + 1;
        else high = mid;
      }
      if (Math.min(below, total - below) / total < MIN_SPLIT_SHARE) continue;

      const cuts = crossingsAlongLine(
        info, grid, ux, uy, nx, ny, offset,
        sheet, rects, clearance, minLength, endMargin
      );
      if (cuts.length === 0) continue;

      const severed = cuts.reduce((sum, c) => sum + Math.hypot(c.x2 - c.x1, c.y2 - c.y1), 0);
      const cost = severed
        * (1 + CENTRALITY_WEIGHT * Math.abs(offset - centroidOffset) / halfSpan)
        * (squareToSheet ? 1 : 1 + OFF_AXIS_PENALTY);
      if (cost < bestCost) {
        bestCost = cost;
        best = cuts;
      }
    }
  }

  return best ?? [];
}

/**
 * Score an X through an enclosed pocket: the narrowest crossing through its
 * middle, plus the perpendicular. In the diamond between four near-touching
 * discs both of those land on the 45° diagonals, which is how you would draw it
 * by hand — the four lobes each break away toward their own pinch point.
 */
function crossCuts(
  info: RegionInfo,
  grid: Grid,
  mask: Uint8Array,
  sheet: SheetLayout,
  rects: Rect[],
  clearance: number,
  minLength: number,
  f: number,
  margin: number
): ScoreLine[] {
  const mid = interiorPoint(info, grid);

  let bestK = -1;
  let bestLength = Infinity;
  const chords: { a: Pt; b: Pt }[] = [];

  for (let k = 0; k < CUT_ANGLES; k++) {
    const angle = (k / CUT_ANGLES) * Math.PI;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const a = castWithinRegion(mid, ux, uy, mask, grid, sheet, rects, clearance);
    const b = castWithinRegion(mid, -ux, -uy, mask, grid, sheet, rects, clearance);
    chords.push({ a, b });
    const length = dist(a, b);
    if (length < bestLength) {
      bestLength = length;
      bestK = k;
    }
  }

  if (bestK < 0) return [];

  const cuts: ScoreLine[] = [];
  for (const k of [bestK, (bestK + CUT_ANGLES / 2) % CUT_ANGLES]) {
    const { a, b } = chords[k];
    if (effectiveLength(dist(a, b), f, margin) >= minLength) {
      cuts.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }
  return cuts;
}

/**
 * Break oversized pockets down. `barriers` carries every full-length crossing
 * (feature marks included) and models where the web separates; the returned
 * lines are what actually gets emitted — X legs at mark fraction, grid lines
 * full length.
 */
function subdivide(
  sheet: SheetLayout,
  barriers: ScoreLine[],
  clearance: number,
  maxPieceSpan: number,
  enclosedSpan: number,
  minLength: number,
  endMargin: number,
  f: number
): ScoreLine[] {
  const rects = scrapRects(sheet);
  const emitted: ScoreLine[] = [];
  const cutLines: ScoreLine[] = [];

  // Judge each pocket's character on pure geometry — discs, rects, and the
  // sheet edge, with no score-line barriers. On that map a ring around a
  // filler disc is still one annulus (score ticks haven't split it into
  // lobes), and an empty diamond is one compact pocket. Score-line barriers
  // would make every throat-ticked lobe look like its own enclosed diamond.
  // Gaps up to the neck width all get throat ticks, so for pocket identity
  // they count as walls: seal them via a clearance of half the neck width.
  // Anything thinner than the neck erodes away entirely (lobes around filler
  // discs), which is correct — those pockets never earn an X.
  const geoGrid = buildRegions(sheet, [], [], Math.max(clearance, enclosedSpan / 3));
  const geoInfo = new Map<number, { xEligible: boolean; ring: boolean }>();
  for (const gi of summarizeRegions(geoGrid, sheet, rects)) {
    // Raw cell bounds, not the walked-out ones — the walk crosses sealed
    // throats into neighbouring pockets and inflates every span.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const idx of gi.cells) {
      const c = idx % geoGrid.cols;
      const pt = cellCenter(c, (idx - c) / geoGrid.cols);
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    const w = maxX - minX + GRID;
    const h = maxY - minY + GRID;
    // A diamond is compact — roughly square between its four discs. Long
    // crescent channels between two large arcs stay un-X'd; their throats
    // already carry ticks.
    const compact = Math.max(w, h) <= Math.min(w, h) * 1.7;
    const ring = wrapsDisc(gi, geoGrid, sheet);
    const xEligible = compact && !ring && isEnclosed(gi, geoGrid, sheet) &&
      Math.max(w, h) > enclosedSpan;
    geoInfo.set(gi.id, { xEligible, ring });
  }
  const geoOf = (info: RegionInfo): { xEligible: boolean; ring: boolean } | undefined => {
    const p = interiorPoint(info, geoGrid);
    const c = Math.floor(p.x / GRID);
    const r = Math.floor(p.y / GRID);
    if (c < 0 || r < 0 || c >= geoGrid.cols || r >= geoGrid.rows) return undefined;
    return geoInfo.get(geoGrid.region[r * geoGrid.cols + c]);
  };

  for (let pass = 0; pass < MAX_SUBDIVIDE_PASSES; pass++) {
    const grid = buildRegions(sheet, barriers, cutLines, clearance);
    // An enclosed diamond earns its X at a much smaller size than open ground
    // earns a grid line — the hand-marked references X every empty diamond.
    const oversized = summarizeRegions(grid, sheet, rects).filter(r => {
      const geo = geoOf(r);
      const limit = geo?.xEligible ? enclosedSpan : maxPieceSpan;
      return regionSpan(r) > limit;
    });
    if (oversized.length === 0) break;

    const before = cutLines.length;
    for (const info of oversized) {
      if (barriers.length + cutLines.length >= MAX_LINES) return emitted;

      const geo = geoOf(info);
      // Rings around a filler disc break lobe by lobe at their throats; only
      // a truly oversized one is worth a cut.
      if (geo?.ring && regionSpan(info) <= maxPieceSpan) continue;

      // An empty diamond comes away whole, so it takes an X through the
      // middle rather than being cut off one side; isEnclosed (with the live
      // barriers) keeps a diamond from being re-X'd once its X exists.
      const xCuts = geo?.xEligible && isEnclosed(info, grid, sheet)
        ? crossCuts(info, grid, cellMask(info, grid), sheet, rects, clearance, minLength, f, endMargin)
        : [];

      if (xCuts.length > 0) {
        cutLines.push(...xCuts);
        for (const cut of xCuts) {
          const mark = markFrom({ x: cut.x1, y: cut.y1 }, { x: cut.x2, y: cut.y2 }, f, endMargin);
          if (mark) emitted.push(mark);
        }
      } else {
        // Grid lines stay full-length — they carry the break across open
        // ground — less the end-margin clearance.
        const gridCuts = lineCut(info, grid, sheet, rects, clearance, minLength, endMargin);
        cutLines.push(...gridCuts);
        for (const cut of gridCuts) {
          const trimmed = trim({ x: cut.x1, y: cut.y1 }, { x: cut.x2, y: cut.y2 }, endMargin, 0);
          if (trimmed) emitted.push(trimmed);
        }
      }
    }

    // Whatever is left is a sliver too narrow to score across.
    if (cutLines.length === before) break;
  }

  return emitted;
}

// ── Deduplication ─────────────────────────────────────────────────────

/**
 * Collapse marks that would break the same material twice. Several generators
 * can legitimately land in the same corridor — a disc↔scrap throat, a
 * disc↔edge throat and a channel dash within an inch of one another — and one
 * break there is enough. A candidate is dropped when a kept mark runs at
 * nearly the same angle and passes within `LATERAL_TOLERANCE` of it; marks at
 * clearly different angles (a chevron's two arms, a tick crossing a dash)
 * always coexist. Generators run in priority order, so the earlier feature
 * wins the corridor.
 */
function dedupe(lines: ScoreLine[]): ScoreLine[] {
  const LATERAL_TOLERANCE = 2.75;        // inches
  const ANGLE_TOLERANCE = Math.PI / 6;  // 30°
  const kept: ScoreLine[] = [];

  for (const line of lines) {
    const mx = (line.x1 + line.x2) / 2;
    const my = (line.y1 + line.y2) / 2;
    const angle = normalizeAngle(Math.atan2(line.y2 - line.y1, line.x2 - line.x1));

    const duplicate = kept.some(k => {
      const kAngle = normalizeAngle(Math.atan2(k.y2 - k.y1, k.x2 - k.x1));
      const diff = Math.abs(angle - kAngle);
      if (Math.min(diff, Math.PI - diff) > ANGLE_TOLERANCE) return false;

      // Distance from the candidate's midpoint to the kept segment.
      const vx = k.x2 - k.x1;
      const vy = k.y2 - k.y1;
      const vlen2 = vx * vx + vy * vy;
      const t = vlen2 === 0 ? 0 : Math.max(0, Math.min(1, ((mx - k.x1) * vx + (my - k.y1) * vy) / vlen2));
      return Math.hypot(mx - (k.x1 + vx * t), my - (k.y1 + vy * t)) <= LATERAL_TOLERANCE;
    });

    if (!duplicate) kept.push(line);
  }

  return kept;
}

/** Map an undirected line's angle into [0, π). */
function normalizeAngle(angle: number): number {
  return ((angle % Math.PI) + Math.PI) % Math.PI;
}

// ── Public API ────────────────────────────────────────────────────────

export function generateWebScoreLines(sheet: SheetLayout, config: ScoreConfig): ScoreLine[] {
  const { webToggles: toggles, webSettings: settings } = config;
  const endMargin = Math.max(0, settings.endMargin);
  const f = Math.min(1, Math.max(0.05, settings.markFraction ?? 0.5));
  const minLen = config.minScoreLength;
  const handBreak = Math.max(0, settings.minHandBreak);
  const rects = scrapRects(sheet);

  // Marks are emitted at `f` of their crossing; the full crossing goes into
  // the barrier model so subdivision knows the break it starts will complete.
  const emit: ScoreLine[] = [];
  const barriers: ScoreLine[] = [];
  const feature = (a: Pt, b: Pt) => {
    barriers.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    const mark = markFrom(a, b, f, endMargin);
    if (mark) emit.push(mark);
  };

  if (toggles.neckScores) {
    const maxGap = Math.max(handBreak, settings.maxNeckWidth);
    // Throat ticks are exempt from minScoreLength — a throat is short by
    // definition, and its tick is the most valuable mark on the sheet.
    for (const neck of collectNecks(sheet, handBreak, maxGap)) feature(neck.a, neck.b);
    for (const m of collectPinchMarks(sheet, rects, handBreak, settings.maxPieceSpan, f, endMargin, minLen)) feature(m.a, m.b);
    for (const m of collectCornerMarks(sheet, rects, handBreak, settings.maxPieceSpan, f, endMargin, minLen)) feature(m.a, m.b);
  }

  if (toggles.areaSubdivision) {
    // Half the hand-break gap on each side of an obstacle: a throat that thin
    // is already a break, so it should not hold two pockets together.
    emit.push(...subdivide(
      sheet,
      barriers,
      handBreak / 2,
      Math.max(GRID * 2, settings.maxPieceSpan),
      Math.max(GRID * 2, settings.maxNeckWidth * 1.5),
      minLen,
      endMargin,
      f
    ));
  }

  return dedupe(emit);
}
