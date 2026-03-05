import { DiscSpec, SheetConfig, ScrapConfig, ScoreConfig, ScrapDensity, ScoreMode } from '../core/types';
import { parseInches } from '../utils/parsing';

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
    <div class="scrap-config">
      <h3>
        <label class="section-toggle">
          <input type="checkbox" id="scrap-enabled" ${initial.enabled !== false ? 'checked' : ''} />
          Scrap Management
        </label>
      </h3>
      <div class="scrap-fields" id="scrap-fields" style="${initial.enabled === false ? 'display:none;' : ''}">
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
      scrapEdgeMargin: parseFloat((document.getElementById('scrap-edge-margin') as HTMLInputElement).value) ?? defaults.scrapEdgeMargin,
      scrapDiscMargin: parseFloat((document.getElementById('scrap-disc-margin') as HTMLInputElement).value) ?? defaults.scrapDiscMargin,
    };
  }

  document.getElementById('scrap-enabled')!.addEventListener('change', () => {
    const enabled = (document.getElementById('scrap-enabled') as HTMLInputElement).checked;
    document.getElementById('scrap-fields')!.style.display = enabled ? '' : 'none';
    persist(); onChange();
  });
  for (const id of ['scrap-min-area', 'scrap-edge-margin', 'scrap-disc-margin']) {
    document.getElementById(id)!.addEventListener('input', () => { persist(); onChange(); });
  }
  document.getElementById('scrap-density')!.addEventListener('change', () => { persist(); onChange(); });

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
      };
    } catch { /* use defaults */ }
  }

  const mode = initial.mode || 'radial';
  const toggles = initial.smartToggles;
  const settings = initial.smartSettings;

  container.innerHTML = `
    <div class="score-config">
      <h3>
        <label class="section-toggle">
          <input type="checkbox" id="score-enabled" ${initial.enabled !== false ? 'checked' : ''} />
          Score Lines
        </label>
      </h3>
      <div class="score-fields" id="score-fields" style="${initial.enabled === false ? 'display:none;' : ''}">
        <div class="field">
          <label>Mode</label>
          <select id="score-mode">
            <option value="radial"${mode === 'radial' ? ' selected' : ''}>Radial</option>
            <option value="smart"${mode === 'smart' ? ' selected' : ''}>Smart</option>
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
      </div>
    </div>
  `;

  function persist() {
    localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(getConfig()));
  }

  function getConfig(): ScoreConfig {
    const currentMode = (document.getElementById('score-mode') as HTMLSelectElement).value as ScoreMode;
    const isRadial = currentMode === 'radial';

    return {
      enabled: (document.getElementById('score-enabled') as HTMLInputElement).checked,
      mode: currentMode,
      scoreDiscMargin: parseFloat((document.getElementById(isRadial ? 'score-disc-margin' : 'smart-disc-margin') as HTMLInputElement).value) ?? defaults.scoreDiscMargin,
      scoreShapeMargin: parseFloat((document.getElementById(isRadial ? 'score-shape-margin' : 'smart-shape-margin') as HTMLInputElement).value) ?? defaults.scoreShapeMargin,
      scoreDensity: (document.getElementById('score-density') as HTMLSelectElement).value as ScrapDensity,
      minScoreLength: parseFloat((document.getElementById(isRadial ? 'score-min-length' : 'smart-min-length') as HTMLInputElement).value) || defaults.minScoreLength,
      smartToggles: {
        gapMarks: (document.getElementById('smart-gap-marks') as HTMLInputElement).checked,
        diagonalLines: (document.getElementById('smart-diagonal-lines') as HTMLInputElement).checked,
      },
      smartSettings: {
        gapMaxThreshold: parseFloat((document.getElementById('smart-gap-threshold') as HTMLInputElement).value) || defaults.smartSettings.gapMaxThreshold,
        gapMarkLengthRatio: defaults.smartSettings.gapMarkLengthRatio,
      },
    };
  }

  // Master enable toggle
  document.getElementById('score-enabled')!.addEventListener('change', () => {
    const enabled = (document.getElementById('score-enabled') as HTMLInputElement).checked;
    document.getElementById('score-fields')!.style.display = enabled ? '' : 'none';
    persist(); onChange();
  });

  // Mode selector
  document.getElementById('score-mode')!.addEventListener('change', () => {
    const m = (document.getElementById('score-mode') as HTMLSelectElement).value;
    document.getElementById('score-fields-radial')!.style.display = m === 'radial' ? '' : 'none';
    document.getElementById('score-fields-smart')!.style.display = m === 'smart' ? '' : 'none';
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

  return { getConfig };
}
