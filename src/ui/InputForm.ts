import { DiscSpec, SheetConfig, ScrapConfig, ScoreConfig, ScrapDensity, ScoreMode, SmartV2Toggles, SmartV2Settings } from '../core/types';
import { parseInches } from '../utils/parsing';
import { collapsibleHeader, makeCollapsible } from './collapsible';

let rowCounter = 0;

const STORAGE_KEY = 'disc-array-tool-discs';
const SHEET_STORAGE_KEY = 'disc-array-tool-sheet';
const SCRAP_STORAGE_KEY = 'disc-array-tool-scrap';
const SCORE_STORAGE_KEY = 'disc-array-tool-score';

interface DiscRow {
  id: string;
  countInput: HTMLInputElement;
  diameterInput: HTMLInputElement;
  holeInput: HTMLInputElement;
}

interface DiscRowData {
  count: string;
  diameter: string;
  hole: string;
}

const rows: DiscRow[] = [];

function saveToStorage() {
  const data: DiscRowData[] = rows.map(r => ({
    count: r.countInput.value,
    diameter: r.diameterInput.value,
    hole: r.holeInput.value,
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadFromStorage(): DiscRowData[] | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data) && data.length > 0) return data;
  } catch { /* ignore corrupt data */ }
  return null;
}

/**
 * Parses a single order line from PDF copy-paste.
 * Example inputs:
 *   lamp parts generic 17 31/32" .118 No CTR Hole 25 0.00 0.00
 *   lamp parts generic 5 7/8" .118 or .177 40 0.00 0.00
 *   lamp parts generic 41 31/32" .177 1/2" Ctr Hole 5 0.00 0.00
 * Extracts: diameter, center hole (or none), and quantity.
 */
function parseOrderLine(line: string): { count: string; diameter: string; hole: string } | null {
  // Find the diameter: a fractional inch measurement ending with "
  // Matches patterns like: 17 31/32" or 5 7/8" or 23 31/32" or 6"
  const diameterMatch = line.match(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+)"/);
  if (!diameterMatch) return null;

  const diameterStr = diameterMatch[1];
  const afterDiameter = line.slice(diameterMatch.index! + diameterMatch[0].length);

  // Look for center hole: either "No CTR Hole" or a measurement like '1/2" Ctr Hole'
  let holeStr = '';
  const noCtrMatch = afterDiameter.match(/no\s+ctr\s*hole/i);
  const ctrHoleMatch = afterDiameter.match(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+)"\s*Ctr\s*Hole/i);

  if (ctrHoleMatch) {
    holeStr = ctrHoleMatch[1];
  }
  // "No CTR Hole" or no mention at all → leave holeStr empty (no hole)

  // Find quantity: the standalone integer after the hole/thickness info,
  // before the trailing 0.00 values.
  // Strip trailing price columns (0.00 0.00) and grab the last standalone integer
  const stripped = afterDiameter.replace(/(\d+\.\d+\s*)+\s*$/, '').trim();
  const qtyMatch = stripped.match(/(\d+)\s*$/);
  if (!qtyMatch) return null;

  const count = qtyMatch[1];

  return { count, diameter: diameterStr, hole: holeStr };
}

export function createSheetConfig(
  container: HTMLElement,
  defaults: SheetConfig,
  onChange: () => void
): {
  getConfig: () => SheetConfig;
} {
  let initial = defaults;
  const savedSheet = localStorage.getItem(SHEET_STORAGE_KEY);
  if (savedSheet) {
    try {
      const parsed = JSON.parse(savedSheet);
      initial = { ...defaults, ...parsed };
    } catch { /* use defaults */ }
  }

  container.innerHTML = `
    <div class="sheet-config">
      <div class="field">
        <label>Sheet Width (in)</label>
        <input type="number" id="sheet-width" value="${initial.width}" step="0.5" min="1" />
      </div>
      <div class="field">
        <label>Sheet Height (in)</label>
        <input type="number" id="sheet-height" value="${initial.height}" step="0.5" min="1" />
      </div>
    </div>
  `;

  function saveSheetConfig() {
    const saved = localStorage.getItem(SHEET_STORAGE_KEY);
    let existing: Record<string, unknown> = {};
    if (saved) { try { existing = JSON.parse(saved); } catch { /* ignore */ } }
    const config = {
      ...existing,
      width: parseFloat((document.getElementById('sheet-width') as HTMLInputElement).value),
      height: parseFloat((document.getElementById('sheet-height') as HTMLInputElement).value),
    };
    localStorage.setItem(SHEET_STORAGE_KEY, JSON.stringify(config));
  }

  for (const id of ['sheet-width', 'sheet-height']) {
    document.getElementById(id)!.addEventListener('input', () => { saveSheetConfig(); onChange(); });
  }

  return {
    getConfig() {
      return {
        width: parseFloat((document.getElementById('sheet-width') as HTMLInputElement).value) || defaults.width,
        height: parseFloat((document.getElementById('sheet-height') as HTMLInputElement).value) || defaults.height,
        spacing: parseFloat((document.getElementById('sheet-spacing') as HTMLInputElement)?.value) || defaults.spacing,
      };
    },
  };
}

