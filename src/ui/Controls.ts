import { OptimizationMode, NestingResult, NestingConfig, NestingCorner, NestingDirection, SheetConfig, ScrapConfig, ScoreConfig, ExportColors } from '../core/types';
import { exportPerSheet, exportCombined, downloadFile, downloadAllFiles, downloadBlob } from '../core/dxfExport';
import { exportPdf } from '../core/pdfExport';
import { DEFAULT_EXPORT_COLORS } from '../core/exportUtils';
import { collapsibleHeader, makeCollapsible } from './collapsible';

const NESTING_STORAGE_KEY = 'disc-array-tool-nesting';
const EXPORT_STORAGE_KEY = 'disc-array-tool-export';
const COLORS_STORAGE_KEY = 'disc-array-tool-colors';
const SCRAP_STORAGE_KEY = 'disc-array-tool-scrap';
const SCORE_STORAGE_KEY = 'disc-array-tool-score';
const DISCS_STORAGE_KEY = 'disc-array-tool-discs';
const DEFAULTS_STORAGE_KEY = 'disc-array-tool-defaults';

interface NestingSettings {
  mode: OptimizationMode;
  corner: NestingCorner;
  direction: NestingDirection;
  minUtilization?: number;
}

/** A snapshot of every non-disc setting the user can save as their defaults. */
export interface DefaultsSnapshot {
  sheet: SheetConfig;
  nesting: NestingSettings;
  scrap: ScrapConfig;
  score: ScoreConfig;
  colors: ExportColors;
}

function loadExportColors(): ExportColors {
  const raw = localStorage.getItem(COLORS_STORAGE_KEY);
  if (raw) {
    try { return { ...DEFAULT_EXPORT_COLORS, ...JSON.parse(raw) }; } catch { /* use defaults */ }
  }
  return { ...DEFAULT_EXPORT_COLORS };
}

