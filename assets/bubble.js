/* KisuKisu floating bubble ("Blot") and its tap bar: a 1:1 port of the Android overlay.
   Source of truth (read only): android/app/src/main/java/com/voicerewriter/
     BubbleGeom (BubblePreview.kt), TakeMotion.kt, DotChoreo.kt, DotMoves.kt (restUnfold), DotPainter.kt,
     RollPillDrawable.kt, WaveformView.kt (WaveGeom), StatusWordsView.kt, BubbleColors.kt,
     BubbleService.kt (the real overlay: colours, layout, the take's sequence), ui/Theme.kt (AccentChoice), AppPrefs.kt.
   Every number below carries its Kotlin source in a comment. Units: dp (1 dp = dotPx / 44 CSS px).
   Classic script: defines window.KisuBubble = { create, state, TL, ACCENTS, colors, fontReady }. No dependencies. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- geometry (BubblePreview.kt BubbleGeom)
  const DOT = 44;            // BubbleGeom.DOT_DP
  const GAP = 8;             // BubbleGeom.GAP_DP
  const TAP_PILL = 2.3;      // BubbleGeom.TAP_PILL
  const WIDE_PILL = 4.8;     // BubbleGeom.WIDE_PILL (the widest pill)
  const TEXT_SP = 12;        // StatusWordsView sp12 (== BubbleGeom.TEXT_SP)
  const ICON_PAD = 0.27;     // BubbleService.addBubble iconPad = size * 0.27 (the ✕ icon's padding)

  // ---------------------------------------------------------------- the mark (DotChoreo.kt), body space: dot radius 150
  const LX = 60.12, LH = 110.94, LW = 61.15, BW = 24.51, BH = 72.11;
  const LEAF = (() => { const c = LH / 2, s = LW / 2, r = (c * c + s * s) / (2 * s); return `M0,${-c} A${r},${r} 0 0,0 0,${c} A${r},${r} 0 0,0 0,${-c}Z`; })();
  const CLOSE_ICON = 'M6.5,6.5 L17.5,17.5 M17.5,6.5 L6.5,17.5';   // res/drawable/ic_close_round.xml (stroke 2.6, round caps)

  // ---------------------------------------------------------------- easing (DotChoreo.kt)
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (x, a, b) => clamp((x - a) / (b - a));
  const lerp = (a, b, x) => a + (b - a) * x;
  const eOut = x => 1 - Math.pow(1 - x, 3);
  const eInOut = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const back = (x, c = 1.6) => { const c3 = c + 1; return 1 + c3 * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const smoother = x => { const u = clamp(x); return u * u * u * (u * (u * 6 - 15) + 10); };
  const hann = (t, a, b) => { const u = seg(t, a, b); return u <= 0 || u >= 1 ? 0 : Math.pow(Math.sin(Math.PI * u), 2); };
  function spring(t, x0, x1, v0 = 0, z = 0.75, k = 400) {
    if (t <= 0) return x0;
    const w = Math.sqrt(k), d0 = x0 - x1;
    if (z >= 0.9999) {
      if (z <= 1.0001) return x1 + Math.exp(-w * t) * (d0 + (v0 + w * d0) * t);
      const s = Math.sqrt(z * z - 1), r1 = -w * (z - s), r2 = -w * (z + s), c2 = (v0 - r1 * d0) / (r2 - r1);
      return x1 + (d0 - c2) * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
    }
    const wd = w * Math.sqrt(1 - z * z), b = (v0 + z * w * d0) / wd;
    return x1 + Math.exp(-z * w * t) * (d0 * Math.cos(wd * t) + b * Math.sin(wd * t));
  }
  const springV = (t, x0, x1, v0 = 0, z = 0.75, k = 400) =>
    (spring(t + 1e-3, x0, x1, v0, z, k) - spring(Math.max(0, t - 1e-3), x0, x1, v0, z, k)) / (t > 1e-3 ? 2e-3 : 1e-3);
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    return xIn => {
      const x = clamp(xIn); let u = x;
      for (let i = 0; i < 8; i++) {
        const e = ((ax * u + bx) * u + cx) * u - x, d = (3 * ax * u + 2 * bx) * u + cx;
        if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break;
        u -= e / d;
      }
      u = clamp(u); return ((ay * u + by) * u + cy) * u;
    };
  }
  const stepS = (t, k = 300, z = 0.8) => t <= 0 ? 0 : spring(t, 0, 1, 0, z, k);
  /** android.animation.ValueAnimator's default interpolator (AccelerateDecelerateInterpolator). */
  const accelDecel = x => Math.cos((x + 1) * Math.PI) / 2 + 0.5;

  // ---------------------------------------------------------------- TakeMotion.kt
  const PILL_OUT = 0.14, UNROLL_SECONDS = 0.4;
  const T1_ROLL_AT = 0.02, T1_LAND = 0.26, T1_SWAP = 0.28, CHECK_READ = 0.38;
  const ROLL = cubicBezier(0.4, 0, 0.7, 1);
  const TM = {
    unrollCheck: tt => smoother(seg(tt, 0, 0.16)),
    unrollPill: (tt, pillW, gap) => clamp(((gap + pillW) * eOut(seg(tt, 0, PILL_OUT)) - gap) / pillW),
    unrollBar: (tt, j) => smoother(seg(tt, 0.03 + j * 0.008, 0.09 + j * 0.008)),
    unrollCancel: tt => tt <= 0.03 ? 0 : stepS(tt - 0.03, 900, 0.62),
    t1Cancel: τ => 1 - smoother(seg(τ, 0, 0.12)),
    t1Pill: τ => 1 - ROLL(seg(τ, T1_ROLL_AT, T1_LAND)),
    t1Check: τ => smoother(seg(τ, 0.1, T1_LAND)),
    t1SlotScale: τ => 1 + 0.05 * hann(τ, T1_LAND - 0.09, T1_LAND + 0.01),
    t1Tint: τ => smoother(seg(τ, 0.06, T1_LAND)),
    textBlur: τ => 7 * seg(τ, 0, 0.15),
    textAlpha: τ => 1 - smoother(seg(τ, 0, 0.15)),
    slot(τ, wig) {
      const fade = 1 - smoother(seg(τ, 0.06, 0.11));
      const amp = wig.barAmp * Math.exp(-14 * τ) * Math.cos(24 * τ) * fade;
      return pose({ barAmp: amp, barCyc: wig.barCyc, barPh: wig.barPh + τ * 10, check: TM.t1Check(τ) });
    },
  };

  // ---------------------------------------------------------------- poses (DotChoreo.kt DotPose, the moments a take uses)
  const pose = (o = {}) => Object.assign({ check: 0, barAmp: 0, barCyc: 1.6, barPh: 0, lsx: 1, lsy: 1, rsx: 1, rsy: 1 }, o);
  const REST = pose();
  // DotMoment.SLOT_TIDY (DotChoreo.raw): the bar wiggles while it works
  const slotTidy = t => pose({ barAmp: 12 * eOut(seg(t, 0, 0.25)), barCyc: 1.5, barPh: t * 10 });
  // DotMoment.SLOT_TIDY_FROM_CHECK (DotChoreo.finalPose): the ✓ unfolds (0.2 s), then SLOT_TIDY
  const slotTidyFromCheck = t => t < 0.2 ? pose({ check: 1 - smoother(seg(t, 0, 0.2)) }) : slotTidy(t - 0.2);
  // DotMoment.CHECK = DotMoves.restUnfold, 0.34 s
  const CHECK_SECONDS = 0.34;
  const restUnfold = t => pose({
    check: 1 - smoother(seg(t, 0, 0.18)),
    lsx: 1 + 0.06 * hann(t, 0.12, 0.3), lsy: 1 + 0.06 * hann(t, 0.12, 0.3),
    rsx: 1 + 0.06 * hann(t, 0.14, 0.32), rsy: 1 + 0.06 * hann(t, 0.14, 0.32),
  });

  // ---------------------------------------------------------------- colours
  // ui/Theme.kt AccentChoice: dark, light, soft
  const ACCENTS = {
    steel: { label: 'Steel blue', dark: 0x4682B4, light: 0x36648B, soft: 0x7FA7CC },
    copper: { label: 'Copper', dark: 0xD9A184, light: 0x9A5B3C, soft: 0xE8C2AE },
    sage: { label: 'Sage', dark: 0x8FA377, light: 0x55693F, soft: 0xB7C6A5 },
    violet: { label: 'Violet', dark: 0x9B8CE6, light: 0x5B4BB0, soft: 0xC3B9F2 },
    rose: { label: 'Rose', dark: 0xE08A9A, light: 0xA8445A, soft: 0xEFB8C2 },
  };
  // BubbleColors.blend: per channel, truncated (toInt)
  const ch = (c, s) => (c >> s) & 0xFF;
  const blend = (a, b, t) => {
    const m = s => Math.trunc(ch(a, s) + (ch(b, s) - ch(a, s)) * t) & 0xFF;
    return (m(16) << 16) | (m(8) << 8) | m(0);
  };
  const hex = c => '#' + (c & 0xFFFFFF).toString(16).padStart(6, '0');
  const WHITE = 0xFFFFFF, BLACK = 0x000000;
  const INK = 0x1E1C22;                         // BubbleService.INK (waveform bars, ✕, status words)
  function colors(accentKey) {
    const a = ACCENTS[accentKey] || ACCENTS.steel;
    const first = blend(a.dark, WHITE, 0.18), second = blend(a.dark, BLACK, 0.08);   // BubbleService.accentPair
    return {
      body: [first, second].map(hex),                                                  // dot + ✓ slot, TL→BR
      piece: hex(blend(0xC4C0CA, a.soft, 0.22)),                                       // BubbleService.pieceLight: ✕ and listening pill
      busy: [blend(first, WHITE, 0.42), blend(second, WHITE, 0.34)].map(hex),          // BubbleColors.busyWash (tidying pill)
      busySlot: [blend(a.dark, BLACK, 0.16), blend(a.dark, BLACK, 0.30)].map(hex),     // BubbleColors.busySlot (tidying ✓ slot)
      ink: hex(INK), mark: '#ffffff',
    };
  }

  // ---------------------------------------------------------------- the take, as a timeline (seconds)
  // App constants: TakeMotion (above), StatusPacer (FIRST_WORD 0.35, MIN_HOLD 0.9, SWAP 0.32), AppPrefs.statusPaceMs 1.3.
  // Scenario lengths (how long you talk, how long the tidy-up takes) are not app constants: rest 0.8 and
  // listening 2.1 are TakePreview's (unrollAt 0.8, tidyAt 2.9); tidying is longer than TakePreview's 1.6 s so a
  // hearing word, the G3 shimmer and a tidy word all play (the pacing rules decide the swap times).
  const PACE = 1.3, FIRST_WORD = 0.35, MIN_HOLD = 0.9, SWAP = 0.32;
  function timeline(o = {}) {
    const tap = o.tap ?? 0.8, processing = o.processing ?? 2.9, tidyStage = o.tidyStage ?? 4.1, done = o.done ?? 5.6;
    const words = [];
    // firstWord: FIRST_WORD_DELAY_MS after onProcessing, StatusPacer.start(rolling) → shown 0.32 s later
    const w0 = processing + FIRST_WORD;
    words.push({ at: w0, text: o.hearing ?? 'Listening back', shimmer: false, first: true });
    let shownAt = w0 + SWAP, tickFrom = w0;
    // hearing → tidying: stageSwapAt = max(now, shownAt + MIN_HOLD), with the G3 shimmer
    const st = Math.max(tidyStage, shownAt + MIN_HOLD);
    words.push({ at: st, text: o.tidy ?? 'Tidying up', shimmer: o.stageShimmer ?? true });
    shownAt = st + SWAP; tickFrom = st;
    // later pace ticks (nextSwapAt), only if they fall ≥ 0.4 s before done (DOT-MOTION-FINAL "no swap within 400 ms of done")
    const more = o.more ?? ['Fixing commas', 'Polishing'];
    for (const s of more) {
      const earliest = shownAt + MIN_HOLD, k = Math.max(1, Math.ceil((earliest - tickFrom) / PACE)), at = tickFrom + k * PACE;
      if (at > done - 0.4) break;
      words.push({ at, text: s, shimmer: false }); shownAt = at + SWAP; tickFrom = at;
    }
    const land = done + T1_LAND, unfoldAt = land + CHECK_READ;   // BubbleService.afterCheckRead
    const end = o.loop ?? (unfoldAt + CHECK_SECONDS + 0.8);
    return { tap, processing, done, swap: done + T1_SWAP, land, unfoldAt, unfoldEnd: unfoldAt + CHECK_SECONDS, loop: end, words, pillLag: o.pillLag ?? 0 };
  }

  // ---------------------------------------------------------------- waveform (BubblePreview.previewLevels, WaveformView WaveGeom)
  const NBARS = 11;
  function previewLevels(t) {
    const out = [];
    for (let i = 0; i < NBARS; i++) {
      const shape = Math.sin(Math.PI * (i + 0.5) / NBARS);
      out.push(clamp(shape * (0.45 + 0.4 * Math.sin(t * 7.3 + i * 1.7) * (0.6 + 0.4 * Math.sin(t * 3.1 + i * 0.9)))));
    }
    return out;
  }
  function waveBar(i, w, h, level, on) {
    const pad = w * 0.12, slot = (w - pad * 2) / NBARS, barW = slot * 0.36;
    const bh = Math.max(barW, level * h * 0.5) * on, cx = pad + slot * (i + 0.5), cy = h / 2;
    return [cx - barW / 2, cy - bh / 2, barW, bh];
  }

  // ---------------------------------------------------------------- status words (StatusWordsView.kt)
  const OUT_END = 0.14, SHIMMER_S = 0.6;
  const rollH = h => h * 115 / 300;
  function wordsState(t, tl, measure, pillMin, pillMax) {
    const h = DOT, list = tl.words;
    let idx = -1;
    for (let i = 0; i < list.length; i++) if (list[i].at <= t) idx = i;
    if (idx < 0) return null;
    const need = s => clamp(measure(s) + 0.8 * h, pillMin, Math.max(pillMin, pillMax));
    // width before each swap (widthNow carries over: a swap's spring ends at its widthTo after ≤ 1.2 s)
    let widthNow = pillMin;
    const ev = [];
    for (let i = 0; i <= idx; i++) {
      const w = list[i], from = i === 0 ? pillMin : (() => {
        const p = ev[i - 1], u = w.at - list[i - 1].at;
        return u > 1.2 ? p.to : p.widthAt(u);
      })();
      const to = need(w.text), shrinking = to < from, textW = measure(w.text);
      const widthAt = u => !shrinking ? spring(u, from, to, 0, 1, 600) : (u < OUT_END ? from : spring(u - OUT_END, from, to, 0, 1, 600));
      let inShift = 0;
      if (!shrinking) { const fit = Math.min(to, textW + 0.5 * h); let u = 0.07; while (u < 0.25 && widthAt(u) < fit - 0.5) u += 0.005; inShift = u; }
      ev.push({ from, to, widthAt, inShift });
    }
    const cur = list[idx], e = ev[idx], u = t - cur.at;
    widthNow = u > 1.2 ? e.to : e.widthAt(u);
    const hh = rollH(h), ui = u - e.inShift;
    const swapping = u <= 1.2;
    const oy = -hh * Math.pow(seg(u, 0, OUT_END), 3), oa = 1 - seg(u, 0.04, OUT_END);
    const ny = spring(ui - 0.06, hh, 0, 0, 0.5, 520), na = seg(ui, 0.06, 0.16);
    const v = Math.abs(springV(Math.max(0, ui - 0.06), hh, 0, 0, 0.5, 520)) * (300 / h);
    const old = idx > 0 && !cur.first ? list[idx - 1].text : null;
    return {
      width: widthNow,
      old: swapping && old ? { text: old, y: oy, a: oa } : null,
      cur: swapping ? { text: cur.text, y: ny, a: na, stretch: 1 + 0.22 * clamp(v / 2200) } : { text: cur.text, y: 0, a: 1, stretch: 1 },
      shimmer: cur.shimmer && u > 0 && u < SHIMMER_S ? u / SHIMMER_S : -1,
      readable: !swapping || ui >= 0.2,
    };
  }

  // ---------------------------------------------------------------- the whole state at time t (pure, given a text measurer)
  function state(tIn, opt = {}) {
    const tl = opt.tl || timeline(opt);
    const measure = opt.measure || (s => s.length * 6.2);   // fallback only; create() passes the real Nunito measurer
    const t = opt.loop === false ? tIn : ((tIn % tl.loop) + tl.loop) % tl.loop;
    const pillW = TAP_PILL * DOT, pillMax = opt.pillMax ?? WIDE_PILL * DOT;
    const s = {
      t, phase: 'rest', slotPose: REST, slotScale: 1, slotTint: 0, showBar: false,
      pillW, pillLen: 0, busyMix: 0, cancelScale: 0, bars: null, words: null, wordsAlpha: 1, wordsBlur: 0, waveAlpha: 1,
    };
    if (t < tl.tap) return s;
    if (t < tl.processing) {
      const tt = t - tl.tap, tp = tt - tl.pillLag;
      s.phase = tt < UNROLL_SECONDS ? 'unroll' : 'listening'; s.showBar = true;
      s.slotPose = pose({ check: TM.unrollCheck(tt) });
      s.pillLen = TM.unrollPill(tp, pillW, GAP) * pillW;
      s.cancelScale = TM.unrollCancel(tp);
      const lv = previewLevels(t);
      s.bars = lv.map((level, i) => ({ level, on: tp < 0 ? 0 : TM.unrollBar(tp, opt.side === 'left' ? i : NBARS - 1 - i) }));
      return s;
    }
    const busyAt = tp => accelDecel(seg(tp, 0, 0.2));   // busyMix and tintSlot: ValueAnimator 0→1, 200 ms
    if (t < tl.done) {
      const tp = t - tl.processing;
      s.phase = 'tidying'; s.showBar = true; s.cancelScale = 1;
      s.busyMix = busyAt(tp); s.slotTint = busyAt(tp);
      s.slotPose = slotTidyFromCheck(tp);
      s.words = wordsState(t, tl, measure, pillW, pillMax);
      s.pillW = s.words ? s.words.width : pillW; s.pillLen = s.pillW;
      return s;
    }
    if (t < tl.swap) {
      const τ = t - tl.done, wig = slotTidyFromCheck(tl.done - tl.processing);
      const w = wordsState(tl.done, tl, measure, pillW, pillMax);
      s.phase = 'reroll'; s.showBar = true;
      s.busyMix = busyAt(tl.done - tl.processing);
      s.pillW = w ? w.width : pillW;
      s.pillLen = TM.t1Pill(τ) * s.pillW;
      s.cancelScale = TM.t1Cancel(τ);
      s.slotPose = TM.slot(τ, wig);
      s.slotScale = TM.t1SlotScale(τ);
      s.slotTint = busyAt(tl.done - tl.processing) * (1 - TM.t1Tint(τ));
      if (w) {
        s.words = w;
        // a word fully readable blurs away (X4); one still coming in is cut in 60 ms (TakeMotion.textCut)
        if (w.readable) { s.wordsAlpha = TM.textAlpha(τ); s.wordsBlur = TM.textBlur(τ) * DOT / 300 * 1.7; }
        else s.wordsAlpha = 1 - seg(τ, 0, 0.06);
      } else s.waveAlpha = TM.textAlpha(τ);
      return s;
    }
    if (t < tl.unfoldAt) { s.phase = 'check'; s.slotPose = pose({ check: 1 }); return s; }
    if (t < tl.unfoldEnd) { s.phase = 'unfold'; s.slotPose = restUnfold(t - tl.unfoldAt); return s; }
    return s;
  }

  // ---------------------------------------------------------------- drawing (SVG, dp units)
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const f2 = v => (Math.round(v * 1000) / 1000).toString();
  let uid = 0;

  /** DotPainter.drawMark, body space (dot radius 150): the two leaves and the bar (or the ✓ fold). */
  function markParts(p) {
    const ck = clamp(p.check), shrink = 1 - clamp(ck * 2.2), len = BH - BW / 2;
    let bar, bw = BW;
    if (ck > 0) {
      const e = back(ck, 1.2);
      const ax = [0, 0, 0], ay = [len, 0, -len], bx = [-50, -16, 50], by = [2, 40, -42];
      bar = ax.map((_, i) => (i ? 'L' : 'M') + f2(lerp(ax[i], bx[i], e)) + ',' + f2(lerp(ay[i], by[i], e))).join(' ');
      bw = BW * lerp(1, 1.08, ck);
    } else if (p.barAmp !== 0) {
      const pts = [];
      for (let i = 0; i <= 36; i++) {
        const u = i / 36;
        pts.push((i ? 'L' : 'M') + f2(p.barAmp * Math.sin(p.barPh + u * p.barCyc * Math.PI * 2) * Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.35)) + ',' + f2(-len + u * 2 * len));
      }
      bar = pts.join(' ');
    } else bar = `M0,${f2(len)} L0,${f2(-len)}`;
    return {
      bar, bw, show: shrink > 0.01,
      left: `translate(${-LX},0) scale(${f2(p.lsx * shrink)},${f2(p.lsy * shrink)})`,
      right: `translate(${LX},0) scale(${f2(p.rsx * shrink)},${f2(p.rsy * shrink)})`,
    };
  }

  function create(host, o = {}) {
    const opt = Object.assign({ dotPx: 44, side: 'right', accent: 'steel', opacity: 0.85, fontFamily: 'Nunito', deviceDensity: 2 }, o);
    const id = 'kb' + (++uid);
    const PAD = 4;
    const VW = DOT + GAP + WIDE_PILL * DOT + GAP + DOT + PAD * 2, VH = DOT + PAD * 2;
    const svg = mk('svg', { viewBox: `0 0 ${VW} ${VH}`, width: VW * opt.dotPx / DOT, height: VH * opt.dotPx / DOT, 'aria-hidden': 'true' });
    svg.style.overflow = 'visible'; svg.style.display = 'block';
    const defs = mk('defs', {}, svg);
    const gBody = mk('linearGradient', { id: id + 'body', gradientUnits: 'userSpaceOnUse', x1: -22, y1: -22, x2: 22, y2: 22 }, defs);
    const gSlot = mk('linearGradient', { id: id + 'slot', gradientUnits: 'userSpaceOnUse', x1: -22, y1: -22, x2: 22, y2: 22 }, defs);
    const gBusy = mk('linearGradient', { id: id + 'busy', gradientUnits: 'userSpaceOnUse' }, defs);
    const gShim = mk('linearGradient', { id: id + 'shim', gradientUnits: 'userSpaceOnUse' }, defs);
    const stops = (g, n) => Array.from({ length: n }, (_, i) => mk('stop', { offset: n === 2 ? i : i / (n - 1) }, g));
    const sBody = stops(gBody, 2), sSlot = stops(gSlot, 2), sBusy = stops(gBusy, 2), sShim = stops(gShim, 3);
    sShim[0].setAttribute('stop-color', '#fff'); sShim[0].setAttribute('stop-opacity', 0);
    sShim[1].setAttribute('stop-color', '#fff'); sShim[1].setAttribute('stop-opacity', 0xA6 / 255);
    sShim[2].setAttribute('stop-color', '#fff'); sShim[2].setAttribute('stop-opacity', 0);
    const clip = mk('clipPath', { id: id + 'clip' }, defs);
    const clipR = mk('rect', {}, clip);
    const blur = mk('filter', { id: id + 'blur', x: '-50%', y: '-100%', width: '200%', height: '300%' }, defs);
    const blurE = mk('feGaussianBlur', { stdDeviation: 0 }, blur);

    // the whole window composited at the bubble's opacity (one layer, like the overlay's container alpha)
    const rootG = mk('g', {}, svg);
    const cancelG = mk('g', {}, rootG);
    const cancelC = mk('circle', { r: DOT / 2 }, cancelG);
    const iconS = (DOT - 2 * DOT * ICON_PAD) / 24;
    const cancelX = mk('path', { d: CLOSE_ICON, fill: 'none', 'stroke-width': 2.6, 'stroke-linecap': 'round', transform: `scale(${f2(iconS)}) translate(-12,-12)` }, cancelG);
    const pillG = mk('g', {}, rootG);
    const pillBase = mk('rect', {}, pillG), pillBusy = mk('rect', { fill: `url(#${id}busy)` }, pillG);
    const barsG = mk('g', {}, rootG);
    const barEls = Array.from({ length: NBARS }, () => mk('rect', {}, barsG));
    const wordsG = mk('g', { 'clip-path': `url(#${id}clip)` }, rootG);
    const textG = mk('g', {}, wordsG);
    const tOld = mk('text', { 'text-anchor': 'middle' }, textG), tCur = mk('text', { 'text-anchor': 'middle' }, textG);
    const shimR = mk('rect', { fill: `url(#${id}shim)` }, wordsG);
    const slotG = mk('g', {}, rootG);
    mk('circle', { r: DOT / 2, fill: `url(#${id}body)` }, slotG);
    const slotBusy = mk('circle', { r: DOT / 2, fill: `url(#${id}slot)` }, slotG);
    const markG = mk('g', { transform: `scale(${DOT / 300})` }, slotG);
    const leafL = mk('path', { d: LEAF }, markG), leafR = mk('path', { d: LEAF }, markG);
    const barP = mk('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, markG);
    host.appendChild(svg);

    let measureCtx = null;
    const cache = new Map();
    function measure(sTxt) {
      if (cache.has(sTxt)) return cache.get(sTxt);
      measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
      measureCtx.font = `700 ${TEXT_SP * 10}px ${opt.fontFamily}`;
      const w = measureCtx.measureText(sTxt).width / 10;
      if (document.fonts && document.fonts.status === 'loaded') cache.set(sTxt, w);
      return w;
    }
    let tl = timeline(opt);
    let col = null;
    function paintColors() {
      col = colors(opt.accent);
      sBody[0].setAttribute('stop-color', col.body[0]); sBody[1].setAttribute('stop-color', col.body[1]);
      sSlot[0].setAttribute('stop-color', col.busySlot[0]); sSlot[1].setAttribute('stop-color', col.busySlot[1]);
      sBusy[0].setAttribute('stop-color', col.busy[0]); sBusy[1].setAttribute('stop-color', col.busy[1]);
      cancelC.setAttribute('fill', col.piece); pillBase.setAttribute('fill', col.piece);
      cancelX.setAttribute('stroke', col.ink);
      barEls.forEach(b => b.setAttribute('fill', col.ink));
      [tOld, tCur].forEach(e => { e.setAttribute('fill', col.ink); e.setAttribute('font-family', opt.fontFamily); e.setAttribute('font-weight', 700); e.setAttribute('font-size', TEXT_SP); });
      leafL.setAttribute('fill', col.mark); leafR.setAttribute('fill', col.mark); barP.setAttribute('stroke', col.mark);
      rootG.setAttribute('opacity', opt.opacity);
    }
    paintColors();

    function render(time) {
      const s = state(time, { tl, measure, side: opt.side, pillMax: opt.pillMax });
      const right = opt.side !== 'left';
      // BubbleService.placeTap: [✕] gap [pill] gap [✓] with the ✓ where the dot rests
      const slotCx = right ? VW - PAD - DOT / 2 : PAD + DOT / 2, cy = PAD + DOT / 2;
      const pillL = right ? slotCx - DOT / 2 - GAP - s.pillW : slotCx + DOT / 2 + GAP;
      const cancelCx = right ? pillL - GAP - DOT / 2 : pillL + s.pillW + GAP + DOT / 2;
      slotG.setAttribute('transform', `translate(${f2(slotCx)},${f2(cy)}) scale(${f2(s.slotScale)})`);
      slotBusy.setAttribute('opacity', f2(s.slotTint));
      const m = markParts(s.slotPose);
      leafL.setAttribute('transform', m.left); leafR.setAttribute('transform', m.right);
      leafL.style.display = leafR.style.display = m.show ? '' : 'none';
      barP.setAttribute('d', m.bar); barP.setAttribute('stroke-width', f2(m.bw));
      cancelG.style.display = s.showBar && s.cancelScale > 0.001 ? '' : 'none';
      cancelG.setAttribute('transform', `translate(${f2(cancelCx)},${f2(cy)}) scale(${f2(Math.max(0, s.cancelScale))})`);
      // RollPillDrawable.visible: a capsule `length` long from the end nearest the dot
      const len = clamp(s.pillLen, 0, s.pillW), show = s.showBar && len >= 0.5;
      pillG.style.display = show ? '' : 'none';
      const x0 = right ? pillL + s.pillW - len : pillL, rx = Math.min(DOT / 2, len / 2);
      for (const r of [pillBase, pillBusy, clipR]) { r.setAttribute('x', f2(x0)); r.setAttribute('y', PAD); r.setAttribute('width', f2(len)); r.setAttribute('height', DOT); r.setAttribute('rx', f2(rx)); r.setAttribute('ry', DOT / 2); }
      pillBase.style.display = s.busyMix < 0.999 ? '' : 'none';
      pillBusy.setAttribute('opacity', f2(s.busyMix)); pillBusy.style.display = s.busyMix > 0.001 ? '' : 'none';
      gBusy.setAttribute('x1', f2(pillL)); gBusy.setAttribute('y1', PAD); gBusy.setAttribute('x2', f2(pillL + s.pillW)); gBusy.setAttribute('y2', PAD + DOT);
      // waveform: inside the full pill view (WaveGeom), not clipped to the unrolled length (as WaveformView)
      barsG.style.display = s.bars && s.showBar ? '' : 'none';
      barsG.setAttribute('opacity', f2(s.waveAlpha));
      if (s.bars) s.bars.forEach((b, i) => {
        const e = barEls[i];
        if (b.on <= 0.01) { e.style.display = 'none'; return; }
        const [x, y, w, h] = waveBar(i, s.pillW, DOT, b.level, b.on);
        e.style.display = '';
        e.setAttribute('x', f2(pillL + x)); e.setAttribute('y', f2(PAD + y)); e.setAttribute('width', f2(w)); e.setAttribute('height', f2(h));
        e.setAttribute('rx', f2(w / 2)); e.setAttribute('opacity', f2(b.on));
      });
      // status words: centred in the pill view, baseline from Nunito's ascent/descent (1011/-353 per 1000)
      const W = s.words;
      wordsG.style.display = W && show ? '' : 'none';
      if (W) {
        const cx = pillL + s.pillW / 2, base = 0.329 * TEXT_SP;  // (1.011 - (1.011 + 0.353) / 2) * size
        textG.setAttribute('opacity', f2(s.wordsAlpha));
        // RenderEffect.createBlurEffect(radius): hwui turns the radius into sigma = 0.57735 * r + 0.5 px
        blurE.setAttribute('stdDeviation', f2(s.wordsBlur > 0 ? 0.57735 * s.wordsBlur + 0.5 / opt.deviceDensity : 0));
        textG.setAttribute('filter', s.wordsBlur > 0.05 ? `url(#${id}blur)` : '');
        const put = (el, p) => {
          if (!p || p.a <= 0.01) { el.style.display = 'none'; return; }
          el.style.display = ''; el.textContent = p.text; el.setAttribute('opacity', f2(p.a));
          const yc = cy + p.y;
          el.setAttribute('x', f2(cx)); el.setAttribute('y', f2(yc + base));
          el.setAttribute('transform', p.stretch && p.stretch !== 1 ? `translate(0,${f2(yc)}) scale(1,${f2(p.stretch)}) translate(0,${f2(-yc)})` : '');
        };
        put(tOld, W.old); put(tCur, W.cur);
        // G3 shimmer (StatusWordsView.onDraw): a skewed light band from Dot's end across the pill
        if (W.shimmer > 0 && W.shimmer < 1) {
          const g = W.shimmer, near = right ? x0 + len : x0, far = right ? x0 : x0 + len;
          const x = lerp(near, far, eInOut(g)), bw = DOT * 0.6;
          gShim.setAttribute('x1', f2(x - bw / 2)); gShim.setAttribute('x2', f2(x + bw / 2)); gShim.setAttribute('y1', 0); gShim.setAttribute('y2', 0);
          shimR.setAttribute('x', f2(x - bw / 2)); shimR.setAttribute('y', PAD); shimR.setAttribute('width', f2(bw)); shimR.setAttribute('height', DOT);
          // canvas.skew(-0.32, 0); canvas.translate(cy * 0.32, 0) with cy the view's half height, in pill-view space
          shimR.setAttribute('transform', `translate(0,${PAD}) skewX(${f2(Math.atan(-0.32) * 180 / Math.PI)}) translate(${f2(DOT / 2 * 0.32)},${-PAD})`);
          shimR.setAttribute('opacity', f2(Math.sin(Math.PI * g)));
          shimR.style.display = '';
        } else shimR.style.display = 'none';
      }
      return s;
    }
    return {
      svg, render, measure,
      get timeline() { return tl; },
      set(o2) { Object.assign(opt, o2); tl = timeline(opt); cache.clear(); paintColors(); },
      layout: { VW, VH, PAD },
    };
  }

  function fontReady(family = 'Nunito') {
    if (!document.fonts) return Promise.resolve();
    return document.fonts.load(`700 ${TEXT_SP}px ${family}`).then(() => document.fonts.ready);
  }

  root.KisuBubble = { create, state, timeline, colors, ACCENTS, fontReady, TakeMotion: TM, geom: { DOT, GAP, TAP_PILL, WIDE_PILL, TEXT_SP } };
})(typeof window !== 'undefined' ? window : globalThis);