function parseNum(value: string, fallback: number): number {
  const n = parseFloat(value);
  return isNaN(n) ? fallback : n;
}

let emptyRow: HTMLTableRowElement | null = null;

function createRow(
  tbody: HTMLTableSectionElement,
  onRowChange: () => void,
  prefill?: { count: string; diameter: string; hole: string }
): DiscRow {
  const id = `disc-${rowCounter++}`;
  const tr = document.createElement('tr');
  tr.id = id;

  tr.innerHTML = `
    <td class="count-col"><input type="number" value="${prefill?.count ?? '1'}" min="1" step="1" /></td>
    <td class="diameter-col"><input type="text" placeholder='e.g. 31 31/32' value="${prefill?.diameter ?? ''}" /></td>
    <td class="hole-col"><input type="text" placeholder='e.g. 0.5 or none' value="${prefill?.hole ?? ''}" /></td>
    <td class="action-col">
      <button class="btn-danger remove-row" title="Remove">&times;</button>
    </td>
  `;

  // Insert before the empty row if it exists, otherwise append
  if (emptyRow && emptyRow.parentNode === tbody) {
    tbody.insertBefore(tr, emptyRow);
  } else {
    tbody.appendChild(tr);
  }

  const inputs = tr.querySelectorAll('input');

  const row: DiscRow = {
    id,
    countInput: inputs[0] as HTMLInputElement,
    diameterInput: inputs[1] as HTMLInputElement,
    holeInput: inputs[2] as HTMLInputElement,
  };

  tr.querySelector('.remove-row')!.addEventListener('click', () => {
    const idx = rows.indexOf(row);
    if (idx >= 0) rows.splice(idx, 1);
    tr.remove();
    saveToStorage();
    onRowChange();
  });

  for (const input of [row.countInput, row.diameterInput, row.holeInput]) {
    input.addEventListener('input', () => { saveToStorage(); onRowChange(); });
  }

  rows.push(row);
  return row;
}

/**
 * Creates and maintains the always-present empty "add" row at the bottom of the table.
 * When the user types into any field, it promotes to a real row and a new empty row appears.
 */
function ensureEmptyRow(tbody: HTMLTableSectionElement, onRowChange: () => void) {
  if (emptyRow && emptyRow.parentNode === tbody) return;

  const tr = document.createElement('tr');
  tr.className = 'empty-add-row';

  tr.innerHTML = `
    <td class="count-col"><input type="number" placeholder="1" min="1" step="1" /></td>
    <td class="diameter-col"><input type="text" placeholder="e.g. 31 31/32" /></td>
    <td class="hole-col"><input type="text" placeholder="e.g. 0.5 or none" /></td>
    <td class="action-col"></td>
  `;

  tbody.appendChild(tr);
  emptyRow = tr;

  const inputs = tr.querySelectorAll('input');

  function promoteRow() {
    // Remove promote listeners
    for (const input of inputs) {
      input.removeEventListener('input', promoteRow);
    }

    // Promote in-place: give the row an id, add remove button, register as real row
    const id = `disc-${rowCounter++}`;
    tr.id = id;
    tr.className = '';
    emptyRow = null;

    // Default count to 1 if empty
    if (!(inputs[0] as HTMLInputElement).value) {
      (inputs[0] as HTMLInputElement).value = '1';
    }

    // Add the remove button
    const actionTd = tr.querySelector('.action-col')!;
    actionTd.innerHTML = `<button class="btn-danger remove-row" title="Remove">&times;</button>`;

    const row: DiscRow = {
      id,
      countInput: inputs[0] as HTMLInputElement,
      diameterInput: inputs[1] as HTMLInputElement,
      holeInput: inputs[2] as HTMLInputElement,
    };

    actionTd.querySelector('.remove-row')!.addEventListener('click', () => {
      const idx = rows.indexOf(row);
      if (idx >= 0) rows.splice(idx, 1);
      tr.remove();
      saveToStorage();
      onRowChange();
    });

    // Add persistent input listeners for save/regenerate
    for (const input of [row.countInput, row.diameterInput, row.holeInput]) {
      input.addEventListener('input', () => { saveToStorage(); onRowChange(); });
    }

    rows.push(row);
    saveToStorage();

    // Create a new empty row below
    ensureEmptyRow(tbody, onRowChange);
  }

  for (const input of inputs) {
    input.addEventListener('input', promoteRow);
  }
}

