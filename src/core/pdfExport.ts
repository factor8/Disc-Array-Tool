import { jsPDF } from 'jspdf';
import { NestingResult, SheetLayout, ExportColors } from './types';
import { buildDiscLegend, DEFAULT_EXPORT_COLORS, hexToRgb } from './exportUtils';

function drawSheetPdf(
  doc: jsPDF,
  sheet: SheetLayout,
  sheetIndex: number,
  totalSheets: number,
  colors: ExportColors
) {
  // Sheet outline — hairline
  doc.setDrawColor(...hexToRgb(colors.boundary));
  doc.setLineWidth(0.01);
  doc.rect(0, 0, sheet.width, sheet.height, 'S');

  // Disc circles — no fill, hairline
  doc.setDrawColor(...hexToRgb(colors.cuts));
  doc.setLineWidth(0.01);
  for (const disc of sheet.discs) {
    doc.circle(disc.x, disc.y, disc.diameter / 2, 'S');
    if (disc.centerHole !== null && disc.centerHole > 0) {
      doc.circle(disc.x, disc.y, disc.centerHole / 2, 'S');
    }
  }

  // Disassembly (scrap cuts) — hairline, L/C shaped
  if (sheet.scrapCuts?.length) {
    doc.setDrawColor(...hexToRgb(colors.disassembly));
    doc.setLineWidth(0.01);
    for (const cut of sheet.scrapCuts) {
      const x1 = cut.x;
      const y1 = cut.y;
      const x2 = cut.x + cut.width;
      const y2 = cut.y + cut.height;
      const e = cut.edges;

      if (e.top) doc.line(x1, y1, x2, y1);
      if (e.right) doc.line(x2, y1, x2, y2);
      if (e.bottom) doc.line(x1, y2, x2, y2);
      if (e.left) doc.line(x1, y1, x1, y2);
    }
  }

  // Score lines — hairline
  if (sheet.scoreLines?.length) {
    doc.setDrawColor(...hexToRgb(colors.score));
    doc.setLineWidth(0.01);
    for (const line of sheet.scoreLines) {
      doc.line(line.x1, line.y1, line.x2, line.y2);
    }
  }

  // Text — below sheet boundary in margin area
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(14);
  const textY = sheet.height + 1;
  doc.text(
    `Sheet ${sheetIndex + 1} of ${totalSheets} - ${sheet.discs.length} discs`,
    0.5,
    textY
  );

  const legend = buildDiscLegend(sheet);
  if (legend) {
    doc.setFontSize(11);
    doc.text(legend, 0.5, textY + 0.6);
  }
}

/** Export all sheets as a multi-page PDF at full material size */
export function exportPdf(
  result: NestingResult,
  colors: ExportColors = DEFAULT_EXPORT_COLORS
): Blob {
  const firstSheet = result.sheets[0];
  const textMargin = 3; // extra inches below sheet for text

  // Create doc with first sheet dimensions
  const doc = new jsPDF({
    orientation: firstSheet.width > firstSheet.height ? 'landscape' : 'portrait',
    unit: 'in',
    format: [firstSheet.width, firstSheet.height + textMargin],
  });

  for (let i = 0; i < result.sheets.length; i++) {
    const sheet = result.sheets[i];

    if (i > 0) {
      doc.addPage(
        [sheet.width, sheet.height + textMargin],
        sheet.width > sheet.height ? 'landscape' : 'portrait'
      );
    }

    drawSheetPdf(doc, sheet, i, result.totalSheets, colors);
  }

  return doc.output('blob');
}
