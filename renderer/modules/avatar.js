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
  const GEO = { cx: 0.507, cy: 0.425, headR: 0.357, pedY: 0.91 };

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
        <div class="av-mouth"></div>
        <img class="av-jaw" src="${src}" alt="" draggable="false">
        <div class="av-eye av-eye-l"></div>
        <div class="av-eye av-eye-r"></div>
      </div>
      <canvas class="av-canvas av-front"></canvas>`;
    container.appendChild(root);

    const $ = (s) => root.querySelector(s);
    const face = $('.av-face'), jaw = $('.av-jaw'), mouth = $('.av-mouth');
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

    // ── Paramètres animés ──
    const col = [0, 200, 255];
    const k = { bright: 0, eyes: 0, halo: 0, spin: 0, wave: 0, spread: 0 };
    let t = 0, DT = 0.016, last = performance.now(), ringRot = 0, ringRot2 = 0;
    let raf = 0, running = false, lastDraw = 0;

    function targets() {
      const L = lvl;
      switch (state) {
        case 'listening': return { bright: .06 + L * .10, eyes: .55 + L * .45, halo: .55 + L * .9, spin: .06, wave: .35, spread: L * .06 };
        case 'thinking':  return { bright: .02, eyes: .22, halo: .40, spin: .45, wave: .08, spread: 0 };
        case 'speaking':  return { bright: .16 + L * .22, eyes: .40 + L * .30, halo: .55 + L * .6, spin: .08, wave: 1, spread: L * .03 };
        default:          return { bright: 0, eyes: .12, halo: .30, spin: .025, wave: .12, spread: 0 };
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

      // Visage : respiration + luminosité
      const br = Math.sin(t * (Math.PI * 2 / 6.5));
      const amp = state === 'idle' ? 0.006 : 0.009;
      face.style.transform = `translateY(${(-br * 0.35).toFixed(3)}%) scale(${(1 + br * amp).toFixed(4)})`;
      face.style.filter = `brightness(${(1 + k.bright + br * 0.02).toFixed(3)}) saturate(${(1 + k.bright * 0.6).toFixed(3)})`;

      // Yeux
      const eo = Math.min(1, k.eyes * (0.92 + 0.08 * Math.sin(t * 3.1)));
      eyeL.style.opacity = eo.toFixed(3);
      eyeR.style.opacity = (eo * (0.97 + 0.03 * Math.sin(t * 2.3))).toFixed(3);

      // Bouche (parole uniquement)
      const open = state === 'speaking' ? Math.min(1, lvlFast * 1.6) : 0;
      jaw.style.transform = `translateY(${(open * 1.15).toFixed(3)}%)`;
      mouth.style.transform = `translate(-50%,-50%) scaleY(${(open * 1.1).toFixed(3)})`;

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
      const g = ctx.createRadialGradient(cx, cy, S * 0.12, cx, cy, hr);
      g.addColorStop(0, rgba(0.10 + k.halo * 0.18, 0.5));
      g.addColorStop(0.6, rgba(0.04 + k.halo * 0.08, 0.7));
      g.addColorStop(1, rgba(0, 0.7));
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

      // Ondulations du socle
      const py = GEO.pedY * S;
      const ripples = state === 'speaking' || state === 'listening' ? 3 : 2;
      ctx.lineWidth = 1;
      for (let j = 0; j < ripples; j++) {
        const ph = (t * (state === 'idle' ? 0.25 : 0.6) + j / ripples) % 1;
        const rx = S * (0.06 + ph * 0.30);
        ctx.strokeStyle = rgba((1 - ph) * (0.25 + lvl * 0.5), 0.6);
        ctx.beginPath(); ctx.ellipse(cx, py, rx, rx * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
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
        ctx.fillStyle = rgba(a, front ? 0.6 : 0.4);
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
      root.remove();
    }

    resume();
    return { setState, setAudio, pause, resume, destroy, get state() { return state; }, el: root };
  }

  window.createMatinAvatar = createMatinAvatar;
})();