export function parseDiscSpecs(): { specs: DiscSpec[]; errors: string[] } {
  const specs: DiscSpec[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    const count = parseInt(row.countInput.value);
    const diameter = parseInches(row.diameterInput.value);
    const holeText = row.holeInput.value.trim().toLowerCase();

    if (!count || count < 1) {
      errors.push('Count must be at least 1');
      continue;
    }
    if (diameter === null || diameter <= 0) {
      errors.push(`Invalid diameter: "${row.diameterInput.value}"`);
      continue;
    }

    let centerHole: number | null = null;
    if (holeText && holeText !== 'none' && holeText !== '0') {
      centerHole = parseInches(holeText);
      if (centerHole === null || centerHole <= 0) {
        errors.push(`Invalid center hole: "${row.holeInput.value}"`);
        continue;
      }
      if (centerHole >= diameter) {
        errors.push('Center hole must be smaller than diameter');
        continue;
      }
    }

    specs.push({
      id: row.id,
      count,
      diameter,
      centerHole,
    });
  }

  return { specs, errors };
}

export function createDiscForm(container: HTMLElement, onChange: () => void): void {
  container.innerHTML = `
    <div class="csv-import">
      <button class="btn-secondary btn-small" id="csv-toggle-btn">Import Order</button>
      <div id="csv-import-panel" style="display:none;">
        <textarea id="csv-input" rows="5" placeholder="Paste order lines from PDF, e.g.:&#10;lamp parts generic 17 31/32&quot; .118 No CTR Hole 25 0.00 0.00&#10;lamp parts generic 41 31/32&quot; .177 1/2&quot; Ctr Hole 5 0.00 0.00"></textarea>
        <div class="csv-actions">
          <button class="btn-primary btn-small" id="csv-import-btn">Import</button>
        </div>
        <div id="csv-errors" style="color: #e94560; margin-top: 4px; font-size: 0.85rem;"></div>
      </div>
    </div>
    <table class="disc-table">
      <thead>
        <tr>
          <th class="count-col">Count</th>
          <th class="diameter-col">Diameter</th>
          <th class="hole-col">Center Hole</th>
          <th class="action-col"></th>
        </tr>
      </thead>
      <tbody id="disc-tbody"></tbody>
    </table>
  `;

  const tbody = document.getElementById('disc-tbody') as HTMLTableSectionElement;

  // CSV toggle
  document.getElementById('csv-toggle-btn')!.addEventListener('click', () => {
    const panel = document.getElementById('csv-import-panel')!;
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
  });

  // Order line import
  document.getElementById('csv-import-btn')!.addEventListener('click', () => {
    const csvErrorDiv = document.getElementById('csv-errors')!;
    csvErrorDiv.textContent = '';

    const text = (document.getElementById('csv-input') as HTMLTextAreaElement).value.trim();
    if (!text) {
      csvErrorDiv.textContent = 'Paste order data first.';
      return;
    }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const parsed: { count: string; diameter: string; hole: string }[] = [];
    const errors: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip header lines
      if (/^item\s+description/i.test(line)) continue;

      const result = parseOrderLine(line);
      if (result === null) {
        errors.push(`Line ${i + 1}: couldn't parse "${line}"`);
        continue;
      }

      parsed.push(result);
    }

    if (errors.length > 0) {
      csvErrorDiv.textContent = errors.join('. ');
      return;
    }

    if (parsed.length === 0) {
      csvErrorDiv.textContent = 'No valid rows found.';
      return;
    }

    while (rows.length > 0) {
      const row = rows.pop()!;
      document.getElementById(row.id)?.remove();
    }
    // Remove existing empty row
    if (emptyRow) { emptyRow.remove(); emptyRow = null; }

    for (const entry of parsed) {
      createRow(tbody, onChange, entry);
    }

    // Re-add empty row at bottom
    ensureEmptyRow(tbody, onChange);

    document.getElementById('csv-import-panel')!.style.display = 'none';
    saveToStorage();
    onChange();
  });

  // Restore saved data
  const saved = loadFromStorage();
  if (saved) {
    for (const entry of saved) {
      createRow(tbody, onChange, entry);
    }
  }

  // Always ensure an empty row at the bottom for adding new discs
  ensureEmptyRow(tbody, onChange);
}

