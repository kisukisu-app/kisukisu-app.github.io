/* KisuKisu homepage prototype: scroll-driven motion, no framework.
   - one rAF-throttled, passive scroll listener drives every scrubbed section (reads first, then writes)
   - IntersectionObserver turns scrubbers on/off and fires one-shot reveals and timelines
   - only transform / opacity / class toggles per frame (text typing is the one exception, in tiny boxes)
   Accent maths (themeFor / bubbleFor) are copied from brag-output/work/tpl-common.js (ui/Theme.kt). */
(() => {
  'use strict';
  const doc = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (x, a, b) => clamp((x - a) / (b - a));
  const lerp = (a, b, x) => a + (b - a) * x;
  const eIO = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (RM) doc.classList.add('rm');
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');

  // ===================================================================== accents (Theme.kt)
  const ACCENTS = {
    steel:  { dark: '#4682B4', light: '#36648B', soft: '#7FA7CC', label: 'Steel blue' },
    copper: { dark: '#D9A184', light: '#9A5B3C', soft: '#E8C2AE', label: 'Copper' },
    sage:   { dark: '#8FA377', light: '#55693F', soft: '#B7C6A5', label: 'Sage' },
    violet: { dark: '#9B8CE6', light: '#5B4BB0', soft: '#C3B9F2', label: 'Violet' },
    rose:   { dark: '#E08A9A', light: '#A8445A', soft: '#EFB8C2', label: 'Rose' },
  };
  const hx = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const toHex = c => '#' + c.map(v => Math.trunc(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  const mixC = (a, b, t) => { const A = hx(a), B = hx(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
  const rgbOf = h => hx(h).join(',');
  const lumOf = h => { const [r, g, b] = hx(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
  const contrastOf = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const reach = (from, to, bg, target) => { for (let i = 0; i <= 100; i++) { const c = mixC(from, to, i / 100); if (contrastOf(c, bg) >= target) return c; } return to; };
  // steel = the live site's exact tokens; other accents are derived with the same relationships
  const STEEL = {
    light: { bg: '#EAF0F5', dots: '#D2DCE6', ink: '#16202B', ink2: '#5B6B7C', accent: '#2F6A9C', card: '#FFFFFF', line: '#DCE4EC', shadow: 'rgba(30,60,90,.16)', pop: '#D6E6F3' },
    dark:  { bg: '#0E1116', dots: '#1F252D', ink: '#EEF2F6', ink2: '#93A1B0', accent: '#8DB6DC', card: '#161B22', line: '#28303A', shadow: 'rgba(0,0,0,.5)', pop: 'rgba(110,156,198,.28)' },
  };
  const TEXT_TARGET = { light: contrastOf('#2F6A9C', '#EAF0F5'), dark: contrastOf('#8DB6DC', '#0E1116') };
  function themeFor(key, theme) {
    if (key === 'steel') return STEEL[theme];
    const a = ACCENTS[key];
    if (theme === 'light') {
      const bg = mixC('#FFFFFF', a.soft, .17);
      return { bg, dots: mixC(bg, a.light, .13), ink: mixC('#15191E', a.light, .12), ink2: mixC('#5E6670', a.light, .25),
        accent: reach(a.dark, a.light, bg, TEXT_TARGET.light), card: '#FFFFFF', line: mixC(bg, a.light, .1),
        shadow: `rgba(${rgbOf(mixC(a.dark, '#000000', .6))},.16)`, pop: mixC(a.soft, '#FFFFFF', .5) };
    }
    const bg = mixC('#0D0F12', a.dark, .035);
    return { bg, dots: mixC('#1C1F24', a.dark, .07), ink: mixC('#F2F2F2', a.soft, .06), ink2: mixC('#969CA4', a.soft, .22),
      accent: reach(a.soft, '#FFFFFF', bg, TEXT_TARGET.dark), card: mixC('#15171B', a.dark, .045), line: mixC('#25282D', a.dark, .09),
      shadow: 'rgba(0,0,0,.5)', pop: `rgba(${rgbOf(mixC(a.dark, '#FFFFFF', .22))},.28)` };
  }
  // BubbleService: dot / ✓ = accent lightened 18 % → darkened 8 %; busy = that pair washed toward white; pieces = #C4C0CA nudged to soft
  function bubbleFor(key) {
    const a = ACCENTS[key], c1 = mixC(a.dark, '#FFFFFF', .18), c2 = mixC(a.dark, '#000000', .08);
    if (key === 'steel') return { chk: 'linear-gradient(135deg,#6798C1,#4078A6)', wash: 'linear-gradient(135deg,#A7C3DB,#81A6C4)', piece: '#B5BACA',
      lite: '110,156,198', logo: ['#6E9CC6', mixC('#6E9CC6', '#3F76A4', .55), '#3F76A4'] };
    return { chk: `linear-gradient(135deg,${c1},${c2})`, wash: `linear-gradient(135deg,${mixC(c1, '#FFFFFF', .42)},${mixC(c2, '#FFFFFF', .34)})`,
      piece: mixC('#C4C0CA', a.soft, .22), lite: rgbOf(mixC(a.dark, '#FFFFFF', .22)), logo: [a.soft, a.dark, a.light] };
  }
  // apps on the phone don't wear KisuKisu's accent: steel keeps the reels' blue-grey, other accents go neutral
  const SYS = { steel: { out: '#34465A', round: '#3D6E8F', ent: '#8AB4D6' }, other: { out: '#3A3F47', round: '#4A515A', ent: '#C3C8CE' } };
  let ACC = 'steel';
  function applyAccent(key, save) {
    if (!ACCENTS[key]) key = 'steel';
    ACC = key;
    const theme = darkMQ.matches ? 'dark' : 'light', T = themeFor(key, theme), B = bubbleFor(key), a = ACCENTS[key];
    const sys = key === 'steel' ? SYS.steel : SYS.other;
    const v = { '--bg': T.bg, '--dots': T.dots, '--ink': T.ink, '--ink2': T.ink2, '--accent': T.accent, '--card': T.card, '--line': T.line,
      '--shadow': T.shadow, '--pop': T.pop, '--acc': a.dark, '--acc-rgb': rgbOf(a.dark), '--lite-rgb': B.lite,
      '--chk-g': B.chk, '--wash': B.wash, '--piece': B.piece, '--lg0': B.logo[0], '--lg1': B.logo[1], '--lg2': B.logo[2],
      '--sys-out': sys.out, '--sys-round': sys.round, '--sys-ent': sys.ent };
    for (const k in v) doc.style.setProperty(k, v[k]);
    const tc = $('meta[name="theme-color"]'); if (tc) tc.content = T.bg;
    $$('.swatches .sw').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.accent === key)));
    if (save) { try { localStorage.setItem('kk-accent', key); } catch (e) { /* storage blocked: the choice just won't stick */ } }
  }
  let saved = null;
  try { saved = localStorage.getItem('kk-accent'); } catch (e) { saved = null; }
  applyAccent(saved || 'steel', false);
  darkMQ.addEventListener?.('change', () => applyAccent(ACC, false));
  $$('.swatches .sw').forEach(b => b.addEventListener('click', () => applyAccent(b.dataset.accent, true)));

  // ===================================================================== copy (real cleanup outputs)
  const KK = window.KKText;
  const RAW = "Um, I'm running fifteen minutes late. Uh, can we push the call to two, I mean three pm?";
  const CLEAN = KK.process(RAW);            // "I'm running 15 minutes late. Can we push the call to 3 pm?"
  const OFF_RAW = 'Um, I land at six, I mean seven pm. Uh, can you pick me up?';
  const OFF_CLEAN = KK.process(OFF_RAW);    // "I land at 7 pm. Can you pick me up?"
  const HES = /^(um+|uh+|uhm+|hm+|mm+|mhm+|erm+|er)\W*$/i;
  // raw words tagged for the animation: f = filler, c = correction, n = number (with its digits), k = kept
  function tagTokens(raw) {
    const t = KK.explain(raw).tokens, out = [];
    for (let i = 0; i < t.length; i++) {
      const x = t[i];
      if (x.kind === 'keep') out.push({ w: x.t, k: 'k' });
      else if (x.kind === 'drop' && t[i + 1] && t[i + 1].kind === 'add') { out.push({ w: x.t, k: 'n', d: t[i + 1].t }); i++; }
      else if (x.kind === 'drop') out.push({ w: x.t, k: HES.test(x.t) ? 'f' : 'c' });
    }
    return out;
  }
  const TOK = tagTokens(RAW);
  const hiDigits = s => esc(s).replace(/\d+/g, '<span class="dgt">$&</span>');

  // ===================================================================== phone + bubble markup
  const MARK = '<svg viewBox="0 0 100 100"><use href="#kk-mark"/></svg>';
  const ic = {
    back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#E8EAED" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    video: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#E8EAED"><path d="M4 6h11a2 2 0 0 1 2 2v1.5l4-2.5v10l-4-2.5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>',
    call: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#E8EAED"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
    more: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#E8EAED"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    smile: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9AA0A6" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" stroke-linecap="round"/><circle cx="9" cy="10" r="1" fill="#9AA0A6"/><circle cx="15" cy="10" r="1" fill="#9AA0A6"/></svg>',
    clip: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9AA0A6" stroke-width="2" stroke-linecap="round"><path d="M16.5 6.5l-7.8 7.8a2 2 0 0 0 2.8 2.8l8-8a4 4 0 0 0-5.6-5.6l-8 8a6 6 0 0 0 8.5 8.5L20 14.4"/></svg>',
    mic: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    send: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg>',
    wifi: '<svg class="wifi" width="17" height="17" viewBox="0 0 24 24" fill="#E8EAED"><path d="M12 20l-3.5-4.3a5.5 5.5 0 0 1 7 0zM12 3C7.6 3 3.6 4.6.5 7.3l2.6 3.2A11.5 11.5 0 0 1 12 7.1c3.4 0 6.5 1.3 8.9 3.4l2.6-3.2A17.4 17.4 0 0 0 12 3z"/></svg>',
    plane: '<svg class="plane" width="17" height="17" viewBox="0 0 24 24" fill="#E8EAED"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>',
    battery: '<svg width="24" height="14" viewBox="0 0 26 14"><rect x="0.5" y="0.5" width="22" height="13" rx="3.5" fill="none" stroke="#E8EAED"/><rect x="2.5" y="2.5" width="16" height="9" rx="2" fill="#E8EAED"/><rect x="23.5" y="4.5" width="2" height="5" rx="1" fill="#E8EAED"/></svg>',
    pen: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#E8EAED" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  };
  const K = 430 / 1080, S = 115 * K, PILL = 264 * K;
  const cv = document.createElement('canvas').getContext('2d');
  const tw = s => { cv.font = '700 12.5px Nunito'; return cv.measureText(s).width; };
  function bubbleHTML(top) {
    let bars = '';
    for (let i = 0; i < 11; i++) {
      const sh = Math.sin(Math.PI * (i + .5) / 11);
      bars += `<i style="--h:${(3.2 + 20 * sh).toFixed(1)}px;--du:${(.32 + ((i * 37) % 11) * .025).toFixed(3)}s;--de:-${((i * 53) % 17 * .04).toFixed(2)}s"></i>`;
    }
    const r = S * .31, c = S / 2;
    return `<div class="kkb" data-s="rest" style="top:${top}px">
      <div class="pc x"><svg width="${S * .4}" height="${S * .4}" viewBox="0 0 24 24" fill="none" stroke="#1E1C22" stroke-width="2.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></div>
      <div class="pc pill"><i class="bga"></i><i class="bgb"></i><div class="wv">${bars}</div><span class="st"></span></div>
      <div class="pc ok"><i class="bga"></i><i class="bgb"></i>
        <span class="ico i-chk"><svg width="${S * .42}" height="${S * .42}" viewBox="0 0 24 24" fill="none" stroke="#E8EEF4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
        <span class="ico i-spin"><svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><path fill="none" stroke="#1E1C22" stroke-width="2.4" stroke-linecap="round" d="M ${c + r} ${c} A ${r} ${r} 0 0 1 ${c} ${c + r}"/></svg></span>
        <span class="ico i-done"><svg width="${S * .42}" height="${S * .42}" viewBox="0 0 24 24" fill="none" stroke="#1E1C22" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span></div>
      <div class="pc dot">${MARK}</div></div>`;
  }
  // state: rest | press | tap | busy (with status word) | done
  function setBubble(el, s, word) {
    if (!el) return;
    if (s === 'busy' || s === 'done') {
      const w = word || el._word || 'Almost there';
      el._word = w;
      const st = el.querySelector('.st');
      if (st.textContent !== w) st.textContent = w;
      el.style.setProperty('--pw', Math.max(PILL, tw(w) + 30 * K * 2.6).toFixed(1) + 'px');
    } else el.style.setProperty('--pw', PILL.toFixed(1) + 'px');
    if (el.dataset.s !== s) el.dataset.s = s;
  }
  const KBTOP = 932 - 322, BUBY = 440;
  function statusBar() {
    return `<div class="sbar"><span>9:41</span><span class="ic">${ic.plane}${ic.wifi}<span class="bars"><i></i><i></i><i></i><i></i></span>${ic.battery}</span></div>`;
  }
  function keyboard() {
    const r1 = 'qwertyuiop'.split(''), r2 = 'asdfghjkl'.split(''), r3 = 'zxcvbnm'.split('');
    const k = c => `<div class="key">${c}</div>`;
    return `<div class="kb"><div class="kbtools"><span>☺</span><span style="border:1.6px solid #9AA0A6;border-radius:5px;padding:0 4px">GIF</span><span>⚙</span><span>⋯</span></div>
      <div class="krow">${r1.map(k).join('')}</div><div class="krow">${r2.map(k).join('')}</div>
      <div class="krow"><div class="key fn" style="flex-basis:52px">⇧</div>${r3.map(k).join('')}<div class="key fn" style="flex-basis:52px">⌫</div></div>
      <div class="krow"><div class="key fn" style="flex-basis:60px">?123</div><div class="key fn">,</div><div class="key fn" style="flex-basis:37px">☺</div><div class="key sp">English</div><div class="key fn">.</div><div class="key ent" style="flex-basis:60px">↵</div></div>
      <div class="navpill"></div></div>`;
  }
  const field = ph => `<div class="inputrow"><div class="field">${ic.smile}<span class="txt"><span class="typed"></span><span class="ph">${ph}</span></span>${ic.clip}</div><div class="round">${ic.mic}</div></div>`;
  const msgs = list => `<div style="position:absolute;left:0;right:0;bottom:${932 - (BUBY - 14)}px;display:flex;flex-direction:column;gap:10px">
      <div class="day" style="position:static">Today</div>${list.map(m => `<div class="msg ${m[0]}" style="position:relative;left:auto;right:auto;align-self:${m[0] === 'in' ? 'flex-start' : 'flex-end'};margin:0 12px">${esc(m[1])}<div class="meta">${m[2]}</div></div>`).join('')}</div>`;
  const SCREENS = {
    chat: (o = {}) => `${statusBar()}<div class="appbar">${ic.back}<div class="av" style="background:${o.avc || '#6E8B5E'}">${o.who ? o.who[0] : 'P'}</div><div style="flex:1"><div class="t1">${o.who || 'Priya'}</div><div class="t2">${o.sub || 'online'}</div></div>${ic.video}<span style="width:10px"></span>${ic.call}<span style="width:6px"></span>${ic.more}</div>
      ${msgs(o.msgs || [['in', 'Still on for the 2 pm call?', '9:38']])}${field('Message')}${keyboard()}`,
    email: () => `${statusBar()}<div class="appbar">${ic.back}<div style="flex:1" class="t1">Compose</div>${ic.clip}<span style="width:12px"></span>${ic.send}<span style="width:6px"></span>${ic.more}</div>
      <div class="efield" style="top:110px"><span>From</span><span>me</span></div>
      <div class="efield" style="top:160px"><span>To</span><span class="chipme"><i>P</i>Priya</span></div>
      <div class="efield" style="top:210px"><span style="width:auto;color:#E8EAED">Today's call</span></div>
      <div class="ebody" style="top:278px"><span class="typed"></span><span class="ph" style="color:#9AA0A6">Compose email</span></div>${keyboard()}`,
    notes: () => `${statusBar()}<div class="appbar">${ic.back}<div style="flex:1" class="t1">Notes</div>${ic.pen}<span style="width:12px"></span>${ic.more}</div>
      <div class="notes-t"><h4>Monday</h4><div class="d">Today · 9:41</div><div class="bd"><p>Pick up dry cleaning</p><p><span class="typed"></span><span class="ph" style="color:#6c737b">Note</span></p></div></div>${keyboard()}`,
  };
  function buildPhone(el, kind, o) {
    el.innerHTML = `<div class="device"><div class="screen"><div class="cam"></div>${SCREENS[kind](o)}${bubbleHTML(BUBY)}<div class="finger" style="left:${430 - 10.75 - S / 2 - 28}px;top:${BUBY + S / 2 - 28}px"></div></div></div>`;
    return { root: el, bub: $('.kkb', el), typed: $('.typed', el), round: $('.round', el), finger: $('.finger', el), bars: $$('.sbar .bars i', el) };
  }
  function setTyped(P, s) {
    if (P.typed.textContent !== s) P.typed.textContent = s;
    if (P.round) P.round.innerHTML = s ? ic.send : ic.mic;
  }
  // a dictation, start to finish, in real time (used where it isn't scrubbed)
  async function dictate(P, text, alive = () => true) {
    const steps = [
      () => { setBubble(P.bub, 'rest'); setTyped(P, ''); }, 600,
      () => { P.finger.classList.add('on'); setBubble(P.bub, 'press'); }, 220,
      () => { setBubble(P.bub, 'tap'); }, 260,
      () => P.finger.classList.remove('on'), 1600,
      () => { P.finger.classList.add('on'); }, 200,
      () => { P.finger.classList.remove('on'); setBubble(P.bub, 'busy', 'Listening back'); }, 650,
      () => setBubble(P.bub, 'busy', 'Tidying up'), 650,
      () => setBubble(P.bub, 'busy', 'Almost there'), 500,
      () => setBubble(P.bub, 'done'), 250,
    ];
    for (let i = 0; i < steps.length; i += 2) { if (!alive()) return false; steps[i](); await sleep(steps[i + 1]); }
    const t0 = performance.now(), dur = 900;
    await new Promise(res => { const f = now => { if (!alive()) return res(); const x = clamp((now - t0) / dur); setTyped(P, text.slice(0, Math.round(text.length * x))); x < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
    await sleep(350);
    setBubble(P.bub, 'rest');
    return true;
  }

  // ===================================================================== scroll engine
  const scrubs = [];
  let ticking = false, vh = innerHeight;
  const io = new IntersectionObserver(es => { for (const e of es) { const s = scrubs.find(x => x.el === e.target); if (s) s.vis = e.isIntersecting; } kick(); }, { rootMargin: '25% 0px' });
  function scrub(el, mode, fn) { if (!el) return; const s = { el, mode, fn, vis: false, last: -1, stageH: 0, stageTop: 0 }; scrubs.push(s); measure(s); io.observe(el); }
  function measure(s) { if (s.mode === 'pin') { const st = s.el.firstElementChild; s.stageH = st.offsetHeight; s.stageTop = parseFloat(getComputedStyle(st).top) || 0; } }
  function frame() {
    ticking = false;
    const live = scrubs.filter(s => s.vis);
    const reads = live.map(s => s.el.getBoundingClientRect());           // all reads first
    live.forEach((s, i) => {                                               // then all writes
      const r = reads[i];
      const p = s.mode === 'pin' ? clamp((s.stageTop - r.top) / Math.max(1, r.height - s.stageH)) : clamp((vh - r.top) / (vh * .8));
      if (Math.abs(p - s.last) > 1e-4) { s.last = p; s.fn(p); }
    });
  }
  function kick() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', () => { vh = innerHeight; scrubs.forEach(s => { measure(s); s.last = -1; }); onResize.forEach(f => f()); kick(); }, { passive: true });
  const onResize = [];
  const revealIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
  $$('.reveal').forEach(el => revealIO.observe(el));
  // run a callback while an element is (mostly) on screen
  function watch(el, on, off, threshold = .45) {
    if (!el) return;
    new IntersectionObserver(es => es.forEach(e => (e.isIntersecting ? on : off)?.()), { threshold }).observe(el);
  }

  // ===================================================================== 1. hero
  const hero = { copy: $('.hero-copy'), phoneWrap: $('.hero-phone'), card: $('.hero-card-wrap'), tcard: $('.tcard'), stream: $('[data-stream="hero"]'),
    out: $('.tcard-out'), chips: $('.chips'), stage: $('.hero-stage') };
  const heroP = buildPhone($('[data-phone="hero"]'), 'chat');
  hero.stream.innerHTML = TOK.map(t => `<span class="wd${t.k === 'f' ? ' f' : t.k === 'c' ? ' c' : ''}">${esc(t.w)}</span>`).join(' ');
  $('[data-clean="hero"]').textContent = CLEAN;
  const heroWords = $$('.wd', hero.stream);
  let HG = {};
  function heroGeom() {
    const sh = hero.stage.offsetHeight, sw = hero.stage.offsetWidth;
    const ps = sw < 700 ? .56 : clamp((sh - 140) / 952, .5, .66);
    heroP.root.style.setProperty('--ps', ps);
    const ph = 952 * ps, copyH = hero.copy.offsetHeight + 34;
    HG = { sh, ph, ps, y0: copyH + 22, yC: Math.max(18, (sh - ph) / 2), yF: -ph * .38, cardH: hero.card.offsetHeight, copyH };
  }
  heroGeom(); onResize.push(heroGeom);
  function heroFrame(p) {
    const a = eIO(seg(p, 0, .3)), b = eIO(seg(p, .28, .52));
    const y = lerp(lerp(HG.y0, HG.yC, a), HG.yF, b), sc = lerp(1, .78, b);
    hero.phoneWrap.style.transform = `translate3d(-50%,${y.toFixed(1)}px,0) scale(${sc.toFixed(3)})`;
    hero.phoneWrap.style.opacity = (1 - .15 * b).toFixed(3);
    hero.copy.style.transform = `translate3d(0,${(-a * HG.copyH * .45).toFixed(1)}px,0)`;
    hero.copy.style.opacity = (1 - seg(p, .02, .22)).toFixed(3);
    hero.copy.style.visibility = p > .23 ? 'hidden' : '';
    const cy = lerp(HG.sh * .62, 0, b);
    hero.card.style.transform = `translate3d(-50%,calc(-50% + ${(cy + HG.sh * .04).toFixed(1)}px),0) scale(${lerp(.92, 1, b).toFixed(3)})`;
    hero.card.style.opacity = seg(p, .3, .45).toFixed(3);
    const n = Math.round(seg(p, .5, .86) * heroWords.length);
    heroWords.forEach((w, i) => { w.classList.toggle('on', i < n); w.classList.toggle('last', i === n - 1 && n < heroWords.length); });
    hero.tcard.classList.toggle('streaming', n > 0 && n < heroWords.length);
    hero.out.classList.toggle('on', p > .88);
    hero.chips.classList.toggle('on', p > .91);
    heroLoopOn = p < .26;
  }
  // the phone runs a real dictation on a loop while it is the thing on screen
  let heroLoopOn = true, heroRunning = false;
  async function heroLoop() {
    if (heroRunning) return; heroRunning = true;
    await sleep(900);
    while (heroLoopOn && !document.hidden) { await dictate(heroP, CLEAN, () => heroLoopOn); await sleep(2600); }
    heroRunning = false;
  }
  if (RM) {
    setBubble(heroP.bub, 'rest'); setTyped(heroP, CLEAN);
    heroWords.forEach(w => w.classList.add('on')); hero.out.classList.add('on'); hero.chips.classList.add('on');
  } else {
    scrub($('.hero-pin'), 'pin', p => { heroFrame(p); if (heroLoopOn) heroLoop(); });
    heroFrame(0); heroLoop();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && heroLoopOn) heroLoop(); });
  }

  // ===================================================================== 2. how it works
  function buildVis(el) {
    el.innerHTML = `<div class="v-crop"><div class="device"><div class="screen"><div class="cam"></div>${SCREENS.chat()}${bubbleHTML(BUBY)}
      <div class="finger" style="left:${430 - 10.75 - S / 2 - 28}px;top:${BUBY + S / 2 - 28}px"></div></div></div></div>
      <div class="v-hint">Tap the bubble</div>
      <div class="v-card hide" style="top:auto;bottom:16px"><div class="tag"><span class="lbl">You say</span><span class="tag acc st2" style="margin:0"></span></div>
        <div class="v-text"><div class="v-raw">${TOK.map(t => t.k === 'n'
          ? `<span class="t n"><span class="wd2">${esc(t.w)}</span><span class="dg">${esc(t.d)}</span></span>`
          : `<span class="t ${t.k}">${esc(t.w)}</span>`).join(' ')}</div><div class="v-clean">${hiDigits(CLEAN)}</div></div></div>
      <div class="v-done"><span class="tick">✓</span> Typed into the box</div>`;
    const crop = $('.device', el);
    return { el, bub: $('.kkb', el), finger: $('.finger', el), card: $('.v-card', el), lbl: $('.lbl', el), st2: $('.st2', el), text: $('.v-text', el),
      toks: $$('.v-raw .t', el), hint: $('.v-hint', el), done: $('.v-done', el), typed: $('.typed', crop), round: $('.round', crop), k: -1 };
  }
  function renderVis(V, k, t) {
    const P = { typed: V.typed, round: V.round };
    V.hint.classList.toggle('hide', k !== 0 || t > .55);
    V.card.classList.toggle('hide', k === 0 || k === 3);
    V.done.classList.toggle('on', k === 3 && t > .62);
    if (k !== 3) setTyped(P, '');
    const toks = V.toks, N = toks.length;
    if (k === 0) {
      V.finger.classList.toggle('on', t > .28 && t < .58);
      setBubble(V.bub, t < .3 ? 'rest' : t < .42 ? 'press' : 'tap');
    } else V.finger.classList.remove('on');
    if (k === 1) {
      setBubble(V.bub, 'tap');
      V.lbl.textContent = 'You say'; V.st2.textContent = '';
      V.text.classList.remove('clean');
      const n = Math.round(clamp(t / .92) * N);
      toks.forEach((x, i) => { x.classList.toggle('hid', i >= n); x.classList.toggle('last', i === n - 1 && n < N); x.classList.remove('cut', 'dig'); });
    }
    if (k === 2) {
      const word = t < .34 ? 'Listening back' : t < .67 ? 'Tidying up' : 'Almost there';
      setBubble(V.bub, 'busy', word);
      V.lbl.textContent = 'Cleaning up'; V.st2.textContent = '';
      toks.forEach(x => { x.classList.remove('hid', 'last'); });
      toks.forEach((x, i) => {
        const c = TOK[i].k;
        x.classList.toggle('cut', (c === 'f' && t > .12) || (c === 'c' && t > .34));
        x.classList.toggle('dig', c === 'n' && t > .52);
      });
      V.text.classList.toggle('clean', t > .76);
      if (t > .76) V.lbl.textContent = 'It types';
    }
    if (k === 3) {
      setBubble(V.bub, t < .14 ? 'busy' : t < .5 ? 'done' : 'rest', 'Almost there');
      const x = seg(t, .14, .5);
      setTyped(P, CLEAN.slice(0, Math.round(CLEAN.length * x)));
    }
  }
  const howSteps = $$('.steps li'), stepsOl = $('.steps');
  const desk = buildVis($('[data-vis="desk"]'));
  const deskMQ = matchMedia('(min-width: 900px) and (min-height: 561px)');
  if (!RM) {
    scrub($('.how-pin'), 'pin', p => {
      if (!deskMQ.matches) return;
      const k = Math.min(3, Math.floor(p * 4)), t = clamp((p * 4 - k) / .8);
      howSteps.forEach((li, i) => { li.classList.toggle('act', i === k); li.classList.toggle('done', i < k); });
      stepsOl.style.setProperty('--prog', clamp(p * 1.06).toFixed(3));
      renderVis(desk, k, t);
    });
  }
  // phones (and reduced motion): each step carries its own visual, played once it scrolls into view
  howSteps.forEach((li, k) => {
    const V = buildVis($('.vis', li));
    if (RM) { renderVis(V, k, k === 0 ? 1 : 1); return; }
    renderVis(V, k, 0);
    let raf = 0, t0 = 0;
    const dur = [2600, 4200, 4200, 3200][k];
    watch(V.el, () => {
      if (deskMQ.matches) return;
      cancelAnimationFrame(raf); t0 = performance.now();
      const f = now => { const t = clamp((now - t0) / dur); renderVis(V, k, t); if (t < 1) raf = requestAnimationFrame(f); };
      raf = requestAnimationFrame(f);
    }, () => { cancelAnimationFrame(raf); renderVis(V, k, 0); }, .55);
  });

  // ===================================================================== 3. one bubble, every app
  const appPh = ['chat', 'email', 'notes'].map(kind => buildPhone($(`[data-phone="${kind}"]`), kind));
  const appsRow = $('[data-apps]');
  if (RM) { appsRow.classList.add('in'); appPh.forEach(P => setTyped(P, CLEAN)); }
  else {
    let appsGo = 0;
    watch(appsRow, () => {
      appsRow.classList.add('in');
      const id = ++appsGo;
      appPh.forEach(async (P, i) => { setTyped(P, ''); await sleep(500 + i * 900); if (id === appsGo) await dictate(P, CLEAN, () => id === appsGo); });
    }, () => { appsGo++; }, .35);
  }

  // ===================================================================== 4. offline
  const offP = buildPhone($('[data-phone="offline"]'), 'chat', { who: 'Dad', avc: '#8E6F5A', sub: 'last seen today', msgs: [['in', 'What time do you land?', '17:02']] });
  const qsRows = $$('.qs-row'), qsBars = $$('.qs-card .bars i'), toast = $('.toast');
  const planeIc = $('.sbar .plane', offP.root), wifiIc = $('.sbar .wifi', offP.root);
  let offTyped = false, offRun = 0;
  function offFrame(p) {
    [.16, .22, .28, .34].forEach((th, i) => { const off = p > th; offP.bars[3 - i].classList.toggle('off', off); qsBars[3 - i].classList.toggle('off', off); });
    qsRows[2].classList.toggle('on', p > .34);
    wifiIc.style.opacity = p > .4 ? '0' : '1';
    qsRows[1].classList.toggle('on', p > .4);
    const plane = p > .48;
    qsRows[0].classList.toggle('on', plane);
    planeIc.style.opacity = plane ? '1' : '0'; planeIc.style.transform = plane ? 'scale(1)' : 'scale(.4)';
    if (p > .6 && !offTyped) {
      offTyped = true; const id = ++offRun;
      dictate(offP, OFF_CLEAN, () => id === offRun).then(ok => { if (ok && id === offRun) toast.classList.add('on'); });
    }
    if (p < .1 && offTyped) { offTyped = false; offRun++; toast.classList.remove('on'); setTyped(offP, ''); setBubble(offP.bub, 'rest'); }
  }
  if (RM) { offFrame(.59); setTyped(offP, OFF_CLEAN); toast.classList.add('on'); }
  else scrub($('[data-scrub="offline"]'), 'view', offFrame);

  // ===================================================================== 5. accent preview bubbles
  $$('.bub-slot').forEach(slot => {
    slot.innerHTML = bubbleHTML(0);
    const b = $('.kkb', slot), s = slot.dataset.bub;
    setBubble(b, s, 'Tidying up');
  });

  // ===================================================================== 6. try the cleanup
  const tin = $('#try-in'), tdiff = $('#try-diff'), tres = $('#try-res');
  function runTry() {
    const raw = tin.value.slice(0, 2000);
    const { output, tokens } = KK.explain(raw);
    tdiff.innerHTML = tokens.map(x => x.kind === 'drop' ? `<s>${esc(x.t)}</s>` : x.kind === 'add' ? `<ins>${esc(x.t)}</ins>` : esc(x.t)).join(' ') || '&nbsp;';
    tres.textContent = output || ' ';
    [tdiff, tres].forEach(e => { e.classList.remove('pop-in'); void e.offsetWidth; e.classList.add('pop-in'); });
  }
  $('#try-go').addEventListener('click', runTry);
  tin.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runTry(); } });
  $$('.ex button').forEach(b => b.addEventListener('click', () => { tin.value = b.dataset.ex; runTry(); }));
  runTry();

  // ===================================================================== 7. final line fills in word by word
  const fillWords = $$('.fill .w');
  fillWords.forEach(w => w.dataset.t = w.textContent);
  if (!RM) scrub($('.fill'), 'view', p => { const x = seg(p, .15, .85) * fillWords.length; fillWords.forEach((w, i) => w.style.setProperty('--o', clamp(x - i).toFixed(3))); });

  kick();
})();
