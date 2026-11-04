/* Сфера Джарвиса для сторінок — перенесення _OrbRenderer із jarvis_ui.py (той самий алгоритм і ті самі числа):
   клубок із 9 шарів дуг + промені від центру, 110 волосинок із хвилями й вогниками, 420 іскор; світло точок складається
   (білінійно), гарячі місця яскравіші, ореол у ½ і ¼ розміру, м'яке світіння центру; кольори й швидкість станів — _HOLO.
   Використання: JarvisOrb(canvas, () => ({mode: 'sleep'|'listen'|'think'|'speak', level: 0..1}), {fps: 30, max: 420}) */
(function (G) {
  const HOLO = {sleep: [[70, 125, 175], [150, 190, 230], .22], listen: [[255, 170, 55], [255, 232, 165], .42],
                think: [[255, 140, 30], [255, 205, 130], 1.2], speak: [[255, 185, 75], [255, 245, 205], .6]};
  const BASE_LEN = {sleep: .05, listen: .13, think: .20, speak: .15};
  const NT = 110, MT = 78, DS = .015, TAU = Math.PI * 2;

  function build(seed) {
    let s = seed >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const nrm = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rnd()); };
    const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const P = [], LY = [], BR = [], LR = [];
    for (let li = 0; li < 9; li++) {                                   // 9 вкладених шарів дуг
      const r = .28 + .72 * li / 8; LR.push(r);
      for (let k = 0, cnt = Math.floor(26 + 44 * r); k < cnt; k++) {
        const ax = unit([nrm(), nrm(), nrm()]), u = unit(cross(ax, Math.abs(ax[1]) < .9 ? [0, 1, 0] : [1, 0, 0])), w = cross(ax, u);
        const a0 = rnd() * TAU, ln = .25 + rnd() * 1.05, n = Math.max(4, Math.floor(ln * r / DS)), b0 = .55 + rnd() * .45;
        for (let q = 0; q < n; q++) {
          const tt = a0 + ln * q / (n - 1), c = Math.cos(tt), sn = Math.sin(tt);
          P.push(r * (c * u[0] + sn * w[0]), r * (c * u[1] + sn * w[1]), r * (c * u[2] + sn * w[2]));
          LY.push(li); BR.push(Math.pow(Math.sin(.15 + (Math.PI - .3) * q / (n - 1)), .6) * b0);   // м'які кінці
        }
      }
    }
    LR.push(.5);
    for (let k = 0; k < 55; k++) {                                     // промені від центру
      const v = unit([nrm(), nrm(), nrm()]), r0 = .05 + rnd() * .3, r1 = .6 + rnd() * .4, n = Math.max(4, Math.floor((r1 - r0) / DS));
      for (let q = 0; q < n; q++) { const rr = r0 + (r1 - r0) * q / (n - 1); P.push(rr * v[0], rr * v[1], rr * v[2]); LY.push(9); BR.push(.9 - .75 * q / (n - 1)); }
    }
    const SP = new Float32Array(420 * 3), SPF = new Float32Array(420);
    for (let i = 0; i < 420; i++) {                                    // іскри: густіше до центру
      const d = unit([nrm(), nrm(), nrm()]), m = Math.pow(.02 + rnd() * .98, .6) * 1.05;
      SP[i * 3] = d[0] * m; SP[i * 3 + 1] = d[1] * m; SP[i * 3 + 2] = d[2] * m; SPF[i] = rnd() * TAU;
    }
    const B = new Float32Array(NT * 3), E1 = new Float32Array(NT * 3), E2 = new Float32Array(NT * 3);
    const PH = new Float32Array(NT), GN = new Float32Array(NT), CURL = new Float32Array(NT), DL = new Float32Array(NT);
    for (let i = 0; i < NT; i++) {                                     // корені волосинок — спіраль Фібоначчі
      const ii = i + .5, phi = Math.acos(1 - 2 * ii / NT), th = Math.PI * (1 + Math.sqrt(5)) * ii;
      const b = [Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi)];
      let e1 = cross(b, [0, 1, 0]); if (Math.hypot(e1[0], e1[1], e1[2]) < 1e-3) e1 = cross(b, [1, 0, 0]); e1 = unit(e1);
      const e2 = cross(b, e1);
      for (let j = 0; j < 3; j++) { B[i * 3 + j] = b[j]; E1[i * 3 + j] = e1[j]; E2[i * 3 + j] = e2[j]; }
      PH[i] = rnd() * TAU; GN[i] = .45 + rnd() * .55; CURL[i] = (rnd() < .5 ? -1 : 1) * (.6 + rnd() * .9);
      DL[i] = (Math.atan2(b[2], b[0]) + Math.PI) / TAU * .3;
    }
    return {P: new Float32Array(P), LY: new Uint8Array(LY), BR: new Float32Array(BR), LR, SP, SPF, B, E1, E2, PH, GN, CURL, DL};
  }

  G.JarvisOrb = function (cv, getState, opts) {
    opts = opts || {};
    const g = build(11), ctx = cv.getContext('2d');
    const S = new Float32Array(MT), S15 = new Float32Array(MT), S14 = new Float32Array(MT);
    for (let i = 0; i < MT; i++) { S[i] = i / (MT - 1); S15[i] = Math.pow(S[i], 1.6); S14[i] = 1 - S[i]; }
    const ext = new Float32Array(NT).fill(.05), lq = new Float32Array(NT), E = new Float32Array(NT);
    const X2 = new Float32Array(MT), Y2 = new Float32Array(MT), QK = new Float32Array(MT);
    let ht = [], hl = [], ph = 0, fl = 0, W = 0, L, Lh, Lq, T1, Gb, d2, img;
    const s0 = (getState() || {}).mode, m0 = HOLO[s0] ? s0 : 'sleep';
    const cb = HOLO[m0][0].slice(), cl = HOLO[m0][1].slice();
    let spd = HOLO[m0][2], A = m0 === 'sleep' ? 120 : 255, yaw = 0, lvl = 0, t0 = performance.now(), last = t0, lastDraw = 0;

    function alloc(w) {
      W = w; cv.width = cv.height = W;
      const h = W >> 1, q = h >> 1, c = W / 2;
      L = new Float32Array(W * W); Gb = new Float32Array(W * W); d2 = new Float32Array(W * W);
      Lh = new Float32Array(h * h); T1 = new Float32Array(h * h); Lq = new Float32Array(q * q);
      img = ctx.createImageData(W, W);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) d2[y * W + x] = (x - c + .5) ** 2 + (y - c + .5) ** 2;
    }
    function splat(X, Y, w) {                                          // білінійне «додавання світла»
      X -= .5; Y -= .5; const xi = X | 0, yi = Y | 0;
      if (X < 0 || Y < 0 || xi >= W - 1 || yi >= W - 1) return;
      const fx = X - xi, fy = Y - yi, i = yi * W + xi;
      L[i] += (1 - fx) * (1 - fy) * w; L[i + 1] += fx * (1 - fy) * w; L[i + W] += (1 - fx) * fy * w; L[i + W + 1] += fx * fy * w;
    }
    function pass(a, o, n, s, vert) {                                  // рівномірне вікно s (як uniform_filter, нулі за краєм)
      const r = s >> 1;
      for (let l = 0; l < n; l++) {
        const at = vert ? (k => a[k * n + l]) : (k => a[l * n + k]);
        let acc = 0;
        for (let k = -r; k < s - r; k++) if (k >= 0 && k < n) acc += at(k);
        for (let k = 0; k < n; k++) {
          o[vert ? k * n + l : l * n + k] = acc / s;
          const ad = k - r + s, sb = k - r;
          if (ad < n) acc += at(ad);
          if (sb >= 0) acc -= at(sb);
        }
      }
    }
    function blur(a, n, s, tmp) { for (let p = 0; p < 2; p++) { pass(a, tmp, n, s, false); pass(tmp, a, n, s, true); } }
    function half(src, sn, dst) { const dn = sn >> 1; for (let y = 0; y < dn; y++) for (let x = 0; x < dn; x++) { const i = 2 * y * sn + 2 * x; dst[y * dn + x] = (src[i] + src[i + 1] + src[i + sn] + src[i + sn + 1]) * .25; } }
    function up(src, sn, dst, dn) {                                    // білінійно, як PIL BILINEAR
      const k = sn / dn;
      for (let y = 0; y < dn; y++) {
        let sy = (y + .5) * k - .5; if (sy < 0) sy = 0; let y0 = sy | 0; if (y0 > sn - 2) y0 = sn - 2; const fy = Math.min(1, sy - y0);
        for (let x = 0; x < dn; x++) {
          let sx = (x + .5) * k - .5; if (sx < 0) sx = 0; let x0 = sx | 0; if (x0 > sn - 2) x0 = sn - 2; const fx = Math.min(1, sx - x0), i = y0 * sn + x0;
          dst[y * dn + x] = (src[i] * (1 - fx) + src[i + 1] * fx) * (1 - fy) + (src[i + sn] * (1 - fx) + src[i + sn + 1] * fx) * fy;
        }
      }
    }
    function step(t, dt, lv, mode) {                                  // пружини волосинок і накопичені фази
      if (ht.length && t < ht[ht.length - 1]) { ht = []; hl = []; }
      ht.push(t); hl.push(lv);
      while (ht.length > 2 && t - ht[0] > 1) { ht.shift(); hl.shift(); }
      const gain = {speak: .95, listen: .55, think: .25}[mode] || 0, bl = BASE_LEN[mode] ?? .1;
      dt = Math.min(dt, .1);
      for (let i = 0; i < NT; i++) {
        const tq = t - g.DL[i]; let v;
        if (tq <= ht[0]) v = hl[0]; else if (tq >= ht[ht.length - 1]) v = hl[hl.length - 1];
        else { let j = 1; while (ht[j] < tq) j++; v = hl[j - 1] + (hl[j] - hl[j - 1]) * (tq - ht[j - 1]) / (ht[j] - ht[j - 1]); }
        const target = bl * (.6 + .4 * g.GN[i]) + g.GN[i] * v * gain + .02 * Math.sin(t * 1.3 + g.PH[i]);
        ext[i] += (target - ext[i]) * (1 - Math.exp(-(target > ext[i] ? 14 : 4) * dt));
        E[i] = Math.min(1, Math.max(0, ext[i]));
        lq[i] = (lq[i] + dt * (.25 + 1.5 * v)) % 1;
      }
      ph = (ph + dt * (.9 + 2 * lv) * (mode === 'think' ? 1.8 : 1)) % TAU;
      fl = (fl + dt * (2.5 + 7 * lv)) % TAU;
    }
    function frame(t, dt, lv, mode, base, bright, Af) {
      L.fill(0);
      const c = W / 2, size = W / 1.4;
      const R = size * .40 * (1 + .05 * lv + .012 * Math.sin(t * 2)), tilt = .35 + .06 * Math.sin(t * .33), ct = Math.cos(tilt), st = Math.sin(tilt);
      const ca = new Float32Array(10), sa = new Float32Array(10);       // 1) клубок: внутрішні шари крутяться швидше
      for (let k = 0; k < 10; k++) { const a = yaw * (1 + .9 * (1 - g.LR[k])); ca[k] = Math.cos(a); sa[k] = Math.sin(a); }
      const P = g.P, k1 = Af * (.75 + .25 * lv) * DS * R * .55;
      for (let i = 0, n = P.length / 3; i < n; i++) {
        const ly = g.LY[i], px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
        const x = px * ca[ly] + pz * sa[ly]; let z = pz * ca[ly] - px * sa[ly];
        const y = py * ct - z * st; z = py * st + z * ct;
        const pers = (1 + .15 * z) * R;
        splat(c + x * pers, c - y * pers, g.BR[i] * (.2 + .5 * (z + 1) * .5) * k1);
      }
      step(t, dt, lv, mode);                                           // 2) волосинки + 3) вогники
      const cy = Math.cos(yaw), sy = Math.sin(yaw), lightK = Af * (mode === 'speak' ? .9 : .35);
      for (let n = 0; n < NT; n++) {
        const e = E[n], vis = Math.min(1, Math.max(0, (e - .03) / .35));
        const b3 = n * 3, bx = g.B[b3], by = g.B[b3 + 1], bz = g.B[b3 + 2];
        const ax = g.E1[b3], ay = g.E1[b3 + 1], az = g.E1[b3 + 2], cx2 = g.E2[b3], cy2 = g.E2[b3 + 1], cz2 = g.E2[b3 + 2];
        for (let s = 0; s < MT; s++) {
          const Ss = S[s], th = g.PH[n] + ph - Ss * 3.2 + g.CURL[n] * Ss * 1.2, amp = (.06 + .45 * e) * S15[s], rad = .93 + e * Ss;
          const oc = amp * Math.cos(th), os = amp * Math.sin(th);
          const Qx = bx * rad + ax * oc + cx2 * os, Qy = by * rad + ay * oc + cy2 * os, Qz = bz * rad + az * oc + cz2 * os;
          const qx = Qx * cy + Qz * sy; let qz = Qz * cy - Qx * sy; const qy = Qy * ct - qz * st; qz = Qy * st + qz * ct;
          const qp = (1 + .15 * qz) * R;
          X2[s] = c + qx * qp; Y2[s] = c - qy * qp; QK[s] = (Math.min(1.5, Math.max(-1.5, qz)) / 1.5 + 1) * .5;
        }
        if (vis > 0) for (let s = 0; s < MT; s++) {
          const seg = s ? Math.hypot(X2[s] - X2[s - 1], Y2[s] - Y2[s - 1]) : Math.hypot(X2[1] - X2[0], Y2[1] - Y2[0]);
          splat(X2[s], Y2[s], S14[s] * (.3 + .7 * QK[s]) * vis * Math.min(2.5, Math.max(.3, seg)) * Af * 1.05);
        }
        const q = (lq[n] + g.PH[n] / TAU) % 1, j = Math.min(Math.floor(q * (MT - 1)), MT - 1);
        splat(X2[j], Y2[j], (1 - q) * vis * QK[j] * lightK * 1.6);
      }
      const c13 = Math.cos(yaw * 1.3), s13 = Math.sin(yaw * 1.3), k4 = Af * (.7 + .5 * lv) * .55;   // 4) іскри
      for (let i = 0; i < 420; i++) {
        const sx = g.SP[i * 3], sy2 = g.SP[i * 3 + 1], sz = g.SP[i * 3 + 2];
        const px = sx * c13 + sz * s13; let pz = sz * c13 - sx * s13; const py = sy2 * ct - pz * st; pz = sy2 * st + pz * ct;
        const flick = .5 + .5 * Math.sin(g.SPF[i] + fl), pp = (1 + .15 * pz) * R;
        splat(c + px * pp, c - py * pp, (.25 + .75 * (pz + 1) * .5) * (.4 + .6 * flick) * k4 * 1.6);
      }
      const h = W >> 1, q4 = h >> 1;                                   // 5) ореол: тонкий у ½, широкий у ¼
      half(L, W, Lh); half(Lh, h, Lq);
      blur(Lq, q4, Math.max(3, Math.floor(W / 48)), T1);
      blur(Lh, h, 3, Gb);
      up(Lq, q4, T1, h);
      for (let i = 0; i < h * h; i++) Lh[i] = Lh[i] * 1.1 + T1[i] * 1.8;
      up(Lh, h, Gb, W);
      const rc = R * (.30 + .10 * lv) * .6, inv = -1 / (2 * rc * rc), kc = (.26 + .14 * lv) * Af, D = img.data;
      for (let i = 0, n = W * W; i < n; i++) {
        const l = L[i], bm = l * Math.min(1, Math.max(0, l * 1.1)), gg = Gb[i];
        const xb = Math.exp(d2[i] * inv) * kc + l - bm + gg * .7, yb = bm + gg * .3;
        let r = xb * base[0] + yb * bright[0], gr = xb * base[1] + yb * bright[1], b = xb * base[2] + yb * bright[2];
        r = r < 0 ? 0 : r > 255 ? 255 : r; gr = gr < 0 ? 0 : gr > 255 ? 255 : gr; b = b < 0 ? 0 : b > 255 ? 255 : b;
        const a = r > gr ? (r > b ? r : b) : (gr > b ? gr : b), o = i * 4;   // прозорість = яскравість (як у вікні сфери)
        if (a < 1) { D[o + 3] = 0; continue; }
        const k = 255 / a; D[o] = r * k; D[o + 1] = gr * k; D[o + 2] = b * k; D[o + 3] = a;
      }
    }
    function tick(now) {
      requestAnimationFrame(tick);
      if (document.hidden || now - lastDraw < 1000 / (opts.fps || 30) || (opts.active && !opts.active())) return;
      const rc = cv.getBoundingClientRect(); if (!rc.width) return;
      const want = Math.max(120, Math.min(opts.max || 420, Math.round(rc.width * Math.min(1.5, window.devicePixelRatio || 1)))) & ~3;
      if (want !== W) alloc(want);
      const dt = Math.min(.1, (now - last) / 1000); last = lastDraw = now;
      const st = getState() || {}, mode = HOLO[st.mode] ? st.mode : (st.mode === 'exec' ? 'think' : 'sleep');
      const H = HOLO[mode], k = 1 - Math.exp(-dt * 6);                 // колір і швидкість — плавно, за ~0,3 с
      for (let j = 0; j < 3; j++) { cb[j] += (H[0][j] - cb[j]) * k; cl[j] += (H[1][j] - cl[j]) * k; }
      A += ((mode === 'sleep' ? 120 : 255) - A) * k; spd += (H[2] - spd) * k; yaw += spd * dt;
      const raw = mode === 'sleep' ? 0 : Math.min(1, +st.level || 0);
      lvl += (raw - lvl) * (1 - Math.exp(-dt * (raw > lvl ? 16 : 4)));
      frame((now - t0) / 1000, dt, lvl, mode, cb, cl, A / 255);
      ctx.putImageData(img, 0, 0);
    }
    requestAnimationFrame(tick);
  };
})(window);
