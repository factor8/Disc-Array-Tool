export interface DiscSpec {
  id: string;
  count: number;
  diameter: number;       // inches
  centerHole: number | null; // inches, null = no hole
}

export interface SheetConfig {
  width: number;   // inches, default 48
  height: number;  // inches, default 96
  spacing: number; // kerf/gap in inches, default 0.1
}

export interface PlacedDisc {
  x: number;        // center x on sheet
  y: number;        // center y on sheet
  diameter: number;
  centerHole: number | null;
  specId: string;   // reference back to DiscSpec
}

export interface SheetLayout {
  id: string;
  templateId: string;   // sheets with same templateId are identical layouts
  width: number;
  height: number;
  discs: PlacedDisc[];
  scrapCuts?: ScrapCut[];
  scoreLines?: ScoreLine[];
}

export interface NestingResult {
  sheets: SheetLayout[];
  totalSheets: number;
  uniqueTemplates: number;
  unplacedDiscs: number; // discs that couldn't fit
}

export type OptimizationMode = 'minimize-sheets' | 'minimize-unique';

export type ScrapDensity = 'low' | 'medium' | 'high';

export interface ScrapConfig {
  enabled: boolean;            // whether scrap cuts are generated
  minScrapEdge: number;      // minimum edge length (inches) to keep a scrap rectangle
  scrapDensity: ScrapDensity; // how aggressively to subdivide gaps
  scrapEdgeMargin: number;   // inches inset from sheet edge
  scrapDiscMargin: number;   // inches inset from disc outlines
}

export interface ScrapCut {
  x: number;      // top-left x
  y: number;      // top-left y
  width: number;
  height: number;
  /** Which edges to actually cut (false = coincides with sheet boundary, skip) */
  edges: { top: boolean; right: boolean; bottom: boolean; left: boolean };
}

export type NestingCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
export type NestingDirection = 'horizontal' | 'vertical';

export interface NestingConfig {
  corner: NestingCorner;
  direction: NestingDirection;
  minUtilization?: number; // 0–1, target minimum fill for repeated template sheets (minimize-unique mode only)
}

export type ScoreMode = 'radial' | 'smart' | 'smart-v2' | 'web';

export interface SmartScoreToggles {
  gapMarks: boolean;
  diagonalLines: boolean;
}

export interface SmartScoreSettings {
  gapMaxThreshold: number;      // max gap between disc edges to generate a gap mark (inches)
  gapMarkLengthRatio: number;   // mark length as fraction of gap size
}

export interface SmartV2Settings {
  minHandBreakDistance: number;  // gaps smaller than this break by hand, no score needed (default 0.25")
  maxBridgeWidth: number;       // gaps larger than this aren't thin bridges (default 2.0")
  areaSliceMinGap: number;      // minimum distance-to-obstacle to consider an area worth slicing (default 1.0")
}

export interface SmartV2Toggles {
  bridgeScoring: boolean;       // score thin bridges between obstacles
  areaSubdivision: boolean;     // slice large open areas in negative space
}

export interface WebScoreToggles {
  neckScores: boolean;      // score the narrow throats between cut edges
  areaSubdivision: boolean; // slice oversized pockets of the web
}

export interface WebScoreSettings {
  minHandBreak: number;   // throats narrower than this snap by hand — no score (inches)
  maxNeckWidth: number;   // wider than this isn't a throat, it's open area (inches)
  maxPieceSpan: number;   // subdivide any web pocket larger than this across (inches)
  markFraction: number;   // emitted mark length as a fraction of its natural crossing (0–1)
  endMargin: number;      // stop each score short of the cut edge (inches, 0 = run into it)
}

export interface ScoreConfig {
  enabled: boolean;            // whether score lines are generated
  mode: ScoreMode;             // 'radial' = starburst, 'smart' = strategic placement, 'smart-v2' = negative-space analysis
  // Radial-mode settings
  scoreDiscMargin: number;   // inches gap between disc edge and score start
  scoreShapeMargin: number;  // inches gap between score end and other shapes (discs, scrap rects, sheet edge)
  scoreDensity: ScrapDensity; // radial lines per disc: low=4, medium=8, high=16
  minScoreLength: number;    // inches, discard scores shorter than this
  // Smart-mode settings
  smartToggles: SmartScoreToggles;
  smartSettings: SmartScoreSettings;
  // Smart v2 settings
  smartV2Toggles: SmartV2Toggles;
  smartV2Settings: SmartV2Settings;
  // Negative-space ('web') settings
  webToggles: WebScoreToggles;
  webSettings: WebScoreSettings;
}

export interface ScoreLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Per-line-type colors applied only to exported files (DXF/PDF), not the
 * on-screen preview. Each value is a '#RRGGBB' hex string. Laser/CNC software
 * typically maps color to operation, so these are worth tuning per shop.
 */
export interface ExportColors {
  boundary: string;    // sheet outline
  cuts: string;        // disc circles + center holes
  disassembly: string; // scrap cuts
  score: string;       // score lines
}

/** Everything that shapes an exported file but not the on-screen preview. */
export interface ExportOptions {
  colors: ExportColors;
  /** Draw the sheet label + disc legend below each sheet. */
  includeText: boolean;
}
