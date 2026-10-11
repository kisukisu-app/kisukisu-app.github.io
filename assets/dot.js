/* Dot: the KisuKisu bubble's mark, and its moments. Ported from the Dot motion lab (the owner's final picks):
   the everyday entrances, the droplet exit, the settled endings, and the pieces the bubble's take uses.
   Mark space: the dot is r150 at (0,0); the overlay window is ±240. Poses use the lab's format:
     body { tx, ty, rot (about the base), sx, sy, anchor 'b', s (uniform, pivot px/py), a, r / rx / ry / cx, fill 'u',
            stretch { ang, amt }, clip { cx, cy, r } }   mark { tx, ty, s, a }
     l / r { x, y, sx, sy, s, rot, a, abs, pts, pivot }   bar { x, y, tilt, len, w, a, amp, cyc, ph, check, bars }
     fold (P4 outlines)  rings [[scale, a]]  sp [[x, y, s, a, rot, col]]  glow { r, a }  bead { cx, r, neck }
     wet { cx, cy, r, a }  bud { bx, r, sx, sy, ga }
   Rules kept from the playground: the leaves stay upright inside the dot and only lean once they are out past
   its edge (then they cast a soft grey shadow), and the bar never disappears while the leaves show (two leaves
   alone would read as eyes). Everything is a transform / path / opacity on a fixed set of SVG nodes, driven by one
   shared requestAnimationFrame loop that only runs while something is playing. */
