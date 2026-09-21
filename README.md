# Disc Array Tool

A browser tool for nesting circular discs onto material sheets and exporting laser-ready DXF or PDF files. You enter the discs you need, the tool packs them onto 48×96" (or whatever size) sheets, shows a live preview, and adds the scrap cuts and score lines that let you break the leftover material apart by hand after cutting.

Runs at [discs.fnmnl.com](https://discs.fnmnl.com), or locally with `npm run dev`.

## Getting started

```bash
npm install
npm run dev      # Vite dev server
npm run build    # type-check + build to dist/
npm run preview  # serve the built output
```

No framework, no backend — vanilla TypeScript, Vite, and a canvas.

## How it works

### 1. Disc specifications

Each row is a count, a diameter, and an optional center hole. Diameters accept fractional inches, so `31 31/32`, `31.96875`, `1/2`, and `.5` all parse ([parsing.ts](src/utils/parsing.ts)). Sheet width, height, and spacing/kerf are set alongside the disc list.

### 2. Nesting

Two optimization modes ([nesting.ts](src/core/nesting.ts)):

- **Minimize sheets** — greedy largest-first bin packing. Every sheet may end up a different layout.
- **Minimize unique layouts** — builds repeatable template sheets, so you cut N copies of one layout instead of N one-offs. The **Min. Sheet Fill** slider sets how full a template has to be before it's accepted.

You also pick a starting corner (which of the four corners packing grows from) and a direction (horizontal or vertical). Sheets sharing a `templateId` are identical and get the same preview color.

### 3. Scrap cuts

Large empty regions get cut into rectangles so the waste comes off the table in manageable pieces instead of one awkward sheet-sized skeleton ([scrapCuts.ts](src/core/scrapCuts.ts)). Controlled by a 0.25" occupancy grid, with settings for minimum rectangle edge, subdivision density, and how far the rectangles inset from the sheet edge and from disc outlines. Edges that coincide with the sheet boundary are skipped, and the remaining edges are joined into single polylines on export.

### 4. Score lines

Score lines are shallow cuts that let you snap the scrap apart by hand. Three modes ([scoreLines.ts](src/core/scoreLines.ts)):

- **Radial** — a starburst of rays from each disc, marching outward until they hit another disc, a scrap rectangle, or the sheet edge. Settings: disc margin, shape margin, density (4/8/16 rays), minimum length.
- **Smart** — strategic placement rather than uniform ([smartScoreLines.ts](src/core/smartScoreLines.ts)). Short gap marks at the thin point between two nearly-touching discs, plus 45° diagonals that break up the large waste pockets. Each is independently toggleable.
- **Smart v2** — treats the negative space as the subject ([smartScoreLinesV2.ts](src/core/smartScoreLinesV2.ts)). Builds a distance field over the empty area, finds the peaks (the widest, most stubborn regions), and casts opposing ray pairs through them. Separately scores thin bridges between obstacles. Settings: minimum hand-break distance (gaps below this snap without help), maximum bridge width, and minimum open-area size worth slicing.

### 5. Export

- **One DXF per sheet** — separate file for each sheet, downloaded together.
- **Combined DXF** — every sheet in one file, each on its own layer.
- **PDF** — full-size, one page per sheet, with a disc legend.

Line colors are configurable per type (sheet boundary, disc cuts, disassembly cuts, score lines) since most laser software maps color to operation. These apply to exported files only, not the preview. DXF text uses Arial so CAD programs don't warn about a missing SHX font.

Every panel's settings can be saved as your defaults; they persist in localStorage and reload with the page.

## Project layout

```
src/
  main.ts                  App entry — wires the panels together, debounced re-nest on change
  ui/
    InputForm.ts           Disc list, sheet config, scrap and score panels
    Controls.ts            Nesting mode, export format, colors, saved defaults
    Preview.ts             Canvas rendering with zoom
    collapsible.ts         Panel collapse behavior
  core/
    types.ts               Shared interfaces
    nesting.ts             Bin packing and template grouping
    scrapCuts.ts           Occupancy grid → scrap rectangles
    scoreLines.ts          Score mode dispatch + shared ray-marching helpers
    smartScoreLines.ts     Smart mode
    smartScoreLinesV2.ts   Smart v2 (distance field)
    dxfExport.ts           DXF generation
    pdfExport.ts           PDF generation
    exportUtils.ts         Colors, disc legend
  utils/
    geometry.ts            Collision and distance helpers
    parsing.ts             Fractional inch parser
```

## Deployment

[deploy.sh](deploy.sh) is a Plesk post-deployment hook. The repo is checked out to `/var/www/vhosts/fnmnl.com/repos/disc-array-tool`, and the script builds it and copies `dist/` into the site's document root, which it takes as an argument:

```
bash /var/www/vhosts/fnmnl.com/repos/disc-array-tool/deploy.sh \
     /var/www/vhosts/fnmnl.com/discs.fnmnl.com
```

It refuses to run if the docroot doesn't exist or sits inside the repo, so a wrong argument can't delete the checkout.

## Notes

[PRD.md](PRD.md) is the original spec and is now partly out of date — most notably, material thickness was dropped from the disc spec, so all discs on a run share one material. [changes.md](changes.md) is a working scratchpad of open issues, mainly around score line placement and inconsistent scrap margins.
