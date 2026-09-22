/**
 * Crop-and-zoom a region of a PNG so fine mark detail can actually be read.
 * Companion to the target-comparison loop: pixel-squinting full sheets
 * misreads mark angles; a 4x crop does not.
 *
 * Usage:
 *   node tools/crop-image.cjs <image.png> <fx> <fy> <fw> <fh> [scale] [out.png]
 *
 * <fx> <fy> <fw> <fh> are FRACTIONS of the image (0..1), so the same window
 * works on a render and a target regardless of their resolutions. For a
 * vertically-flipped target, pass fy' = 1 - fy - fh.
 * Default scale 4, default out .render-out/crop.png.
 */
const fs = require('fs');
const path = require('path');
const { decode, encode } = require('fast-png');

const [, , file, fxs, fys, fws, fhs, scales, outArg] = process.argv;
if (!file || fhs === undefined) {
  console.error('usage: node tools/crop-image.cjs <image.png> <fx> <fy> <fw> <fh> [scale] [out.png]');
  process.exit(1);
}

const img = decode(fs.readFileSync(file));
const { width, height, channels, depth } = img;
const data = img.data;

const fx = parseFloat(fxs), fy = parseFloat(fys), fw = parseFloat(fws), fh = parseFloat(fhs);
const scale = scales ? parseFloat(scales) : 4;
const out = outArg || path.join(__dirname, '..', '.render-out', 'crop.png');

const x0 = Math.max(0, Math.floor(fx * width));
const y0 = Math.max(0, Math.floor(fy * height));
const w = Math.min(width - x0, Math.ceil(fw * width));
const h = Math.min(height - y0, Math.ceil(fh * height));
if (w <= 0 || h <= 0) {
  console.error(`empty crop: image ${width}x${height}, window ${x0},${y0} ${w}x${h}`);
  process.exit(1);
}

const max = depth === 16 ? 65535 : 255;
function pixelAt(x, y) {
  const i = (y * width + x) * channels;
  const v = ch => Math.round((data[i + ch] / max) * 255);
  if (channels >= 3) return [v(0), v(1), v(2)];
  return [v(0), v(0), v(0)]; // grey / grey+alpha
}

const ow = Math.round(w * scale);
const oh = Math.round(h * scale);
const px = new Uint8Array(ow * oh * 3);
for (let y = 0; y < oh; y++) {
  for (let x = 0; x < ow; x++) {
    const [r, g, b] = pixelAt(x0 + Math.min(w - 1, Math.floor(x / scale)),
                              y0 + Math.min(h - 1, Math.floor(y / scale)));
    const o = (y * ow + x) * 3;
    px[o] = r; px[o + 1] = g; px[o + 2] = b;
  }
}

fs.writeFileSync(out, Buffer.from(encode({ width: ow, height: oh, data: px, channels: 3 })));
console.log(`${file} ${width}x${height} -> crop ${x0},${y0} ${w}x${h} @${scale}x -> ${out}`);
