# Target images

Drop your desired-outcome images here, one per sheet, named to match the
renderer's output:

```
targets/template-1.png
targets/template-2.png
...
```

`.jpg` works too. These are the hand-marked references — how the score lines
*should* come out for each template of the current job.

After `npm run render -- state.json`, open `.render-out/compare.html` to see
every template's actual output side by side with its target. Templates without
a target image just show the render.

Template numbering follows the renderer's output order, which is stable for a
given `state.json`. If the disc list or nesting settings change, re-check which
template is which before trusting old target images.
