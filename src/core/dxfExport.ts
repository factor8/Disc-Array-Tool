import { NestingResult, SheetLayout, ScrapCut, ExportColors } from './types';
import { buildDiscLegend, DEFAULT_EXPORT_COLORS, hexToInt } from './exportUtils';

// dxf-writer uses CommonJS default export
import Drawing from 'dxf-writer';

/**
 * Point the drawing's default text style at a TrueType font that exists on
 * every platform. dxf-writer defaults to the AutoCAD SHX font "txt", which
 * most CAD / laser programs don't ship — so they warn about a missing font
 * every time the DXF is imported. Arial is the universally-available
 * cross-platform stand-in for Helvetica.
 */
function useCrossPlatformFont(drawing: Drawing) {
  const styleTable = (drawing as any).tables?.STYLE;
  if (!styleTable) return;
  for (const style of styleTable.elements) {
    style.fontFileName = 'Arial.ttf';
  }
}

/**
 * Trace a scrap cut's active edges into connected polyline chains so an
 * exported rectangle is one compound line (and an L is one, not two). Edges
 * are walked around the rectangle in cyclic order (top → right → bottom →
 * left); consecutive active edges join into a single chain, and a full
 * rectangle becomes a single closed polyline.
 */
function scrapCutPolylines(
  cut: ScrapCut,
  offsetX: number,
  offsetY: number
): { points: [number, number][]; closed: boolean }[] {
  const x1 = offsetX + cut.x;
  const y1 = offsetY + cut.y;
  const x2 = x1 + cut.width;
  const y2 = y1 + cut.height;

  const A: [number, number] = [x1, y1]; // top-left
  const B: [number, number] = [x2, y1]; // top-right
  const C: [number, number] = [x2, y2]; // bottom-right
  const D: [number, number] = [x1, y2]; // bottom-left

  // Edges in cyclic order, each connecting one corner to the next.
  const cycle = [
    { on: cut.edges.top, a: A, b: B },
    { on: cut.edges.right, a: B, b: C },
    { on: cut.edges.bottom, a: C, b: D },
    { on: cut.edges.left, a: D, b: A },
  ];

  const activeCount = cycle.filter((e) => e.on).length;
  if (activeCount === 0) return [];
  if (activeCount === 4) {
    return [{ points: [A, B, C, D], closed: true }];
  }

  // Start walking just after a gap so chains don't split across the wrap point.
  let start = 0;
  while (cycle[start].on) start++;

  const polylines: { points: [number, number][]; closed: boolean }[] = [];
  let current: [number, number][] | null = null;
  for (let k = 1; k <= 4; k++) {
    const e = cycle[(start + k) % 4];
    if (e.on) {
      if (!current) current = [e.a, e.b];
      else current.push(e.b);
    } else if (current) {
      polylines.push({ points: current, closed: false });
      current = null;
    }
  }
  if (current) polylines.push({ points: current, closed: false });
  return polylines;
}

/**
 * Add a layer whose displayed color is an exact RGB (DXF true color, group
 * code 420) rather than a palette index, so exports match the color the user
 * picked. The ACI argument is kept as a fallback for viewers that ignore true
 * color.
 */
function addColoredLayer(drawing: Drawing, name: string, hex: string, aci: number) {
  drawing.addLayer(name, aci, 'CONTINUOUS');
  drawing.setActiveLayer(name);
  drawing.setTrueColor(hexToInt(hex));
}

