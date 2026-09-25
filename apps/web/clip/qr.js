/*
 * Tiny QR Code encoder for the /clip page: byte mode, error-correction level M,
 * versions 1–10 (up to 213 bytes, plenty for a URL). No dependencies.
 *
 *   window.MozuQR.svg('https://…', { modulePx: 6 }) → an <svg> markup string
 *   window.MozuQR.matrix('https://…')               → { size, get(row, col) }
 *
 * Follows ISO/IEC 18004: Reed–Solomon over GF(256), the eight mask patterns with
 * the four penalty rules, and BCH-coded format / version information.
 */
(function (global) {
  'use strict';

  // ── GF(256) arithmetic (primitive polynomial 0x11d) ─────────────────────
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (var i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }

  // Level M block structure per version: [ecPerBlock, [blockDataLengths…]]
  var BLOCKS = {
    1: [10, [16]], 2: [16, [28]], 3: [26, [44]], 4: [18, [32, 32]], 5: [24, [43, 43]],
    6: [16, [27, 27, 27, 27]], 7: [18, [31, 31, 31, 31]], 8: [22, [38, 38, 39, 39]],
    9: [22, [36, 36, 36, 37, 37]], 10: [26, [43, 43, 43, 43, 44]],
  };
  var ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

  function utf8(text) {
    var out = [], s = unescape(encodeURIComponent(text));
    for (var k = 0; k < s.length; k++) out.push(s.charCodeAt(k));
    return out;
  }

  function chooseVersion(byteCount) {
    for (var v = 1; v <= 10; v++) {
      var dataCodewords = BLOCKS[v][1].reduce(function (a, b) { return a + b; }, 0);
      var bits = 4 + (v < 10 ? 8 : 16) + byteCount * 8;
      if (bits <= dataCodewords * 8) return v;
    }
    throw new Error('Text is too long for this QR encoder (max 213 bytes).');
  }

  // ── Data codewords: mode, length, bytes, terminator, padding ────────────
  function dataCodewords(bytes, version) {
    var bits = [];
    function push(value, count) { for (var b = count - 1; b >= 0; b--) bits.push((value >> b) & 1); }
    push(4, 4);                                  // byte mode
    push(bytes.length, version < 10 ? 8 : 16);   // character count
    bytes.forEach(function (byte) { push(byte, 8); });
    var capacity = BLOCKS[version][1].reduce(function (a, b) { return a + b; }, 0) * 8;
    push(0, Math.min(4, capacity - bits.length)); // terminator
    while (bits.length % 8) bits.push(0);
    var words = [];
    for (var k = 0; k < bits.length; k += 8) {
      var w = 0;
      for (var b = 0; b < 8; b++) w = (w << 1) | bits[k + b];
      words.push(w);
    }
    for (var pad = 0xEC; words.length < capacity / 8; pad ^= 0xEC ^ 0x11) words.push(pad);
    return words;
  }

  // ── Reed–Solomon error correction ───────────────────────────────────────
  function rsGenerator(degree) {
    var g = [1];
    for (var d = 0; d < degree; d++) {
      var next = new Array(g.length + 1).fill(0);
      for (var k = 0; k < g.length; k++) {
        next[k] ^= g[k];
        next[k + 1] ^= mul(g[k], EXP[d]);
      }
      g = next;
    }
    return g;
  }

  function rsRemainder(data, generator) {
    var rem = new Array(generator.length - 1).fill(0);
    data.forEach(function (byte) {
      var factor = byte ^ rem.shift();
      rem.push(0);
      for (var k = 0; k < generator.length - 1; k++) rem[k] ^= mul(generator[k + 1], factor);
    });
    return rem;
  }

  function interleave(words, version) {
    var ecLen = BLOCKS[version][0], lengths = BLOCKS[version][1], generator = rsGenerator(ecLen);
    var blocks = [], ecs = [], offset = 0;
    lengths.forEach(function (len) {
      var block = words.slice(offset, offset + len);
      offset += len;
      blocks.push(block);
      ecs.push(rsRemainder(block, generator));
    });
    var out = [], longest = Math.max.apply(null, lengths);
    for (var k = 0; k < longest; k++) blocks.forEach(function (b) { if (k < b.length) out.push(b[k]); });
    for (var e = 0; e < ecLen; e++) ecs.forEach(function (b) { out.push(b[e]); });
    return out;
  }

  // ── Matrix ──────────────────────────────────────────────────────────────
  function Matrix(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (var r = 0; r < this.size; r++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFunction.push(new Array(this.size).fill(false));
    }
  }
  Matrix.prototype.setFunction = function (r, c, dark) {
    if (r < 0 || c < 0 || r >= this.size || c >= this.size) return;
    this.modules[r][c] = dark;
    this.isFunction[r][c] = true;
  };
  Matrix.prototype.drawFunctionPatterns = function () {
    var n = this.size, r, c;
    for (var t = 0; t < n; t++) { this.setFunction(6, t, t % 2 === 0); this.setFunction(t, 6, t % 2 === 0); }
    [[3, 3], [3, n - 4], [n - 4, 3]].forEach(function (center) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFunction(center[0] + dy, center[1] + dx, dist !== 2 && dist !== 4);
      }
    }, this);
    var pos = ALIGN[this.version], last = pos.length - 1;
    for (var a = 0; a < pos.length; a++) for (var b = 0; b < pos.length; b++) {
      if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
      for (r = -2; r <= 2; r++) for (c = -2; c <= 2; c++) this.setFunction(pos[a] + r, pos[b] + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
    }
    this.drawFormat(0);        // reserve the format areas; rewritten once the mask is chosen
    this.drawVersion();
  };
  Matrix.prototype.drawFormat = function (mask) {
    var data = mask;           // level M is 00, so the 5 data bits are just the mask
    var rem = data;
    for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412, n = this.size;
    function bit(i) { return ((bits >>> i) & 1) === 1; }
    // First copy: down column 8 beside the top-left finder, then along row 8.
    for (var i = 0; i <= 5; i++) this.setFunction(i, 8, bit(i));
    this.setFunction(7, 8, bit(6)); this.setFunction(8, 8, bit(7)); this.setFunction(8, 7, bit(8));
    for (i = 9; i < 15; i++) this.setFunction(8, 14 - i, bit(i));
    // Second copy: along row 8 under the top-right finder, then down column 8 at the bottom.
    for (i = 0; i < 8; i++) this.setFunction(8, n - 1 - i, bit(i));
    for (i = 8; i < 15; i++) this.setFunction(n - 15 + i, 8, bit(i));
    this.setFunction(n - 8, 8, true);   // the always-dark module
  };
  Matrix.prototype.drawVersion = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var k = 0; k < 12; k++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (this.version << 12) | rem, n = this.size;
    for (var i = 0; i < 18; i++) {
      var dark = ((bits >>> i) & 1) === 1, a = Math.floor(i / 3), b = n - 11 + (i % 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  };
  Matrix.prototype.drawCodewords = function (words) {
    var n = this.size, i = 0, total = words.length * 8;
    for (var right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < n; vert++) for (var j = 0; j < 2; j++) {
        var c = right - j, upward = ((right + 1) & 2) === 0, r = upward ? n - 1 - vert : vert;
        if (!this.isFunction[r][c] && i < total) {
          this.modules[r][c] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  };
  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; },
  ];
  Matrix.prototype.applyMask = function (mask) {
    for (var r = 0; r < this.size; r++) for (var c = 0; c < this.size; c++) {
      if (!this.isFunction[r][c] && MASKS[mask](r, c)) this.modules[r][c] = !this.modules[r][c];
    }
  };
  Matrix.prototype.penalty = function () {
    var n = this.size, m = this.modules, score = 0, dark = 0, r, c;
    function runs(get) {
      for (var a = 0; a < n; a++) {
        var run = 0, history = [0, 0, 0, 0, 0, 0, 0], color = false;
        for (var b = 0; b <= n; b++) {
          var same = b < n && get(a, b) === color;
          if (same) { run++; continue; }
          if (run >= 5) score += run - 2;                        // rule 1: 3 + (run − 5)
          history.shift(); history.push(run);
          if (!color && finderLike(history)) score += 40;       // rule 3
          color = !color; run = 1;
        }
        history.shift(); history.push(run);
        if (color && finderLike(history)) score += 40;
      }
    }
    function finderLike(h) {
      var core = h[2] > 0 && h[3] === h[2] * 3 && h[4] === h[2] && h[5] === h[2] && h[1] === h[2];
      return core && (h[0] >= h[2] * 4 || h[6] >= h[2] * 4);
    }
    runs(function (a, b) { return m[a][b]; });
    runs(function (a, b) { return m[b][a]; });
    for (r = 0; r < n - 1; r++) for (c = 0; c < n - 1; c++) {
      var v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;   // rule 2
    }
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (m[r][c]) dark++;
    var k = Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1;                  // rule 4
    return score + k * 10;
  };

  function matrix(text) {
    var bytes = utf8(String(text)), version = chooseVersion(bytes.length);
    var m = new Matrix(version);
    m.drawFunctionPatterns();
    m.drawCodewords(interleave(dataCodewords(bytes, version), version));
    var best = 0, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      m.applyMask(mask);
      m.drawFormat(mask);
      var s = m.penalty();
      if (s < bestScore) { bestScore = s; best = mask; }
      m.applyMask(mask);
    }
    m.applyMask(best);
    m.drawFormat(best);
    return { size: m.size, version: version, mask: best, get: function (r, c) { return m.modules[r][c]; } };
  }

  function svg(text, options) {
    var o = options || {}, q = o.quietZone == null ? 4 : o.quietZone, px = o.modulePx || 6;
    var m = matrix(text), n = m.size + q * 2, path = '';
    for (var r = 0; r < m.size; r++) for (var c = 0; c < m.size; c++) {
      if (m.get(r, c)) path += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" width="' + n * px + '" height="' + n * px + '" shape-rendering="crispEdges" role="img" aria-label="' + (o.label || 'QR code') + '">' +
      '<rect width="' + n + '" height="' + n + '" fill="' + (o.light || '#fff') + '"/>' +
      '<path d="' + path + '" fill="' + (o.dark || '#000') + '"/></svg>';
  }

  global.MozuQR = { matrix: matrix, svg: svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = { MozuQR: global.MozuQR }; // for the tests
})(typeof window !== 'undefined' ? window : globalThis);
