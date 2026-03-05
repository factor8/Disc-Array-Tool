# Disc Array Tool — Product Requirements Document

## Overview
A local web tool for generating laser-cut DXF files for disc products. Users enter disc specifications, the tool nests them onto material sheets, previews the layout, and exports DXF files ready for the laser cutter.

**Not deployed** — runs locally via `npm run dev`.

## Tech Stack
- Node.js + TypeScript
- Vite (dev server + build)
- Vanilla TypeScript (no UI framework)
- `dxf-writer` for DXF generation
- HTML5 Canvas for preview rendering

---

## Data Model

### Disc Specification
| Field | Type | Notes |
|-------|------|-------|
| Count | integer | How many of this disc to cut |
| Diameter | fractional inches | e.g. `31 31/32"` — must support fractional input |
| Center Hole | fractional inches or none | e.g. `0.5"` or no hole |
| Thickness | `.118"` or `.177"` | Material thickness — determines which sheet group |

### Sheet Configuration
| Field | Default | Notes |
|-------|---------|-------|
| Width | 48" | Material sheet width |
| Height | 96" | Material sheet height |
| Spacing / Kerf | 0.1" | Gap between discs and sheet edges — **configurable in UI** |

### Key Constraint
**Discs of different thicknesses go on separate sheets** — they represent different physical materials.

---

## Features

### Phase 1: Input Form
- Table-based entry for disc specifications
- Add/remove row buttons
- Fractional inch parsing (e.g. `31 31/32` → `31.96875`)
- Sheet size inputs with defaults (48 × 96")
- Configurable spacing/kerf input
- "Generate" button to trigger nesting

### Phase 2: Nesting Algorithm
Two optimization modes controlled by the user:

**Mode A — Minimize Total Sheets**
- Greedy bin-packing: largest discs first
- Bottom-left placement heuristic with collision detection
- Pack as tightly as possible, each sheet may be unique

**Mode B — Minimize Unique Sheet Layouts**
- Build repeatable "template" sheets
- Prefer N copies of the same layout over N distinct layouts, even if it uses slightly more material
- Example: 6 identical sheets is better than 5 sheets that are all different

**Controls:**
- Toggle or slider between Mode A ↔ Mode B
- The algorithm groups discs by thickness first, then nests within each group

### Phase 3: Preview
- HTML5 Canvas 2D rendering
- Each sheet drawn as a rectangle with discs as circles (center holes shown)
- Color-code sheets by template (identical layouts share a color)
- Sheet labels: "Sheet 1 of N" with template identifier
- Pan/zoom (stretch goal)

### Phase 4: DXF Export
- Circles for disc outlines, smaller circles for center holes
- **Two export options** (user chooses):
  1. One `.dxf` file per sheet
  2. One combined `.dxf` with each sheet on a separate layer
- Download button triggers browser file save

### Phase 5: Edge Cuts & Scrap Processing (Future)
- Add rectangles to large unused areas of each sheet
- Add score/cut lines around disc edges so scrap material is breakable
- **Requires reference image from user before implementation**

---

## Project Structure
```
src/
  main.ts                — App entry point, wires up UI
  ui/
    InputForm.ts         — Disc list form + sheet config
    Preview.ts           — Canvas-based 2D preview
    Controls.ts          — Nesting mode controls + export options
  core/
    types.ts             — Disc, Sheet, NestingResult interfaces
    nesting.ts           — Circle packing / bin-pack algorithm
    sheetOptimizer.ts    — Template-based sheet grouping logic
    dxfExport.ts         — DXF file generation
  utils/
    geometry.ts          — Circle/rect collision, distance helpers
    parsing.ts           — Fractional inch string parser
index.html               — Single page shell
style.css                — Styling
```

---

## Nesting Algorithm Detail

### Circle Packing Heuristic
1. Separate discs by thickness into groups
2. Within each group, sort discs largest-first
3. For each unplaced disc:
   - Scan candidate positions on a grid (step size ~radius/4)
   - Check: no overlap with placed discs (center distance > sum of radii + kerf)
   - Check: fully within sheet bounds (edge + radius + kerf from border)
   - Place at first valid bottom-left position
   - Settle: try shifting down and left to pack tighter

### Template Optimization (Mode B)
1. Find the best single-sheet layout L that, when repeated k times, covers the most discs
2. Score by: `total_sheets_needed / unique_layouts` — higher is better
3. Handle remainder discs with additional template(s)
4. Greedy search: fix the most common disc sizes into the template first

---

## Verification Checklist
1. `npm run dev` — app loads in browser
2. Enter sample data: 10 × 31 31/32" discs, 0.5" center hole, .118" thick
3. Click Generate — preview shows nested layout
4. Toggle optimization mode — layout visibly changes
5. Export DXF (both formats) — files download and open in a DXF viewer
6. Mix thicknesses — confirm they land on separate sheets
7. Adjust kerf — confirm spacing changes in preview
