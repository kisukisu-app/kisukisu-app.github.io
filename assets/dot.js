/* Dot: the KisuKisu bubble's mark, and its moments. Ported from the Dot playground (v5, the approved
   variant: no arms). Mark space: the dot is r150 at (0,0); the overlay window is ±240.
   Only the dot, its two leaves and the bar move. Rules kept from the playground:
   - the leaves stay upright inside the dot and only lean once they are out past its edge
   - the bar never disappears (two leaves alone would read as eyes)
   Everything is a transform / path / opacity on four SVG nodes, driven by one shared requestAnimationFrame
   loop that only runs while something is playing. */
(() => {
  'use strict';
  const LX = 60.12, LH = 110.94, LW = 61.15, BW = 24.51, BH = 72.11;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (x, a, b) => clamp((x - a) / (b - a));
  const lerp = (a, b, x) => a + (b - a) * x;
  const n2 = v => String(Math.round(v * 100) / 100);
  const eOut = x => 1 - Math.pow(1 - x, 3);
  const bump = (t, a, b) => Math.sin(Math.PI * seg(t, a, b));
  const sstep = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
  const hann = (t, a, b) => { const u = seg(t, a, b); return u <= 0 || u >= 1 ? 0 : Math.pow(Math.sin(Math.PI * u), 2); };
  const back = (x, c = 1.6) => { x = clamp(x); const c3 = c + 1; return 1 + c3 * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  // the app's own spring (BubbleService.springTo: stiffness 400, damping ratio 0.75)
  function spring(t, x0, x1, v0 = 0, zeta = .75, k = 400) {
    if (t <= 0) return x0;
    const w = Math.sqrt(k), wd = w * Math.sqrt(1 - zeta * zeta), d0 = x0 - x1, B = (v0 + zeta * w * d0) / wd;
    return x1 + Math.exp(-zeta * w * t) * (d0 * Math.cos(wd * t) + B * Math.sin(wd * t));
  }
  const stepS = (t, k = 300, z = .8) => t <= 0 ? 0 : spring(t, 0, 1, 0, z, k);
  const beatP = (t, t0, len = .26) => { const x = (t - t0) / len; if (x <= 0 || x >= 1) return 0; return x < .3 ? Math.pow(Math.sin(Math.PI / 2 * x / .3), 2) : .5 + .5 * Math.cos(Math.PI * (x - .3) / .7); };
  const clapHit = (t, tc) => { if (t < tc - .11 || t > tc + .17) return 0; if (t <= tc) { const x = (t - (tc - .11)) / .11; return x * x; } return 1 - sstep((t - tc) / .17); };
  const LEAF = (() => { const c = LH / 2, s = LW / 2, r = (c * c + s * s) / (2 * s); return `M0,${n2(-c)} A${n2(r)},${n2(r)} 0 0,0 0,${n2(c)} A${n2(r)},${n2(r)} 0 0,0 0,${n2(-c)}Z`; })();
  const SPARK_D = 'M0,-1 C.12,-.12 .12,-.12 1,0 C.12,.12 .12,.12 0,1 C-.12,.12 -.12,.12 -1,0 C-.12,-.12 -.12,-.12 0,-1Z';
  const COPY_ICON = 'M9,9 h9 a1.5,1.5 0 0 1 1.5,1.5 v9 a1.5,1.5 0 0 1 -1.5,1.5 h-9 a1.5,1.5 0 0 1 -1.5,-1.5 v-9 a1.5,1.5 0 0 1 1.5,-1.5 z M15,6 v-0.5 a1.5,1.5 0 0 0 -1.5,-1.5 h-8 a1.5,1.5 0 0 0 -1.5,1.5 v8 a1.5,1.5 0 0 0 1.5,1.5 h0.5';
  // the bar as a travelling sine (the tidy-up wiggle), pinned at both ends
  function wavePath(amp, cyc, ph, len) {
    let d = '';
    for (let i = 0; i <= 28; i++) { const u = i / 28, y = -len + u * 2 * len, x = amp * Math.sin(ph + u * cyc * Math.PI * 2) * Math.pow(Math.sin(Math.PI * u), .35); d += (i ? 'L' : 'M') + n2(x) + ',' + n2(y); }
    return d;
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
  const openK = (t, o, d = .38) => { const u = seg(t, o, o + d); return 1 - sstep(u) - .09 * hann(u, .55, 1); };
  const peekK = (t, c0, c1, o, d) => t < o ? sstep(seg(t, c0, c1)) : openK(t, o, d);
  function foldPose(t) {   // P4: the leaves fold over the bar like closing petals, melt into one almond, then unfold
    const S = shapes(), k = peekK(t, .04, .4, .5, .44), kc = clamp(k), uf = seg(kc, 0, .75), f = Math.cos(.75 * Math.PI * uf), m = sstep(seg(kc, .72, 1));
    const lf = side => {
      const xh = side * (lerp(LX - LW / 2, 6, uf) - 40 * Math.min(0, k));
      const P = S.leaf.map(p => [xh + (side * (LW / 2) + p[0]) * f, p[1] * (1 + .12 * uf)]);
      return m > 0 ? mixP(flipIdx(P), S.alm, m) : P;
    };
    return { pk: { l: lf(-1), r: lf(1), b: mixP(S.bar, S.alm, sstep(seg(kc, .35, 1))), merged: kc > .999 }, body: { s: 1 + .045 * hann(t, .52, .84) } };
  }

  // ---------- W4: the whole dot leans toward the middle of the screen and rocks while that side's leaf waves ----------
  const outW = (t, bk, k1 = 260, z1 = .82, k2 = 300) => stepS(t, k1, z1) - stepS(t - bk, k2, .9);
  // edge = the screen edge the bubble sits on. Written for the left edge (the right leaf waves), mirrored for the right.
  function wavePose(t, edge = 'right') {
    const out = outW(t - .02, .8, 240, .82, 280), s = lerp(1, .86, out), env = hann(t, .1, .92), ps = Math.sin(2 * Math.PI * 1.75 * (t - .14));
    const lean = 3.5 * sstep(seg(t, .06, .3)) * (1 - sstep(seg(t, .78, 1.08)));
    const p = { abs: true, body: { rot: lean + 5 * ps * env }, r: { x: lerp(LX, 158, out), y: -16 * out, s, rot: 8 * out + 16 * ps * env }, l: { x: -LX + 5 * out }, bar: { x: 4 * out, tilt: 3 * out } };
    if (edge === 'left') return p;
    const mo = o => Object.assign({}, o, { x: -(o.x || 0), rot: -(o.rot || 0) });
    return { abs: true, body: { rot: -p.body.rot }, l: mo(p.r), r: mo(p.l), bar: { x: -p.bar.x, tilt: -p.bar.tilt } };
  }

  // ---------- one-shots (offset format: leaf x/y are offsets from their resting place) ----------
  const mirL = o => Object.assign({}, o, { x: -(o.x || 0), rot: -(o.rot || 0) });
  const MOMENTS = {
    wave: { D: 1.15, pose: (t, d) => wavePose(t, d < 0 ? 'right' : 'left') },
    fold: { D: 1.05, pose: t => foldPose(t) },
    // flourishes after a long take
    clap: { D: .9, pose: t => {
      const wind = hann(t, 0, .16), h = Math.max(clapHit(t, .24), clapHit(t, .48)), imp = hann(t, .22, .31) + hann(t, .46, .55);
      const lf = { x: -7 * wind + 17.5 * h, sx: 1 - .1 * imp, sy: 1 + .04 * imp }, sp = [];
      for (const tc of [.24, .48]) { const u = seg(t, tc, tc + .3); if (u > 0 && u < 1) for (const sd of [-1, 1]) sp.push([sd * (16 + 40 * u), -98 - 52 * u, 26 * (1 - .45 * u), Math.sin(Math.PI * Math.min(1, .15 + u * 1.1)), 40 * u * sd, '#fff']); }
      return { l: lf, r: mirL(lf), bar: { w: 1 + .16 * imp, len: 1 - .04 * imp }, body: { sx: 1 + .02 * imp, sy: 1 + .02 * imp }, sp };
    } },
    shimmy: { D: 1.1, pose: t => {
      const e = sstep(seg(t, 0, .14)) * (1 - sstep(seg(t, .78, 1.05))), w = 2 * Math.PI * 2.3;
      const sw = d => Math.sin(w * (t - d)) * e, bob = d => (1 - Math.cos(2 * w * (t - d))) / 2 * e;
      const tw = (t0, x, y, s) => [x, y, s, hann(t, t0, t0 + .4), 30 * seg(t, t0, t0 + .4)];
      return { l: { x: 12 * sw(0), y: -6 * bob(0) }, bar: { x: 10 * sw(.06), y: -5 * bob(.06), tilt: 9 * sw(.06) }, r: { x: 12 * sw(.12), y: -6 * bob(.12) }, body: { tx: 4 * sw(.03) },
        sp: [tw(.12, -176, -150, 26), tw(.34, 178, -128, 20), tw(.52, -168, 150, 17), tw(.62, 182, 142, 22)] };
    } },
    bounce: { D: .95, pose: t => {
      const u = seg(t, .12, .5), air = t > .12 && t < .5 ? 4 * u * (1 - u) : 0;
      const crouch = hann(t, 0, .16), land = hann(t, .48, .7), reb = hann(t, .68, .86);
      const sy = 1 - .2 * land + .05 * reb, sx = 1 + .12 * land - .03 * reb;
      const lf = { x: -4 * land, y: LH / 2 * (1 - sy), sx, sy };
      return { l: lf, r: mirL(lf), bar: { y: -90 * air + 10 * crouch + 8 * land, len: 1 - .14 * crouch + .12 * hann(t, .1, .24) + .1 * hann(t, .38, .5) - .2 * land, w: 1 + .1 * crouch + .14 * land },
        body: { anchor: 'b', sx: 1 + .03 * land, sy: 1 - .04 * land } };
    } },
    // idle nudges (keyboard up, bubble unused)
    say: { D: 1.3, pose: t => {
      const k = sstep(seg(t, .02, .24)) * (1 - sstep(seg(t, 1.0, 1.26))), env = hann(t, .14, 1.12);
      const bars = [-21, 0, 21].map((x, i) => { const lev = .5 + .5 * Math.sin(2 * Math.PI * 2.4 * (t - .18) + i * 2.3 + (i === 1 ? 1.1 : 0)); return [x * k, BH * (lerp(1, .42, k) + .46 * k * env * lev), lerp(1, .56, k)]; });
      return { l: { x: -9 * k }, r: { x: 9 * k }, bars };
    } },
    ping: { D: 1.15, pose: t => {
      const b = beatP(t, .04, .3) + .7 * beatP(t, .4, .3), k = 1 + .08 * b;
      const rings = [[.06, .5], [.42, .34]].map(([t0, a]) => { const u = seg(t, t0, t0 + .7); return u > 0 && u < 1 ? [1 + .5 * eOut(u), a * Math.pow(1 - u, 1.6)] : [1, 0]; });
      return { l: { x: -LX * (k - 1), sx: k, sy: k }, r: { x: LX * (k - 1), sx: k, sy: k }, bar: { len: k, w: k }, body: { sx: 1 + .02 * b, sy: 1 + .02 * b }, rings };
    } },
    peek: { D: 1.1, pose: (t, d) => {
      const e = -d, pos = t < .56 ? sstep(seg(t, .04, .34)) : 1 - stepS(t - .56, 380, .5), press = hann(t, .26, .62), sq = hann(t, .6, .86);
      return { body: { tx: e * 60 * pos, sx: 1 - .07 * press + .06 * sq, sy: 1 + .03 * press - .06 * sq }, l: { x: d * 6 * pos }, r: { x: d * 6 * pos }, bar: { tilt: e * 5 * pos } };
    } },
    flutter: { D: .9, pose: t => {
      const env = hann(t, .06, .38) + hann(t, .46, .78), w = Math.sin(2 * Math.PI * 15 * t) * env, a = Math.abs(w);
      const lf = side => ({ x: side * 7 * w, y: -4 * a, sx: 1 - .08 * a, sy: 1 + .08 * a });
      return { l: lf(-1), r: lf(1), bar: { w: 1 + .04 * env } };
    } },
    yawn: { D: 1.7, pose: t => {
      const s = t < 1.0 ? sstep(seg(t, .05, .8)) : 1 - stepS(t - 1.0, 260, .55), wob = 2.5 * Math.sin(2 * Math.PI * 1.6 * (t - .5)) * hann(t, .45, 1.0);
      return { l: { x: -8 * s, y: 7 * s, sy: 1 - .1 * s }, r: { x: 8 * s, y: 7 * s, sy: 1 - .1 * s }, bar: { len: 1 + .42 * s, w: 1 - .12 * s, tilt: wob }, body: { anchor: 'b', sx: 1 + .05 * s, sy: 1 - .06 * s } };
    } },
  };
  const NUDGES = ['say', 'ping', 'peek', 'flutter', 'yawn', 'wave', 'fold'];
  const FLOURISH = ['clap', 'shimmy', 'bounce'];
  function picker(pool) { let last = null; return () => { let x; do x = pool[Math.floor(Math.random() * pool.length)]; while (pool.length > 1 && x === last); last = x; return x; }; }

  // ---------- the bar folding into a ✓ (check 0..1) and the tidy wiggle ----------
  const checkPose = ck => ({ check: ck });
  const busyPose = t => ({ bar: { amp: 12 * eOut(seg(t, 0, .25)), cyc: 1.5, ph: t * 10 } });
  // C2: a small dot buds off toward the screen centre on a liquid neck, carrying a copy icon; tR = when it flows back
  const UD = 150 / 22, RB = 18 * UD, FAR = 150 + 8 * UD + RB;
  function budPose(t, d = -1, tR = 2.4) {
    const k = t < tR ? stepS(t - .05, 170, .8) : Math.max(-.03, 1 - stepS(t - tR, 220, .95));
    const bx = d * lerp(40, FAR, k), r = t < tR ? lerp(56, RB, sstep(seg(t, .05, .45))) : lerp(RB, 56, sstep(seg(t, tR + .1, tR + .5)));
    const nud = d * 10 * hann(t, 0, .45), ga = clamp(seg(t, .42, .58)) * (1 - clamp(seg(t, tR, tR + .12)));
    const p = { body: { s: 1 + .035 * hann(t, tR + .25, tR + .6) }, bud: { bx, r, ga } };
    p[d < 0 ? 'l' : 'r'] = { x: nud };
    return p;
  }

  // ---------- SVG ----------
  let N = 0;
  function svg(o = {}) {
    const circle = o.bg === false ? '' : `<circle r="150" fill="url(#${o.grad || 'kk-bub-g'})"/>`;
    return `<svg class="kkdot" viewBox="${o.vb || '-240 -240 480 480'}" aria-hidden="true" focusable="false"><g class="und"></g>` +
      `<g class="rg"><circle r="150" fill="none" stroke="#fff" stroke-width="5" opacity="0"/><circle r="150" fill="none" stroke="#fff" stroke-width="5" opacity="0"/></g>` +
      `<g class="bd">${circle}<path class="lf" d="${LEAF}" transform="translate(${-LX} 0)" fill="#fff" stroke-width="0"/><path class="lf" d="${LEAF}" transform="translate(${LX} 0)" fill="#fff" stroke-width="0"/>` +
      `<path class="br" d="M0,${BH} L0,${-BH}" fill="none" stroke="#fff" stroke-width="${BW}" stroke-linecap="round" stroke-linejoin="round"/></g>` +
      `<g class="sps">${`<path d="${SPARK_D}" opacity="0"/>`.repeat(4)}</g><g class="ex"></g></svg>`;
  }
  function refs(el) {
    if (el._kd) return el._kd;
    const q = s => el.querySelector(s), qa = s => [...el.querySelectorAll(s)];
    return (el._kd = { el, id: 'kd' + (++N), und: q('.und'), rg: qa('.rg circle'), bd: q('.bd'), lf: qa('.lf'), br: q('.br'), sps: qa('.sps path'), ex: q('.ex'), anim: null, bud: null });
  }
  const set = (el, k, v) => { const c = el._c || (el._c = {}); if (c[k] === v) return; c[k] = v; if (v == null) el.removeAttribute(k); else el.setAttribute(k, v); };
  function pose(D, p = {}) {
    const b = p.body || {}, ay = b.anchor === 'b' ? 150 : 0, bs = b.s ?? 1;
    set(D.bd, 'transform', `translate(${n2(b.tx || 0)} ${n2(b.ty || 0)}) rotate(${n2(b.rot || 0)} 0 150) translate(0 ${ay}) scale(${n2((b.sx ?? 1) * bs)} ${n2((b.sy ?? 1) * bs)}) translate(0 ${-ay})`);
    if (p.pk) {
      const k = p.pk;
      [k.l, k.r].forEach((A, i) => { const el = D.lf[i]; set(el, 'display', k.merged ? 'none' : null); set(el, 'd', dP(A)); set(el, 'transform', null); set(el, 'stroke-width', '0'); });
      set(D.br, 'd', dP(k.b)); set(D.br, 'transform', null); set(D.br, 'fill', '#fff'); set(D.br, 'stroke-width', '0');
    } else {
      const ck = clamp(p.check || 0), shrink = 1 - clamp(ck * 2.2);
      [[p.l, -1], [p.r, 1]].forEach(([o, side], i) => {
        o = o || {}; const el = D.lf[i], s = (o.s ?? 1) * shrink;
        if (s <= .01) { set(el, 'display', 'none'); return; }
        set(el, 'display', null);
        const sx = (o.sx ?? 1) * s, sy = (o.sy ?? 1) * s, x = p.abs ? (o.x ?? side * LX) : side * LX + (o.x || 0), y = o.y || 0;
        const outK = clamp(((p.abs ? Math.hypot(x, y) : Math.abs(x)) + LW / 2 * sx - 150) / 30);   // 0 inside the dot, 1 out past its edge
        set(el, 'd', LEAF);
        set(el, 'transform', `translate(${n2(x)} ${n2(y)}) rotate(${n2((o.rot || 0) * outK)} 0 ${n2(o.pivot === 'c' ? 0 : LH / 2 * sy)}) scale(${n2(sx)} ${n2(sy)})`);
        set(el, 'stroke-width', outK > 0 ? n2(7 * outK / Math.min(sx, sy)) : '0');
      });
      const br = p.bar || {};
      let d, tf = null, w = BW * (br.w ?? 1);
      if (ck > 0) {
        const len = BH, A = [[0, len], [0, 0], [0, -len]], Bk = [[-50, 2], [-16, 40], [50, -42]], e = back(ck, 1.2);
        const q = A.map((a, i) => [lerp(a[0], Bk[i][0], e), lerp(a[1], Bk[i][1], e)]);
        d = `M${n2(q[0][0])},${n2(q[0][1])} L${n2(q[1][0])},${n2(q[1][1])} L${n2(q[2][0])},${n2(q[2][1])}`; w = BW * lerp(1, 1.08, ck);
      } else if (p.bars) {
        d = p.bars.map(([x, h, , y = 0]) => `M${n2(x)},${n2(y + h)} L${n2(x)},${n2(y - h)}`).join(' '); w = BW * p.bars[0][2];
      } else {
        const len = (br.len ?? 1) * BH;
        d = br.amp ? wavePath(br.amp, br.cyc ?? 1.6, br.ph || 0, len) : `M0,${n2(len)} L0,${n2(-len)}`;
        tf = `translate(${n2(br.x || 0)} ${n2(br.y || 0)}) rotate(${n2(br.tilt || 0)})`;
      }
      set(D.br, 'd', d); set(D.br, 'transform', tf); set(D.br, 'fill', 'none'); set(D.br, 'stroke-width', n2(w));
    }
    D.rg.forEach((r, i) => { const q = (p.rings || [])[i] || [1, 0]; set(r, 'transform', `scale(${n2(q[0])})`); set(r, 'opacity', n2(q[1])); });
    D.sps.forEach((s, i) => { const q = (p.sp || [])[i];
      if (!q || q[3] <= .01) { set(s, 'opacity', '0'); return; }
      set(s, 'transform', `translate(${n2(q[0])} ${n2(q[1])}) rotate(${n2(q[4] || 0)}) scale(${n2(q[2])})`); set(s, 'opacity', n2(q[3])); s.style.fill = q[5] || 'var(--spark)'; });
    if (p.bud) {
      if (!D.bud) {
        const f = D.id + 'g';
        D.und.innerHTML = `<defs><filter id="${f}" filterUnits="userSpaceOnUse" x="-720" y="-260" width="1440" height="520" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="14"/><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 12 -6.3"/></filter></defs>` +
          `<g filter="url(#${f})"><circle r="150" fill="url(#kk-bub-u)"/><circle class="bud" r="56" fill="url(#kk-bub-u)"/></g>`;
        D.ex.innerHTML = `<path class="cpy" d="${COPY_ICON}" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" opacity="0"/>`;
        D.bud = { c: D.und.querySelector('.bud'), ic: D.ex.querySelector('.cpy') };
      }
      const { bx, r, ga } = p.bud;
      set(D.und, 'display', null); set(D.ex, 'display', null);
      set(D.bud.c, 'cx', n2(bx)); set(D.bud.c, 'r', n2(r + 2));
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
  // play fn(t) on dot D for dur seconds (Infinity for a loop); resolves true when it ends, false if stopped
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
  function pause(D) { const a = D.anim; if (a && a.dur === Infinity && running.has(a)) { running.delete(a); a.paused = true; } }
  function resume(D) { const a = D.anim; if (a && a.paused) { a.paused = false; running.add(a); if (!rafOn) { rafOn = true; requestAnimationFrame(tick); } } }
  const moment = (D, name, d = -1) => { const m = MOMENTS[name]; return play(D, t => pose(D, m.pose(t, d)), m.D, name).then(ok => { if (ok) pose(D, {}); return ok; }); };

  window.KKDot = { svg, refs, pose, play, stop, pause, resume, moment, picker, MOMENTS, NUDGES, FLOURISH, busyPose, checkPose, budPose, wavePose,
    util: { clamp, seg, lerp, bump, hann, sstep, eOut, n2 } };
})();