export function createGenerateSection(
  container: HTMLElement,
  onGenerate: (specs: DiscSpec[]) => void
): void {
  container.innerHTML = `
    <div class="generate-section">
      <button class="btn-primary btn-large" id="generate-btn">Generate Nesting</button>
      <div id="form-errors" style="color: #e94560; margin-top: 8px; font-size: 0.85rem;"></div>
    </div>
  `;

  document.getElementById('generate-btn')!.addEventListener('click', () => {
    const errorDiv = document.getElementById('form-errors')!;
    errorDiv.textContent = '';

    const { specs, errors } = parseDiscSpecs();

    if (errors.length > 0) {
      errorDiv.textContent = errors.join('. ');
      return;
    }

    if (specs.length === 0) {
      errorDiv.textContent = 'Add at least one disc specification.';
      return;
    }

    onGenerate(specs);
  });
}

export function createScrapConfig(
  container: HTMLElement,
  defaults: ScrapConfig,
  onChange: () => void
): {
  getConfig: () => ScrapConfig;
} {
  // Load saved
  let initial = defaults;
  const savedRaw = localStorage.getItem(SCRAP_STORAGE_KEY);
  if (savedRaw) {
    try {
      const parsed = JSON.parse(savedRaw);
      initial = { ...defaults, ...parsed };
    } catch { /* use defaults */ }
  }

  container.innerHTML = `
    <div class="scrap-config panel-collapsible">
      ${collapsibleHeader('Scrap Management', `<label class="section-toggle"><input type="checkbox" id="scrap-enabled" ${initial.enabled !== false ? 'checked' : ''} /></label>`)}
      <div class="scrap-fields" id="scrap-fields" data-collapse-body>
        <div class="field">
          <label>Min Edge Length (in)</label>
          <input type="number" id="scrap-min-area" value="${initial.minScrapEdge}" step="0.25" min="0.25" max="24" />
        </div>
        <div class="field">
          <label>Cut Density</label>
          <select id="scrap-density">
            <option value="low"${initial.scrapDensity === 'low' ? ' selected' : ''}>Low</option>
            <option value="medium"${initial.scrapDensity === 'medium' ? ' selected' : ''}>Medium</option>
            <option value="high"${initial.scrapDensity === 'high' ? ' selected' : ''}>High</option>
          </select>
        </div>
        <div class="field">
          <label>Edge Margin (in)</label>
          <input type="number" id="scrap-edge-margin" value="${initial.scrapEdgeMargin}" step="0.05" min="0" />
        </div>
        <div class="field">
          <label>Disc Margin (in)</label>
          <input type="number" id="scrap-disc-margin" value="${initial.scrapDiscMargin}" step="0.05" min="0" />
        </div>
      </div>
    </div>
  `;

  function persist() {
    localStorage.setItem(SCRAP_STORAGE_KEY, JSON.stringify(getConfig()));
  }

  function getConfig(): ScrapConfig {
    return {
      enabled: (document.getElementById('scrap-enabled') as HTMLInputElement).checked,
      minScrapEdge: parseFloat((document.getElementById('scrap-min-area') as HTMLInputElement).value) || defaults.minScrapEdge,
      scrapDensity: (document.getElementById('scrap-density') as HTMLSelectElement).value as ScrapDensity,
      scrapEdgeMargin: parseNum((document.getElementById('scrap-edge-margin') as HTMLInputElement).value, defaults.scrapEdgeMargin),
      scrapDiscMargin: parseNum((document.getElementById('scrap-disc-margin') as HTMLInputElement).value, defaults.scrapDiscMargin),
    };
  }

  document.getElementById('scrap-enabled')!.addEventListener('change', () => { persist(); onChange(); });
  for (const id of ['scrap-min-area', 'scrap-edge-margin', 'scrap-disc-margin']) {
    document.getElementById(id)!.addEventListener('input', () => { persist(); onChange(); });
  }
  document.getElementById('scrap-density')!.addEventListener('change', () => { persist(); onChange(); });

  makeCollapsible(container.querySelector('.scrap-config')!, 'scrap');

  return { getConfig };
}

