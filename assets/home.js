/* KisuKisu homepage: scroll-driven phones, no framework. Blot in every phone is the app's own bubble
   (bubble.js, a 1:1 port of the Android overlay): real sizes, colours, waveform, unroll and re-roll timings.
   - one rAF-throttled, passive scroll listener drives every scrubbed section (reads first, then writes)
   - IntersectionObserver turns scrubbers on/off and fires one-shot reveals and takes */
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
  const KB = window.KisuBubble, KK = window.KKText;

  // ===================================================================== copy
  // what the app typed for these lines (app pipeline, chat context, 2026-10-20); the raw words are only tagged for the animation
  const RAW = "Um, I'm running fifteen minutes late. Uh, can we push the call to two, I mean three pm?";
  const CLEAN = "I'm running 15 minutes late, can we push the call to 3 pm?";
  const OFF_CLEAN = 'I land at 7 pm, can you pick me up?';
  const HES = /^(um+|uh+|uhm+|hm+|mm+|mhm+|erm+|er)\W*$/i;
  // raw words tagged: f = filler, c = correction, n = number (with its digits), k = kept
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

  // ===================================================================== phone markup (a clean Android at 430 x 932)
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
  // the bubble on a 430 px screen: 44 dp = 45.79 px, 10.75 px from the edge, its top at y 440
  const S = 45.79, EDGE = 10.75, BUBY = 440, KPX = S / 44;
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
      <div class="notes-t"><h4>Monday</h4><div class="d">Today · 9:41</div><div class="bd"><p>Pick up dry cleaning</p><p class="pline"><span class="pastetip">Paste</span><span class="typed"></span><span class="ph" style="color:#6c737b">Note</span></p></div></div>${keyboard()}`,
  };
  const fingerHTML = `<div class="finger" style="left:${430 - EDGE - S / 2 - 28}px;top:${BUBY + S / 2 - 28}px"></div>`;
  // the app's bubble, anchored where BubbleService puts it: right edge, dot resting in the ✓ slot
  function mountBubble(screen) {
    const host = document.createElement('div');
    host.className = 'kbub';
    const b = KB.create(host, { dotPx: S, side: 'right', hearing: 'Listening back', tidy: 'Tidying up', more: ['Fixing commas'] });
    const pad = b.layout.PAD * KPX;
    host.style.right = (EDGE - pad) + 'px'; host.style.top = (BUBY - pad) + 'px';
    screen.appendChild(host);
    b.render(0);
    return b;
  }
  function buildPhone(el, kind, o) {
    el.innerHTML = `<div class="device"><div class="screen"><div class="cam"></div>${SCREENS[kind](o)}${fingerHTML}</div></div>`;
    const screen = $('.screen', el);
    return { root: el, b: mountBubble(screen), typed: $('.typed', el), round: $('.round', el), finger: $('.finger', el), bars: $$('.sbar .bars i', el), tip: $('.pastetip', el) };
  }
  function setTyped(P, s) {
    if (P.typed.textContent !== s) P.typed.textContent = s;
    if (P.round) P.round.innerHTML = s ? ic.send : ic.mic;
  }
  // one frame of a take at time t (seconds on the bubble's own timeline). The finger taps the dot to start
  // and the ✓ to stop; the text goes in as the ✓ lands. copy: the text is copied, then pasted.
  function takeAt(P, t, text, copy) {
    const tl = P.b.timeline;
    P.b.render(t);
    const near = a => t > a - .3 && t < a + .1;
    P.finger.classList.toggle('on', near(tl.tap) || near(tl.processing));
    if (copy) {
      P.tip?.classList.toggle('on', t > tl.land + .5 && t < tl.land + 1.3);
      setTyped(P, t >= tl.land + 1.3 ? text : '');
    } else setTyped(P, t >= tl.land ? text : '');
  }
  // a take in real time; resolves false if it was cut short
  function play(P, text, alive = () => true, copy = false) {
    return new Promise(res => {
      const t0 = performance.now(), end = P.b.timeline.loop + (copy ? 1.4 : 0);
      const f = now => {
        if (!alive()) { P.finger.classList.remove('on'); P.tip?.classList.remove('on'); return res(false); }
        const t = (now - t0) / 1000;
        takeAt(P, Math.min(t, end), text, copy);
        t < end ? requestAnimationFrame(f) : res(true);
      };
      requestAnimationFrame(f);
    });
  }
  const restPhone = (P, text = '') => { P.b.render(0); P.finger.classList.remove('on'); P.tip?.classList.remove('on'); setTyped(P, text); };

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
  const onResize = [];
  addEventListener('resize', () => { vh = innerHeight; scrubs.forEach(s => { measure(s); s.last = -1; }); onResize.forEach(f => f()); kick(); }, { passive: true });
  const revealIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
  $$('.reveal').forEach(el => revealIO.observe(el));
  // run a callback while an element is (mostly) on screen
  function watch(el, on, off, threshold = .45) {
    if (!el) return;
    new IntersectionObserver(es => es.forEach(e => (e.isIntersecting ? on : off)?.()), { threshold }).observe(el);
  }

  // small resting Blots: the real dot, cropped out of the tap bar's window
  function restDot(el, px) {
    const b = KB.create(el, { dotPx: px, side: 'left', opacity: 1 });
    b.render(0.2);
    const k = px / 44, pad = b.layout.PAD;
    el.style.width = el.style.height = px + 'px';
    b.svg.style.marginLeft = b.svg.style.marginTop = (-pad * k) + 'px';
  }

  function start() {
    // =================================================================== 1. hero: the phone takes, then gives way to the transcript card
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
    let heroLoopOn = true, heroRunning = false;
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
    // the phone runs a real take on a loop while it is the thing on screen
    async function heroLoop() {
      if (heroRunning) return; heroRunning = true;
      await sleep(700);
      while (heroLoopOn && !document.hidden) {
        restPhone(heroP);
        if (!await play(heroP, CLEAN, () => heroLoopOn)) break;
        await sleep(1800);
      }
      heroRunning = false;
    }
    if (RM) {
      takeAt(heroP, 0, CLEAN); setTyped(heroP, CLEAN);
      heroWords.forEach(w => w.classList.add('on')); hero.out.classList.add('on'); hero.chips.classList.add('on');
    } else {
      scrub($('.hero-pin'), 'pin', p => { heroFrame(p); if (heroLoopOn) heroLoop(); });
      heroFrame(0); heroLoop();
      document.addEventListener('visibilitychange', () => { if (!document.hidden && heroLoopOn) heroLoop(); });
    }

    // =================================================================== 2. how it works: scroll drives the take
    function buildVis(el) {
      el.innerHTML = `<div class="v-crop"><div class="device"><div class="screen"><div class="cam"></div>${SCREENS.chat()}${fingerHTML}</div></div></div>
        <div class="v-hint">Tap Blot</div>
        <div class="v-card hide" style="top:auto;bottom:16px"><div class="tag"><span class="lbl">You say</span></div>
          <div class="v-text"><div class="v-raw">${TOK.map(t => t.k === 'n'
            ? `<span class="t n"><span class="wd2">${esc(t.w)}</span><span class="dg">${esc(t.d)}</span></span>`
            : `<span class="t ${t.k}">${esc(t.w)}</span>`).join(' ')}</div><div class="v-clean">${hiDigits(CLEAN)}</div></div></div>
        <div class="v-done"><span class="tick">✓</span> Typed into the box</div>`;
      const screen = $('.screen', el);
      return { el, b: mountBubble(screen), finger: $('.finger', el), card: $('.v-card', el), lbl: $('.lbl', el), text: $('.v-text', el),
        toks: $$('.v-raw .t', el), hint: $('.v-hint', el), done: $('.v-done', el), typed: $('.typed', screen), round: $('.round', screen) };
    }
    function renderVis(V, k, t) {
      const tl = V.b.timeline, open = tl.tap + .7;
      // each step owns a stretch of the bubble's timeline
      const bt = [lerp(0, open, t), lerp(open, tl.processing - .02, t), lerp(tl.processing, tl.done, t), lerp(tl.done, tl.loop, t)][k];
      takeAt(V, bt, CLEAN);
      V.hint.classList.toggle('hide', k !== 0 || t > .5);
      V.card.classList.toggle('hide', k === 0 || k === 3);
      V.done.classList.toggle('on', k === 3 && bt >= tl.land);
      const toks = V.toks, N = toks.length;
      if (k === 1) {
        V.lbl.textContent = 'You say';
        V.text.classList.remove('clean');
        const n = Math.round(clamp(t / .92) * N);
        toks.forEach((x, i) => { x.classList.toggle('hid', i >= n); x.classList.toggle('last', i === n - 1 && n < N); x.classList.remove('cut', 'dig'); });
      }
      if (k === 2) {
        V.lbl.textContent = 'Cleaning up';
        toks.forEach(x => x.classList.remove('hid', 'last'));
        toks.forEach((x, i) => {
          const c = TOK[i].k;
          x.classList.toggle('cut', (c === 'f' && t > .12) || (c === 'c' && t > .34));
          x.classList.toggle('dig', c === 'n' && t > .52);
        });
        V.text.classList.toggle('clean', t > .76);
        if (t > .76) V.lbl.textContent = 'It types';
      }
    }
    const howSteps = $$('.steps li'), stepsOl = $('.steps');
    const desk = buildVis($('[data-vis="desk"]'));
    const deskMQ = matchMedia('(min-width: 900px) and (min-height: 561px)');
    renderVis(desk, 0, 0);
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
      if (RM) { renderVis(V, k, 1); return; }
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

    // =================================================================== 3. one bubble, every app
    const appPh = ['chat', 'email', 'notes'].map(kind => buildPhone($(`[data-phone="${kind}"]`), kind));
    const appsRow = $('[data-apps]');
    if (RM) { appsRow.classList.add('in'); appPh.forEach(P => setTyped(P, CLEAN)); }
    else {
      let appsGo = 0;
      watch(appsRow, () => {
        appsRow.classList.add('in');
        const id = ++appsGo;
        appPh.forEach(async (P, i) => {
          restPhone(P);
          await sleep(700 + i * 650); if (id !== appsGo) return;
          await play(P, CLEAN, () => id === appsGo, i === 2);
        });
      }, () => { appsGo++; appPh.forEach(P => restPhone(P)); }, .35);
    }

    // =================================================================== 4. offline
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
        play(offP, OFF_CLEAN, () => id === offRun).then(ok => { if (ok && id === offRun) toast.classList.add('on'); });
      }
      if (p < .1 && offTyped) { offTyped = false; offRun++; toast.classList.remove('on'); restPhone(offP); }
    }
    if (RM) { offFrame(.59); setTyped(offP, OFF_CLEAN); toast.classList.add('on'); }
    else scrub($('[data-scrub="offline"]'), 'view', offFrame);

    // =================================================================== 5. try the cleanup
    const tin = $('#try-in'), tdiff = $('#try-diff'), tres = $('#try-res');
    function runTry() {
      const { output, tokens } = KK.explain(tin.value.slice(0, 2000));
      tdiff.innerHTML = tokens.map(x => x.kind === 'drop' ? `<s>${esc(x.t)}</s>` : x.kind === 'add' ? `<ins>${esc(x.t)}</ins>` : esc(x.t)).join(' ') || '&nbsp;';
      tres.textContent = output || ' ';
      [tdiff, tres].forEach(e => { e.classList.remove('pop-in'); void e.offsetWidth; e.classList.add('pop-in'); });
    }
    $('#try-go').addEventListener('click', runTry);
    tin.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runTry(); } });
    $$('.ex button').forEach(b => b.addEventListener('click', () => { tin.value = b.dataset.ex; runTry(); }));
    runTry();

    // =================================================================== 6. resting Blots, and the final line filling in word by word
    $$('[data-dot]').forEach(el => restDot(el, el.classList.contains('big') ? 92 : 44));
    const fillWords = $$('.fill .w');
    fillWords.forEach(w => w.dataset.t = w.textContent);
    if (!RM) scrub($('.fill'), 'view', p => { const x = seg(p, .15, .85) * fillWords.length; fillWords.forEach((w, i) => w.style.setProperty('--o', clamp(x - i).toFixed(3))); });

    kick();
  }

  // the status words are measured in Nunito, so wait for it
  KB.fontReady().then(start);
})();
