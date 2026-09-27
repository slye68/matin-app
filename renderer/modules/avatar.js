/* ════════════════════════════════════════════════════════════════
   Matin — Avatar vocal holographique
   L'image de référence (avatar-holo.webp) reste intacte : toutes les
   animations sont superposées (halo, particules, anneaux, waveform,
   respiration, yeux, bouche).

   Usage :
     const avatar = createMatinAvatar(containerEl, { src: 'assets/avatar-holo.webp' });
     avatar.setState('idle' | 'listening' | 'thinking' | 'speaking');
     avatar.setAudio(level0to1, freqDataOptional);   // Uint8Array ou Float32Array
     avatar.pause(); avatar.resume(); avatar.destroy();
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Géométrie calée sur l'image recadrée (fractions de la taille du composant)
  const GEO = { cx: 0.498, cy: 0.42, headR: 0.335, pedY: 0.883 };

  // Accent par état : appliqué aux effets uniquement, jamais au visage
  const THEME = {
    idle:      [0, 200, 255],
    listening: [255, 160, 70],
    thinking:  [170, 120, 255],
    speaking:  [70, 230, 160],
  };

  const BARS = 96;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  function createMatinAvatar(container, opts = {}) {
    const src = opts.src || 'assets/avatar-holo.webp';
    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── DOM ──
    const root = document.createElement('div');
    root.className = 'matin-avatar';
    root.dataset.state = 'idle';
    root.innerHTML = `
      <canvas class="av-canvas av-back"></canvas>
      <div class="av-face">
        <img class="av-img" src="${src}" alt="" draggable="false">
        <img class="av-img av-img-white" src="${src}" alt="" draggable="false">
        <img class="av-img av-img-face" src="${src}" alt="" draggable="false">
        <img class="av-img av-img-feat" src="${src}" alt="" draggable="false">
        <div class="av-mouth"></div>
        <div class="av-smile"></div>
        <img class="av-jaw" src="${src}" alt="" draggable="false">
        <div class="av-eye av-eye-l"></div>
        <div class="av-eye av-eye-r"></div>
      </div>
      <canvas class="av-canvas av-front"></canvas>`;
    container.appendChild(root);

    const $ = (s) => root.querySelector(s);
    const face = $('.av-face'), jaw = $('.av-jaw'), mouth = $('.av-mouth'), smileEl = $('.av-smile'), featEl = $('.av-img-feat');
    const eyeL = $('.av-eye-l'), eyeR = $('.av-eye-r');
    const cBack = $('.av-back'), cFront = $('.av-front');
    const bx = cBack.getContext('2d'), fx = cFront.getContext('2d');

    // ── État + audio ──
    let state = 'idle';
    let level = 0, lvl = 0, lvlFast = 0;
    let freq = null;
    const bars = new Float32Array(BARS);

    function setState(s) {
      if (!THEME[s]) return;
      state = s;
      root.dataset.state = s;
      if (s !== 'listening' && s !== 'speaking') level = 0;
    }

    function setAudio(l, freqData) {
      level = Math.max(0, Math.min(1, +l || 0));
      if (freqData && freqData.length) {
        if (!freq) freq = new Float32Array(BARS);
        const n = freqData.length;
        const scale = freqData instanceof Uint8Array ? 1 / 255 : 1;
        for (let i = 0; i < BARS; i++) {
          // bas du spectre (voix), symétrique gauche/droite autour de la tête
          const u = Math.abs((i / BARS) * 2 - 1);
          const idx = Math.min(n - 1, Math.floor((1 - u) * n * 0.45));
          freq[i] = freqData[idx] * scale;
        }
      } else {
        freq = null;
      }
    }

    // ── Canvas HiDPI ──
    let S = 200, dpr = 1;
    function resize() {
      const r = root.getBoundingClientRect();
      if (!r.width) return;
      S = r.width;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const c of [cBack, cFront]) {
        c.width = Math.round(S * dpr);
        c.height = Math.round(S * dpr);
      }
      bx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    resize();

    // ── Particules ──
    const P = Array.from({ length: 80 }, () => ({
      a: rand(0, Math.PI * 2),
      r: rand(0.30, 0.50),
      z: Math.random(),
      s: rand(0.4, 1.4),
      w: rand(0.6, 1.4) * (Math.random() < 0.5 ? -1 : 1),
      ph: rand(0, Math.PI * 2),
    }));

    // ── Étoiles fines du fond noir (2026-09-25) : points nets d'1-2 px, semés
    // dans le disque noir en évitant la tête, scintillement lent. Dessinées sur
    // le canvas AVANT (fusion additive) : l'image du visage, opaque, cacherait
    // celles du canvas arrière.
    const STARS = [];
    while (STARS.length < 220) {
      const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 0.47;
      const x = 0.498 + Math.cos(ang) * rr, y = 0.43 + Math.sin(ang) * rr * 0.98;
      if (Math.abs(x - 0.498) < 0.17 && y > 0.14 && y < 0.72) continue;   // pas sur le visage
      if (y > 0.80) continue;                                              // pas sur le socle/la galaxie
      STARS.push({ x, y, b: 0.25 + Math.random() * 0.75, big: Math.random() < 0.06, ph: Math.random() * 6.28, sp: 0.4 + Math.random() * 1.6 });
    }

    // ── Galaxie du socle : bras spiraux qui tournent en permanence ──
    const GALAXY = Array.from({ length: 150 }, () => {
      const arm = Math.floor(Math.random() * 3);
      const r = Math.pow(Math.random(), 0.8) * 0.30 + 0.02;
      return { a: (arm / 3) * Math.PI * 2 + r * 9 + rand(-0.35, 0.35), r, s: rand(0.5, 1.5), ph: rand(0, Math.PI * 2) };
    });
    let galaxyRot = 0;

    // ── Interaction yeux : regard vers la souris, survol, clignements ──
    // Les yeux font partie de l'image : seule la lueur superposée glisse vers
    // le curseur, et le visage s'incline légèrement (rotation 3D).
    let gazeTX = 0, gazeTY = 0, gazeX = 0, gazeY = 0;
    let hoverT = 0, hover = 0;
    let nextBlink = 2 + Math.random() * 3, blinkStart = -1;
    // Mouvement de tête aléatoire pendant la parole : cible tirée toutes les
    // 0,5-1,5 s, lissée, amplitude modulée par le volume.
    let hmNext = 0, hmLast = -1, hmCur = null, hmStart = 0;
    const HP = { yaw: 0, pitch: 0, roll: 0, dx: 0, dy: 0, sc: 0 };   // pose lissée
    // Gestes de tête (pose cible normalisée ; osc = oscillation pendant le
    // geste). 12 mouvements tirés au hasard, jamais 2 fois de suite.
    const HEAD_GESTURES = [
      { yaw: -1, pitch: 0.1, roll: 0.2, dx: -0.6, dy: 0, sc: 0 },               // regard gauche
      { yaw: 1, pitch: 0.1, roll: -0.2, dx: 0.6, dy: 0, sc: 0 },                // regard droite
      { yaw: 0, pitch: 0, roll: -1, dx: 0, dy: 0.2, sc: 0 },                    // tête penchée gauche
      { yaw: 0, pitch: 0, roll: 1, dx: 0, dy: 0.2, sc: 0 },                     // tête penchée droite
      { yaw: 0, pitch: -1, roll: 0, dx: 0, dy: -0.5, sc: 0.01 },                // menton relevé
      { yaw: 0, pitch: 0.9, roll: 0, dx: 0, dy: 0.5, sc: 0 },                   // menton baissé
      { yaw: -0.8, pitch: -0.6, roll: -0.6, dx: -0.4, dy: -0.3, sc: 0 },        // diagonale haut-gauche
      { yaw: 0.8, pitch: 0.6, roll: 0.6, dx: 0.4, dy: 0.3, sc: 0 },             // diagonale bas-droite
      { yaw: 0, pitch: 0.2, roll: 0, dx: 0, dy: 0.4, sc: 0.05 },                // se penche vers l'avant
      { yaw: 0, pitch: -0.2, roll: 0, dx: 0, dy: -0.3, sc: -0.04 },             // recule
      { yaw: 0, pitch: 0.3, roll: 0, dx: 0, dy: 0, sc: 0, osc: 'pitch', oa: 0.8, of: 7 },   // acquiescement
      { yaw: 0, pitch: 0, roll: 0, dx: 0, dy: 0, sc: 0, osc: 'yaw', oa: 0.9, of: 6.5 },     // hochement latéral
    ];
    // Bouche : formes enchaînées au hasard pendant la parole (o = ouverture,
    // w = largeur, s = sourire, k = décalage latéral). L'enveloppe audio les
    // module : silence = bouche fermée, quelle que soit la forme tirée.
    const MOUTH_SHAPES = [
      { o: 1.0, w: 1.0, s: 0.0, k: 0 },     // grande ouverture
      { o: 0.55, w: 0.9, s: 0.0, k: 0 },    // mi-ouverte
      { o: 0.6, w: 0.55, s: 0.0, k: 0 },    // « o » arrondi
      { o: 0.25, w: 1.45, s: 0.3, k: 0 },   // étirée
      { o: 0.06, w: 1.0, s: 0.0, k: 0 },    // lèvres serrées
      { o: 0.65, w: 1.35, s: 1.0, k: 0 },   // grand sourire ouvert
      { o: 0.5, w: 1.0, s: 0.2, k: 1 },     // asymétrique droite
      { o: 0.5, w: 1.0, s: 0.2, k: -1 },    // asymétrique gauche
      { o: 0.15, w: 1.5, s: 1.0, k: 0 },    // sourire lèvres fermées
      { o: 1.25, w: 0.85, s: 0.0, k: 0 },   // très ouverte
    ];
    let featK = 0;   // intensité lissée de la lueur des contours (parole uniquement)
    let mNext = 0, mLast = -1, mTarget = MOUTH_SHAPES[1], smileNext = 3, smileUntil = 0;
    const MS = { o: 0, w: 1, s: 0, k: 0 };
    const BLINK_DUR = 0.16;
    function onPointer(ev) {
      const r = root.getBoundingClientRect();
      if (!r.width) return;
      const cx = r.left + r.width * GEO.cx, cy = r.top + r.height * GEO.cy;
      const dx = ev.clientX - cx, dy = ev.clientY - cy;
      // Saturation douce : ~1 à 500px du visage, jamais au-delà.
      gazeTX = Math.max(-1, Math.min(1, dx / 500));
      gazeTY = Math.max(-1, Math.min(1, dy / 500));
      hoverT = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom ? 1 : 0;
    }
    function onLeave() { gazeTX = 0; gazeTY = 0; hoverT = 0; }
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);

    // ── Paramètres animés ──
    const col = [0, 200, 255];
    const k = { bright: 0, eyes: 0, halo: 0, spin: 0, wave: 0, spread: 0, tint: 0 };   // tint : fond coloré accentué (écoute/parole)
    let t = 0, DT = 0.016, last = performance.now(), ringRot = 0, ringRot2 = 0;
    let raf = 0, running = false, lastDraw = 0;

    function targets() {
      const L = lvl;
      switch (state) {
        case 'listening': return { bright: .06 + L * .10, eyes: .55 + L * .45, halo: .55 + L * .9, spin: .06, wave: .35, spread: L * .06, tint: 1 };
        case 'thinking':  return { bright: .02, eyes: .45, halo: .40, spin: .45, wave: .08, spread: 0, tint: 0 };
        case 'speaking':  return { bright: .16 + L * .22, eyes: .70 + L * .30, halo: .55 + L * .6, spin: .08, wave: 1, spread: L * .03, tint: 1 };
        default:          return { bright: 0, eyes: .12, halo: .30, spin: .025, wave: .12, spread: 0, tint: 0 };
      }
    }

    function rgba(a, m) {
      // mélange l'accent d'état avec le cyan de l'image
      const r = Math.round(lerp(0, col[0], m));
      const g = Math.round(lerp(200, col[1], m));
      const b = Math.round(lerp(255, col[2], m));
      return `rgba(${r},${g},${b},${a})`;
    }

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);

      // Idle : 30 fps suffisent (économie CPU, le dashboard tourne toute la journée)
      if (state === 'idle' && now - lastDraw < 32) return;
      lastDraw = now;

      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      DT = dt * (REDUCED ? 0.25 : 1);
      t += DT;

      lvl = lerp(lvl, level, 1 - Math.pow(0.001, dt));
      lvlFast = lerp(lvlFast, level, 1 - Math.pow(1e-6, dt));

      const tg = targets();
      const e = 1 - Math.pow(0.02, dt);
      for (const key in tg) k[key] = lerp(k[key], tg[key], e);
      const c = THEME[state];
      for (let i = 0; i < 3; i++) col[i] = lerp(col[i], c[i], e);

      // Regard + survol lissés (pendant la réflexion, le regard dérive seul)
      const gE = 1 - Math.pow(0.004, dt);
      const tx = state === 'thinking' ? Math.sin(t * 0.7) * 0.5 : gazeTX;
      const ty = state === 'thinking' ? -0.4 + Math.sin(t * 0.5) * 0.15 : gazeTY;
      gazeX = lerp(gazeX, tx, gE);
      gazeY = lerp(gazeY, ty, gE);
      hover = lerp(hover, hoverT, 1 - Math.pow(0.01, dt));

      // Clignements : aléatoires (3-6 s), plus fréquents pendant la réflexion
      if (blinkStart < 0 && t >= nextBlink) blinkStart = t;
      let blink = 1;
      if (blinkStart >= 0) {
        const p = (t - blinkStart) / BLINK_DUR;
        if (p >= 1) {
          blinkStart = -1;
          nextBlink = t + (state === 'thinking' ? rand(1.2, 2.5) : rand(3, 6));
        } else blink = 1 - Math.sin(p * Math.PI);
      }

      // Visage : respiration + luminosité + légère inclinaison vers le curseur
      const br = Math.sin(t * (Math.PI * 2 / 6.5));
      const amp = state === 'idle' ? 0.006 : 0.009;
      const tilt = REDUCED ? 0 : 1;
      // Gestes de tête pendant la parole. PAS bridés par « réduire les
      // animations » (demande explicite) : seul le suivi du curseur (tilt) l'est.
      if (state === 'speaking') {
        if (t >= hmNext) {
          let g; do { g = Math.floor(Math.random() * HEAD_GESTURES.length); } while (g === hmLast);
          hmLast = g; hmCur = HEAD_GESTURES[g]; hmStart = t; hmNext = t + rand(0.7, 1.7);
        }
      } else hmCur = null;
      const tp = hmCur || { yaw: 0, pitch: 0, roll: 0, dx: 0, dy: 0, sc: 0 };
      const osc = hmCur && hmCur.osc ? Math.sin((t - hmStart) * hmCur.of) * hmCur.oa : 0;
      const hmE = 1 - Math.pow(0.05, dt);
      HP.yaw = lerp(HP.yaw, tp.yaw + (hmCur?.osc === 'yaw' ? osc : 0), hmE);
      HP.pitch = lerp(HP.pitch, tp.pitch + (hmCur?.osc === 'pitch' ? osc : 0), hmE);
      HP.roll = lerp(HP.roll, tp.roll, hmE);
      HP.dx = lerp(HP.dx, tp.dx, hmE); HP.dy = lerp(HP.dy, tp.dy, hmE); HP.sc = lerp(HP.sc, tp.sc, hmE);
      const hmAmp = 1 + lvl * 0.4;
      face.style.transform = `perspective(700px) translate(${(HP.dx * 1.1 * hmAmp).toFixed(2)}%, ${(HP.dy * 0.8 * hmAmp).toFixed(2)}%) rotateY(${(gazeX * 7 * tilt + HP.yaw * 8 * hmAmp).toFixed(2)}deg) rotateX(${(-gazeY * 5 * tilt + HP.pitch * 5.5 * hmAmp).toFixed(2)}deg) rotateZ(${(HP.roll * 3 * hmAmp).toFixed(2)}deg) translateY(${(-br * 0.35).toFixed(3)}%) scale(${(1 + br * amp + HP.sc * 0.5).toFixed(4)})`;
      face.style.filter = `brightness(${(1 + k.bright + hover * 0.06 + br * 0.02).toFixed(3)}) saturate(${(1 + k.bright * 0.6).toFixed(3)})`;

      // Yeux : lueur (survol = plus vive), clignement, décalage vers le regard
      const eo = Math.min(1, (k.eyes + hover * 0.35) * (0.92 + 0.08 * Math.sin(t * 3.1))) * blink;
      eyeL.style.opacity = eo.toFixed(3);
      eyeR.style.opacity = (eo * (0.97 + 0.03 * Math.sin(t * 2.3))).toFixed(3);
      const openness = state === 'idle' ? 1 : Math.max(0.45, Math.min(1, k.eyes / 0.7));
      const ex = (gazeX * S * 0.012).toFixed(2), ey = (gazeY * S * 0.008).toFixed(2);
      const eyeT = `translate(-50%,-50%) translate(${ex}px,${ey}px) scaleY(${(openness * (0.25 + 0.75 * blink)).toFixed(3)})`;
      eyeL.style.transform = eyeT;
      eyeR.style.transform = eyeT;

      // Bouche (parole uniquement) : forme tirée au hasard toutes les 0,11-0,3 s
      // (10 formes dont sourires et asymétries), modulée par le volume ; un
      // sourire franc revient toutes les 3-7 s.
      const speaking = state === 'speaking';
      if (speaking) {
        if (t >= mNext) {
          let m; do { m = Math.floor(Math.random() * MOUTH_SHAPES.length); } while (m === mLast);
          mLast = m; mTarget = MOUTH_SHAPES[m]; mNext = t + rand(0.11, 0.30);
        }
        if (t >= smileNext) { smileUntil = t + rand(0.9, 1.6); smileNext = t + rand(3, 7); }
      } else { mTarget = { o: 0, w: 1, s: 0, k: 0 }; }
      const mE = 1 - Math.pow(0.0005, dt);
      const env = speaking ? Math.min(1, lvlFast * 2.4) : 0;
      MS.o = lerp(MS.o, mTarget.o * (0.25 + 0.85 * env), mE);
      MS.w = lerp(MS.w, mTarget.w, mE);
      MS.s = lerp(MS.s, Math.max(mTarget.s, speaking && t < smileUntil ? 1 : 0), 1 - Math.pow(0.02, dt));
      MS.k = lerp(MS.k, mTarget.k, mE);
      const open = Math.min(1.3, MS.o);
      jaw.style.transform = `translate(${(MS.k * 0.35).toFixed(3)}%, ${(open * 1.6).toFixed(3)}%)`;
      mouth.style.transform = `translate(-50%,-50%) translateX(${(MS.k * 8).toFixed(1)}%) scale(${MS.w.toFixed(3)}, ${(open * 1.1).toFixed(3)})`;
      smileEl.style.opacity = (MS.s * 0.85).toFixed(3);
      smileEl.style.transform = `translate(-50%,-50%) translateX(${(MS.k * 6).toFixed(1)}%) scale(${(0.9 + 0.35 * MS.s + (MS.w - 1) * 0.3).toFixed(3)}, ${(0.6 + 0.8 * MS.s).toFixed(3)})`;

      // Lueur blanc-cyan des contours yeux/nez/bouche : montée rapide, descente
      // plus douce ; suit l'enveloppe de la voix, nulle hors parole.
      const featT = speaking ? Math.min(1, 0.2 + env * 0.7) : 0;
      featK = lerp(featK, featT, 1 - Math.pow(featT > featK ? 0.002 : 0.05, dt));
      featEl.style.opacity = (featK * 0.55).toFixed(3);

      drawBack();
      drawFront();
    }

    function drawBack() {
      const ctx = bx;
      ctx.clearRect(0, 0, S, S);
      const cx = GEO.cx * S, cy = GEO.cy * S;

      // Halo pulsant
      const pulse = 0.5 + 0.5 * Math.sin(t * (state === 'idle' ? 0.9 : 1.8));
      const hr = S * (0.40 + k.halo * 0.05 + pulse * 0.015);
      const tn = k.tint;   // 0 idle/réflexion → 1 écoute/parole : halo plus large, plus opaque, couleur d'état plus pure
      const g = ctx.createRadialGradient(cx, cy, S * (0.30 - 0.09 * tn), cx, cy, hr);   // 0.12 → 0.30 : le centre derrière le visage reste noir
      const bst = 1 + 1.6 * tn, mix = lerp(0.5, 1, tn);
      g.addColorStop(0, rgba(Math.min(0.75, (0.10 + k.halo * 0.18) * bst), mix));
      g.addColorStop(0.6, rgba(Math.min(0.40, (0.04 + k.halo * 0.08) * bst), lerp(0.7, 1, tn)));
      g.addColorStop(1, rgba(0, lerp(0.7, 1, tn)));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, hr, 0, Math.PI * 2); ctx.fill();

      // Lueur du socle
      const py = GEO.pedY * S;
      const pg = ctx.createRadialGradient(cx, py, 0, cx, py, S * 0.22);
      pg.addColorStop(0, rgba(0.20 + k.halo * 0.25 + pulse * 0.08, 0.4));
      pg.addColorStop(1, rgba(0, 0.4));
      ctx.save();
      ctx.translate(cx, py); ctx.scale(1, 0.28); ctx.translate(-cx, -py);
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(cx, py, S * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      drawParticles(ctx, false);
    }

    function drawFront() {
      const ctx = fx;
      ctx.clearRect(0, 0, S, S);
      const cx = GEO.cx * S, cy = GEO.cy * S;

      // Anneaux
      ringRot += k.spin * DT;
      ringRot2 -= k.spin * DT * 0.7;
      ctx.lineCap = 'round';
      const ring = (r, rot, segs, len, w, a) => {
        ctx.lineWidth = w;
        ctx.strokeStyle = rgba(a, 0.75);
        ctx.shadowColor = rgba(a, 0.75);
        ctx.shadowBlur = 6;
        for (let i = 0; i < segs; i++) {
          const s = rot + (i / segs) * Math.PI * 2;
          ctx.beginPath(); ctx.arc(cx, cy, r, s, s + len); ctx.stroke();
        }
        ctx.shadowBlur = 0;
      };
      const ra = 0.28 + k.halo * 0.25;
      ring(S * 0.405, ringRot, 3, 0.9, 1.4, ra);
      ring(S * 0.445, ringRot2, 5, 0.35, 0.9, ra * 0.7);
      ring(S * 0.472, ringRot * 0.6, 24, 0.05, 1.2, ra * 0.55);

      // Waveform circulaire
      const baseR = S * (GEO.headR + 0.012);
      for (let i = 0; i < BARS; i++) {
        let v;
        if (freq) v = freq[i];
        else {
          const u = Math.abs((i / BARS) * 2 - 1);
          v = lvlFast * (0.55 + 0.45 * Math.sin(u * 9 + t * 7)) * (0.6 + 0.4 * Math.sin(i * 1.7 + t * 11));
        }
        bars[i] = lerp(bars[i], Math.max(0, v), 0.35);
      }
      const idleWave = 0.006 + 0.004 * Math.sin(t * 1.3);
      ctx.lineWidth = Math.max(1, S * 0.006);
      for (let i = 0; i < BARS; i++) {
        const ang = -Math.PI / 2 + (i / BARS) * Math.PI * 2;
        const len = S * (idleWave + bars[i] * 0.075 * k.wave);
        const a = 0.18 + Math.min(0.7, bars[i] * 1.2) * k.wave;
        ctx.strokeStyle = rgba(a, 0.8);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * baseR, cy + Math.sin(ang) * baseR);
        ctx.lineTo(cx + Math.cos(ang) * (baseR + len), cy + Math.sin(ang) * (baseR + len));
        ctx.stroke();
      }

      // Galaxie du socle — rotation CONSTANTE, indépendante de l'état (même
      // en idle) ; DT est déjà ralenti si « réduire les animations ».
      const py = GEO.pedY * S;
      galaxyRot += 0.55 * DT;
      const core = ctx.createRadialGradient(cx, py, 0, cx, py, S * 0.10);
      core.addColorStop(0, rgba(0.55, 0.5));
      core.addColorStop(1, rgba(0, 0.5));
      ctx.save();
      ctx.translate(cx, py); ctx.scale(1, 0.22); ctx.translate(-cx, -py);
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(cx, py, S * 0.10, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      for (const g of GALAXY) {
        const ang = g.a + galaxyRot * (1.4 - g.r * 2.2);
        const x = cx + Math.cos(ang) * g.r * S;
        const y = py + Math.sin(ang) * g.r * S * 0.22;
        const tw = 0.6 + 0.4 * Math.sin(t * 2.2 + g.ph);
        ctx.fillStyle = rgba((0.35 + 0.5 * (1 - g.r / 0.32)) * tw, 0.6);
        ctx.beginPath(); ctx.arc(x, y, S * 0.0035 * g.s, 0, Math.PI * 2); ctx.fill();
      }
      ctx.setLineDash([S * 0.03, S * 0.05]);
      ctx.lineWidth = 1;
      [0.13, 0.21, 0.29].forEach((rr, i) => {
        ctx.lineDashOffset = -galaxyRot * S * (i % 2 ? -0.12 : 0.12);
        ctx.strokeStyle = rgba(0.30 - i * 0.06, 0.6);
        ctx.beginPath(); ctx.ellipse(cx, py, S * rr, S * rr * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
      });
      ctx.setLineDash([]);

      // Ondulations du socle
      const ripples = state === 'speaking' || state === 'listening' ? 3 : 2;
      ctx.lineWidth = 1;
      for (let j = 0; j < ripples; j++) {
        const ph = (t * (state === 'idle' ? 0.25 : 0.6) + j / ripples) % 1;
        const rx = S * (0.06 + ph * 0.30);
        ctx.strokeStyle = rgba((1 - ph) * (0.25 + lvl * 0.5), 0.6);
        ctx.beginPath(); ctx.ellipse(cx, py, rx, rx * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
      }

      // Étoiles fines (voir STARS) : coordonnées arrondies = points nets.
      for (const st of STARS) {
        const tw = 0.55 + 0.45 * Math.sin(t * st.sp + st.ph);
        const a = st.b * tw;
        if (a < 0.08) continue;
        const px = Math.round(st.x * S * dpr) / dpr, py2 = Math.round(st.y * S * dpr) / dpr;
        const w = (st.big ? 2 : 1.2) / dpr * dpr;
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.fillRect(px, py2, w, w);
        if (st.big && a > 0.5) {   // petit scintillement en croix
          ctx.fillStyle = `rgba(255,255,255,${(a * 0.45).toFixed(3)})`;
          ctx.fillRect(px - 3, py2 + 0.5, 8, 1);
          ctx.fillRect(px + 0.5, py2 - 3, 1, 8);
        }
      }

      drawParticles(ctx, true);
    }

    function drawParticles(ctx, front) {
      const cx = GEO.cx * S, cy = GEO.cy * S;
      const orbit = state === 'thinking' ? 0.35 : state === 'idle' ? 0.03 : 0.07;
      for (const p of P) {
        if ((p.z > 0.5) !== front) continue;
        p.a += p.w * orbit * DT;
        const wob = Math.sin(t * 0.8 + p.ph) * 0.012;
        const r = (p.r + wob + k.spread * (0.5 + p.s * 0.5)) * S;
        const x = cx + Math.cos(p.a) * r;
        const y = cy + Math.sin(p.a) * r * 0.92;
        // estompe ce qui passe devant le visage
        const dFace = Math.hypot((x - cx) / S, (y - (cy + S * 0.05)) / S);
        const faceFade = front ? Math.min(1, Math.max(0, (dFace - 0.20) / 0.08)) : 1;
        const tw = 0.55 + 0.45 * Math.sin(t * 2 + p.ph * 3);
        const a = (0.25 + 0.35 * tw + lvl * 0.5 * (state === 'listening' ? 1 : 0.4)) * faceFade * (front ? 1 : 0.6);
        if (a < 0.02) continue;
        const size = S * 0.0045 * p.s * (1 + lvl * (state === 'listening' ? 1.2 : 0.5));
        ctx.fillStyle = `rgba(255,255,255,${Math.min(1, a * 1.15).toFixed(3)})`;   // points lumineux blancs
        ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ── Cycle de vie ──
    function resume() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function pause() {
      running = false;
      cancelAnimationFrame(raf);
    }
    const onVis = () => (document.hidden ? pause() : resume());
    document.addEventListener('visibilitychange', onVis);

    function destroy() {
      pause();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
      root.remove();
    }

    resume();
    return { setState, setAudio, pause, resume, destroy, get state() { return state; }, el: root };
  }

  window.createMatinAvatar = createMatinAvatar;
})();
