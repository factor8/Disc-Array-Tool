# Disc Array Tool

Vite + TypeScript app that nests circular discs on sheets for laser cutting,
generates scrap ("disassembly") cuts and score lines, and exports DXF/PDF.
Core logic in `src/core/`, UI in `src/ui/`, dev tooling in `tools/`.

## The target-comparison system

Score-line generation (`src/core/webScoreLines.ts`, mode "Negative Space") is
tuned against **hand-marked reference sheets** made by the user while actually
cutting jobs. This loop is the source of truth for what the generator should
produce — prose descriptions of mark placement have repeatedly failed; the
drawings have not. Do not redesign mark placement from first principles;
compare against targets.

### The loop

1. **Get real state.** `state.json` (repo root, gitignored) is a dump of the
   app's localStorage. The user captures it in the browser console with:
   `copy(JSON.stringify(Object.fromEntries(Object.entries(localStorage)), null, 2))`
   Before comparing, confirm it matches the user's current panel settings —
   stale scrap/score settings silently invalidate every comparison.
2. **Render.** `npm run render -- state.json` runs the real pipeline
   (nest → scrap → score) headless and writes per-template PNGs plus
   `compare.html` to `.render-out/` (gitignored). ALWAYS go through the npm
   script: it compiles TypeScript to `.render-build/` first. Running
   `node tools/render-sheet.cjs` directly uses a stale build.
3. **Targets.** The user drops marked-up reference images in
   `targets/template-N.png` (see `targets/README.md`). Targets are drawn on
   the DXF/PDF export view, which is **vertically flipped** relative to the
   renderer (DXF is y-up, layout space is y-down). `compare.html` flips the
   tool output by default; when reading pairs with the Read tool, flip
   mentally, and verify per sheet via scrap-rect positions — the user has
   uploaded unflipped images before.
4. **Compare.** Read each render/target pair. Judge: vocabulary (right kind of
   mark at each feature), placement, length, and count. Then verify
   suspicions numerically:
   `node tools/inspect-template.cjs state.json 5 [x1 y1 x2 y2]`
   prints every disc/rect/score line with coordinates, length, and angle.
   Pixel-squinting misleads; the inspector settles what a mark actually is.
5. **Fix by rule, not by patch.** Every target discrepancy so far has traced
   to a general rule (see the header comment in `webScoreLines.ts` for the
   current model). Derive the rule, implement it, re-render ALL templates —
   fixes for one sheet regress others constantly (rings vs diamonds, lobes vs
   channels). Template 5 is the canonical clean sheet; 8 is the dense
   mixed-size stress test.

### Hard-won rules already encoded (do not re-litigate without new targets)

- Feature marks are short crack starters of roughly constant length (~1–1.5",
  the Max Mark Length setting), never proportional to pocket size — but X
  strokes are exempt: they span the diamond at mark fraction of the crossing,
  uncapped (zoomed t8 target: ~4.7" strokes in 8–9" diamonds).
- The end margin scales down on short crossings (min(endMargin, L/4)): at full
  strength the 0.7" margin erased every tick on throats narrower than ~1.6",
  which the targets all mark.
- Throat ticks lie flat, straight across the neck — disc↔disc and disc↔edge
  alike. (An earlier 45° edge-tick rule came from unzoomed reads; 3–6× crops
  of three sheets all show flat ticks.)
- One break per corridor: parallel same-corridor marks dedupe at 2.75".
- X every empty compact diamond; never X rings around filler discs or long
  crescent channels. Pocket character is judged on a geometry-only region map
  with throat-width gaps sealed (rect adjacency must be tested against
  clearance-grown rects, not raw cell contact). A stretched diamond (long
  chord > 2× the enclosed-span limit) doubles its short stroke: long diagonal
  plus two parallel shorts.
- Nothing against scrap rects (they fall out) or disc/sheet-edge tangencies
  (slivers snap off). Rect-facing pockets get NO pinch marks or dashes at all
  — zoomed t7/t8 targets show every rect boundary bare (this overturned an
  earlier "channel dashes at rect voids" rule).
- Apex pairs: a disc's closest approach to a sheet edge with gap in
  (Max Neck, 1.5×Max Neck], or to a rect face with gap in (hand-break,
  1.5×Max Neck], gets two 45° slants straddling the apex, leaning toward it,
  placed where the strip has deepened by ~1.75".
- Chevrons: vertex at the sheet edge, arms anchored at the vertex; corner
  marks run along the corner bisector.
- Grid cuts only where both region dimensions exceed Max Piece Span.
- UNRESOLVED: t5's target adds 45° flare slants mid-pocket along edge strips
  (between each edge-throat tick and the neighbouring chevrons, ~every 6");
  t6's target has identical strip geometry and none. Flares are currently not
  emitted — get a ruling from the user before adding them.

### Maintenance

- `tools/render-sheet.cjs` mirrors `defaultScoreConfig` from `src/main.ts` in
  its DEFAULTS block — keep them in sync when adding settings.
- Template numbering follows nesting output order: stable for a given
  `state.json`, invalid the moment the disc list or nesting settings change.
  Old target images then no longer correspond to their numbers.
- Sheets sharing a `templateId` are identical; score/scrap generation is
  memoized per template in `src/main.ts`.

## Build

- `npm run dev` / `npm run build` (tsc + vite). No test suite; the render
  loop above is the regression harness — compare counts and renders before
  and after any scoring change.
