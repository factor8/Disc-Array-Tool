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
}

export type ScoreMode = 'radial' | 'smart';

export interface SmartScoreToggles {
  gapMarks: boolean;
  diagonalLines: boolean;
}

export interface SmartScoreSettings {
  gapMaxThreshold: number;      // max gap between disc edges to generate a gap mark (inches)
  gapMarkLengthRatio: number;   // mark length as fraction of gap size
}

export interface ScoreConfig {
  enabled: boolean;            // whether score lines are generated
  mode: ScoreMode;             // 'radial' = starburst, 'smart' = strategic placement
  // Radial-mode settings
  scoreDiscMargin: number;   // inches gap between disc edge and score start
  scoreShapeMargin: number;  // inches gap between score end and other shapes (discs, scrap rects, sheet edge)
  scoreDensity: ScrapDensity; // radial lines per disc: low=4, medium=8, high=16
  minScoreLength: number;    // inches, discard scores shorter than this
  // Smart-mode settings
  smartToggles: SmartScoreToggles;
  smartSettings: SmartScoreSettings;
}

export interface ScoreLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
