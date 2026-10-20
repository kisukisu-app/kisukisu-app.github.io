/* KisuKisu homepage. Blot here is the app's own bubble (bubble.js, a 1:1 port of the Android overlay):
   real size ratios, colours, waveform and the 4.1D unroll / T1 re-roll timings. Nothing is redrawn by hand. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KB = window.KisuBubble;
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  // A real take: the spoken line and what the app typed (app pipeline, chat context, 2026-10-20).
  const SAID = "um I'm running fifteen minutes late uh can we push the call to two I mean three pm";
  const TYPED = "I'm running 15 minutes late, can we push the call to 3 pm?";

  // small resting Blots: the real dot, cropped out of the tap bar's window
  function restDot(el, px) {
    const b = KB.create(el, { dotPx: px, side: 'left', opacity: 1 });
    b.render(0.2);
    const k = px / 44, pad = b.layout.PAD;
    el.style.width = el.style.height = px + 'px';
    b.svg.style.marginLeft = b.svg.style.marginTop = (-pad * k) + 'px';
  }

  function hero() {
    const stage = $('#stage'), host = $('#bub'), saidT = $('#said-t'), typedT = $('#typed-t'), hint = $('#hint');
    const words = SAID.split(' ');
    let b, k, VW, PAD, tl, t0 = null, raf = 0, tx = null, played = false;
    function build() {
      host.innerHTML = '';
      const avail = stage.clientWidth - 8, showDp = 44 + 8 + 136 + 8 + 44 + 8;
      const px = Math.max(48, Math.min(92, avail / showDp * 44));
      b = KB.create(host, { dotPx: px, side: 'right', opacity: 1, hearing: 'Listening back', tidy: 'Tidying up', more: ['Fixing commas'] });
      k = px / 44; VW = b.layout.VW; PAD = b.layout.PAD; tl = b.timeline;
      stage.style.height = (b.layout.VH * k + 40) + 'px';
      paint(t0 === null ? 0.2 : (performance.now() - t0) / 1000, true);
    }
    function textAt(t) {
      // words stream in while it listens, the clean line lands with the ✓
      const a = tl.tap + 0.45, z = tl.processing - 0.1;
      const n = t < a ? 0 : Math.min(words.length, Math.ceil((t - a) / (z - a) * words.length));
      saidT.textContent = words.slice(0, n).join(' ');
      $('#said').classList.toggle('on', n > 0);
      const done = t >= tl.land - 0.05;
      typedT.textContent = done ? TYPED : '';
      $('#typed').classList.toggle('on', done);
    }
    function paint(t, snap) {
      const s = b.render(t);
      // a gentle camera: the dot centred at rest, the whole tap bar centred while it is open
      const len = s ? s.pillLen || 0 : 0, open = len > 1 || (s && s.cancelScale > 0.01);
      const barDp = open ? 44 + 8 + len + 8 + 44 : 44;
      const centreDp = VW - PAD - barDp / 2;
      const target = stage.clientWidth / 2 - centreDp * k;
      tx = (tx === null || snap) ? target : tx + (target - tx) * 0.18;
      b.svg.style.transform = `translateX(${tx.toFixed(1)}px)`;
      textAt(t);
    }
    function frame(now) {
      const t = (now - t0) / 1000;
      paint(Math.min(t, tl.loop), false);
      if (t < tl.loop) raf = requestAnimationFrame(frame); else { raf = 0; }
    }
    function play() {
      if (RM) return;
      cancelAnimationFrame(raf); t0 = performance.now(); played = true; hint.classList.add('gone');
      raf = requestAnimationFrame(frame);
    }
    build();
    if (RM) { b.render(2.4); saidT.textContent = SAID; typedT.textContent = TYPED; $('#said').classList.add('on'); $('#typed').classList.add('on'); }
    host.addEventListener('click', play);
    addEventListener('resize', () => { const keep = t0; build(); t0 = keep; });
    // play once by itself when the hero is on screen
    if (!RM) new IntersectionObserver((es, io) => es.forEach(e => { if (e.isIntersecting && !played) { io.disconnect(); setTimeout(() => { if (!played) { play(); hint.classList.remove('gone'); } }, 900); } }), { threshold: .5 }).observe(stage);
  }

  function tryIt() {
    const tin = $('#try-in'), tdiff = $('#try-diff'), tres = $('#try-res');
    const KK = window.KKText; if (!tin || !KK) return;
    const run = () => {
      const { output, tokens } = KK.explain(tin.value.slice(0, 2000));
      tdiff.innerHTML = tokens.map(x => x.kind === 'drop' ? `<s>${esc(x.t)}</s>` : x.kind === 'add' ? `<ins>${esc(x.t)}</ins>` : esc(x.t)).join(' ') || '&nbsp;';
      tres.textContent = output || ' ';
    };
    $('#try-go').addEventListener('click', run);
    tin.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
    $$('.ex button').forEach(b => b.addEventListener('click', () => { tin.value = b.dataset.ex; run(); }));
    run();
  }

  KB.fontReady().then(() => {
    $$('[data-dot]').forEach(el => restDot(el, el.classList.contains('big') ? 72 : 44));
    hero();
    tryIt();
  });
})();
