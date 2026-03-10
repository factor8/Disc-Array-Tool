import { OptimizationMode, NestingResult, NestingConfig, NestingCorner, NestingDirection, SheetConfig } from '../core/types';
import { exportPerSheet, exportCombined, downloadFile, downloadAllFiles, downloadBlob } from '../core/dxfExport';
import { exportPdf } from '../core/pdfExport';

const NESTING_STORAGE_KEY = 'disc-array-tool-nesting';
const EXPORT_STORAGE_KEY = 'disc-array-tool-export';

interface NestingSettings {
  mode: OptimizationMode;
  corner: NestingCorner;
  direction: NestingDirection;
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

  container.innerHTML = `
    <div class="nesting-controls">
      <h3>Nesting</h3>
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
  `;

  function persist() {
    saveNestingSettings({
      mode: getMode(),
      corner: (document.getElementById('nest-corner') as HTMLSelectElement).value as NestingCorner,
      direction: (document.getElementById('nest-direction') as HTMLSelectElement).value as NestingDirection,
    });
  }

  function getMode(): OptimizationMode {
    const checked = container.querySelector<HTMLInputElement>('input[name="opt-mode"]:checked');
    return (checked?.value as OptimizationMode) || 'minimize-sheets';
  }

  // Listen to all controls
  const radios = container.querySelectorAll<HTMLInputElement>('input[name="opt-mode"]');
  for (const radio of radios) {
    radio.addEventListener('change', () => { persist(); onChange(); });
  }
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

  return {
    getMode,
    getNestingConfig(): NestingConfig {
      return {
        corner: (document.getElementById('nest-corner') as HTMLSelectElement).value as NestingCorner,
        direction: (document.getElementById('nest-direction') as HTMLSelectElement).value as NestingDirection,
      };
    },
  };
}

export function createExportControls(
  container: HTMLElement,
  getResult: () => NestingResult | null
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

    if (format === 'per-sheet') {
      const files = exportPerSheet(result);
      downloadAllFiles(files);
    } else if (format === 'combined') {
      const file = exportCombined(result);
      downloadFile(file.filename, file.content);
    } else if (format === 'pdf') {
      const blob = exportPdf(result);
      downloadBlob('disc_layout.pdf', blob);
    }
  });
}
