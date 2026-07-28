import { DiscSpec, SheetConfig, ScrapConfig, ScoreConfig, NestingResult, OptimizationMode, NestingConfig } from './core/types';
import { nestDiscs } from './core/nesting';
import { generateScrapCuts } from './core/scrapCuts';
import { generateScoreLines } from './core/scoreLines';
import { DEFAULT_EXPORT_COLORS } from './core/exportUtils';
import { createSheetConfig, createDiscForm, createScrapConfig, createScoreConfig, parseDiscSpecs } from './ui/InputForm';
import { createNestingControls, createExportControls, createColorControls, createDefaultsControls, DefaultsSnapshot } from './ui/Controls';
import { renderPreview } from './ui/Preview';

let currentResult: NestingResult | null = null;
let currentSpecs: DiscSpec[] = [];

function runNesting(
  specs: DiscSpec[],
  config: SheetConfig,
  mode: OptimizationMode,
  nestingConfig: NestingConfig,
  scrapConfig: ScrapConfig,
  scoreConfig: ScoreConfig
) {
  currentSpecs = specs;
  currentResult = nestDiscs(specs, config, mode, nestingConfig);

  for (const sheet of currentResult.sheets) {
    sheet.scrapCuts = scrapConfig.enabled ? generateScrapCuts(sheet, scrapConfig) : [];
    sheet.scoreLines = scoreConfig.enabled ? generateScoreLines(sheet, scoreConfig) : [];
  }

  const previewSection = document.getElementById('preview-section')!;
  previewSection.style.display = '';

  const previewContainer = document.getElementById('preview-container')!;
  renderPreview(previewContainer, currentResult);
}

function init() {
  const sheetConfigEl = document.getElementById('sheet-config')!;
  const discFormEl = document.getElementById('disc-form')!;
  const nestingControlsEl = document.getElementById('nesting-controls')!;
  const colorControlsEl = document.getElementById('color-config')!;
  const exportControlsEl = document.getElementById('export-controls')!;
  const scrapConfigEl = document.getElementById('scrap-config')!;
  const scoreConfigEl = document.getElementById('score-config')!;
  const defaultsControlsEl = document.getElementById('defaults-controls')!;
  const defaultConfig: SheetConfig = { width: 48, height: 96, spacing: 0.1 };
  const defaultScrapConfig: ScrapConfig = {
    enabled: true,
    minScrapEdge: 2,
    scrapDensity: 'medium',
    scrapEdgeMargin: 0.25,
    scrapDiscMargin: 0.25,
  };
  const defaultScoreConfig: ScoreConfig = {
    enabled: true,
    mode: 'radial',
    scoreDiscMargin: 0.125,
    scoreShapeMargin: 0.125,
    scoreDensity: 'medium',
    minScoreLength: 0.5,
    smartToggles: {
      gapMarks: true,
      diagonalLines: true,
    },
    smartSettings: {
      gapMaxThreshold: 1.0,
      gapMarkLengthRatio: 0.5,
    },
    smartV2Toggles: {
      bridgeScoring: true,
      areaSubdivision: true,
    },
    smartV2Settings: {
      minHandBreakDistance: 0.25,
      maxBridgeWidth: 2.0,
      areaSliceMinGap: 1.0,
    },
  };

  // Debounced auto-regenerate — only fires if we have valid specs
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRegenerate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const { specs, errors } = parseDiscSpecs();
      if (errors.length === 0 && specs.length > 0) {
        runNesting(specs, getConfig(), getMode(), getNestingConfig(), getScrapConfig(), getScoreConfig());
      }
    }, 400);
  }

  const { getConfig } = createSheetConfig(sheetConfigEl, defaultConfig, scheduleRegenerate);
  const { getConfig: getScrapConfig } = createScrapConfig(scrapConfigEl, defaultScrapConfig, scheduleRegenerate);
  const { getConfig: getScoreConfig } = createScoreConfig(scoreConfigEl, defaultScoreConfig, scheduleRegenerate);
  const { getMode, getNestingConfig } = createNestingControls(nestingControlsEl, scheduleRegenerate);

  createDiscForm(discFormEl, scheduleRegenerate);

  const { getColors } = createColorControls(colorControlsEl);
  createExportControls(exportControlsEl, () => currentResult, getColors);

  // Built-in fallback used when the user hasn't saved their own defaults yet.
  const builtinDefaults: DefaultsSnapshot = {
    sheet: defaultConfig,
    nesting: { mode: 'minimize-sheets', corner: 'bottom-left', direction: 'horizontal', minUtilization: 0.85 },
    scrap: defaultScrapConfig,
    score: defaultScoreConfig,
    colors: DEFAULT_EXPORT_COLORS,
  };

  createDefaultsControls(
    defaultsControlsEl,
    () => ({
      sheet: getConfig(),
      nesting: { mode: getMode(), ...getNestingConfig() },
      scrap: getScrapConfig(),
      score: getScoreConfig(),
      colors: getColors(),
    }),
    builtinDefaults
  );
}

init();
