import { NestingResult, SheetLayout } from '../core/types';

const TEMPLATE_COLORS = [
  '#e94560', '#0f3460', '#16c79a', '#f5a623',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
];

const VIEW_STORAGE_KEY = 'disc-array-tool-view';

const DEFAULT_PPI = 8;
const MIN_PPI = 2;
const MAX_PPI = 20;

interface ViewSettings {
  pixelsPerInch: number;
}

function loadViewSettings(): ViewSettings {
  const raw = localStorage.getItem(VIEW_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        pixelsPerInch: parsed.pixelsPerInch ?? DEFAULT_PPI,
      };
    } catch { /* use defaults */ }
  }
  return { pixelsPerInch: DEFAULT_PPI };
}

function saveViewSettings(settings: ViewSettings) {
  localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(settings));
}

function getTemplateColor(templateId: string, templateIds: string[]): string {
  const idx = templateIds.indexOf(templateId);
  return TEMPLATE_COLORS[idx % TEMPLATE_COLORS.length];
}

function drawSheet(
  canvas: HTMLCanvasElement,
  sheet: SheetLayout,
  templateColor: string,
  pixelsPerInch: number
) {
  const ctx = canvas.getContext('2d')!;
  const scale = pixelsPerInch;

  canvas.width = sheet.width * scale + 2;
  canvas.height = sheet.height * scale + 2;

  // Background
  ctx.fillStyle = '#0f0f23';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Sheet border
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.strokeRect(1, 1, sheet.width * scale, sheet.height * scale);

  // Discs
  for (const disc of sheet.discs) {
    const cx = disc.x * scale + 1;
    const cy = disc.y * scale + 1;
    const r = (disc.diameter / 2) * scale;

    // Disc fill
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = templateColor + '33'; // semi-transparent
    ctx.fill();
    ctx.strokeStyle = templateColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Center hole
    if (disc.centerHole !== null && disc.centerHole > 0) {
      const hr = (disc.centerHole / 2) * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, hr, 0, Math.PI * 2);
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Scrap cuts (L/C shaped — only draw non-boundary edges)
  if (sheet.scrapCuts) {
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 1;
    for (const cut of sheet.scrapCuts) {
      const x1 = cut.x * scale + 1;
      const y1 = cut.y * scale + 1;
      const x2 = (cut.x + cut.width) * scale + 1;
      const y2 = (cut.y + cut.height) * scale + 1;
      const e = cut.edges;

      ctx.beginPath();
      if (e.top) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y1); }
      if (e.right) { ctx.moveTo(x2, y1); ctx.lineTo(x2, y2); }
      if (e.bottom) { ctx.moveTo(x1, y2); ctx.lineTo(x2, y2); }
      if (e.left) { ctx.moveTo(x1, y1); ctx.lineTo(x1, y2); }
      ctx.stroke();
    }
  }

  // Score lines
  if (sheet.scoreLines) {
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 1;
    for (const line of sheet.scoreLines) {
      ctx.beginPath();
      ctx.moveTo(line.x1 * scale + 1, line.y1 * scale + 1);
      ctx.lineTo(line.x2 * scale + 1, line.y2 * scale + 1);
      ctx.stroke();
    }
  }
}

export function renderPreview(
  container: HTMLElement,
  result: NestingResult
) {
  container.innerHTML = '';

  if (result.sheets.length === 0) {
    container.innerHTML = '<p style="color: #888;">No sheets generated.</p>';
    return;
  }

  const settings = loadViewSettings();

  // Stats
  const statsDiv = document.createElement('div');
  statsDiv.className = 'stats';
  statsDiv.innerHTML = `
    <div class="stat">
      <div class="stat-value">${result.totalSheets}</div>
      <div class="stat-label">Total Sheets</div>
    </div>
    <div class="stat">
      <div class="stat-value">${result.uniqueTemplates}</div>
      <div class="stat-label">Unique Layouts</div>
    </div>
    <div class="stat">
      <div class="stat-value">${result.sheets.reduce((s, sh) => s + sh.discs.length, 0)}</div>
      <div class="stat-label">Discs Placed</div>
    </div>
    ${result.unplacedDiscs > 0 ? `
    <div class="stat">
      <div class="stat-value" style="color: #ff6b6b;">${result.unplacedDiscs}</div>
      <div class="stat-label">Unplaced</div>
    </div>` : ''}
  `;
  container.appendChild(statsDiv);

  // View controls
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'view-controls';
  controlsDiv.innerHTML = `
    <div class="view-control-group">
      <span class="view-control-label">Zoom</span>
      <div class="zoom-slider">
        <input type="range" min="${MIN_PPI}" max="${MAX_PPI}" step="1" value="${settings.pixelsPerInch}" id="zoom-range" />
        <span class="zoom-value" id="zoom-value">${settings.pixelsPerInch}px/in</span>
      </div>
    </div>
  `;
  container.appendChild(controlsDiv);

  // Flow wrapper — panels fill width naturally based on zoom
  const gridDiv = document.createElement('div');
  gridDiv.className = 'preview-flow';
  container.appendChild(gridDiv);

  // Get unique template IDs for color coding
  const templateIds = [...new Set(result.sheets.map(s => s.templateId))];

  // Render sheets
  function renderSheets(ppi: number) {
    gridDiv.innerHTML = '';
    for (let i = 0; i < result.sheets.length; i++) {
      const sheet = result.sheets[i];
      const color = getTemplateColor(sheet.templateId, templateIds);

      const wrapper = document.createElement('div');
      wrapper.className = 'sheet-preview';

      const templateCount = result.sheets.filter(s => s.templateId === sheet.templateId).length;
      const templateLabel = templateCount > 1 ? ` (Template used ${templateCount}x)` : '';

      const label = document.createElement('div');
      label.className = 'sheet-label';
      label.innerHTML = `Sheet ${i + 1} of ${result.totalSheets} &mdash; ${sheet.discs.length} discs${templateLabel}`;
      wrapper.appendChild(label);

      const canvas = document.createElement('canvas');
      drawSheet(canvas, sheet, color, ppi);
      wrapper.appendChild(canvas);

      gridDiv.appendChild(wrapper);
    }
  }

  renderSheets(settings.pixelsPerInch);

  // Zoom slider
  const zoomRange = document.getElementById('zoom-range') as HTMLInputElement;
  const zoomValue = document.getElementById('zoom-value') as HTMLElement;

  zoomRange.addEventListener('input', () => {
    const ppi = parseInt(zoomRange.value);
    settings.pixelsPerInch = ppi;
    zoomValue.textContent = `${ppi}px/in`;
    saveViewSettings(settings);
    renderSheets(ppi);
  });
}
