/**
 * Dev renderer — runs the real nesting/scrap/score pipeline outside the browser
 * and writes each sheet to a PNG, so a layout can be inspected and compared
 * without screenshotting the app.
 *
 * Usage:
 *   npm run render -- <state.json> [outDir]
 *
 * <state.json> is a dump of the app's localStorage. In the browser console:
 *   copy(JSON.stringify(Object.fromEntries(Object.entries(localStorage)), null, 2))
 * then paste into a file.
 */
const fs = require('fs');
const path = require('path');
const { Canvas } = require('./png.cjs');

const BUILD_ROOT = path.join(__dirname, '..', '.render-build');
// The package is ESM, so tsc's CommonJS output needs its own marker to be
// require()-able. Written before the requires below, which run in order.
fs.writeFileSync(path.join(BUILD_ROOT, 'package.json'), '{ "type": "commonjs" }');

const BUILD = path.join(BUILD_ROOT, 'core');
const { nestDiscs } = require(path.join(BUILD, 'nesting.js'));
const { generateScrapCuts } = require(path.join(BUILD, 'scrapCuts.js'));
const { generateScoreLines } = require(path.join(BUILD, 'scoreLines.js'));
const { parseInches } = require(path.join(BUILD_ROOT, 'utils', 'parsing.js'));

const COLOR = {
  background: [15, 15, 35],
  border: [90, 90, 100],
  discFill: [42, 30, 70],
  discStroke: [139, 92, 246],
  scrap: [255, 0, 255],
  score: [255, 255, 0],
};

// Mirrors the built-in defaults in src/main.ts, used for any key the dump lacks.
const DEFAULTS = {
  sheet: { width: 48, height: 96, spacing: 0.1 },
  nesting: { mode: 'minimize-sheets', corner: 'bottom-left', direction: 'horizontal', minUtilization: 0.85 },
  scrap: { enabled: true, minScrapEdge: 2, scrapDensity: 'medium', scrapEdgeMargin: 0.25, scrapDiscMargin: 0.25 },
  score: {
    enabled: true, mode: 'radial',
    scoreDiscMargin: 0.125, scoreShapeMargin: 0.125, scoreDensity: 'medium', minScoreLength: 0.5,
    smartToggles: { gapMarks: true, diagonalLines: true },
    smartSettings: { gapMaxThreshold: 1.0, gapMarkLengthRatio: 0.5 },
    smartV2Toggles: { bridgeScoring: true, areaSubdivision: true },
    smartV2Settings: { minHandBreakDistance: 0.25, maxBridgeWidth: 2.0, areaSliceMinGap: 1.0 },
    webToggles: { neckScores: true, areaSubdivision: true },
    webSettings: { minHandBreak: 0.25, maxNeckWidth: 3.0, maxPieceSpan: 12, markFraction: 0.5, endMargin: 0 },
  },
};

function readState(file) {
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  const get = (key) => {
    const raw = dump[`disc-array-tool-${key}`];
    if (raw === undefined) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  };
  // The app deep-merges saved settings over defaults; do the same so a dump
  // taken before a setting existed still renders.
  const score = { ...DEFAULTS.score, ...(get('score') || {}) };
  for (const nested of ['smartToggles', 'smartSettings', 'smartV2Toggles', 'smartV2Settings', 'webToggles', 'webSettings']) {
    score[nested] = { ...DEFAULTS.score[nested], ...(score[nested] || {}) };
  }
  return {
    sheet: { ...DEFAULTS.sheet, ...(get('sheet') || {}) },
    nesting: { ...DEFAULTS.nesting, ...(get('nesting') || {}) },
    scrap: { ...DEFAULTS.scrap, ...(get('scrap') || {}) },
    score,
    discRows: get('discs') || [],
  };
}

