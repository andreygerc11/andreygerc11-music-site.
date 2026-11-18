(function () {
    var TEAL = '32,201,151';
    var CYAN = '32,201,151';
    var cv = document.createElement('canvas');
    cv.id = 'musicBg';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;';
    var cx = cv.getContext('2d');
    var W = 0, H = 0, DPR = 1;
    var ROWS = 26, COLS = 38, BANDS = 48, NP = 260;

    var st = { playing: false, bass: 0, mid: 0, treb: 0, lvl: 0, kick: 0, speed: 0, phase: 0, amp: 0.45, ema: 0.2, lastKick: 0, breathe: 0, K: 0.22, sp: new Float32Array(BANDS), ss: new Float32Array(BANDS) };
    var ctx = null, an = null, srcNode = null, data = null, audioEl = null, real = false, errs = 0, last = 0;
    var ridge = null;
    var rs = 7;
    function rnd() { rs = (rs * 16807) % 2147483647; return rs / 2147483647; }

    var P = [];
    for (var pi = 0; pi < NP; pi++) P.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, s: 1, hue: 0, on: false });
    var pcur = 0;

    function hash(a, b) { var h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); }
    function vnoise(x, y) {
        var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
        var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        var a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
    function ease(cur, target, k, dt) { return cur + (target - cur) * Math.min(1, k * dt); }

    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, 1.5);
        W = window.innerWidth; H = window.innerHeight;
        cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
        cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    function readAudio(dt, t) {
        var bass = 0, mid = 0, treb = 0, i, sp = st.sp;
        if (st.playing && real && an) {
            an.getByteFrequencyData(data);
            var n;
            n = 0; for (i = 1; i <= 3; i++) { bass += data[i]; n++; } bass = bass / n / 255;
            n = 0; for (i = 4; i <= 20; i++) { mid += data[i]; n++; } mid = mid / n / 255;
            n = 0; for (i = 21; i <= 60; i++) { treb += data[i]; n++; } treb = treb / n / 255;
            for (i = 0; i < BANDS; i++) {
                var bi = Math.floor(1 + Math.pow(i / (BANDS - 1), 1.5) * 70);
                var tv = data[bi] / 255;
                sp[i] = ease(sp[i], tv, tv > sp[i] ? 20 : 5, dt);
            }
        } else if (st.playing) {
            var ct = audioEl ? audioEl.currentTime : t;
            var beat = (ct * 2) % 1;
            bass = 0.25 + 0.75 * Math.pow(1 - beat, 3);
            mid = 0.3 + 0.25 * Math.sin(ct * 3.1) * Math.sin(ct * 1.7);
            treb = 0.25 + 0.2 * Math.sin(ct * 7.3);
            for (i = 0; i < BANDS; i++) {
                var f = (0.25 + 0.55 * Math.pow(Math.sin(ct * 2.2 + i * 0.6), 2)) * (0.45 + bass * 0.7);
                sp[i] = ease(sp[i], f, f > sp[i] ? 14 : 5, dt);
            }
        } else {
            for (i = 0; i < BANDS; i++) sp[i] = ease(sp[i], 0, 3, dt);
        }
        st.bass = ease(st.bass, bass, bass > st.bass ? 22 : 5, dt);
        st.mid = ease(st.mid, mid, mid > st.mid ? 16 : 5, dt);
        st.treb = ease(st.treb, treb, treb > st.treb ? 16 : 6, dt);
        st.lvl = st.bass * 0.6 + st.mid * 0.4;
        st.ema = ease(st.ema, bass, 1.2, dt);
        var kicked = false;
        if (st.playing && bass > 0.3 && bass > st.ema * 1.22 + 0.04 && t - st.lastKick > 0.2) { st.kick = 1; st.lastKick = t; kicked = true; }
        st.kick = Math.max(0, st.kick - dt * 3.2);
        var tgtSpeed = st.playing ? 0.45 + st.bass * 2.2 + st.kick * 1.4 : 0;
        st.speed = ease(st.speed, tgtSpeed, st.playing ? 5 : 2.2, dt);
        st.phase += st.speed * dt;
        var tgtAmp = st.playing ? 0.6 + st.lvl * 1.15 + st.kick * 0.35 : 0.5;
        st.amp = ease(st.amp, tgtAmp, 6, dt);
        st.breathe = 0.5 + 0.5 * Math.sin(t * 0.8);
        st.K = ease(st.K, st.playing ? Math.min(0.85, 0.3 + 0.5 * st.lvl + 0.25 * st.kick) : 0.2, 5, dt);
        var rt = document.documentElement.style;
        rt.setProperty('--bass', st.bass.toFixed(3));
        rt.setProperty('--lvl', st.lvl.toFixed(3));
        rt.setProperty('--kick', st.kick.toFixed(3));
        return kicked;
    }

    function spawn(x, y, vx, vy, life, s, hue) {
        var p = P[pcur]; pcur = (pcur + 1) % NP;
        p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.s = s; p.hue = hue; p.on = true;
    }

    var scene = '1c', relief = 0, nowT = 0, act = 0, tm = 0;

    function curve(xs, ys, move) {
        if (move) cx.moveTo(xs[0], ys[0]); else cx.lineTo(xs[0], ys[0]);
        for (var i = 1; i < xs.length - 1; i++) cx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
        cx.lineTo(xs[xs.length - 1], ys[ys.length - 1]);
    }

    function smoothBands() {
        var a = st.sp, b = st.ss, i, pass, n = BANDS;
        for (i = 0; i < n; i++) b[i] = a[i];
        for (pass = 0; pass < 3; pass++) {
            var c = b.slice();
            for (i = 0; i < n; i++) {
                var l = Math.max(0, i - 2), r = Math.min(n - 1, i + 2), sum = 0, k;
                for (k = l; k <= r; k++) sum += c[k];
                b[i] = sum / (r - l + 1);
            }
        }
    }

    function bandAt(u) {
        var x = Math.min(1, Math.abs(u - 0.5) * 2) * 0.92 * (BANDS - 1);
        var lo = Math.floor(x), hi = Math.min(BANDS - 1, lo + 1);
        return st.ss[lo] + (st.ss[hi] - st.ss[lo]) * (x - lo);
    }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function hsl(h, sat, l, a) { return 'hsla(' + Math.round(h) + ',' + sat + '%,' + l + '%,' + a + ')'; }

    function paintBg(c0, c1, mode) {
        var g = mode === 'radial' ? cx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.8) : cx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, c0); g.addColorStop(1, c1);
        cx.globalCompositeOperation = 'source-over';
        cx.globalAlpha = 1;
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    }

    function drawRidges(color) {
        paintBg(color ? '#0a0d2a' : '#0c0c0c', color ? '#04050f' : '#000', 'linear');
        var rows = 150, top = H * 0.08, bot = H * 1.05;
        var f = st.phase % 1, base = Math.floor(st.phase);
        var bgc = color ? '#050716' : '#000';
        var step = Math.max(6, W / 120);
        var kb = Math.min(1, st.kick * 0.5);
        for (var k = 0; k < rows; k++) {
            var q = (k + f) / rows;
            var y = top + (bot - top) * Math.pow(q, 1.25);
            var id = base - k;
            var amp = (0.25 + q * 0.9) * H * 0.17 * (0.3 + relief * 0.75) * act;
            var xs = [], ys = [], x, u, n, sp, spike, h;
            for (x = -step; x <= W + step; x += step) {
                u = x / W;
                n = 0.6 * vnoise(u * 2.1 + 1.7, id * 0.085) + 0.32 * vnoise(u * 4.2 + 8, id * 0.17) + 0.08 * vnoise(u * 7 + 3, id * 0.3);
                sp = vnoise(u * 3.3 + 9, id * 0.11);
                spike = sp > 0.72 ? Math.pow((sp - 0.72) * 3.2, 2) : 0;
                h = (Math.pow(n, 1.8) * 2.0 + spike) * amp * (0.5 + 0.9 * Math.min(1, bandAt(u)));
                xs.push(x); ys.push(y - h);
            }
            cx.globalCompositeOperation = 'source-over';
            cx.beginPath();
            cx.moveTo(xs[0], H + 6);
            curve(xs, ys, false);
            cx.lineTo(xs[xs.length - 1], H + 6);
            cx.closePath();
            cx.fillStyle = bgc; cx.fill();
            var a = 0.5 + 0.5 * q;
            if (color) cx.strokeStyle = hsl(lerp(188, 318, q), 90, 58 + kb * 20, a);
            else cx.strokeStyle = 'rgba(255,255,255,' + Math.min(1, a + kb * 0.2) + ')';
            cx.lineWidth = 0.9 + q * 0.6;
            cx.beginPath();
            curve(xs, ys, true);
            cx.stroke();
        }
    }

    function drawNeon(t) {
        paintBg('#1c0e5e', '#05041f', 'radial');
        cx.globalCompositeOperation = 'lighter';
        var blobs = [[0.15, 0.35, 255, 150, 60, 0.2], [0.85, 0.3, 140, 90, 255, 0.22], [0.5, 0.75, 255, 60, 200, 0.16]];
        for (var b = 0; b < blobs.length; b++) {
            var bx = (blobs[b][0] + 0.06 * Math.sin(t * 0.13 + b * 2)) * W, by = (blobs[b][1] + 0.05 * Math.cos(t * 0.11 + b)) * H;
            var bg = cx.createRadialGradient(bx, by, 0, bx, by, Math.max(W, H) * (0.3 + 0.05 * st.lvl));
            bg.addColorStop(0, 'rgba(' + blobs[b][2] + ',' + blobs[b][3] + ',' + blobs[b][4] + ',' + (blobs[b][5] + 0.12 * st.lvl) + ')');
            bg.addColorStop(1, 'rgba(0,0,0,0)');
            cx.fillStyle = bg; cx.fillRect(0, 0, W, H);
        }
        var S = 36, spd = 0.5 + st.speed * 0.55;
        cx.lineCap = 'round'; cx.lineJoin = 'round';
        for (var s = 0; s < S; s++) {
            var q = s / (S - 1);
            var hue = q < 0.45 ? lerp(32, 315, q / 0.45) : lerp(315, 250, (q - 0.45) / 0.55);
            var xs = [], ys = [];
            for (var x = -12; x <= W + 12; x += 9) {
                var u = x / W;
                var w1 = Math.sin(u * 3.4 * Math.PI + t * spd * 0.7 + q * 2.2);
                var w2 = Math.sin(u * 7.3 - t * spd * 0.5 + q * 3.1) * 0.45;
                var y = H * (0.34 + 0.34 * q) - (w1 + w2) * H * 0.12 * (0.45 + 0.8 * q) * (0.4 + relief * 0.85) - bandAt(u) * H * 0.24 * relief * (1 - q * 0.45) * Math.sin(Math.min(1, Math.max(0, u)) * Math.PI);
                y = H * (0.34 + 0.34 * q) + (y - H * (0.34 + 0.34 * q)) * act;
                xs.push(x); ys.push(y);
            }
            var path = function () { cx.beginPath(); curve(xs, ys, true); };
            path(); cx.strokeStyle = hsl(hue, 100, 60, 0.07 + 0.05 * st.kick); cx.lineWidth = 7 + q * 6; cx.stroke();
            path(); cx.strokeStyle = hsl(hue, 100, 68, 0.5 + 0.4 * q); cx.lineWidth = 1 + q * 1.6; cx.stroke();
        }
    }

    function lowBand() { return (st.sp[1] + st.sp[2] + st.sp[3] + st.sp[4]) / 4; }

    function drawHair(t) {
        paintBg('#051630', '#04122a', 'linear');
        cx.globalCompositeOperation = 'lighter';
        var N = 46, spd = 0.25 + st.speed * 0.28, step = Math.max(6, W / 120);
        var am = (0.7 + 0.45 * st.lvl + 0.35 * lowBand()) * act;
        var P2 = Math.PI * 2;
        var rbs = [
            { cy: 0.3, phA: 0.0, phB: 1.9, per: 1.15, amp: 0.26, hue: 0 },
            { cy: 0.56, phA: 2.6, phB: 4.4, per: 0.95, amp: 0.3, hue: 1 },
            { cy: 0.76, phA: 5.1, phB: 0.7, per: 1.35, amp: 0.22, hue: 2 }
        ];
        for (var r = 0; r < rbs.length; r++) {
            var rb = rbs[r];
            var xs = [], A = [], B = [];
            for (var x = -step; x <= W + step; x += step) {
                var u = x / W;
                var a = H * rb.cy + Math.sin(u * P2 / rb.per + t * spd * 0.6 + rb.phA) * H * rb.amp * am + Math.sin(u * P2 * 2.3 / rb.per - t * spd * 0.9 + rb.phA * 1.3) * H * 0.035 * am;
                var b = H * (rb.cy + 0.07) + Math.sin(u * P2 / (rb.per * 1.12) + t * spd * 0.5 + rb.phB) * H * rb.amp * am * 0.95 + Math.sin(u * P2 * 1.9 / rb.per + t * spd * 0.7 + rb.phB) * H * 0.04 * am;
                xs.push(x); A.push(a); B.push(b);
            }
            var g = cx.createLinearGradient(0, 0, W, 0);
            if (rb.hue === 0) { g.addColorStop(0, 'rgba(40,90,255,0.95)'); g.addColorStop(0.4, 'rgba(80,210,255,0.85)'); g.addColorStop(0.75, 'rgba(200,215,255,0.75)'); g.addColorStop(1, 'rgba(255,90,200,0.9)'); }
            else if (rb.hue === 1) { g.addColorStop(0, 'rgba(200,225,255,0.7)'); g.addColorStop(0.35, 'rgba(90,150,255,0.85)'); g.addColorStop(0.7, 'rgba(170,110,230,0.8)'); g.addColorStop(1, 'rgba(255,80,190,0.9)'); }
            else { g.addColorStop(0, 'rgba(60,110,255,0.9)'); g.addColorStop(0.5, 'rgba(110,225,255,0.8)'); g.addColorStop(1, 'rgba(220,160,255,0.75)'); }
            cx.strokeStyle = g; cx.lineWidth = 0.8;
            for (var i = 0; i < N; i++) {
                var fr = i / (N - 1);
                cx.beginPath();
                var yl = [];
                for (var j = 0; j < xs.length; j++) yl.push(A[j] + (B[j] - A[j]) * fr);
                curve(xs, yl, true);
                cx.globalAlpha = 0.45 + 0.25 * st.lvl;
                cx.stroke();
            }
            cx.globalAlpha = 1;
        }
    }

    function drawGlowWaves(t) {
        paintBg('#000', '#02050a', 'linear');
        var hz = H * 0.66;
        var layers = [[255, 70, 50, 0.0, 1.0, 0.7, 1], [255, 175, 45, 2.1, 1.35, 0.85, -1], [40, 215, 255, 4.4, 1.7, 1.0, 1]];
        var step = Math.max(8, W / 120), P2 = Math.PI * 2;
        var am = (0.65 + 0.5 * st.lvl + 0.3 * lowBand()) * act;
        for (var pass = 0; pass < 2; pass++) {
            for (var L = 0; L < layers.length; L++) {
                var lc = layers[L], col = lc[0] + ',' + lc[1] + ',' + lc[2];
                var hs = [], xs = [];
                for (var x = -step; x <= W + step; x += step) {
                    var u = x / W;
                    var th = u * P2 * lc[4] + t * (0.18 + st.speed * 0.2) + lc[3];
                    var c1 = 0.5 + 0.5 * Math.sin(th + 0.7 * Math.sin(th * 0.5 + 1));
                    var c2 = 0.65 + 0.35 * Math.sin(u * P2 * lc[4] * 0.6 - t * 0.13 + lc[3] * 1.7);
                    var h = H * 0.4 * lc[5] * am * (0.1 + Math.pow(c1, 1.6) * c2) + H * 0.05 * relief * bandAt(u);
                    xs.push(x); hs.push(h);
                }
                for (var bp = 0; bp < 3; bp++) {
                    var hb = hs.slice();
                    for (var bi = 2; bi < hs.length - 2; bi++) hb[bi] = (hs[bi - 2] + hs[bi - 1] + hs[bi] + hs[bi + 1] + hs[bi + 2]) / 5;
                    hs = hb;
                }
                var refl = pass === 1;
                cx.save();
                if (refl) cx.setTransform(DPR, 0, 0, -0.3 * DPR, 0, 1.3 * hz * DPR);
                var ga = refl ? 0.25 : 1;
                cx.globalCompositeOperation = 'lighter';
                var gr = cx.createLinearGradient(0, hz - H * 0.4, 0, hz);
                gr.addColorStop(0, 'rgba(' + col + ',' + (0.34 * ga) + ')'); gr.addColorStop(1, 'rgba(' + col + ',0.02)');
                var yh = [];
                for (var i = 0; i < xs.length; i++) yh.push(hz - hs[i]);
                cx.beginPath(); cx.moveTo(xs[0], hz);
                curve(xs, yh, false);
                cx.lineTo(xs[xs.length - 1], hz); cx.closePath();
                cx.fillStyle = gr; cx.fill();
                for (var m = 0; m < 16; m++) {
                    var sc = Math.pow(1 - m / 16, 1.15);
                    cx.beginPath();
                    var sh = Math.round(m * 0.9 * lc[6]);
                    var yc = [];
                    for (i = 0; i < xs.length; i++) { var si = Math.max(0, Math.min(xs.length - 1, i + sh)); yc.push(hz - hs[si] * sc); }
                    curve(xs, yc, true);
                    cx.strokeStyle = 'rgba(' + col + ',' + ((0.75 - m * 0.04) * ga) + ')';
                    cx.lineWidth = m === 0 ? 2 : 0.8;
                    cx.stroke();
                }
                cx.restore();
            }
        }
    }

    function drawDots(t) {
        paintBg('#000', '#010103', 'linear');
        cx.globalCompositeOperation = 'lighter';
        var NR = 46, NC = Math.max(80, Math.min(260, Math.floor(W / 4)));
        var P2 = Math.PI * 2, f = st.phase % 1;
        var am = (0.6 + 0.55 * st.lvl + 0.3 * lowBand()) * act;
        var rowsY = [], k, c;
        var ridgeRows = { 9: 0, 21: 1, 35: 2 };
        var ridges = [[], [], []];
        for (k = 0; k < NR; k++) {
            var v = (k + f) / NR;
            var z = v * 3.2 - st.phase * 0.05;
            var by = H * (0.4 + 0.58 * Math.pow(v, 1.25));
            var ampv = H * 0.12 * (0.35 + 0.95 * v) * am;
            var hue;
            if (v < 0.25) hue = lerp(300, 350, v / 0.25);
            else if (v < 0.5) hue = lerp(350, 385, (v - 0.25) / 0.25);
            else if (v < 0.72) hue = lerp(25, 55, (v - 0.5) / 0.22);
            else hue = lerp(190, 215, (v - 0.72) / 0.28);
            if (hue >= 360) hue -= 360;
            var r = 1.1 + v * 1.7;
            var al = 0.5 + 0.45 * v;
            var big = v > 0.74;
            for (c = 0; c < NC; c++) {
                var u = c / (NC - 1);
                var h = Math.sin(u * P2 * 1.1 + z * 1.9 + t * 0.21) * 0.5 + Math.sin(u * P2 * 2.3 - z * 2.4 + t * 0.15) * 0.3 + Math.sin(u * P2 * 0.6 + z * 0.9 - t * 0.1) * 0.4 + bandAt(u) * relief * 0.55;
                var x = u * W, y = by - h * ampv;
                if (ridgeRows[k] !== undefined) ridges[ridgeRows[k]].push([x, y]);
                cx.fillStyle = hsl(hue, 100, 58, al * (0.7 + 0.3 * st.lvl));
                cx.fillRect(x - r * 0.5, y - r * 0.5, r, r);
                if (big && (c & 1) === 0) {
                    cx.fillStyle = hsl(hue, 100, 55, 0.07);
                    cx.beginPath(); cx.arc(x, y, r * 3.4, 0, 6.2832); cx.fill();
                }
            }
        }
        cx.lineCap = 'round'; cx.lineJoin = 'round';
        for (var q = 0; q < 3; q++) {
            var pts = ridges[q];
            if (!pts.length) continue;
            var g = cx.createLinearGradient(0, 0, W, 0);
            var off = (t * 0.03 + q * 0.33) % 1;
            var cols = ['rgba(180,90,255,', 'rgba(255,60,140,', 'rgba(255,200,60,', 'rgba(60,230,255,', 'rgba(255,255,255,'];
            for (var s2 = 0; s2 <= 4; s2++) g.addColorStop(s2 / 4, cols[(s2 + q * 2) % 5] + '0.95)');
            cx.beginPath();
            var px = [], py = [];
            for (c = 0; c < pts.length; c++) { px.push(pts[c][0]); py.push(pts[c][1]); }
            curve(px, py, true);
            cx.strokeStyle = g; cx.globalAlpha = 0.16 + 0.1 * st.lvl; cx.lineWidth = 9; cx.stroke();
            cx.globalAlpha = 0.55 + 0.35 * st.lvl; cx.lineWidth = 1.6; cx.stroke();
            cx.globalAlpha = 1;
        }
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (document.hidden) { last = now; return; }
        var t = now / 1000, dt = Math.min(0.05, last ? t - last : 0.016);
        last = t; nowT = t;
        readAudio(dt, t);
        act = ease(act, st.playing ? 1 : 0, 3, dt);
        tm += dt * act;
        relief = ease(relief, st.playing ? 0.5 + 1.2 * st.lvl + 0.5 * st.kick : 0, 6, dt);
        smoothBands();
        cx.setTransform(DPR, 0, 0, DPR, 0, 0);
        if (scene === '1c') drawRidges(true);
        else if (scene === '2') drawNeon(tm);
        else if (scene === '3') drawHair(tm);
        else if (scene === '5') drawDots(tm);
        else drawGlowWaves(tm);
        cx.globalCompositeOperation = 'source-over';
        cx.globalAlpha = 1;
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
                an.fftSize = 256; an.smoothingTimeConstant = 0.7;
                data = new Uint8Array(an.frequencyBinCount);
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