export function createScoreConfig(
  container: HTMLElement,
  defaults: ScoreConfig,
  onChange: () => void
): {
  getConfig: () => ScoreConfig;
} {
  // Load saved (with deep merge for nested objects)
  let initial = defaults;
  const savedRaw = localStorage.getItem(SCORE_STORAGE_KEY);
  if (savedRaw) {
    try {
      const parsed = JSON.parse(savedRaw);
      initial = {
        ...defaults,
        ...parsed,
        smartToggles: { ...defaults.smartToggles, ...parsed.smartToggles },
        smartSettings: { ...defaults.smartSettings, ...parsed.smartSettings },
        smartV2Toggles: { ...defaults.smartV2Toggles, ...parsed.smartV2Toggles },
        smartV2Settings: { ...defaults.smartV2Settings, ...parsed.smartV2Settings },
        webToggles: { ...defaults.webToggles, ...parsed.webToggles },
        webSettings: { ...defaults.webSettings, ...parsed.webSettings },
      };
    } catch { /* use defaults */ }
  }

  const mode = initial.mode || 'radial';
  const toggles = initial.smartToggles;
  const settings = initial.smartSettings;
  const v2Toggles = initial.smartV2Toggles;
  const v2Settings = initial.smartV2Settings;
  const webToggles = initial.webToggles;
  const webSettings = initial.webSettings;

  container.innerHTML = `
    <div class="score-config panel-collapsible">
      ${collapsibleHeader('Score Lines', `<label class="section-toggle"><input type="checkbox" id="score-enabled" ${initial.enabled !== false ? 'checked' : ''} /></label>`)}
      <div class="score-fields" id="score-fields" data-collapse-body>
        <div class="field">
          <label>Mode</label>
          <select id="score-mode">
            <option value="radial"${mode === 'radial' ? ' selected' : ''}>Radial</option>
            <option value="smart"${mode === 'smart' ? ' selected' : ''}>Smart</option>
            <option value="smart-v2"${mode === 'smart-v2' ? ' selected' : ''}>Smart v2</option>
            <option value="web"${mode === 'web' ? ' selected' : ''}>Negative Space</option>
          </select>
        </div>

        <!-- Radial mode fields -->
        <div id="score-fields-radial" style="${mode !== 'radial' ? 'display:none;' : ''}">
          <div class="field">
            <label>Disc Margin (in)</label>
            <input type="number" id="score-disc-margin" value="${initial.scoreDiscMargin}" step="0.05" min="0" />
          </div>
          <div class="field">
            <label>Shape Margin (in)</label>
            <input type="number" id="score-shape-margin" value="${initial.scoreShapeMargin}" step="0.05" min="0" />
          </div>
          <div class="field">
            <label>Density</label>
            <select id="score-density">
              <option value="low"${initial.scoreDensity === 'low' ? ' selected' : ''}>Low (4)</option>
              <option value="medium"${initial.scoreDensity === 'medium' ? ' selected' : ''}>Medium (8)</option>
              <option value="high"${initial.scoreDensity === 'high' ? ' selected' : ''}>High (16)</option>
            </select>
          </div>
          <div class="field">
            <label>Min Length (in)</label>
            <input type="number" id="score-min-length" value="${initial.minScoreLength}" step="0.1" min="0" />
          </div>
        </div>

        <!-- Smart mode fields -->
        <div id="score-fields-smart" style="${mode !== 'smart' ? 'display:none;' : ''}">
          <div class="field">
            <label class="section-toggle">
              <input type="checkbox" id="smart-gap-marks" ${toggles.gapMarks ? 'checked' : ''} />
              Gap Marks
            </label>
          </div>
          <div class="field smart-sub" id="smart-gap-fields" style="${!toggles.gapMarks ? 'display:none;' : ''}">
            <label>Max Gap (in)</label>
            <input type="number" id="smart-gap-threshold" value="${settings.gapMaxThreshold}" step="0.25" min="0.25" />
          </div>

          <div class="field">
            <label class="section-toggle">
              <input type="checkbox" id="smart-diagonal-lines" ${toggles.diagonalLines ? 'checked' : ''} />
              Diagonal Lines
            </label>
          </div>

          <div class="field">
            <label>Disc Margin (in)</label>
            <input type="number" id="smart-disc-margin" value="${initial.scoreDiscMargin}" step="0.05" min="0" />
          </div>
          <div class="field">
            <label>Shape Margin (in)</label>
            <input type="number" id="smart-shape-margin" value="${initial.scoreShapeMargin}" step="0.05" min="0" />
          </div>
          <div class="field">
            <label>Min Score Length (in)</label>
            <input type="number" id="smart-min-length" value="${initial.minScoreLength}" step="0.1" min="0" />
          </div>
        </div>

        <!-- Smart v2 mode fields -->
        <div id="score-fields-smart-v2" style="${mode !== 'smart-v2' ? 'display:none;' : ''}">
          <div class="field">
            <label class="section-toggle">
              <input type="checkbox" id="v2-bridge-scoring" ${v2Toggles.bridgeScoring ? 'checked' : ''} />
              Bridge Scoring
            </label>
          </div>
          <div class="field smart-sub" id="v2-bridge-fields" style="${!v2Toggles.bridgeScoring ? 'display:none;' : ''}">
            <label>Min Hand-Break Distance (in)</label>
            <input type="number" id="v2-min-hand-break" value="${v2Settings.minHandBreakDistance}" step="0.05" min="0" />
          </div>
          <div class="field smart-sub" id="v2-bridge-max-field" style="${!v2Toggles.bridgeScoring ? 'display:none;' : ''}">
            <label>Max Bridge Width (in)</label>
            <input type="number" id="v2-max-bridge" value="${v2Settings.maxBridgeWidth}" step="0.25" min="0.25" />
          </div>

          <div class="field">
            <label class="section-toggle">
              <input type="checkbox" id="v2-area-subdivision" ${v2Toggles.areaSubdivision ? 'checked' : ''} />
              Area Subdivision
            </label>
          </div>
          <div class="field smart-sub" id="v2-area-fields" style="${!v2Toggles.areaSubdivision ? 'display:none;' : ''}">
            <label>Min Open Area Gap (in)</label>
            <input type="number" id="v2-area-min-gap" value="${v2Settings.areaSliceMinGap}" step="0.25" min="0.25" />
          </div>

          <div class="field">
            <label>Shape Margin (in)</label>
            <input type="number" id="v2-shape-margin" value="${initial.scoreShapeMargin}" step="0.05" min="0" />
          </div>
          <div class="field">
            <label>Min Score Length (in)</label>
            <input type="number" id="v2-min-length" value="${initial.minScoreLength}" step="0.1" min="0" />
          </div>
        </div>

        <!-- Negative space mode fields -->
        <div id="score-fields-web" style="${mode !== 'web' ? 'display:none;' : ''}">
          <div class="field">
            <label class="section-toggle">
              <input type="checkbox" id="web-neck-scores" ${webToggles.neckScores ? 'checked' : ''} />
              Neck Scores
            </label>
          </div>
          <div class="field smart-sub web-neck-sub" style="${!webToggles.neckScores ? 'display:none;' : ''}">
            <label title="Throats narrower than this snap by hand, so no score is generated">Min Hand-Break Gap (in)</label>
            <input type="number" id="web-min-hand-break" value="${webSettings.minHandBreak}" step="0.05" min="0" />
          </div>
          <div class="field smart-sub web-neck-sub" style="${!webToggles.neckScores ? 'display:none;' : ''}">
            <label title="Anything wider than this counts as open area, not a throat">Max Neck Width (in)</label>
            <input type="number" id="web-max-neck" value="${webSettings.maxNeckWidth}" step="0.25" min="0.25" />
          </div>

          <div class="field">
            <label class="section-toggle">
              <input type="checkbox" id="web-area-subdivision" ${webToggles.areaSubdivision ? 'checked' : ''} />
              Area Subdivision
            </label>
          </div>
          <div class="field smart-sub web-area-sub" style="${!webToggles.areaSubdivision ? 'display:none;' : ''}">
            <label title="Any leftover web pocket bigger than this across gets sliced again">Max Piece Span (in)</label>
            <input type="number" id="web-max-piece-span" value="${webSettings.maxPieceSpan}" step="1" min="1" />
          </div>
          <div class="field smart-sub web-area-sub" style="${!webToggles.areaSubdivision ? 'display:none;' : ''}">
            <label title="Slices shorter than this are not worth cutting; does not apply to necks">Min Slice Length (in)</label>
            <input type="number" id="web-min-length" value="${initial.minScoreLength}" step="0.1" min="0" />
          </div>

          <div class="field">
            <label title="Each mark is this fraction of its full crossing, centered on the feature; the break runs the rest of the way on its own">Mark Length (fraction)</label>
            <input type="number" id="web-mark-fraction" value="${webSettings.markFraction}" step="0.05" min="0.1" max="1" />
          </div>
          <div class="field">
            <label title="No mark is drawn longer than this, however big the pocket it serves">Max Mark Length (in)</label>
            <input type="number" id="web-max-mark-length" value="${webSettings.maxMarkLength}" step="0.25" min="0.25" />
          </div>
          <div class="field">
            <label title="Minimum clearance between each end of a mark and the cut edges; the shorter of this and Mark Length wins">End Margin (in)</label>
            <input type="number" id="web-end-margin" value="${webSettings.endMargin}" step="0.05" min="0" />
          </div>
        </div>
      </div>
    </div>
  `;

  function persist() {
    localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(getConfig()));
  }

  function getConfig(): ScoreConfig {
    const currentMode = (document.getElementById('score-mode') as HTMLSelectElement).value as ScoreMode;
    const marginId = currentMode === 'radial' ? 'score-shape-margin'
      : currentMode === 'smart' ? 'smart-shape-margin'
      : 'v2-shape-margin';
    const lengthId = currentMode === 'radial' ? 'score-min-length'
      : currentMode === 'smart' ? 'smart-min-length'
      : currentMode === 'web' ? 'web-min-length'
      : 'v2-min-length';
    const discMarginId = currentMode === 'radial' ? 'score-disc-margin' : 'smart-disc-margin';

    return {
      enabled: (document.getElementById('score-enabled') as HTMLInputElement).checked,
      mode: currentMode,
      scoreDiscMargin: parseNum((document.getElementById(discMarginId) as HTMLInputElement)?.value ?? '', defaults.scoreDiscMargin),
      scoreShapeMargin: parseNum((document.getElementById(marginId) as HTMLInputElement).value, defaults.scoreShapeMargin),
      scoreDensity: (document.getElementById('score-density') as HTMLSelectElement).value as ScrapDensity,
      minScoreLength: parseFloat((document.getElementById(lengthId) as HTMLInputElement).value) || defaults.minScoreLength,
      smartToggles: {
        gapMarks: (document.getElementById('smart-gap-marks') as HTMLInputElement).checked,
        diagonalLines: (document.getElementById('smart-diagonal-lines') as HTMLInputElement).checked,
      },
      smartSettings: {
        gapMaxThreshold: parseNum((document.getElementById('smart-gap-threshold') as HTMLInputElement).value, defaults.smartSettings.gapMaxThreshold),
        gapMarkLengthRatio: defaults.smartSettings.gapMarkLengthRatio,
      },
      smartV2Toggles: {
        bridgeScoring: (document.getElementById('v2-bridge-scoring') as HTMLInputElement).checked,
        areaSubdivision: (document.getElementById('v2-area-subdivision') as HTMLInputElement).checked,
      },
      smartV2Settings: {
        minHandBreakDistance: parseNum((document.getElementById('v2-min-hand-break') as HTMLInputElement).value, defaults.smartV2Settings.minHandBreakDistance),
        maxBridgeWidth: parseNum((document.getElementById('v2-max-bridge') as HTMLInputElement).value, defaults.smartV2Settings.maxBridgeWidth),
        areaSliceMinGap: parseNum((document.getElementById('v2-area-min-gap') as HTMLInputElement).value, defaults.smartV2Settings.areaSliceMinGap),
      },
      webToggles: {
        neckScores: (document.getElementById('web-neck-scores') as HTMLInputElement).checked,
        areaSubdivision: (document.getElementById('web-area-subdivision') as HTMLInputElement).checked,
      },
      webSettings: {
        minHandBreak: parseNum((document.getElementById('web-min-hand-break') as HTMLInputElement).value, defaults.webSettings.minHandBreak),
        maxNeckWidth: parseNum((document.getElementById('web-max-neck') as HTMLInputElement).value, defaults.webSettings.maxNeckWidth),
        maxPieceSpan: parseNum((document.getElementById('web-max-piece-span') as HTMLInputElement).value, defaults.webSettings.maxPieceSpan),
        markFraction: parseNum((document.getElementById('web-mark-fraction') as HTMLInputElement).value, defaults.webSettings.markFraction),
        maxMarkLength: parseNum((document.getElementById('web-max-mark-length') as HTMLInputElement).value, defaults.webSettings.maxMarkLength),
        endMargin: parseNum((document.getElementById('web-end-margin') as HTMLInputElement).value, defaults.webSettings.endMargin),
      },
    };
  }

  // Master enable toggle — only controls generation, not panel visibility
  document.getElementById('score-enabled')!.addEventListener('change', () => { persist(); onChange(); });

  // Mode selector
  document.getElementById('score-mode')!.addEventListener('change', () => {
    const m = (document.getElementById('score-mode') as HTMLSelectElement).value;
    document.getElementById('score-fields-radial')!.style.display = m === 'radial' ? '' : 'none';
    document.getElementById('score-fields-smart')!.style.display = m === 'smart' ? '' : 'none';
    document.getElementById('score-fields-smart-v2')!.style.display = m === 'smart-v2' ? '' : 'none';
    document.getElementById('score-fields-web')!.style.display = m === 'web' ? '' : 'none';
    persist(); onChange();
  });

  // Radial mode inputs
  for (const id of ['score-disc-margin', 'score-shape-margin', 'score-min-length']) {
    document.getElementById(id)!.addEventListener('input', () => { persist(); onChange(); });
  }
  document.getElementById('score-density')!.addEventListener('change', () => { persist(); onChange(); });

  // Smart mode toggle checkboxes (show/hide sub-fields)
  document.getElementById('smart-gap-marks')!.addEventListener('change', () => {
    const checked = (document.getElementById('smart-gap-marks') as HTMLInputElement).checked;
    document.getElementById('smart-gap-fields')!.style.display = checked ? '' : 'none';
    persist(); onChange();
  });
  document.getElementById('smart-diagonal-lines')!.addEventListener('change', () => { persist(); onChange(); });

  // Smart mode number inputs
  for (const id of ['smart-gap-threshold', 'smart-disc-margin', 'smart-shape-margin', 'smart-min-length']) {
    document.getElementById(id)!.addEventListener('input', () => { persist(); onChange(); });
  }

  // Smart v2 toggle checkboxes
  document.getElementById('v2-bridge-scoring')!.addEventListener('change', () => {
    const checked = (document.getElementById('v2-bridge-scoring') as HTMLInputElement).checked;
    document.getElementById('v2-bridge-fields')!.style.display = checked ? '' : 'none';
    document.getElementById('v2-bridge-max-field')!.style.display = checked ? '' : 'none';
    persist(); onChange();
  });
  document.getElementById('v2-area-subdivision')!.addEventListener('change', () => {
    const checked = (document.getElementById('v2-area-subdivision') as HTMLInputElement).checked;
    document.getElementById('v2-area-fields')!.style.display = checked ? '' : 'none';
    persist(); onChange();
  });

  // Smart v2 number inputs
  for (const id of ['v2-min-hand-break', 'v2-max-bridge', 'v2-area-min-gap', 'v2-shape-margin', 'v2-min-length']) {
    document.getElementById(id)!.addEventListener('input', () => { persist(); onChange(); });
  }

  // Negative-space mode toggles (show/hide sub-fields)
  const webSections: [string, string][] = [
    ['web-neck-scores', '.web-neck-sub'],
    ['web-area-subdivision', '.web-area-sub'],
  ];
  for (const [toggleId, selector] of webSections) {
    document.getElementById(toggleId)!.addEventListener('change', () => {
      const checked = (document.getElementById(toggleId) as HTMLInputElement).checked;
      container.querySelectorAll<HTMLElement>(selector).forEach(el => {
        el.style.display = checked ? '' : 'none';
      });
      persist(); onChange();
    });
  }

  // Negative-space mode number inputs
  for (const id of ['web-min-hand-break', 'web-max-neck', 'web-max-piece-span', 'web-min-length', 'web-mark-fraction', 'web-max-mark-length', 'web-end-margin']) {
    document.getElementById(id)!.addEventListener('input', () => { persist(); onChange(); });
  }

  makeCollapsible(container.querySelector('.score-config')!, 'score');

  return { getConfig };
}