/** Same rules as parseDiscSpecs() in the UI, without the DOM. */
function toSpecs(rows) {
  const specs = [];
  rows.forEach((row, i) => {
    const count = parseInt(row.count, 10);
    const diameter = parseInches(String(row.diameter ?? ''));
    if (!count || count < 1 || diameter === null || diameter <= 0) return;

    const holeText = String(row.hole ?? '').trim().toLowerCase();
    let centerHole = null;
    if (holeText && holeText !== 'none' && holeText !== '0') {
      centerHole = parseInches(holeText);
      if (centerHole === null || centerHole <= 0 || centerHole >= diameter) centerHole = null;
    }
    specs.push({ id: `row-${i}`, count, diameter, centerHole });
  });
  return specs;
}

function drawSheet(sheet, pixelsPerInch) {
  const s = pixelsPerInch;
  const cv = new Canvas(sheet.width * s + 4, sheet.height * s + 4, COLOR.background);
  const ox = 2, oy = 2;

  cv.rect(ox, oy, ox + sheet.width * s, oy + sheet.height * s, COLOR.border);

  for (const cut of sheet.scrapCuts || []) {
    const x1 = ox + cut.x * s, y1 = oy + cut.y * s;
    const x2 = ox + (cut.x + cut.width) * s, y2 = oy + (cut.y + cut.height) * s;
    if (cut.edges.top) cv.line(x1, y1, x2, y1, COLOR.scrap);
    if (cut.edges.right) cv.line(x2, y1, x2, y2, COLOR.scrap);
    if (cut.edges.bottom) cv.line(x1, y2, x2, y2, COLOR.scrap);
    if (cut.edges.left) cv.line(x1, y1, x1, y2, COLOR.scrap);
  }

  for (const disc of sheet.discs) {
    cv.disc(ox + disc.x * s, oy + disc.y * s, (disc.diameter / 2) * s, COLOR.discFill, COLOR.discStroke);
    if (disc.centerHole) {
      cv.disc(ox + disc.x * s, oy + disc.y * s, (disc.centerHole / 2) * s, COLOR.background, COLOR.border);
    }
  }

  for (const line of sheet.scoreLines || []) {
    cv.line(ox + line.x1 * s, oy + line.y1 * s, ox + line.x2 * s, oy + line.y2 * s, COLOR.score, 1);
  }

  return cv;
}