(() => {
  'use strict';
  const LX = 60.12, LH = 110.94, LW = 61.15, BW = 24.51, BH = 72.11;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (x, a, b) => clamp((x - a) / (b - a));
  const lerp = (a, b, x) => a + (b - a) * x;
  const n2 = v => { v = +v; return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0'; };
  const eOut = x => 1 - Math.pow(1 - clamp(x), 3);
  const eIn = x => Math.pow(clamp(x), 3);
  const eInOut = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const bump = (t, a, b) => Math.sin(Math.PI * seg(t, a, b));
  const sstep = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
  const hann = (t, a, b) => { const u = seg(t, a, b); return u <= 0 || u >= 1 ? 0 : Math.pow(Math.sin(Math.PI * u), 2); };
  const back = (x, c = 1.6) => { x = clamp(x); const c3 = c + 1; return 1 + c3 * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = u => ((ax * u + bx) * u + cx) * u, Y = u => ((ay * u + by) * u + cy) * u, dX = u => (3 * ax * u + 2 * bx) * u + cx;
    return x => { x = clamp(x); let u = x; for (let i = 0; i < 6; i++) { const e = X(u) - x, d = dX(u); if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break; u -= e / d; } return Y(clamp(u)); };
  }
  const ACCEL = cubicBezier(.3, 0, .8, .15);       // Material emphasized accelerate (exits)
  const EMPH = cubicBezier(.05, .7, .1, 1);        // Material emphasized decelerate (the keyboard's slide)
  // a damped spring from x0 to x1 (stiffness k, damping ratio z, start speed v0): exact for any damping
  function spring(t, x0, x1, v0 = 0, z = .75, k = 400) {
    if (t <= 0) return x0;
    const w = Math.sqrt(k), d0 = x0 - x1;
    if (z < .9999) { const wd = w * Math.sqrt(1 - z * z), B = (v0 + z * w * d0) / wd; return x1 + Math.exp(-z * w * t) * (d0 * Math.cos(wd * t) + B * Math.sin(wd * t)); }
    if (z <= 1.0001) return x1 + Math.exp(-w * t) * (d0 + (v0 + w * d0) * t);
    const s = Math.sqrt(z * z - 1), r1 = -w * (z - s), r2 = -w * (z + s), c2 = (v0 - r1 * d0) / (r2 - r1), c1 = d0 - c2;
    return x1 + c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
  }
  const springV = (t, x0, x1, v0, z, k) => (spring(t + 1e-3, x0, x1, v0, z, k) - spring(Math.max(0, t - 1e-3), x0, x1, v0, z, k)) / (t > 1e-3 ? 2e-3 : 1e-3);
  const stepS = (t, k = 300, z = .8) => t <= 0 ? 0 : spring(t, 0, 1, 0, z, k);
  const beatP = (t, t0, len = .26) => { const x = (t - t0) / len; if (x <= 0 || x >= 1) return 0; return x < .3 ? Math.pow(Math.sin(Math.PI / 2 * x / .3), 2) : .5 + .5 * Math.cos(Math.PI * (x - .3) / .7); };
  const clapHit = (t, tc) => { if (t < tc - .11 || t > tc + .17) return 0; if (t <= tc) { const x = (t - (tc - .11)) / .11; return x * x; } return 1 - sstep((t - tc) / .17); };
  const LEAF = (() => { const c = LH / 2, s = LW / 2, r = (c * c + s * s) / (2 * s); return `M0,${n2(-c)} A${n2(r)},${n2(r)} 0 0,0 0,${n2(c)} A${n2(r)},${n2(r)} 0 0,0 0,${n2(-c)}Z`; })();
  const SPARK_D = 'M0,-1 C.12,-.12 .12,-.12 1,0 C.12,.12 .12,.12 0,1 C-.12,.12 -.12,.12 -1,0 C-.12,-.12 -.12,-.12 0,-1Z';
  const COPY_ICON = 'M9,9 h9 a1.5,1.5 0 0 1 1.5,1.5 v9 a1.5,1.5 0 0 1 -1.5,1.5 h-9 a1.5,1.5 0 0 1 -1.5,-1.5 v-9 a1.5,1.5 0 0 1 1.5,-1.5 z M15,6 v-0.5 a1.5,1.5 0 0 0 -1.5,-1.5 h-8 a1.5,1.5 0 0 0 -1.5,1.5 v8 a1.5,1.5 0 0 0 1.5,1.5 h0.5';
  const UD = 150 / 22, EDGE_U = 220, RB = 150 * 18 / 22, FAR = 150 + 8 * UD + RB;   // units per dp, the screen edge, the copy bud
  // the bar as a travelling sine (the tidy-up wiggle), pinned at both ends
  function wavePath(amp, cyc, ph, len) {
    let d = '';
    for (let i = 0; i <= 28; i++) { const u = i / 28, y = -len + u * 2 * len, x = amp * Math.sin(ph + u * cyc * Math.PI * 2) * Math.pow(Math.max(0, Math.sin(Math.PI * u)), .35); d += (i ? 'L' : 'M') + n2(x) + ',' + n2(y); }
    return d;
  }
  // a rounded rect (the lab draws bars as rects with rx = min(w/2, half)), as path data
  function rrD(x, y, half, bw) {
    const r = Math.min(bw / 2, half), x0 = x - bw / 2, y0 = y - half, w = bw, h = 2 * half;
    return `M${n2(x0 + r)},${n2(y0)}H${n2(x0 + w - r)}A${n2(r)},${n2(r)} 0 0 1 ${n2(x0 + w)},${n2(y0 + r)}V${n2(y0 + h - r)}A${n2(r)},${n2(r)} 0 0 1 ${n2(x0 + w - r)},${n2(y0 + h)}H${n2(x0 + r)}A${n2(r)},${n2(r)} 0 0 1 ${n2(x0)},${n2(y0 + h - r)}V${n2(y0 + r)}A${n2(r)},${n2(r)} 0 0 1 ${n2(x0 + r)},${n2(y0)}Z`;
  }

  // ---------- outlines for the P4 leaf fold (pieces as matched point lists, so they morph) ----------
  const NP = 144;
  function resampleClosed(P, n = NP) {
    const L = [0];
    for (let i = 1; i <= P.length; i++) { const a = P[i - 1], b = P[i % P.length]; L.push(L[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const tot = L[P.length], out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const d = tot * k / n;
      while (L[j + 1] < d) j++;
      const a = P[j], b = P[(j + 1) % P.length], u = (d - L[j]) / ((L[j + 1] - L[j]) || 1);
      out.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u)]);
    }
    return out;
  }
  function lensShape(h, w) {
    const c = h / 2, s = w / 2, r = (c * c + s * s) / (2 * s), P = [], q = 200;
    for (let i = 0; i < q; i++) { const y = -c + 2 * c * i / q; P.push([Math.sqrt(Math.max(0, r * r - y * y)) - (r - s), y]); }
    for (let i = 0; i < q; i++) { const y = c - 2 * c * i / q; P.push([-(Math.sqrt(Math.max(0, r * r - y * y)) - (r - s)), y]); }
    return resampleClosed(P);
  }
  function pillShape(w, h) {
    const a = w / 2, L = Math.max(0, h / 2 - a), P = [], q = 60;
    for (let i = 0; i < q; i++) { const th = -Math.PI / 2 + Math.PI / 2 * i / q; P.push([a * Math.cos(th), -L + a * Math.sin(th)]); }
    for (let i = 0; i < q; i++) P.push([a, -L + 2 * L * i / q]);
    for (let i = 0; i < 2 * q; i++) { const th = Math.PI * i / (2 * q); P.push([a * Math.cos(th), L + a * Math.sin(th)]); }
    for (let i = 0; i < q; i++) P.push([-a, L - 2 * L * i / q]);
    for (let i = 0; i < q; i++) { const th = Math.PI + Math.PI / 2 * i / q; P.push([a * Math.cos(th), -L + a * Math.sin(th)]); }
    return resampleClosed(P);
  }
  const mixP = (A, B, u) => u <= 0 ? A : u >= 1 ? B : A.map((p, i) => [p[0] + (B[i][0] - p[0]) * u, p[1] + (B[i][1] - p[1]) * u]);
  const flipIdx = A => A.map((_, i) => A[(NP - i) % NP]);
  const dP = A => 'M' + A.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';
  let SH = null;   // built on first use
  const shapes = () => SH || (SH = { leaf: lensShape(LH, LW), bar: pillShape(BW, 2 * BH + BW), alm: lensShape(178, 86) });
  // P4 "Leaf fold": closes by 0.4 s, holds to 0.5 s, opens by 0.94 s
  const FOLD_SECONDS = 1.05, FOLD_CLOSED = .45, FOLD_OPEN_FROM = .5;
  const foldK = t => t < .5 ? sstep(seg(t, .04, .4)) : 1 - sstep(seg(t, .5, .94)) - .09 * hann(seg(t, .5, .94), .55, 1);
  function foldShapes(t, kOverride) {
    const k = kOverride ?? foldK(t);
    if (k === 0) return null;
    const S = shapes(), kc = clamp(k), uf = seg(kc, 0, .75), f = Math.cos(.75 * Math.PI * uf), m = sstep(seg(kc, .72, 1));
    const lf = side => {
      const xh = side * (lerp(LX - LW / 2, 6, uf) - 40 * Math.min(0, k));
      const P = S.leaf.map(p => [xh + (side * (LW / 2) + p[0]) * f, p[1] * (1 + .12 * uf)]);
      return m > 0 ? mixP(flipIdx(P), S.alm, m) : P;
    };
    return { l: lf(-1), r: lf(1), b: mixP(S.bar, S.alm, sstep(seg(kc, .35, 1))), merged: kc > .999 };
  }
  // the metaball neck between a circle (r1 at x1) and one of radius r2 at x2 (DotChoreo.neck): path data, or ''
  function neckD(x1, r1, x2, r2, maxGap = 26) {
    const x = x2 - x1, d = Math.abs(x), gap = d - r1 - r2;
    if (r1 <= 0 || r2 <= 0 || gap > maxGap || d <= Math.abs(r1 - r2)) return '';
    const v = .5 * clamp(1 - Math.max(0, gap) / maxGap); if (v <= .01) return '';
    const pi = Math.PI;
    const u1 = d < r1 + r2 ? Math.acos(clamp((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d), -1, 1)) : 0;
    const u2 = d < r1 + r2 ? Math.acos(clamp((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d), -1, 1)) : 0;
    const abc = x >= 0 ? 0 : pi, spread = Math.acos(clamp((r1 - r2) / d, -1, 1));
    const a1 = abc + u1 + (spread - u1) * v, a2 = abc - u1 - (spread - u1) * v, a3 = abc + pi - u2 - (pi - u2 - spread) * v, a4 = abc - pi + u2 + (pi - u2 - spread) * v;
    const at = (cx, r, a) => [cx + r * Math.cos(a), r * Math.sin(a)];
    const p1 = at(x1, r1, a1), p2 = at(x1, r1, a2), p3 = at(x2, r2, a3), p4 = at(x2, r2, a4);
    const h = Math.min(v * 2.4, Math.hypot(p1[0] - p3[0], p1[1] - p3[1]) / (r1 + r2)) * Math.min(1, d * 2 / (r1 + r2)), hp = pi / 2;
    const h1 = [p1[0] + r1 * h * Math.cos(a1 - hp), p1[1] + r1 * h * Math.sin(a1 - hp)], h2 = [p2[0] + r1 * h * Math.cos(a2 + hp), p2[1] + r1 * h * Math.sin(a2 + hp)];
    const h3 = [p3[0] + r2 * h * Math.cos(a3 + hp), p3[1] + r2 * h * Math.sin(a3 + hp)], h4 = [p4[0] + r2 * h * Math.cos(a4 - hp), p4[1] + r2 * h * Math.sin(a4 - hp)];
    const P = q => n2(q[0]) + ',' + n2(q[1]);
    return `M${P(p1)} C${P(h1)} ${P(h3)} ${P(p3)} L${P(p4)} C${P(h4)} ${P(h2)} ${P(p2)}Z`;
  }

  // ---------- the moments as shipped (DotChoreo), then their settled endings ----------
  const mirL = o => Object.assign({}, o, { x: -(o.x || 0), rot: -(o.rot || 0) });
  const outW = (t, bk, k1 = 260, z1 = .82, k2 = 300) => stepS(t, k1, z1) - stepS(t - bk, k2, .9);
  // W4 "Whole-dot wave", side-aware: written for the left edge (d = +1), mirrored for the right
  function rockPose(t, d) {
    const out = outW(t - .02, .8, 240, .82, 280), s = lerp(1, .86, out), env = hann(t, .1, .92), ps = Math.sin(2 * Math.PI * 1.75 * (t - .14));
    const lean = 3.5 * sstep(seg(t, .06, .3)) * (1 - sstep(seg(t, .78, 1.08)));
    const r = { abs: true, x: lerp(LX, 158, out), y: -16 * out, s, rot: 8 * out + 16 * ps * env }, l = { abs: true, x: -LX + 5 * out };
    if (d > 0) return { body: { rot: lean + 5 * ps * env }, l, r, bar: { x: 4 * out, tilt: 3 * out } };
    return { body: { rot: -(lean + 5 * ps * env) }, l: Object.assign({}, r, { x: -r.x, rot: -r.rot }), r: Object.assign({}, l, { x: -l.x }), bar: { x: -4 * out, tilt: -3 * out } };
  }
  const SHIP = {
    bounce: t => {
      const u = seg(t, .12, .5), air = t > .12 && t < .5 ? 4 * u * (1 - u) : 0, crouch = hann(t, 0, .16), land = hann(t, .48, .7), reb = hann(t, .68, .86);
      const sy = 1 - .2 * land + .05 * reb, sx = 1 + .12 * land - .03 * reb, lf = { x: -4 * land, y: LH / 2 * (1 - sy), sx, sy };
      return { l: lf, r: mirL(lf), bar: { y: -90 * air + 10 * crouch + 8 * land, len: 1 - .14 * crouch + .12 * hann(t, .1, .24) + .1 * hann(t, .38, .5) - .2 * land, w: 1 + .1 * crouch + .14 * land }, body: { anchor: 'b', sx: 1 + .03 * land, sy: 1 - .04 * land } };
    },
    clap: t => {
      const wind = hann(t, 0, .16), h = Math.max(clapHit(t, .24), clapHit(t, .48)), imp = hann(t, .22, .31) + hann(t, .46, .55);
      const lf = { x: -7 * wind + 17.5 * h, sx: 1 - .1 * imp, sy: 1 + .04 * imp }, sp = [];
      for (const tc of [.24, .48]) { const u = seg(t, tc, tc + .3); if (u > 0 && u < 1) for (const sd of [-1, 1]) sp.push([sd * (16 + 40 * u), -98 - 52 * u, 26 * (1 - .45 * u), Math.sin(Math.PI * Math.min(1, .15 + u * 1.1)), 40 * u * sd, '#fff']); }
      return { l: lf, r: mirL(lf), bar: { w: 1 + .16 * imp, len: 1 - .04 * imp }, body: { sx: 1 + .02 * imp, sy: 1 + .02 * imp }, sp };
    },
    shimmySp: t => { const tw = (t0, x, y, s) => [x, y, s, hann(t, t0, t0 + .4), 30 * seg(t, t0, t0 + .4)]; return [tw(.12, -176, -150, 26), tw(.34, 178, -128, 20), tw(.52, -168, 150, 17), tw(.62, 182, 142, 22)]; },
    nPing: t => {
      const b = beatP(t, .04, .3) + .7 * beatP(t, .4, .3), k = 1 + .08 * b;
      const rings = [[.06, .5], [.42, .34]].map(([t0, a]) => { const u = seg(t, t0, t0 + .7); return u > 0 && u < 1 ? [1 + .5 * eOut(u), a * Math.pow(1 - u, 1.6)] : [1, 0]; });
      return { l: { x: -LX * (k - 1), sx: k, sy: k }, r: { x: LX * (k - 1), sx: k, sy: k }, bar: { len: k, w: k }, body: { sx: 1 + .02 * b, sy: 1 + .02 * b }, rings };
    },
    nPeek: (t, d) => {
      const e = -d, pos = t < .56 ? sstep(seg(t, .04, .34)) : 1 - stepS(t - .56, 380, .5), press = hann(t, .26, .62), sq = hann(t, .6, .86);
      return { body: { tx: e * 60 * pos, sx: 1 - .07 * press + .06 * sq, sy: 1 + .03 * press - .06 * sq }, l: { x: d * 6 * pos }, r: { x: d * 6 * pos }, bar: { tilt: e * 5 * pos } };
    },
    nFlutter: t => { const env = hann(t, .06, .38) + hann(t, .46, .78), w = Math.sin(2 * Math.PI * 15 * t) * env, a = Math.abs(w); const lf = side => ({ x: side * 7 * w, y: -4 * a, sx: 1 - .08 * a, sy: 1 + .08 * a }); return { l: lf(-1), r: lf(1), bar: { w: 1 + .04 * env } }; },
    nYawn: t => {
      const s = t < 1.0 ? sstep(seg(t, .05, .8)) : 1 - stepS(t - 1.0, 260, .55), wob = 2.5 * Math.sin(2 * Math.PI * 1.6 * (t - .5)) * hann(t, .45, 1.0);
      return { l: { x: -8 * s, y: 7 * s, sy: 1 - .1 * s }, r: { x: 8 * s, y: 7 * s, sy: 1 - .1 * s }, bar: { len: 1 + .42 * s, w: 1 - .12 * s, tilt: wob }, body: { anchor: 'b', sx: 1 + .05 * s, sy: 1 - .06 * s } };
    },
  };
  // settleTail(): from tCut on, every number of the pose springs home from where it is AND how fast it is moving.
  // The body uses one spring (k 300, ζ 0.68, ~5 % overshoot); the pieces a softer one, so they land 40-80 ms later.
  const SETTLE_SKIP = new Set(['cyc', 'ph', 'abs', 'pivot', 'anchor', 'fill', 'clip', 'bars', 'pts', 'px', 'py']);
  const restOf = (part, key, abs) => ['s', 'sx', 'sy', 'len', 'w', 'a'].includes(key) ? 1 : key === 'x' && abs ? (part === 'l' ? -LX : LX) : 0;
  function settleTail(fn, tCut, o = {}) {
    const k = o.k ?? 300, z = o.z ?? .68, kP = o.kP ?? 210, zP = o.zP ?? .62;
    return (t, d) => {
      if (t <= tCut) return fn(t, d);
      const p0 = fn(tCut, d) || {}, pm = fn(tCut - .012, d) || {}, tau = t - tCut, base = fn(t, d) || {}, out = {};
      for (const part of ['body', 'l', 'r', 'bar', 'mark']) {
        const a = p0[part]; if (!a) continue;
        const b = pm[part] || {}, q = {}, piece = part !== 'body';
        for (const key in a) {
          const v = a[key];
          if (typeof v !== 'number' || SETTLE_SKIP.has(key)) { q[key] = v; continue; }
          q[key] = spring(tau, v, restOf(part, key, a.abs), (v - (b[key] ?? v)) / .012, piece ? zP : z, piece ? kP : k);
        }
        out[part] = q;
      }
      for (const key of ['rings', 'sp']) if (base[key]) out[key] = base[key];
      return out;
    };
  }
  const END = {
    // the sway decays as e^−3.4t and the last sway lands on centre
    shimmy: t => {
      const w = 2 * Math.PI * 2.3, e = sstep(seg(t, 0, .14)) * Math.exp(-3.4 * Math.max(0, t - .55));
      const sw = dl => Math.sin(w * (t - dl)) * e, bob = dl => (1 - Math.cos(2 * w * (t - dl))) / 2 * e;
      return { l: { x: 12 * sw(0), y: -6 * bob(0) }, bar: { x: 10 * sw(.06), y: -5 * bob(.06), tilt: 9 * sw(.06) }, r: { x: 12 * sw(.12), y: -6 * bob(.12) }, body: { tx: 4 * sw(.03) }, sp: SHIP.shimmySp(Math.min(t, .9)) };
    },
    // N1: the three voice bars merge one by one (outer first, 50 ms apart); the bar lands 5 % long, then settles
    say: t => {
      const k0 = sstep(seg(t, .02, .24)), env = hann(t, .14, 1.12);
      const kOut = i => { const dl = i === 1 ? .1 : i === 0 ? 0 : .05; return 1 - sstep(seg(t, .92 + dl, 1.12 + dl)); };
      const bars = [-21, 0, 21].map((x, i) => { const k = k0 * kOut(i), lev = .5 + .5 * Math.sin(2 * Math.PI * 2.4 * (t - .18) + i * 2.3 + (i === 1 ? 1.1 : 0)); return [x * k, BH * (lerp(1, .42, k) + .46 * k * env * lev), lerp(1, .56, k)]; });
      const done = t > 1.24, len = done ? spring(t - 1.24, 1.05, 1, 0, .6, 300) : 1, lk = k0 * (1 - sstep(seg(t, 1.0, 1.24)));
      return { l: { x: -9 * lk + (done ? -2 * (len - 1) * 20 : 0) }, r: { x: 9 * lk + (done ? 2 * (len - 1) * 20 : 0) }, bar: done || k0 * kOut(1) <= 0 ? { len } : { bars } };
    },
    // P4 opens on a spring (ζ 0.62): the leaves swing ~8 % past open, then 2 % back
    fold: t => {
      const k = t < .5 ? sstep(seg(t, .04, .4)) : spring(t - .5, 1, 0, 0, .62, 150);
      const f = Math.abs(k) < .002 ? null : foldShapes(0, k);
      return f ? { fold: f, body: { s: 1 + .04 * hann(t, .52, .8) } } : {};
    },
  };
  const W4F = settleTail(rockPose, .82, { k: 260, z: .62, kP: 200, zP: .6 });

  const MOMENTS = {
    wave: { D: 1.4, pose: W4F },
    fold: { D: 1.3, pose: END.fold },
    // flourishes after a long take
    clap: { D: 1.1, pose: settleTail(SHIP.clap, .56, { kP: 240, zP: .55 }) },
    shimmy: { D: 1.45, pose: END.shimmy },
    bounce: { D: 1.15, pose: settleTail(SHIP.bounce, .6) },
    // idle nudges (keyboard up, bubble unused)
    say: { D: 1.55, pose: END.say },
    ping: { D: 1.35, pose: settleTail(SHIP.nPing, .6) },
    peek: { D: 1.3, pose: settleTail(SHIP.nPeek, .72, { k: 280, z: .6 }) },
    flutter: { D: 1.0, pose: settleTail(SHIP.nFlutter, .62, { kP: 320, zP: .45 }) },
    yawn: { D: 1.85, pose: settleTail(SHIP.nYawn, 1.06, { k: 260, z: .55, kP: 180, zP: .6 }) },
  };
  const NUDGES = ['say', 'ping', 'peek', 'flutter', 'yawn', 'wave', 'fold'];
  const FLOURISH = ['clap', 'shimmy', 'bounce'];
  function picker(pool) { let last = null; return () => { let x; do x = pool[Math.floor(Math.random() * pool.length)]; while (pool.length > 1 && x === last); last = x; return x; }; }

  // ---------- entrances (the keyboard opens) and the exit (it closes). d = direction of the screen centre (-1: docked right)
  const edgeX = d => -d * EDGE_U;
  function dropletGeom(t, d) {
    const e = -d, E = edgeX(d), k = stepS(t - .01, 300, .8);
    return { x: lerp(E + e * 20, 0, k), r: lerp(70, 150, sstep(seg(t, 0, .26))), sx0: E + e * lerp(70, 165, sstep(seg(t, .1, .34))), rs: lerp(110, 58, sstep(seg(t, 0, .3))) };
  }
  let DROP_SNAP = null;   // E5: when the neck snaps (found once, numerically)
  const dropSnap = () => { if (DROP_SNAP != null) return DROP_SNAP; for (let t = .02; t < .5; t += .002) { const g = dropletGeom(t, -1); if (!neckD(g.sx0 - g.x, g.rs, 0, g.r, 70)) return (DROP_SNAP = t); } return (DROP_SNAP = .2); };
  const ENTS = {
    E1: { fam: 'spring', w: 2, D: .38, pose: t => ({ body: { s: .4 + .6 * stepS(t, 500, .46), a: clamp(t / .07) }, mark: { s: .55 + .45 * stepS(t - .045, 560, .5) } }) },
    E3: { fam: 'spring', D: .4, pose: (t, d) => {
      const x0 = -d * 370, x = spring(t, x0, 0, 0, .66, 460), v = springV(t, x0, 0, 0, .66, 460), xl = spring(t - .05, x0, 0, 0, .66, 460);
      return { body: { tx: x, stretch: { ang: 0, amt: clamp(Math.abs(v) / 2600) * .13 } }, mark: { tx: clamp((xl - x) * .22, -26, 26) } };
    } },
    E5: { fam: 'liquid', D: .46, pose: (t, d) => {
      const g = dropletGeom(t, d), sn = dropSnap(), tau = t - sn, wob = tau > 0 ? .07 * Math.exp(-10 * tau) * Math.sin(30 * tau) : 0;
      const ms = lerp(.6, 1, stepS(t - sn, 520, .58));
      return { body: { tx: g.x, r: g.r, fill: 'u', sx: 1 + wob, sy: 1 - .8 * wob }, bead: { cx: g.sx0 - g.x, r: g.rs, neck: neckD(g.sx0 - g.x, g.rs, 0, g.r, 70) },
        mark: { s: ms * g.r / 150 }, bar: { a: seg(t, sn - .01, sn + .05) }, l: { a: seg(t, sn + .03, sn + .09) }, r: { a: seg(t, sn + .03, sn + .09) } };
    } },
    E6: { fam: 'liquid', D: .38, pose: (t, d) => {
      const ox = -d * 55, oy = 35, u = seg(t, .02, .3), R = 230 * eOut(u) + 6, ls = lerp(.7, 1, stepS(t - .2, 520, .62));
      return { body: { clip: { cx: ox, cy: oy, r: R } }, wet: u > 0 && u < 1 ? { cx: ox, cy: oy, r: Math.max(1, R - 6), a: .55 * (1 - u) } : null,
        bar: { len: eOut(seg(t, .13, .27)) }, l: { a: seg(t, .19, .27), s: ls }, r: { a: seg(t, .19, .27), s: ls } };
    } },
    E11: { fam: 'build', w: 2, D: .36, pose: t => {
      const rx = 12.25 + 137.75 * stepS(t - .03, 520, .55), ry = lerp(96, 150, stepS(t - .03, 520, .85)), k = clamp(stepS(t - .08, 520, .7));
      const lf = side => ({ abs: true, x: side * LX * k, sx: lerp(.4, 1, k), a: seg(k, .25, .6) });
      return { body: { rx, ry, a: clamp(t / .05) }, bar: { len: lerp(.72, 1, sstep(seg(t, .05, .24))) }, l: lf(-1), r: lf(1) };
    } },
    E12: { fam: 'build', D: .43, pose: t => {
      const tf = t < .14 ? FOLD_CLOSED : Math.min(FOLD_SECONDS, FOLD_OPEN_FROM + (t - .14) * 1.9), f = foldShapes(tf);
      return Object.assign(f ? { fold: f } : {}, { body: { s: (.5 + .5 * stepS(t, 600, .7)) * (1 + .045 * hann(tf, .52, .84)), a: clamp(t / .06) } });
    } },
    E13: { fam: 'voice', D: .44, pose: t => {
      const c = sstep(seg(t, .14, .3)), ls = lerp(.6, 1, stepS(t - .26, 520, .6)), la = seg(t, .26, .34);
      const bar = c >= 1 ? {} : { bars: [-48, -24, 0, 24, 48].map((x, i) => { const lev = .5 + .5 * Math.sin(2 * Math.PI * 3.2 * t + i * 1.9); return [x * (1 - c), lerp(BH * (.22 + .5 * lev), BH, c), lerp(.55, i === 2 ? 1 : .55, c)]; }) };
      return { body: { s: .55 + .45 * stepS(t, 420, .7), a: clamp(t / .06) }, bar, l: { s: ls, a: la }, r: { s: ls, a: la } };
    } },
    // special: the first appearance (first open of the day)
    E14: { fam: 'voice', D: .9, special: true, pose: t => {
      const s = t < .5 ? lerp(.82, 1.06, sstep(seg(t, 0, .5))) : spring(t - .5, 1.06, 1, 0, .9, 160), o = hann(t, .1, .8), g = hann(t, .02, .9);
      return { glow: g > .01 ? { r: 150 * s * 1.42, a: g * .9 } : null, body: { s, a: seg(t, 0, .16) }, l: { x: -7 * o, sy: 1 + .06 * o }, r: { x: 7 * o, sy: 1 + .06 * o }, bar: { len: 1 + .08 * o } };
    } },
  };
  // the everyday pool: weighted, never the same option or the same family twice in a row
  const POOL = ['E1', 'E3', 'E5', 'E6', 'E11', 'E12', 'E13'];
  let lastEnt = null;
  function nextEntrance() {
    let c = POOL.filter(id => id !== lastEnt);
    const c2 = c.filter(id => !lastEnt || ENTS[id].fam !== ENTS[lastEnt].fam); if (c2.length) c = c2;
    const tot = c.reduce((a, id) => a + (ENTS[id].w || 1), 0); let r = Math.random() * tot, pick = c[c.length - 1];
    for (const id of c) { r -= ENTS[id].w || 1; if (r <= 0) { pick = id; break; } }
    lastEnt = pick;
    return pick;
  }
  // X4 Droplet reabsorb: it runs back to its edge, a bead swells out of the edge to meet it and drinks it back in
  const X4 = { D: .3, pose: (t, d) => {
    const e = -d, E = edgeX(d), k = ACCEL(seg(t, 0, .3)), x = lerp(0, E + e * 90, k), r = lerp(150, 60, sstep(seg(t, .08, .3)));
    const sx0 = E + e * lerp(165, 80, sstep(seg(t, 0, .2))), rs = lerp(58, 100, sstep(seg(t, 0, .2)));
    const v = Math.abs(ACCEL(seg(t + .01, 0, .3)) - ACCEL(seg(t - .01, 0, .3))) * 50;
    return { body: { tx: x, r, fill: 'u', stretch: { ang: 0, amt: clamp(v) * .1 } }, bead: { cx: sx0 - x, r: rs, neck: neckD(sx0 - x, rs, 0, r, 70) }, mark: { s: r / 150, a: 1 - seg(t, .1, .2) } };
  } };

  // ---------- the take's pieces (the ✓ slot) ----------
  const busyPose = t => ({ bar: { amp: 12 * eOut(seg(t, 0, .25)), cyc: 1.5, ph: t * 10 } });
  // the tidy wiggle settles straight on a damped spring (DotChoreo.settle), from where the loop was at t0
  const settleWig = (tau, t0) => { const w = busyPose(t0).bar; return { bar: { amp: w.amp * Math.exp(-9 * tau) * Math.cos(16 * tau), cyc: 1.5, ph: w.ph + tau * 10 } }; };
  const restUnfold = tau => ({ bar: { check: 1 - sstep(seg(tau, 0, .3)) }, l: { s: 1 + .06 * hann(tau, .22, .44) }, r: { s: 1 + .06 * hann(tau, .25, .47) } });
  const holdThenRest = (tau, from, hold = .45) => tau < from + hold ? { bar: { check: 1 } } : restUnfold(tau - from - hold);
  // the C2 copy bud, sitting out beside Dot (ga: the copy icon), and its return: a teardrop pull on the neck,
  // a two-step gulp (4.5 %, then 1.5 %), and the near leaf is pushed and springs back
  const budHold = (ga = 1, d = -1) => ({ bud: { bx: d * FAR, r: RB, sx: 1, sy: 1, ga } });
  function budRet(t, d = -1) {
    const k = spring(t, 1, 0, 0, .72, 200), r = lerp(RB, 64, sstep(seg(t, .04, .4))), ga = 1 - clamp(seg(t, 0, .1)), pull = hann(t, 0, .3);
    const tg = t - .2, gulp = tg > 0 ? 1 + .045 * Math.exp(-7 * tg) * Math.sin(16 * tg) : 1, nud = tg > 0 ? -7 * Math.exp(-8 * tg) * Math.sin(14 * tg) : 0;
    const p = { body: { s: gulp }, bud: t < .5 ? { bx: d * lerp(40, FAR, k), r, sx: 1 + .22 * pull, sy: 1 - .12 * pull, ga } : null };
    p[d < 0 ? 'l' : 'r'] = { x: d * nud };
    return p;
  }

  // ---------- SVG ----------
  let N = 0;
  function svg(o = {}) {
    const id = 'kd' + (++N), grad = o.grad || 'kk-bub-g';
    const body = o.bg === false ? '' : `<ellipse class="body" rx="150" ry="150" fill="url(#${grad})" data-g="${grad}"/>`;
    return `<svg class="kkdot" viewBox="${o.vb || '-240 -240 480 480'}" aria-hidden="true" focusable="false" data-kd="${id}">` +
      `<defs><clipPath id="${id}b"><circle class="cb" r="150"/></clipPath><clipPath id="${id}d"><circle r="150"/></clipPath></defs><g class="und"></g>` +
      `<circle class="glw" r="0" fill="url(#kk-glow)" opacity="0"/><g class="wb">` +
      `<g class="rg"><circle r="150" fill="none" stroke="#fff" stroke-width="5" opacity="0"/><circle r="150" fill="none" stroke="#fff" stroke-width="5" opacity="0"/></g>` +
      `<g class="bd"><g class="bdu" display="none"><path class="nk" fill="url(#kk-bub-u)"/><circle class="bead" r="0" fill="url(#kk-bub-u)"/></g>${body}` +
      `<g clip-path="url(#${id}d)"><circle class="wet" r="0" fill="none" stroke-width="16" opacity="0"/></g>` +
      `<g class="mk"><path class="lf" d="${LEAF}" transform="translate(${-LX} 0)" fill="#fff"/><path class="lf" d="${LEAF}" transform="translate(${LX} 0)" fill="#fff"/>` +
      `<path class="br" d="${rrD(0, 0, BH + BW / 2, BW)}" fill="#fff"/></g></g>` +
      `<g class="sps">${`<path d="${SPARK_D}" opacity="0"/>`.repeat(4)}</g></g><g class="ex"></g></svg>`;
  }
  function refs(el) {
    if (el._kd) return el._kd;
    const q = s => el.querySelector(s), qa = s => [...el.querySelectorAll(s)], sv = q('.kkdot');
    return (el._kd = { el, id: sv.dataset.kd, und: q('.und'), glw: q('.glw'), wb: q('.wb'), rg: qa('.rg circle'), bd: q('.bd'), bdu: q('.bdu'), nk: q('.nk'), bead: q('.bead'),
      body: q('.body'), cb: q('.cb'), wet: q('.wet'), mk: q('.mk'), lf: qa('.lf'), br: q('.br'), sps: qa('.sps path'), ex: q('.ex'), anim: null, bud: null });
  }
  const set = (el, k, v) => { if (!el) return; const c = el._c || (el._c = {}); if (c[k] === v) return; c[k] = v; if (v == null) el.removeAttribute(k); else el.setAttribute(k, v); };
  const leafShadow = k => `filter:drop-shadow(0 5px 7px rgba(28,32,40,${(.3 * k).toFixed(3)}))`;
  function pose(D, p = {}) {
    const b = p.body || {}, a = b.a ?? 1, s = b.s ?? 1;
    // the whole: uniform scale about (px, py) and alpha
    set(D.wb, 'transform', s !== 1 ? (b.px || b.py ? `translate(${n2(b.px || 0)} ${n2(b.py || 0)}) scale(${n2(s)}) translate(${n2(-(b.px || 0))} ${n2(-(b.py || 0))})` : `scale(${n2(s)})`) : null);
    set(D.wb, 'opacity', a < .999 ? n2(Math.max(0, a)) : null);
    set(D.wb, 'display', a <= .004 || s <= .003 ? 'none' : null);
    // the body
    const ay = b.anchor === 'b' ? 150 : 0, sx = b.sx ?? 1, sy = b.sy ?? 1;
    let tf = `translate(${n2(b.tx || 0)} ${n2(b.ty || 0)})`;
    if (b.rot) tf += ` rotate(${n2(b.rot)} 0 150)`;
    if (sx !== 1 || sy !== 1) tf += ` translate(0 ${ay}) scale(${n2(sx)} ${n2(sy)}) translate(0 ${-ay})`;
    if (b.stretch && b.stretch.amt) { const { ang, amt } = b.stretch; tf += ` rotate(${n2(ang)}) scale(${n2(1 + amt)} ${n2(1 - amt * .55)}) rotate(${n2(-ang)})`; }
    set(D.bd, 'transform', tf);
    if (D.body) {
      set(D.body, 'rx', n2(Math.max(.1, b.rx ?? b.r ?? 150))); set(D.body, 'ry', n2(Math.max(.1, b.ry ?? b.r ?? 150))); set(D.body, 'cx', b.cx ? n2(b.cx) : null);
      set(D.body, 'fill', b.fill === 'u' ? 'url(#kk-bub-u)' : `url(#${D.body.dataset.g})`);
      if (b.clip) { set(D.cb, 'cx', n2(b.clip.cx)); set(D.cb, 'cy', n2(b.clip.cy)); set(D.cb, 'r', n2(Math.max(.5, b.clip.r))); set(D.body, 'clip-path', `url(#${D.id}b)`); }
      else set(D.body, 'clip-path', null);
    }
    const bd = p.bead;
    set(D.bdu, 'display', bd ? null : 'none');
    if (bd) { set(D.bead, 'cx', n2(bd.cx)); set(D.bead, 'r', n2(bd.r)); set(D.nk, 'd', bd.neck || null); set(D.nk, 'display', bd.neck ? null : 'none'); }
    const wt = p.wet;
    if (wt && wt.a > .005) { set(D.wet, 'cx', n2(wt.cx)); set(D.wet, 'cy', n2(wt.cy)); set(D.wet, 'r', n2(wt.r)); set(D.wet, 'opacity', n2(wt.a)); } else set(D.wet, 'opacity', '0');
    const gl = p.glow;
    if (gl && gl.a > .005) { set(D.glw, 'r', n2(gl.r)); set(D.glw, 'opacity', n2(gl.a)); } else set(D.glw, 'opacity', '0');
    // the mark: its own offset / scale / alpha (pieces landing a beat after the body)
    const m = p.mark || {}, ma = m.a ?? 1, ms = m.s ?? 1;
    set(D.mk, 'transform', m.tx || m.ty || ms !== 1 ? `translate(${n2(m.tx || 0)} ${n2(m.ty || 0)}) scale(${n2(ms)})` : null);
    set(D.mk, 'opacity', ma < .999 ? n2(Math.max(0, ma)) : null);
    set(D.mk, 'display', ma <= .004 || ms <= .003 ? 'none' : null);
    if (p.fold) {
      const k = p.fold;
      [k.l, k.r].forEach((A, i) => { const el = D.lf[i]; set(el, 'display', k.merged ? 'none' : null); set(el, 'd', dP(A)); set(el, 'transform', null); set(el, 'opacity', null); set(el, 'style', null); });
      set(D.br, 'display', null); set(D.br, 'd', dP(k.b)); set(D.br, 'transform', null); set(D.br, 'fill', '#fff'); set(D.br, 'stroke', null); set(D.br, 'opacity', null);
    } else {
      const br = p.bar || {}, ck = clamp(br.check || 0), shrink = 1 - clamp(ck * 2.2);
      [[p.l, -1], [p.r, 1]].forEach(([o, side], i) => {
        o = o || {}; const el = D.lf[i], s2 = (o.s ?? 1) * shrink, la = o.a ?? 1;
        const lsx = (o.sx ?? 1) * s2, lsy = (o.sy ?? 1) * s2;
        if (la <= .004 || lsx <= .004 || lsy <= .004) { set(el, 'display', 'none'); return; }
        set(el, 'display', null); set(el, 'opacity', la < .999 ? n2(la) : null);
        if (o.pts) { set(el, 'd', dP(o.pts)); set(el, 'transform', null); set(el, 'style', null); return; }
        const x = o.abs ? (o.x ?? side * LX) : side * LX + (o.x || 0), y = o.y || 0;
        const outK = clamp((Math.hypot(x, y) + LW / 2 * lsx - 150) / 30);   // 0 inside the dot, 1 out past its edge
        set(el, 'd', LEAF);
        set(el, 'transform', `translate(${n2(x)} ${n2(y)}) rotate(${n2((o.rot || 0) * outK)} 0 ${n2(o.pivot === 'c' ? 0 : LH / 2 * lsy)}) scale(${n2(lsx)} ${n2(lsy)})`);
        set(el, 'style', outK > 0 ? leafShadow(outK) : null);   // pure white, no outline; past the edge a soft grey shadow
      });
      const ba = br.a ?? 1;
      set(D.br, 'opacity', ba < .999 ? n2(Math.max(0, ba)) : null);
      let d = '', tf2 = null, stroke = false, w = BW * (br.w ?? 1);
      if (ck > 0) {
        const len = (br.len ?? 1) * BH, A = [[0, len], [0, 0], [0, -len]], Bk = [[-50, 2], [-16, 40], [50, -42]], e = back(ck, 1.2);
        const q = A.map((a2, i) => [lerp(a2[0], Bk[i][0], e), lerp(a2[1], Bk[i][1], e)]);
        d = `M${n2(q[0][0])},${n2(q[0][1])} L${n2(q[1][0])},${n2(q[1][1])} L${n2(q[2][0])},${n2(q[2][1])}`; w = BW * lerp(1, 1.08, ck) * (br.w ?? 1); stroke = true;
        tf2 = br.x || br.y ? `translate(${n2(br.x || 0)} ${n2(br.y || 0)})` : null;
      } else if (br.bars) {
        d = br.bars.map(([x, h, bw, y = 0]) => rrD(x, y, h + BW * bw / 2, BW * bw)).join('');
      } else if (br.amp) {
        d = wavePath(br.amp, br.cyc ?? 1.6, br.ph || 0, (br.len ?? 1) * BH); stroke = true;
        tf2 = `translate(${n2(br.x || 0)} ${n2(br.y || 0)}) rotate(${n2(br.tilt || 0)})`;
      } else {
        const len = br.len ?? 1;
        if (len > .004 && w > .2) d = rrD(0, 0, (BH + BW / 2) * len, w);
        tf2 = br.x || br.y || br.tilt ? `translate(${n2(br.x || 0)} ${n2(br.y || 0)}) rotate(${n2(br.tilt || 0)})` : null;
      }
      set(D.br, 'display', d ? null : 'none');
      set(D.br, 'd', d || null); set(D.br, 'transform', tf2);
      set(D.br, 'fill', stroke ? 'none' : '#fff'); set(D.br, 'stroke', stroke ? '#fff' : null);
      set(D.br, 'stroke-width', stroke ? n2(w) : null); set(D.br, 'stroke-linecap', stroke ? 'round' : null); set(D.br, 'stroke-linejoin', stroke ? 'round' : null);
    }
    D.rg.forEach((r, i) => { const q = (p.rings || [])[i] || [1, 0]; set(r, 'transform', `scale(${n2(q[0])})`); set(r, 'opacity', n2(q[1])); });
    D.sps.forEach((sp, i) => { const q = (p.sp || [])[i];
      if (!q || q[3] <= .01) { set(sp, 'opacity', '0'); return; }
      set(sp, 'transform', `translate(${n2(q[0])} ${n2(q[1])}) rotate(${n2(q[4] || 0)}) scale(${n2(q[2])})`); set(sp, 'opacity', n2(q[3])); sp.style.fill = q[5] || 'var(--spark)'; });
    if (p.bud) {
      if (!D.bud) {
        const f = D.id + 'g';
        D.und.innerHTML = `<defs><filter id="${f}" filterUnits="userSpaceOnUse" x="-720" y="-260" width="1440" height="520" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="14"/><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 12 -6.3"/></filter></defs>` +
          `<g filter="url(#${f})"><circle r="150" fill="url(#kk-bub-u)"/><ellipse class="bud" rx="56" ry="56" fill="url(#kk-bub-g)"/></g>`;
        D.ex.innerHTML = `<path class="cpy" d="${COPY_ICON}" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" opacity="0"/>`;
        D.bud = { c: D.und.querySelector('.bud'), ic: D.ex.querySelector('.cpy') };
      }
      const { bx, r, ga } = p.bud, bsx = p.bud.sx ?? 1, bsy = p.bud.sy ?? 1;
      set(D.und, 'display', null); set(D.ex, 'display', null);
      set(D.bud.c, 'cx', n2(bx)); set(D.bud.c, 'rx', n2((r + 2) * bsx)); set(D.bud.c, 'ry', n2((r + 2) * bsy));
      set(D.bud.ic, 'transform', `translate(${n2(bx)} 0) scale(${n2(RB * 1.05 / 24 * lerp(.7, 1, ga))}) translate(-12 -12.5)`); set(D.bud.ic, 'opacity', n2(ga));
    } else if (D.bud) { set(D.und, 'display', 'none'); set(D.ex, 'display', 'none'); }
  }

  // ---------- the shared clock ----------
  const running = new Set();
  let rafOn = false;
  function tick(now) {
    rafOn = false;
    for (const a of [...running]) {
      const t = (now - a.t0) / 1000;
      if (t >= a.dur) { running.delete(a); a.D.anim = null; a.fn(a.dur); a.res(true); }
      else a.fn(t);
    }
    if (running.size) { rafOn = true; requestAnimationFrame(tick); }
  }
  // play fn(t) on D for dur seconds (Infinity for a loop); resolves true when it ends, false if stopped
  function play(D, fn, dur, kind = '') {
    stop(D);
    return new Promise(res => {
      const a = { D, fn, dur, kind, res, t0: performance.now() };
      D.anim = a; running.add(a); fn(0);
      if (!rafOn) { rafOn = true; requestAnimationFrame(tick); }
    });
  }
  function stop(D) { const a = D.anim; if (a) { running.delete(a); D.anim = null; a.res(false); } }
  // pause / resume a loop while its dot is off screen (one-shots just finish)
  function pause(D) { const a = D.anim; if (a && a.dur === Infinity && running.has(a)) { running.delete(a); a.paused = true; a.pt = performance.now(); } }
  function resume(D) { const a = D.anim; if (a && a.paused) { a.paused = false; a.t0 += performance.now() - a.pt; running.add(a); if (!rafOn) { rafOn = true; requestAnimationFrame(tick); } } }
  const moment = (D, name, d = -1) => { const m = MOMENTS[name]; return play(D, t => pose(D, m.pose(t, d)), m.D, name).then(ok => { if (ok) pose(D, {}); return ok; }); };
  const enter = (D, id, d = -1) => { const E = ENTS[id]; return play(D, t => pose(D, E.pose(Math.min(t, E.D), d)), E.D + .02, 'enter').then(ok => { pose(D, {}); return ok; }); };
  const leave = (D, d = -1) => play(D, t => pose(D, X4.pose(Math.min(t, X4.D), d)), X4.D + .02, 'leave').then(ok => { pose(D, { body: { a: 0 } }); return ok; });

  window.KKDot = { svg, refs, pose, play, stop, pause, resume, moment, enter, leave, picker, nextEntrance, MOMENTS, NUDGES, FLOURISH, ENTS, X4,
    busyPose, settleWig, restUnfold, holdThenRest, budHold, budRet, FAR, RB,
    util: { clamp, seg, lerp, bump, hann, sstep, eOut, eIn, eInOut, n2, spring, springV, stepS, cubicBezier, ACCEL, EMPH } };
})();
