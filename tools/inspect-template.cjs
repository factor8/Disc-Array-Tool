/**
 * Numeric inspector for one template's score lines — the precision counterpart
 * to the PNG renders. Use it when a mark looks wrong and you need to know
 * exactly what it is: coordinates, length, and angle expose the generator that
 * produced it faster than squinting at pixels.
 *
 * Usage:
 *   node tools/render-sheet.cjs state.json        # (or npm run render) FIRST — compiles .render-build
 *   node tools/inspect-template.cjs state.json 5              # all lines of template 5
 *   node tools/inspect-template.cjs state.json 5 0 0 18 18    # only lines touching x<18,y<18 window
 */
const fs = require('fs');
const path = require('path');

const BUILD_ROOT = path.join(__dirname, '..', '.render-build');
fs.writeFileSync(path.join(BUILD_ROOT, 'package.json'), '{ "type": "commonjs" }');
const { nestDiscs } = require(path.join(BUILD_ROOT, 'core', 'nesting.js'));
const { generateScrapCuts } = require(path.join(BUILD_ROOT, 'core', 'scrapCuts.js'));
const { generateScoreLines } = require(path.join(BUILD_ROOT, 'core', 'scoreLines.js'));
const { parseInches } = require(path.join(BUILD_ROOT, 'utils', 'parsing.js'));

const [stateFile, indexArg, wx1, wy1, wx2, wy2] = process.argv.slice(2);
if (!stateFile || !indexArg) {
  console.error('usage: node tools/inspect-template.cjs <state.json> <templateIndex> [x1 y1 x2 y2]');
  process.exit(1);
}
const templateIndex = Number(indexArg);
const win = wx1 !== undefined
  ? { x1: Number(wx1), y1: Number(wy1), x2: Number(wx2), y2: Number(wy2) }
  : null;

const dump = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const get = (key) => JSON.parse(dump[`disc-array-tool-${key}`]);

const specs = [];
get('discs').forEach((row, i) => {
  const count = parseInt(row.count, 10);
  const diameter = parseInches(String(row.diameter ?? ''));
  if (!count || count < 1 || diameter === null || diameter <= 0) return;
  const holeText = String(row.hole ?? '').trim().toLowerCase();
  let centerHole = null;
  if (holeText && holeText !== 'none' && holeText !== '0') centerHole = parseInches(holeText);
  specs.push({ id: `row-${i}`, count, diameter, centerHole });
});

const nesting = get('nesting');
const result = nestDiscs(specs, get('sheet'), nesting.mode, nesting);

const seen = new Set();
let sheet = null;
for (const s of result.sheets) {
  if (seen.has(s.templateId)) continue;
  seen.add(s.templateId);
  if (seen.size === templateIndex) { sheet = s; break; }
}
if (!sheet) {
  console.error(`template ${templateIndex} not found (${seen.size} templates exist)`);
  process.exit(1);
}

const scrap = get('scrap');
sheet.scrapCuts = scrap.enabled ? generateScrapCuts(sheet, scrap) : [];
sheet.scoreLines = generateScoreLines(sheet, get('score'));

const inWindow = (x, y) => !win || (x >= win.x1 && x <= win.x2 && y >= win.y1 && y <= win.y2);

console.log(`template ${templateIndex}: ${sheet.discs.length} discs, ${sheet.scrapCuts.length} scrap cuts, ${sheet.scoreLines.length} score lines\n`);
console.log('discs:');
for (const d of sheet.discs) {
  if (!inWindow(d.x, d.y)) continue;
  console.log(`  c=(${d.x.toFixed(2)}, ${d.y.toFixed(2)}) dia=${d.diameter.toFixed(3)}`);
}
console.log('scrap rects:');
for (const c of sheet.scrapCuts) {
  console.log(`  (${c.x.toFixed(2)}, ${c.y.toFixed(2)}) ${c.width.toFixed(2)} x ${c.height.toFixed(2)}`);
}
console.log('score lines (angle 0=+x, y grows downward):');
for (const l of sheet.scoreLines) {
  if (!inWindow(l.x1, l.y1) && !inWindow(l.x2, l.y2)) continue;
  const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
  const ang = Math.atan2(l.y2 - l.y1, l.x2 - l.x1) * 180 / Math.PI;
  console.log(`  (${l.x1.toFixed(2)}, ${l.y1.toFixed(2)})-(${l.x2.toFixed(2)}, ${l.y2.toFixed(2)})  len=${len.toFixed(2)}  ang=${ang.toFixed(0)}`);
}