function main() {
  const [stateFile, outDir = path.join(__dirname, '..', '.render-out')] = process.argv.slice(2);
  if (!stateFile) {
    console.error('usage: npm run render -- <state.json> [outDir]');
    process.exit(1);
  }

  const state = readState(stateFile);
  const specs = toSpecs(state.discRows);
  if (specs.length === 0) {
    console.error('No usable disc rows in the state dump.');
    process.exit(1);
  }

  console.log(`sheet     ${state.sheet.width} x ${state.sheet.height}, spacing ${state.sheet.spacing}`);
  console.log(`nesting   ${state.nesting.mode}, ${state.nesting.corner}, ${state.nesting.direction}`);
  console.log(`scrap     ${state.scrap.enabled ? `on (${state.scrap.scrapDensity}, min edge ${state.scrap.minScrapEdge}")` : 'off'}`);
  console.log(`score     ${state.score.enabled ? state.score.mode : 'off'}`);
  if (state.score.mode === 'web') {
    const w = state.score.webSettings;
    console.log(`          necks=${state.score.webToggles.neckScores} subdivide=${state.score.webToggles.areaSubdivision}`);
    console.log(`          handBreak=${w.minHandBreak}" maxNeck=${w.maxNeckWidth}" pieceSpan=${w.maxPieceSpan}" markFraction=${w.markFraction} endMargin=${w.endMargin}" minSlice=${state.score.minScoreLength}"`);
  }
  for (const spec of specs) {
    console.log(`discs     ${spec.count} x ${spec.diameter.toFixed(4)}"${spec.centerHole ? ` (hole ${spec.centerHole}")` : ''}`);
  }

  const result = nestDiscs(specs, state.sheet, state.nesting.mode, state.nesting);

  const cache = new Map();
  for (const sheet of result.sheets) {
    let cached = cache.get(sheet.templateId);
    if (!cached) {
      sheet.scrapCuts = state.scrap.enabled ? generateScrapCuts(sheet, state.scrap) : [];
      sheet.scoreLines = state.score.enabled ? generateScoreLines(sheet, state.score) : [];
      cached = { scrapCuts: sheet.scrapCuts, scoreLines: sheet.scoreLines };
      cache.set(sheet.templateId, cached);
    }
    sheet.scrapCuts = cached.scrapCuts;
    sheet.scoreLines = cached.scoreLines;
  }

  console.log(`\n${result.totalSheets} sheets, ${result.uniqueTemplates} unique, ${result.unplacedDiscs} unplaced`);

  fs.mkdirSync(outDir, { recursive: true });
  const seen = new Set();
  const rendered = [];
  for (const sheet of result.sheets) {
    if (seen.has(sheet.templateId)) continue;
    seen.add(sheet.templateId);
    const file = path.join(outDir, `template-${seen.size}.png`);
    fs.writeFileSync(file, drawSheet(sheet, 10).toPNG());
    rendered.push({
      index: seen.size,
      discs: sheet.discs.length,
      scrapCuts: (sheet.scrapCuts || []).length,
      scoreLines: (sheet.scoreLines || []).length,
    });
    console.log(`  template ${seen.size}: ${sheet.discs.length} discs, ${(sheet.scrapCuts || []).length} scrap cuts, ${(sheet.scoreLines || []).length} score lines -> ${file}`);
  }

  writeComparePage(outDir, rendered);
}

/**
 * Side-by-side page: each template's render next to its hand-marked target
 * from targets/ (template-N.png or .jpg), when one exists.
 */
function writeComparePage(outDir, rendered) {
  const targetsDir = path.join(__dirname, '..', 'targets');
  const findTarget = (index) => {
    for (const ext of ['png', 'jpg', 'jpeg']) {
      const file = path.join(targetsDir, `template-${index}.${ext}`);
      if (fs.existsSync(file)) return file;
    }
    return null;
  };

  const rel = (file) => path.relative(outDir, file).split(path.sep).join('/');
  let withTargets = 0;

  const rows = rendered.map((r) => {
    const target = findTarget(r.index);
    if (target) withTargets++;
    const targetCell = target
      ? `<img src="${rel(target)}" alt="target ${r.index}">`
      : '<div class="missing">no target yet</div>';
    return `
    <section>
      <h2>Template ${r.index} <small>${r.discs} discs &middot; ${r.scrapCuts} scrap cuts &middot; ${r.scoreLines} score lines</small></h2>
      <div class="pair">
        <figure><img class="render" src="template-${r.index}.png" alt="render ${r.index}"><figcaption>tool output</figcaption></figure>
        <figure>${targetCell}<figcaption>target</figcaption></figure>
      </div>
    </section>`;
  });

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Score line comparison</title>
<style>
  body { background: #14142a; color: #ddd; font-family: system-ui, sans-serif; margin: 1.5rem; }
  h2 { margin: 2rem 0 0.5rem; font-size: 1.05rem; }
  h2 small { color: #999; font-weight: normal; margin-left: 0.75rem; }
  .pair { display: flex; gap: 1rem; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { color: #888; font-size: 0.8rem; margin-top: 0.25rem; }
  img { max-height: 85vh; max-width: 45vw; border: 1px solid #333; }
  .missing { display: flex; align-items: center; justify-content: center; width: 20rem; height: 12rem;
             border: 1px dashed #444; color: #666; }
  body.flipped img.render { transform: scaleY(-1); }
  label { color: #aaa; font-size: 0.9rem; }
</style>
<body class="flipped">
<h1>Tool output vs. targets</h1>
<p>Targets come from <code>targets/template-N.png</code>. Re-run <code>npm run render</code> and refresh.</p>
<p><label><input type="checkbox" checked onchange="document.body.classList.toggle('flipped', this.checked)">
flip tool output vertically to match DXF-orientation targets</label></p>
${rows.join('\n')}
`;
  const file = path.join(outDir, 'compare.html');
  fs.writeFileSync(file, html);
  console.log(`\ncompare page (${withTargets}/${rendered.length} targets present) -> ${file}`);
}

main();