function loadNestingSettings(): NestingSettings | null {
  const raw = localStorage.getItem(NESTING_STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function saveNestingSettings(settings: NestingSettings) {
  localStorage.setItem(NESTING_STORAGE_KEY, JSON.stringify(settings));
}

const SHEET_STORAGE_KEY = 'disc-array-tool-sheet';

export function createNestingControls(
  container: HTMLElement,
  onChange: () => void,
  defaultSpacing: number = 0.1
): { getMode: () => OptimizationMode; getNestingConfig: () => NestingConfig } {
  const saved = loadNestingSettings();
  const initialMode = saved?.mode ?? 'minimize-sheets';
  const initialCorner = saved?.corner ?? 'bottom-left';
  const initialDirection = saved?.direction ?? 'horizontal';
  const initialMinUtil = saved?.minUtilization ?? 0.85;

  // Load saved spacing from sheet config
  let initialSpacing = defaultSpacing;
  const savedSheet = localStorage.getItem(SHEET_STORAGE_KEY);
  if (savedSheet) {
    try {
      const parsed = JSON.parse(savedSheet);
      if (parsed.spacing !== undefined) initialSpacing = parsed.spacing;
    } catch { /* use default */ }
  }

  const cornerOptions: NestingCorner[] = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];
  const cornerLabels: Record<NestingCorner, string> = {
    'bottom-left': 'Bottom-Left',
    'bottom-right': 'Bottom-Right',
    'top-left': 'Top-Left',
    'top-right': 'Top-Right',
  };

  const initialMinUtilPct = Math.round(initialMinUtil * 100);
  container.innerHTML = `
    <div class="nesting-controls panel-collapsible">
      ${collapsibleHeader('Nesting')}
      <div data-collapse-body>
      <div class="toggle-field">
        <label class="toggle-label">
          <span>Optimization</span>
        </label>
        <div class="toggle-row">
          <label class="toggle-option">
            <input type="radio" name="opt-mode" value="minimize-sheets" ${initialMode === 'minimize-sheets' ? 'checked' : ''} />
            <span>Fewer total sheets</span>
          </label>
          <label class="toggle-option">
            <input type="radio" name="opt-mode" value="minimize-unique" ${initialMode === 'minimize-unique' ? 'checked' : ''} />
            <span>Fewer unique layouts</span>
          </label>
        </div>
      </div>
      <div class="nesting-fields">
        <div class="field" id="min-util-field" style="${initialMode === 'minimize-unique' ? '' : 'display:none'}">
          <label>Min. Sheet Fill: <span id="min-util-display">${initialMinUtilPct}%</span></label>
          <input type="range" id="nest-min-util" min="50" max="100" step="5" value="${initialMinUtilPct}" />
        </div>
        <div class="field">
          <label>Starting Corner</label>
          <select id="nest-corner">
            ${cornerOptions.map(c => `<option value="${c}"${c === initialCorner ? ' selected' : ''}>${cornerLabels[c]}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Direction</label>
          <select id="nest-direction">
            <option value="horizontal"${initialDirection === 'horizontal' ? ' selected' : ''}>Horizontal</option>
            <option value="vertical"${initialDirection === 'vertical' ? ' selected' : ''}>Vertical</option>
          </select>
        </div>
        <div class="field">
          <label>Spacing / Kerf (in)</label>
          <input type="number" id="sheet-spacing" value="${initialSpacing}" step="0.01" min="0" />
        </div>
      </div>
      </div>
    </div>
  `;

  function getMinUtil(): number {
    const slider = document.getElementById('nest-min-util') as HTMLInputElement;
    return parseInt(slider.value, 10) / 100;
  }

  function persist() {
    saveNestingSettings({
      mode: getMode(),
      corner: (document.getElementById('nest-corner') as HTMLSelectElement).value as NestingCorner,
      direction: (document.getElementById('nest-direction') as HTMLSelectElement).value as NestingDirection,
      minUtilization: getMinUtil(),
    });
  }

  function getMode(): OptimizationMode {
    const checked = container.querySelector<HTMLInputElement>('input[name="opt-mode"]:checked');
    return (checked?.value as OptimizationMode) || 'minimize-sheets';
  }

  // Listen to all controls
  const radios = container.querySelectorAll<HTMLInputElement>('input[name="opt-mode"]');
  for (const radio of radios) {
    radio.addEventListener('change', () => {
      const utilField = document.getElementById('min-util-field')!;
      utilField.style.display = getMode() === 'minimize-unique' ? '' : 'none';
      persist();
      onChange();
    });
  }
  document.getElementById('nest-min-util')!.addEventListener('input', () => {
    const slider = document.getElementById('nest-min-util') as HTMLInputElement;
    document.getElementById('min-util-display')!.textContent = `${slider.value}%`;
    persist();
    onChange();
  });
  document.getElementById('nest-corner')!.addEventListener('change', () => { persist(); onChange(); });
  document.getElementById('nest-direction')!.addEventListener('change', () => { persist(); onChange(); });
  document.getElementById('sheet-spacing')!.addEventListener('input', () => {
    // Save spacing to sheet config storage so getConfig() in InputForm picks it up
    const savedSheet = localStorage.getItem(SHEET_STORAGE_KEY);
    let existing: Record<string, unknown> = {};
    if (savedSheet) { try { existing = JSON.parse(savedSheet); } catch { /* ignore */ } }
    existing.spacing = parseFloat((document.getElementById('sheet-spacing') as HTMLInputElement).value);
    localStorage.setItem(SHEET_STORAGE_KEY, JSON.stringify(existing));
    onChange();
  });

  makeCollapsible(container.querySelector('.nesting-controls')!, 'nesting');

  return {
    getMode,
    getNestingConfig(): NestingConfig {
      return {
        corner: (document.getElementById('nest-corner') as HTMLSelectElement).value as NestingCorner,
        direction: (document.getElementById('nest-direction') as HTMLSelectElement).value as NestingDirection,
        minUtilization: getMinUtil(),
      };
    },
  };
}

export function createExportControls(
  container: HTMLElement,
  getResult: () => NestingResult | null,
  getColors: () => ExportColors = loadExportColors
): void {
  const savedFormat = localStorage.getItem(EXPORT_STORAGE_KEY) || 'combined';

  container.innerHTML = `
    <div class="export-controls">
      <select id="export-format">
        <option value="per-sheet"${savedFormat === 'per-sheet' ? ' selected' : ''}>One DXF per sheet</option>
        <option value="combined"${savedFormat === 'combined' ? ' selected' : ''}>Combined DXF (layers)</option>
        <option value="pdf"${savedFormat === 'pdf' ? ' selected' : ''}>PDF (full size)</option>
      </select>
      <button class="btn-primary btn-large" id="export-btn">Export</button>
    </div>
  `;

  document.getElementById('export-format')!.addEventListener('change', () => {
    localStorage.setItem(EXPORT_STORAGE_KEY, (document.getElementById('export-format') as HTMLSelectElement).value);
  });

  document.getElementById('export-btn')!.addEventListener('click', () => {
    const result = getResult();
    if (!result || result.sheets.length === 0) return;

    const format = (document.getElementById('export-format') as HTMLSelectElement).value;

    const colors = getColors();

    if (format === 'per-sheet') {
      const files = exportPerSheet(result, colors);
      downloadAllFiles(files);
    } else if (format === 'combined') {
      const file = exportCombined(result, colors);
      downloadFile(file.filename, file.content);
    } else if (format === 'pdf') {
      const blob = exportPdf(result, colors);
      downloadBlob('disc_layout.pdf', blob);
    }
  });
}

/**
 * Export color panel. Lets the user recolor each exported line type (sheet
 * boundary, disc cuts, disassembly cuts, score lines) without touching the
 * on-screen preview. Colors persist to localStorage and are read at export
 * time by createExportControls' getColors().
 */
export function createColorControls(
  container: HTMLElement
): { getColors: () => ExportColors } {
  const initial = loadExportColors();

  const swatches: { key: keyof ExportColors; label: string }[] = [
    { key: 'boundary', label: 'Sheet Boundary' },
    { key: 'cuts', label: 'Disc Cuts' },
    { key: 'disassembly', label: 'Disassembly' },
    { key: 'score', label: 'Score Lines' },
  ];

  container.innerHTML = `
    <div class="color-config panel-collapsible">
      ${collapsibleHeader('Export Colors')}
      <div data-collapse-body>
        <p class="color-hint">Applied to exported DXF/PDF files only — the preview is unchanged.</p>
        <div class="color-fields">
          ${swatches.map(s => `
            <label class="color-field">
              <input type="color" id="color-${s.key}" value="${initial[s.key]}" />
              <span>${s.label}</span>
            </label>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  function getColors(): ExportColors {
    const read = (key: keyof ExportColors) =>
      (document.getElementById(`color-${key}`) as HTMLInputElement).value.toUpperCase();
    return {
      boundary: read('boundary'),
      cuts: read('cuts'),
      disassembly: read('disassembly'),
      score: read('score'),
    };
  }

  for (const s of swatches) {
    document.getElementById(`color-${s.key}`)!.addEventListener('input', () => {
      localStorage.setItem(COLORS_STORAGE_KEY, JSON.stringify(getColors()));
    });
  }

  makeCollapsible(container.querySelector('.color-config')!, 'colors');

  return { getColors };
}

/**
 * "Set as Defaults" / "Reset to Defaults" controls.
 *
 * Set captures the current sheet, nesting, scrap, and score settings (never the
 * discs) into a saved baseline. Reset writes that baseline back into each
 * section's storage, clears the disc list to start a fresh order, and reloads
 * so every section re-initializes cleanly from storage.
 */
export function createDefaultsControls(
  container: HTMLElement,
  getSnapshot: () => DefaultsSnapshot,
  builtinDefaults: DefaultsSnapshot
): void {
  container.innerHTML = `
    <div class="defaults-controls">
      <button class="btn-secondary btn-small" id="set-defaults-btn"
        title="Save the current sheet, nesting, scrap, and score settings as your defaults (discs are not included)">Set as Defaults</button>
      <button class="btn-secondary btn-small" id="reset-defaults-btn"
        title="Restore settings to your saved defaults and clear the disc list">Reset to Defaults</button>
    </div>
  `;

  const setBtn = document.getElementById('set-defaults-btn') as HTMLButtonElement;
  setBtn.addEventListener('click', () => {
    localStorage.setItem(DEFAULTS_STORAGE_KEY, JSON.stringify(getSnapshot()));
    const original = setBtn.textContent;
    setBtn.textContent = 'Saved ✓';
    setBtn.disabled = true;
    setTimeout(() => { setBtn.textContent = original; setBtn.disabled = false; }, 1200);
  });

  document.getElementById('reset-defaults-btn')!.addEventListener('click', () => {
    if (!confirm('Reset all settings to your saved defaults and clear the disc list?')) return;

    let snapshot = builtinDefaults;
    const raw = localStorage.getItem(DEFAULTS_STORAGE_KEY);
    if (raw) {
      try { snapshot = { ...builtinDefaults, ...JSON.parse(raw) }; } catch { /* fall back to built-in */ }
    }

    localStorage.setItem(SHEET_STORAGE_KEY, JSON.stringify(snapshot.sheet));
    localStorage.setItem(NESTING_STORAGE_KEY, JSON.stringify(snapshot.nesting));
    localStorage.setItem(SCRAP_STORAGE_KEY, JSON.stringify(snapshot.scrap));
    localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(snapshot.score));
    if (snapshot.colors) localStorage.setItem(COLORS_STORAGE_KEY, JSON.stringify(snapshot.colors));
    localStorage.removeItem(DISCS_STORAGE_KEY);

    location.reload();
  });
}
