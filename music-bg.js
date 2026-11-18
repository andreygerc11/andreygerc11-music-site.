(function () {
    var cv = document.createElement('canvas');
    cv.id = 'musicBg';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;';
    var cx = cv.getContext('2d');
    var W = 0, H = 0, DPR = 1, BASEDPR = 1, Q = 1;
    var NB = 64, FMIN = 45, FMAX = 14000, RANGE = 40, P2 = Math.PI * 2;
    var ctx = null, an = null, srcNode = null, audioEl = null, fd = null, real = false, errs = 0;
    var scene = '1c', last = 0, tm = 0, fe = 16.7, qTimer = 0, qUp = 0, agc = -30;

    var st = { kn: 0, hn: 0, fl: [0, 0, 0], thr: [0, 0, 0], js: 0, playing: false, bass: 0, mid: 0, treb: 0, lvl: 0, kick: 0, hat: 0, sp: new Float32Array(NB), pk: new Float32Array(NB) };
    var raw = new Float32Array(NB), rawPrev = new Float32Array(NB), dbs = new Float32Array(NB), bref = new Float32Array(NB), sm = new Float32Array(NB);
    for (var bq = 0; bq < NB; bq++) bref[bq] = -60;
    var pkVel = new Float32Array(NB), pkHold = new Float32Array(NB);
    var BX = new Float32Array(600), BY = new Float32Array(600);
    var bandLo = [], bandHi = [], bandFc = [];
    for (var b0 = 0; b0 < NB; b0++) {
        bandLo.push(FMIN * Math.pow(FMAX / FMIN, b0 / NB));
        bandHi.push(FMIN * Math.pow(FMAX / FMIN, (b0 + 1) / NB));
        bandFc.push(FMIN * Math.pow(FMAX / FMIN, (b0 + 0.5) / NB));
    }
    function bidx(f) { var i = Math.round(Math.log(f / FMIN) / Math.log(FMAX / FMIN) * NB - 0.5); return Math.max(0, Math.min(NB - 1, i)); }
    function mkGroup(f1, f2, lo, hi, refr) { return { a: bidx(f1), b: bidx(f2), lo: lo, hi: hi, v: 0, last: 0, refr: refr, ring: new Float32Array(43), rp: 0 }; }
    var groups = [mkGroup(45, 230, 0.1, 0.7, 0.22), mkGroup(300, 3400, 0.1, 0.7, 0.2), mkGroup(5000, 14000, 0.05, 0.5, 0.07)];

    var NH = 72, hist = [], histAcc = 0, histFrac = 0;
    for (var hi0 = 0; hi0 < NH; hi0++) hist.push(new Float32Array(NB));

    function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function hsl(h, s, l, a) { return 'hsla(' + Math.round(h) + ',' + s + '%,' + Math.round(l) + '%,' + a + ')'; }
    function ease(cur, target, k, dt) { return cur + (target - cur) * (1 - Math.exp(-k * dt)); }

    function specAt(arr, u) {
        var x = clamp01(u) * (NB - 1), i = Math.floor(x), f = x - i;
        var p0 = arr[i > 0 ? i - 1 : 0], p1 = arr[i], p2 = arr[i + 1 < NB ? i + 1 : NB - 1], p3 = arr[i + 2 < NB ? i + 2 : NB - 1];
        var v = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
        return v < 0 ? 0 : v > 1.15 ? 1.15 : v;
    }
    function specRange(arr, a, b, u) { return specAt(arr, (a + (b - a) * clamp01(u)) / (NB - 1)); }

    function resize() {
        BASEDPR = Math.min(window.devicePixelRatio || 1, 1.5);
        DPR = BASEDPR * Q;
        W = window.innerWidth; H = window.innerHeight;
        cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    }

    function analyze(dt, t) {
        var i, k, g, n;
        if (st.playing && real && an) {
            an.getFloatFrequencyData(fd);
            var bw = ctx.sampleRate / an.fftSize, mx = -200;
            for (i = 0; i < NB; i++) {
                var b0 = bandLo[i] / bw, b1 = bandHi[i] / bw, db;
                if (b1 - b0 < 1.5) {
                    var pc = bandFc[i] / bw, i0 = Math.floor(pc), fr = pc - i0;
                    db = fd[i0] * (1 - fr) + fd[Math.min(fd.length - 1, i0 + 1)] * fr;
                } else {
                    var s0 = Math.max(1, Math.ceil(b0)), s1 = Math.min(fd.length - 1, Math.floor(b1));
                    db = -200;
                    for (k = s0; k <= s1; k++) if (fd[k] > db) db = fd[k];
                }
                if (!(db > -140)) db = -140;
                db += 3 * Math.log(bandFc[i] / 1000) / Math.LN2;
                dbs[i] = db;
                if (db > mx) mx = db;
            }
            agc = mx > agc ? mx : agc - dt * 2.5;
            if (agc < -50) agc = -50;
            for (i = 0; i < NB; i++) {
                bref[i] = dbs[i] > bref[i] ? dbs[i] : bref[i] - dt * 1.0;
                var boost = 0.65 * (agc - bref[i]);
                boost = boost < 0 ? 0 : boost > 26 ? 26 : boost;
                raw[i] = Math.pow(clamp01((dbs[i] + boost - (agc - RANGE)) / RANGE), 1.25);
            }
        } else if (st.playing) {
            var ct = audioEl ? audioEl.currentTime : t;
            var env = Math.pow(1 - ((ct * 2) % 1), 3), hh = Math.pow(Math.max(0, Math.sin(ct * Math.PI * 4)), 4);
            for (i = 0; i < NB; i++) {
                var u = i / (NB - 1), v;
                if (u < 0.34) v = 0.3 + 0.6 * env * (1 - u);
                else if (u < 0.75) v = 0.2 + 0.4 * (0.5 + 0.5 * Math.sin(ct * 3 + i * 0.55)) * (0.6 + 0.4 * Math.sin(ct * 0.7));
                else v = 0.1 + 0.5 * hh;
                raw[i] = clamp01(v);
            }
        } else {
            for (i = 0; i < NB; i++) raw[i] = 0.09 + 0.06 * Math.sin(t * 0.55 + i * 0.42) + 0.035 * Math.sin(t * 0.9 - i * 0.9) + (i < 16 ? 0.03 : 0);
        }
        for (i = 0; i < NB; i++) {
            var cur = sm[i], target = raw[i];
            sm[i] = cur + (target - cur) * (1 - Math.exp(-(target > cur ? 34 : 6.5) * dt));
            if (sm[i] >= st.pk[i]) { st.pk[i] = sm[i]; pkVel[i] = 0; pkHold[i] = 0.35; }
            else if (pkHold[i] > 0) pkHold[i] -= dt;
            else { pkVel[i] += dt * 2.4; st.pk[i] = Math.max(sm[i], st.pk[i] - pkVel[i] * dt); }
        }
        for (i = 0; i < NB; i++) st.sp[i] = (sm[i > 0 ? i - 1 : 0] + 2 * sm[i] + sm[i < NB - 1 ? i + 1 : NB - 1]) / 4;
        for (var gi = 0; gi < 3; gi++) {
            g = groups[gi];
            var sum = 0, fl = 0; n = g.b - g.a + 1;
            for (i = g.a; i <= g.b; i++) { sum += st.sp[i]; var df = raw[i] - rawPrev[i]; if (df > 0) fl += df; }
            fl /= n;
            if (st.playing) {
                var x = sum / n;
                g.hi = x > g.hi ? x : g.hi + (x - g.hi) * (1 - Math.exp(-dt / 4));
                g.lo = x < g.lo ? x : g.lo + (x - g.lo) * (1 - Math.exp(-dt / 4));
                g.v = ease(g.v, clamp01((x - g.lo) / Math.max(0.14, g.hi - g.lo)), 14, dt);
                g.ring[g.rp] = fl; g.rp = (g.rp + 1) % 43;
                var m = 0; for (k = 0; k < 43; k++) m += g.ring[k]; m /= 43;
                st.fl[gi] = fl; st.thr[gi] = m * 1.75 + 0.01;
                if (fl > m * 1.75 + 0.01 && fl > 0.02 && t - g.last > g.refr) {
                    g.last = t;
                    if (gi === 0) st.kn++;
                    if (gi === 2) st.hn++;
                    if (gi === 0) st.kick = Math.max(st.kick, Math.min(1, 0.6 + fl * 6));
                    if (gi === 2) st.hat = Math.max(st.hat, Math.min(1, 0.55 + fl * 8));
                }
            } else {
                g.v = ease(g.v, 0.14 + 0.1 * Math.sin(t * 0.5 + gi * 1.7), 3, dt);
            }
        }
        for (i = 0; i < NB; i++) rawPrev[i] = raw[i];
        st.bass = groups[0].v; st.mid = groups[1].v; st.treb = groups[2].v;
        st.lvl = 0.5 * st.bass + 0.3 * st.mid + 0.2 * st.treb;
        st.kick = Math.max(0, st.kick - dt * 4.5);
        st.hat = Math.max(0, st.hat - dt * 7);
        var rt = document.documentElement.style;
        rt.setProperty('--bass', st.bass.toFixed(3));
        rt.setProperty('--lvl', st.lvl.toFixed(3));
        rt.setProperty('--kick', st.kick.toFixed(3));
    }

    function pushHist(dt) {
        var iv = st.playing ? 0.05 : 0.16;
        histAcc += dt;
        while (histAcc >= iv) { histAcc -= iv; var row = hist.pop(); row.set(st.sp); hist.unshift(row); }
        histFrac = histAcc / iv;
    }

    function paintBg(c0, c1, mode) {
        var g = mode === 'radial' ? cx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.8) : cx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, c0); g.addColorStop(1, c1);
        cx.globalCompositeOperation = 'source-over';
        cx.globalAlpha = 1;
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    }

    function curveN(bx, by, n, move) {
        if (move) cx.moveTo(bx[0], by[0]); else cx.lineTo(bx[0], by[0]);
        for (var i = 1; i < n - 1; i++) cx.quadraticCurveTo(bx[i], by[i], (bx[i] + bx[i + 1]) / 2, (by[i] + by[i + 1]) / 2);
        cx.lineTo(bx[n - 1], by[n - 1]);
    }

    function drawRidge() {
        paintBg('#0a0d2a', '#04050f', 'linear');
        var NR = Math.round(30 + 22 * Q), NS = Math.round(60 + 50 * Q);
        var front = H * 0.94, back = H * 0.26;
        for (var r = NR - 1; r >= -1; r--) {
            var row = r < 0 ? st.sp : hist[r];
            var zf = r < 0 ? 0 : Math.min(1, (r + histFrac) / NR);
            var yb = back + (front - back) * Math.pow(1 - zf, 1.6);
            var sc = H * 0.34 * (0.28 + 0.72 * (1 - zf));
            for (var j = 0; j < NS; j++) {
                var u = j / (NS - 1);
                BX[j] = -4 + u * (W + 8);
                BY[j] = yb - Math.pow(specAt(row, u), 1.1) * sc;
            }
            cx.globalCompositeOperation = 'source-over';
            cx.beginPath();
            cx.moveTo(BX[0], yb + 2);
            curveN(BX, BY, NS, false);
            cx.lineTo(BX[NS - 1], yb + 2);
            cx.closePath();
            cx.fillStyle = '#050716'; cx.fill();
            cx.strokeStyle = hsl(188 + (1 - zf) * 135, 92, 56 + 22 * st.kick * (1 - zf), 0.38 + 0.62 * (1 - zf * 0.75));
            cx.lineWidth = 0.8 + 1.1 * (1 - zf);
            cx.beginPath();
            curveN(BX, BY, NS, true);
            cx.stroke();
        }
    }

    var NAMP = [0.15, 0.115, 0.09, 0.07, 0.052, 0.036, 0.024, 0.015];
    var NN = [0.55, 0.95, 1.6, 2.5, 3.8, 5.6, 8.2, 12];
    var NOM = [0.3, 0.45, 0.6, 0.8, 1.1, 1.5, 2.0, 2.6];
    var NPSI = [0.6, 0.9, 1.2, 1.6, 2.0, 2.5, 3.0, 3.6];
    var nPh = new Float32Array(8);
    function partial(k) { var s = 0; for (var i = k * 8; i < k * 8 + 8; i++) s += st.sp[i]; return Math.min(1, s / 8 * 1.15); }

    function drawNeon(dt) {
        paintBg('#1c0e5e', '#05041f', 'radial');
        cx.globalCompositeOperation = 'lighter';
        var blobs = [[0.15, 0.35, 255, 150, 60, 0.2], [0.85, 0.3, 140, 90, 255, 0.22], [0.5, 0.75, 255, 60, 200, 0.16]];
        for (var b = 0; b < blobs.length; b++) {
            var bx = (blobs[b][0] + 0.06 * Math.sin(tm * 0.13 + b * 2)) * W, by = (blobs[b][1] + 0.05 * Math.cos(tm * 0.11 + b)) * H;
            var bg = cx.createRadialGradient(bx, by, 0, bx, by, Math.max(W, H) * (0.3 + 0.05 * st.lvl));
            bg.addColorStop(0, 'rgba(' + blobs[b][2] + ',' + blobs[b][3] + ',' + blobs[b][4] + ',' + (blobs[b][5] + 0.12 * st.lvl) + ')');
            bg.addColorStop(1, 'rgba(0,0,0,0)');
            cx.fillStyle = bg; cx.fillRect(0, 0, W, H);
        }
        var lv = [], k;
        for (k = 0; k < 8; k++) lv.push(partial(k));
        lv[0] = Math.min(1, lv[0] + 0.5 * st.kick);
        lv[7] = Math.min(1, lv[7] + 0.6 * st.hat);
        for (k = 0; k < 8; k++) nPh[k] += dt * NOM[k] * (0.35 + 2.2 * lv[k]);
        var S = Math.round(18 + 14 * Q), step = Math.max(8, W / (60 + 50 * Q)), n;
        cx.lineCap = 'round'; cx.lineJoin = 'round';
        for (var s = 0; s < S; s++) {
            var d = s / (S - 1);
            var hue = d < 0.45 ? lerp(32, 315, d / 0.45) : lerp(315, 250, (d - 0.45) / 0.55);
            n = 0;
            for (var x = -step; x <= W + step; x += step) {
                var u = x / W, y = H * (0.3 + 0.36 * d);
                for (k = 0; k < 8; k++) y -= H * NAMP[k] * (0.1 + 0.9 * lv[k]) * (0.55 + 0.45 * d) * Math.sin(P2 * NN[k] * u + nPh[k] + NPSI[k] * d);
                BX[n] = x; BY[n] = y; n++;
            }
            cx.beginPath(); curveN(BX, BY, n, true);
            cx.strokeStyle = hsl(hue, 100, 60, 0.07 + 0.05 * st.kick); cx.lineWidth = 7 + d * 6; cx.stroke();
            cx.strokeStyle = hsl(hue, 100, 68, 0.5 + 0.4 * d); cx.lineWidth = 1 + d * 1.6; cx.stroke();
        }
    }

    var HR = [
        { cy: 0.28, g: [0, 1, 2], n: [0.8, 1.3, 1.9], amp: [0.12, 0.07, 0.04], gn: 1.5, gap: 0.15 },
        { cy: 0.55, g: [3, 4, 5], n: [1.3, 2.3, 3.5], amp: [0.07, 0.045, 0.03], gn: 2.3, gap: 0.12 },
        { cy: 0.78, g: [5, 6, 7], n: [3.0, 5.2, 8.5], amp: [0.035, 0.022, 0.014], gn: 3.4, gap: 0.09 }
    ];
    var hPh = [new Float32Array(3), new Float32Array(3), new Float32Array(3)], gPh = new Float32Array(3);

    function drawHair(dt) {
        paintBg('#051630', '#04122a', 'linear');
        cx.globalCompositeOperation = 'lighter';
        var step = Math.max(6, W / (70 + 50 * Q)), N = Math.round(26 + 20 * Q);
        var pl = [], k, m;
        for (k = 0; k < 8; k++) pl.push(partial(k));
        for (var r = 0; r < 3; r++) {
            var rb = HR[r], lr = 0;
            var lm = [];
            for (m = 0; m < 3; m++) { var l = pl[rb.g[m]]; if (r === 0) l = Math.min(1, l + 0.5 * st.kick); if (r === 2) l = Math.min(1, l + 0.5 * st.hat); lm.push(l); lr += l / 3; }
            for (m = 0; m < 3; m++) hPh[r][m] += dt * (0.25 + 0.5 * m) * (0.35 + 2.0 * lm[m]);
            gPh[r] += dt * (0.2 + 1.2 * lr);
            var xs = [], A = [], B = [], n = 0;
            for (var x = -step; x <= W + step; x += step) {
                var u = x / W, a = H * rb.cy;
                for (m = 0; m < 3; m++) a += H * rb.amp[m] * (0.15 + 0.85 * lm[m]) * Math.sin(P2 * rb.n[m] * u + hPh[r][m] + r * 2.1);
                var gap = H * rb.gap * (0.15 + 0.85 * lr) * Math.sin(P2 * rb.gn * u + gPh[r] + r);
                xs.push(x); A.push(a); B.push(a + H * 0.05 + gap); n++;
            }
            var g = cx.createLinearGradient(0, 0, W, 0);
            if (r === 0) { g.addColorStop(0, 'rgba(40,90,255,0.95)'); g.addColorStop(0.4, 'rgba(80,210,255,0.85)'); g.addColorStop(0.75, 'rgba(200,215,255,0.75)'); g.addColorStop(1, 'rgba(255,90,200,0.9)'); }
            else if (r === 1) { g.addColorStop(0, 'rgba(200,225,255,0.7)'); g.addColorStop(0.35, 'rgba(90,150,255,0.85)'); g.addColorStop(0.7, 'rgba(170,110,230,0.8)'); g.addColorStop(1, 'rgba(255,80,190,0.9)'); }
            else { g.addColorStop(0, 'rgba(60,110,255,0.9)'); g.addColorStop(0.5, 'rgba(110,225,255,0.8)'); g.addColorStop(1, 'rgba(220,160,255,0.75)'); }
            cx.strokeStyle = g; cx.lineWidth = 0.8;
            for (var i = 0; i < N; i++) {
                var fr = i / (N - 1);
                for (var j = 0; j < n; j++) { BX[j] = xs[j]; BY[j] = A[j] + (B[j] - A[j]) * fr; }
                cx.beginPath(); curveN(BX, BY, n, true);
                cx.globalAlpha = 0.4 + 0.3 * lr + (r === 2 ? 0.25 * st.hat : 0);
                cx.stroke();
            }
            cx.globalAlpha = 1;
        }
    }

    var SH = [
        { col: '255,70,50', a: bidx(45), b: bidx(230), yb: 0.52, hs: 0.42, x0: 0.12, x1: 1.1, dy: -0.03, M: 22, dir: 1, ph: 0 },
        { col: '255,175,45', a: bidx(300), b: bidx(3400), yb: 0.6, hs: 0.46, x0: -0.05, x1: 0.95, dy: 0.06, M: 26, dir: -1, ph: 2 },
        { col: '40,215,255', a: bidx(5000), b: bidx(14000), yb: 0.68, hs: 0.38, x0: -0.1, x1: 1.12, dy: 0.09, M: 26, dir: 1, ph: 4 }
    ];
    var SV = new Float32Array(400), SW = new Float32Array(400), SXS = [], SYS = [];
    for (var sq = 0; sq < 3; sq++) { SXS.push(new Float32Array(260)); SYS.push([]); for (var sm0 = 0; sm0 < 30; sm0++) SYS[sq].push(new Float32Array(260)); }

    function drawGlow() {
        paintBg('#000', '#02050a', 'linear');
        var hz = H * 0.8, NS = Math.round(60 + 60 * Q), S, j, bp, bi, m;
        var kk = H * 0.05, GL = [st.bass, st.mid, st.treb];
        for (S = 0; S < 3; S++) {
            var sh = SH[S], xs = SXS[S], gain = 0.5 + 0.9 * GL[S];
            for (j = 0; j < NS; j++) { SV[j] = specRange(st.sp, sh.a, sh.b, j / (NS - 1)); xs[j] = (sh.x0 + (sh.x1 - sh.x0) * j / (NS - 1)) * W; }
            for (bp = 0; bp < 2; bp++) {
                for (bi = 0; bi < NS; bi++) { var l = Math.max(0, bi - 2), rr = Math.min(NS - 1, bi + 2), sm = 0; for (j = l; j <= rr; j++) sm += SV[j]; SW[bi] = sm / (rr - l + 1); }
                for (bi = 0; bi < NS; bi++) SV[bi] = SW[bi];
            }
            for (m = 0; m < sh.M; m++) {
                var d = m / (sh.M - 1), ys = SYS[S][m], shift = Math.round(m * 0.5 * sh.dir);
                for (j = 0; j < NS; j++) {
                    var jj = Math.max(0, Math.min(NS - 1, j + shift)), uu2 = jj / (NS - 1);
                    var win = Math.sin(Math.PI * clamp01(uu2));
                    var hgt = H * sh.hs * gain * (0.08 + 1.15 * Math.pow(SV[jj], 1.15)) * (0.4 + 0.6 * Math.pow(win, 0.7)) * (1 - 0.3 * d);
                    hgt += H * 0.02 * Math.sin(P2 * 1.1 * uu2 + tm * 0.5 + sh.ph);
                    var y = H * (sh.yb + sh.dy * d) - hgt;
                    ys[j] = hz - kk * Math.log(1 + Math.exp((hz - y) / kk));
                }
            }
        }
        for (var pass = 0; pass < 2; pass++) {
            var refl = pass === 1;
            cx.save();
            if (refl) cx.setTransform(DPR, 0, 0, -0.3 * DPR, 0, 1.3 * hz * DPR);
            var ga = refl ? 0.26 : 1;
            cx.globalCompositeOperation = 'lighter';
            for (S = 0; S < 3; S++) {
                sh = SH[S]; xs = SXS[S];
                var g = cx.createLinearGradient(sh.x0 * W, 0, sh.x1 * W, 0);
                g.addColorStop(0, 'rgba(' + sh.col + ',0)'); g.addColorStop(0.2, 'rgba(' + sh.col + ',1)'); g.addColorStop(0.8, 'rgba(' + sh.col + ',1)'); g.addColorStop(1, 'rgba(' + sh.col + ',0)');
                var c0 = SYS[S][0], cb = SYS[S][sh.M - 1];
                cx.beginPath();
                cx.moveTo(xs[0], c0[0]);
                for (j = 1; j < NS; j++) cx.lineTo(xs[j], c0[j]);
                for (j = NS - 1; j >= 0; j--) cx.lineTo(xs[j], cb[j]);
                cx.closePath();
                cx.globalAlpha = 0.1 * ga; cx.fillStyle = g; cx.fill();
                cx.strokeStyle = g;
                for (m = 0; m < sh.M; m++) {
                    var dd = m / (sh.M - 1);
                    cx.beginPath(); curveN(xs, SYS[S][m], NS, true);
                    if (m === 0) { cx.globalAlpha = 0.2 * ga; cx.lineWidth = 7; cx.stroke(); cx.globalAlpha = 0.95 * ga; cx.lineWidth = 1.8; cx.stroke(); }
                    else { cx.globalAlpha = (0.65 - 0.4 * dd + 0.25 * GL[S]) * ga; cx.lineWidth = 0.8; cx.stroke(); }
                }
                cx.globalAlpha = 1;
            }
            cx.restore();
        }
    }

    function colHue(u) {
        var stops = [[0, 350], [0.25, 315], [0.5, 28], [0.75, 185], [1, 225]];
        for (var i = 0; i < stops.length - 1; i++) {
            if (u <= stops[i + 1][0]) { var t = (u - stops[i][0]) / (stops[i + 1][0] - stops[i][0]); var a = stops[i][1], b = stops[i + 1][1]; if (b - a > 180) b -= 360; if (a - b > 180) b += 360; return (a + (b - a) * t + 720) % 360; }
        }
        return 225;
    }
    var PT = [];
    for (var pi = 0; pi < 90; pi++) PT.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, h: 0 });
    var ptc = 0;

    function drawDots(dt) {
        paintBg('#000', '#010103', 'linear');
        var NC = Math.max(24, Math.min(64, Math.floor(W / 15))), px = W / NC;
        var NRD = Math.max(12, Math.min(30, Math.floor(H * 0.5 / px)));
        var by = H * 0.74, rad = Math.max(1.5, px * 0.3), c, rr, pass;
        cx.globalCompositeOperation = 'lighter';
        var gl = cx.createRadialGradient(W / 2, by, 0, W / 2, by, Math.max(W, H) * 0.55);
        gl.addColorStop(0, 'rgba(255,90,120,' + (0.05 + 0.2 * st.kick + 0.08 * st.bass) + ')'); gl.addColorStop(1, 'rgba(255,90,120,0)');
        cx.fillStyle = gl; cx.fillRect(0, 0, W, H);
        cx.fillStyle = 'rgba(255,255,255,0.05)';
        cx.beginPath();
        for (c = 0; c < NC; c++) for (rr = 0; rr < NRD; rr++) cx.rect((c + 0.5) * px - rad * 0.5, by - (rr + 0.5) * px - rad * 0.5, rad, rad);
        cx.fill();
        for (pass = 0; pass < 2; pass++) {
            var refl = pass === 1;
            for (c = 0; c < NC; c++) {
                var u = (c + 0.5) / NC, hue = colHue(u), x = (c + 0.5) * px;
                var L = Math.pow(clamp01(specAt(st.sp, u)), 0.9) * NRD, full = Math.floor(L), frac = L - full;
                var pr = Math.round(clamp01(specAt(st.pk, u)) * NRD);
                var tiers = 3, tier;
                for (tier = 0; tier < tiers; tier++) {
                    var r0 = Math.floor(full * tier / tiers), r1 = Math.floor(full * (tier + 1) / tiers);
                    if (r1 <= r0) continue;
                    var a = 0.62 + 0.3 * (tier / (tiers - 1));
                    if (refl) a *= 0.2;
                    cx.fillStyle = hsl(hue, 100, 52 + 10 * tier, a);
                    cx.beginPath();
                    for (rr = r0; rr < r1; rr++) {
                        var y = refl ? by + (rr + 0.8) * px * 0.9 : by - (rr + 0.5) * px;
                        cx.moveTo(x + rad, y); cx.arc(x, y, rad, 0, P2);
                    }
                    cx.fill();
                }
                if (frac > 0.05 && full < NRD) {
                    var yt = refl ? by + (full + 0.8) * px * 0.9 : by - (full + 0.5) * px;
                    cx.fillStyle = hsl(hue, 100, 64, 0.9 * frac * (refl ? 0.2 : 1));
                    cx.beginPath(); cx.arc(x, yt, rad, 0, P2); cx.fill();
                }
                if (pr > full + 1 && pr <= NRD) {
                    var yp = refl ? by + (pr + 0.8) * px * 0.9 : by - (pr + 0.5) * px;
                    cx.fillStyle = 'rgba(255,245,235,' + (refl ? 0.14 : 0.85) + ')';
                    cx.beginPath(); cx.arc(x, yp, rad * 0.9, 0, P2); cx.fill();
                }
            }
        }
        if (st.kick > 0.85) {
            for (var q = 0; q < 26; q++) {
                var p = PT[ptc]; ptc = (ptc + 1) % PT.length;
                p.on = true; p.x = Math.random() * W; p.y = by - Math.random() * NRD * px * 0.6; p.vx = (Math.random() - 0.5) * 30; p.vy = -(30 + Math.random() * 90); p.life = p.max = 0.8 + Math.random(); p.h = colHue(p.x / W);
            }
        }
        for (var i = 0; i < PT.length; i++) {
            var pp = PT[i];
            if (!pp.on) continue;
            pp.life -= dt;
            if (pp.life <= 0) { pp.on = false; continue; }
            pp.x += pp.vx * dt; pp.y += pp.vy * dt; pp.vy *= 1 - 0.5 * dt;
            var al = Math.sin(Math.min(1, pp.life / pp.max) * Math.PI) * 0.7;
            cx.fillStyle = hsl(pp.h, 100, 62, al);
            cx.beginPath(); cx.arc(pp.x, pp.y, 1.6, 0, P2); cx.fill();
        }
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (document.hidden) { last = now; return; }
        var t = now / 1000, dt = Math.min(0.05, last ? t - last : 0.016);
        last = t;
        fe += (dt * 1000 - fe) * 0.06;
        qTimer += dt;
        if (qTimer > 1.5) {
            qTimer = 0;
            if (fe > 27 && Q > 0.5) { Q -= 0.25; qUp = 0; resize(); }
            else if (fe < 17.5 && Q < 1) { if (++qUp >= 3) { Q += 0.25; qUp = 0; resize(); } }
            else qUp = 0;
        }
        tm += dt * (st.playing ? 1 : 0.4);
        var t0 = performance.now();
        analyze(dt, t);
        pushHist(dt);
        cx.setTransform(DPR, 0, 0, DPR, 0, 0);
        if (scene === '1c') drawRidge();
        else if (scene === '2') drawNeon(dt);
        else if (scene === '3') drawHair(dt);
        else if (scene === '5') drawDots(dt);
        else drawGlow();
        cx.globalCompositeOperation = 'source-over';
        cx.globalAlpha = 1;
        st.js += (performance.now() - t0 - st.js) * 0.08;
    }

    function setPlaying(v) {
        st.playing = v;
        document.body.classList.toggle('is-playing', v);
    }

    function ensureGraph() {
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!ctx) ctx = new AC();
            if (ctx.state === 'suspended') ctx.resume();
            if (!srcNode && audioEl.crossOrigin) {
                srcNode = ctx.createMediaElementSource(audioEl);
                an = ctx.createAnalyser();
                an.fftSize = 4096; an.smoothingTimeConstant = 0.45; an.minDecibels = -100; an.maxDecibels = -10;
                fd = new Float32Array(an.frequencyBinCount);
                srcNode.connect(an); an.connect(ctx.destination);
                real = true;
            }
        } catch (e) { real = false; }
    }

    window.MusicBG = {
        attach: function (audio) {
            audioEl = audio;
            audio.crossOrigin = 'anonymous';
            audio.addEventListener('playing', function () { errs = 0; setPlaying(true); ensureGraph(); });
            audio.addEventListener('pause', function () { setPlaying(false); });
            audio.addEventListener('ended', function () { setPlaying(false); });
            audio.addEventListener('waiting', function () { setPlaying(false); });
            audio.addEventListener('error', function () {
                setPlaying(false);
                errs++;
                if (!srcNode && errs >= 2 && audio.crossOrigin) audio.removeAttribute('crossorigin');
            });
        },
        getState: function () { return st; },
        perf: function () { return { ms: fe, js: st.js, q: Q, agc: agc }; },
        setScene: function (n) { scene = String(n) === '1' ? '1c' : String(n); },
        isReal: function () { return real; }
    };

    function boot() {
        document.body.appendChild(cv);
        resize();
        window.addEventListener('resize', resize);
        requestAnimationFrame(frame);
    }
    if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
