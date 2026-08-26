/**
 * Minimal dependency-free PNG writer, enough to dump a sheet preview to disk
 * from a plain Node script. Only used by the dev renderer.
 */
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

class Canvas {
  constructor(width, height, background) {
    this.w = Math.round(width);
    this.h = Math.round(height);
    this.px = Buffer.alloc(this.w * this.h * 3);
    for (let i = 0; i < this.w * this.h; i++) {
      this.px[i * 3] = background[0];
      this.px[i * 3 + 1] = background[1];
      this.px[i * 3 + 2] = background[2];
    }
  }

  set(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = color[0];
    this.px[i + 1] = color[1];
    this.px[i + 2] = color[2];
  }

  disc(cx, cy, r, fill, stroke) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r - 1) this.set(x, y, fill);
        else if (d <= r + 0.5) this.set(x, y, stroke);
      }
    }
  }

  line(x1, y1, x2, y2, color, halfWidth = 0) {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 3) + 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      for (let oy = -halfWidth; oy <= halfWidth; oy++) {
        for (let ox = -halfWidth; ox <= halfWidth; ox++) this.set(x + ox, y + oy, color);
      }
    }
  }

  rect(x1, y1, x2, y2, color) {
    this.line(x1, y1, x2, y1, color);
    this.line(x2, y1, x2, y2, color);
    this.line(x2, y2, x1, y2, color);
    this.line(x1, y2, x1, y1, color);
  }

  toPNG() {
    const stride = this.w * 3 + 1;
    const raw = Buffer.alloc(this.h * stride);
    for (let y = 0; y < this.h; y++) {
      raw[y * stride] = 0; // filter: none
      this.px.copy(raw, y * stride + 1, y * this.w * 3, (y + 1) * this.w * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 2;  // colour type: truecolour
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

module.exports = { Canvas };