function drawSheetDxf(
  drawing: Drawing,
  sheet: SheetLayout,
  sheetIndex: number,
  totalSheets: number,
  offsetX: number,
  offsetY: number,
  layerPrefix: string,
  colors: ExportColors
) {
  // Create typed layers, colored with the user's export palette
  addColoredLayer(drawing, `${layerPrefix}Boundary`, colors.boundary, Drawing.ACI.CYAN);
  addColoredLayer(drawing, `${layerPrefix}Cuts`, colors.cuts, Drawing.ACI.RED);
  addColoredLayer(drawing, `${layerPrefix}Disassembly`, colors.disassembly, Drawing.ACI.MAGENTA);
  addColoredLayer(drawing, `${layerPrefix}Score`, colors.score, Drawing.ACI.GREEN);
  // Text stays ACI 7 (white/black) so it auto-contrasts with any CAD background.
  drawing.addLayer(`${layerPrefix}Text`, Drawing.ACI.WHITE, 'CONTINUOUS');

  // Sheet boundary — cyan closed rectangle
  drawing.setActiveLayer(`${layerPrefix}Boundary`);
  drawing.drawRect(offsetX, offsetY, offsetX + sheet.width, offsetY + sheet.height);

  // Disc circles + center holes — red, no fill
  drawing.setActiveLayer(`${layerPrefix}Cuts`);
  for (const disc of sheet.discs) {
    const cx = offsetX + disc.x;
    const cy = offsetY + disc.y;
    drawing.drawCircle(cx, cy, disc.diameter / 2);
    if (disc.centerHole !== null && disc.centerHole > 0) {
      drawing.drawCircle(cx, cy, disc.centerHole / 2);
    }
  }

  // Disassembly (scrap cuts) — magenta, joined into compound polylines
  // (skip edges on sheet boundary)
  if (sheet.scrapCuts?.length) {
    drawing.setActiveLayer(`${layerPrefix}Disassembly`);
    for (const cut of sheet.scrapCuts) {
      for (const pl of scrapCutPolylines(cut, offsetX, offsetY)) {
        drawing.drawPolyline(pl.points, pl.closed);
      }
    }
  }

  // Score lines — yellow
  if (sheet.scoreLines?.length) {
    drawing.setActiveLayer(`${layerPrefix}Score`);
    for (const line of sheet.scoreLines) {
      drawing.drawLine(
        offsetX + line.x1,
        offsetY + line.y1,
        offsetX + line.x2,
        offsetY + line.y2
      );
    }
  }

  // Text — outside sheet boundary (above)
  drawing.setActiveLayer(`${layerPrefix}Text`);
  const textHeight = 1.5;
  const textY = offsetY + sheet.height + 2;
  drawing.drawText(
    offsetX, textY, textHeight, 0,
    `Sheet ${sheetIndex + 1} of ${totalSheets} - ${sheet.discs.length} discs`
  );

  const legend = buildDiscLegend(sheet);
  if (legend) {
    drawing.drawText(offsetX, textY + textHeight + 0.5, textHeight * 0.75, 0, legend);
  }
}

/** Export each sheet as a separate DXF file */
export function exportPerSheet(
  result: NestingResult,
  colors: ExportColors = DEFAULT_EXPORT_COLORS
): { filename: string; content: string }[] {
  const files: { filename: string; content: string }[] = [];

  for (let i = 0; i < result.sheets.length; i++) {
    const sheet = result.sheets[i];
    const drawing = new Drawing();
    drawing.setUnits('Inches');
    useCrossPlatformFont(drawing);

    drawSheetDxf(drawing, sheet, i, result.totalSheets, 0, 0, '', colors);

    files.push({
      filename: `sheet_${i + 1}.dxf`,
      content: drawing.toDxfString(),
    });
  }

  return files;
}

/** Export all sheets into one DXF with layers, gridded 4 columns wide */
export function exportCombined(
  result: NestingResult,
  colors: ExportColors = DEFAULT_EXPORT_COLORS
): { filename: string; content: string } {
  const drawing = new Drawing();
  drawing.setUnits('Inches');
  useCrossPlatformFont(drawing);

  const sheetGap = 10;
  const textSpace = 6;
  const gridCols = 4;

  for (let i = 0; i < result.sheets.length; i++) {
    const sheet = result.sheets[i];
    const col = i % gridCols;
    const row = Math.floor(i / gridCols);
    const offsetX = col * (sheet.width + sheetGap);
    const offsetY = row * (sheet.height + sheetGap + textSpace);

    drawSheetDxf(drawing, sheet, i, result.totalSheets, offsetX, offsetY, `Sheet${i + 1}_`, colors);
  }

  return {
    filename: `all_sheets_combined.dxf`,
    content: drawing.toDxfString(),
  };
}

/** Trigger browser download of a text file */
export function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Download a blob file (for PDF etc.) */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Download a zip-like collection by downloading each file */
export function downloadAllFiles(files: { filename: string; content: string }[]) {
  for (const file of files) {
    downloadFile(file.filename, file.content);
  }
}
