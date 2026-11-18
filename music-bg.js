(function () {
    var TEAL = '32,201,151';
    var CYAN = '32,201,151';
    var cv = document.createElement('canvas');
    cv.id = 'musicBg';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;';
    var cx = cv.getContext('2d');
    var W = 0, H = 0, DPR = 1;
    var ROWS = 26, COLS = 38, BANDS = 48, NP = 260;

    var st = { playing: false, bass: 0, mid: 0, treb: 0, lvl: 0, kick: 0, speed: 0, phase: 0, amp: 0.45, ema: 0.2, lastKick: 0, breathe: 0, K: 0.22, sp: new Float32Array(BANDS) };
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
            for (i = 0; i < BANDS; i++) sp[i] = ease(sp[i], 0.1 + 0.05 * Math.sin(t * 0.6 + i * 0.4), 3, dt);
        }
        st.bass = ease(st.bass, bass, bass > st.bass ? 22 : 5, dt);
        st.mid = ease(st.mid, mid, mid > st.mid ? 16 : 5, dt);
        st.treb = ease(st.treb, treb, treb > st.treb ? 16 : 6, dt);
        st.lvl = st.bass * 0.6 + st.mid * 0.4;
        st.ema = ease(st.ema, bass, 1.2, dt);
        var kicked = false;
        if (st.playing && bass > 0.3 && bass > st.ema * 1.22 + 0.04 && t - st.lastKick > 0.2) { st.kick = 1; st.lastKick = t; kicked = true; }
        st.kick = Math.max(0, st.kick - dt * 3.2);
        var tgtSpeed = st.playing ? 0.45 + st.bass * 2.2 + st.kick * 1.4 : 0.05;
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

    var scene = '1', relief = 0, nowT = 0;

    function bandAt(u) {
        var x = Math.min(1, Math.abs(u - 0.5) * 2) * 0.92 * (BANDS - 1);
        var lo = Math.floor(x), hi = Math.min(BANDS - 1, lo + 1);
        return st.sp[lo] + (st.sp[hi] - st.sp[lo]) * (x - lo);
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
        paintBg(color ? '#0a0d2a' : '#000', color ? '#04050f' : '#000', 'linear');
        var rows = 66, top = H * 0.26, bot = H * 1.03;
        var f = st.phase % 1, base = Math.floor(st.phase);
        var bg = color ? '#050716' : '#000';
        var step = Math.max(5, W / 190);
        for (var k = 0; k < rows; k++) {
            var q = (k + f) / rows;
            var y = top + (bot - top) * Math.pow(q, 1.6);
            var id = base - k;
            var amp = (0.2 + q * 0.95) * H * 0.13 * (0.3 + relief * 0.9);
            cx.globalCompositeOperation = 'source-over';
            var x, u, h, nv, pk;
            var xs = [], ys = [];
            for (x = -step; x <= W + step; x += step) {
                u = x / W;
                nv = vnoise(u * 5.2 + 3, id * 0.33);
                pk = Math.pow(nv, 2.5) * 1.75 + vnoise(u * 14, id * 0.5) * 0.22;
                h = pk * amp * (0.42 + Math.min(1, bandAt(u)) * 0.95);
                xs.push(x); ys.push(y - h);
            }
            cx.beginPath();
            cx.moveTo(xs[0], H + 6);
            for (var i = 0; i < xs.length; i++) cx.lineTo(xs[i], ys[i]);
            cx.lineTo(xs[xs.length - 1], H + 6);
            cx.closePath();
            cx.fillStyle = bg; cx.fill();
            var a = 0.4 + 0.6 * q;
            var kb = Math.min(1, st.kick * 0.5);
            if (color) cx.strokeStyle = hsl(lerp(188, 318, q), 90, 58 + kb * 20, a);
            else cx.strokeStyle = 'rgba(255,255,255,' + Math.min(1, a + kb * 0.2) + ')';
            cx.lineWidth = 0.9 + q * 1.1;
            cx.beginPath();
            for (i = 0; i < xs.length; i++) { if (i === 0) cx.moveTo(xs[i], ys[i]); else cx.lineTo(xs[i], ys[i]); }
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
                xs.push(x); ys.push(y);
            }
            var path = function () { cx.beginPath(); for (var i = 0; i < xs.length; i++) { if (i === 0) cx.moveTo(xs[i], ys[i]); else cx.lineTo(xs[i], ys[i]); } };
            path(); cx.strokeStyle = hsl(hue, 100, 60, 0.07 + 0.05 * st.kick); cx.lineWidth = 7 + q * 6; cx.stroke();
            path(); cx.strokeStyle = hsl(hue, 100, 68, 0.5 + 0.4 * q); cx.lineWidth = 1 + q * 1.6; cx.stroke();
        }
    }

    function drawHair(t) {
        paintBg('#041326', '#02101c', 'linear');
        cx.globalCompositeOperation = 'lighter';
        var R = 3, N = 52, spd = 0.35 + st.speed * 0.4, step = Math.max(8, W / 100);
        for (var r = 0; r < R; r++) {
            var by = H * (0.26 + 0.24 * r), ph = r * 2.3;
            var xs = [], A = [], B = [];
            for (var x = -step; x <= W + step; x += step) {
                var u = x / W;
                var band = bandAt(u);
                var a = by + Math.sin(u * 3.1 * Math.PI + t * spd * 0.5 + ph) * H * 0.09 * (0.5 + relief * 0.8) + Math.sin(u * 8 - t * spd * 0.7 + ph) * H * 0.03 * (0.4 + band * relief * 2);
                var gap = Math.sin(u * 2.3 * Math.PI + t * spd * 0.33 + ph * 1.7) * H * (0.07 + 0.1 * relief) * (0.5 + band * 1.2);
                xs.push(x); A.push(a); B.push(a + gap);
            }
            var g = cx.createLinearGradient(0, 0, W, 0);
            var h0 = 215 + r * 30;
            g.addColorStop(0, hsl(h0, 100, 62, 0.75)); g.addColorStop(0.35, hsl(190, 90, 70, 0.7)); g.addColorStop(0.68, hsl(300, 70, 68, 0.65)); g.addColorStop(1, hsl(335, 80, 66, 0.7));
            cx.strokeStyle = g; cx.lineWidth = 0.7;
            for (var i = 0; i < N; i++) {
                var fr = i / (N - 1);
                fr = fr * fr * (3 - 2 * fr) * 0.35 + fr * 0.65;
                cx.beginPath();
                for (var j = 0; j < xs.length; j++) { var yy = A[j] + (B[j] - A[j]) * fr; if (j === 0) cx.moveTo(xs[j], yy); else cx.lineTo(xs[j], yy); }
                cx.globalAlpha = 0.35 + 0.35 * st.lvl + 0.25 * Math.sin(fr * 3.14);
                cx.stroke();
            }
            cx.globalAlpha = 1;
        }
    }

    function drawGlowWaves(t) {
        paintBg('#010204', '#03070d', 'linear');
        var hz = H * 0.64;
        var layers = [[30, 215, 255, 0.0], [255, 175, 50, 2.1], [255, 70, 50, 4.2]];
        var step = Math.max(8, W / 110);
        for (var pass = 0; pass < 2; pass++) {
            for (var L = 0; L < layers.length; L++) {
                var lc = layers[L], col = lc[0] + ',' + lc[1] + ',' + lc[2];
                var hs = [], xs = [];
                for (var x = -step; x <= W + step; x += step) {
                    var u = x / W;
                    var env = 0.45 + 0.55 * Math.sin(u * Math.PI * (1.2 + L * 0.5) + t * 0.12 + lc[3]);
                    var w = Math.sin(u * 5.2 + t * (0.3 + st.speed * 0.3) * (L + 1) * 0.6 + lc[3]) * 0.5 + 0.5;
                    var h = H * 0.3 * (0.12 + 0.46 * env * w * (0.55 + relief * 0.7) + bandAt(u) * relief * (0.8 - L * 0.1) * (0.4 + env));
                    xs.push(x); hs.push(h);
                }
                for (var bp = 0; bp < 3; bp++) {
                    var hb = hs.slice();
                    for (var bi = 2; bi < hs.length - 2; bi++) hb[bi] = (hs[bi - 2] + hs[bi - 1] + hs[bi] + hs[bi + 1] + hs[bi + 2]) / 5;
                    hs = hb;
                }
                var refl = pass === 1;
                cx.save();
                if (refl) cx.setTransform(DPR, 0, 0, -0.32 * DPR, 0, 1.32 * hz * DPR);
                var ga = refl ? 0.28 : 1;
                cx.globalCompositeOperation = 'lighter';
                var gr = cx.createLinearGradient(0, hz - H * 0.35, 0, hz);
                gr.addColorStop(0, 'rgba(' + col + ',' + (0.3 * ga) + ')'); gr.addColorStop(1, 'rgba(' + col + ',0)');
                cx.beginPath(); cx.moveTo(xs[0], hz);
                for (var i = 0; i < xs.length; i++) cx.lineTo(xs[i], hz - hs[i]);
                cx.lineTo(xs[xs.length - 1], hz); cx.closePath();
                cx.fillStyle = gr; cx.fill();
                for (var m = 0; m < 14; m++) {
                    var sc = 1 - m / 14 * 0.94;
                    cx.beginPath();
                    for (i = 0; i < xs.length; i++) { var yy = hz - hs[i] * sc; if (i === 0) cx.moveTo(xs[i], yy); else cx.lineTo(xs[i], yy); }
                    cx.strokeStyle = 'rgba(' + col + ',' + ((0.5 - m * 0.028 + 0.2 * st.lvl) * ga) + ')';
                    cx.lineWidth = m === 0 ? 1.8 : 0.9;
                    cx.stroke();
                }
                cx.restore();
            }
        }
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (document.hidden) { last = now; return; }
        var t = now / 1000, dt = Math.min(0.05, last ? t - last : 0.016);
        last = t; nowT = t;
        readAudio(dt, t);
        relief = ease(relief, st.playing ? 0.5 + 1.2 * st.lvl + 0.5 * st.kick : 0.28, 6, dt);
        cx.setTransform(DPR, 0, 0, DPR, 0, 0);
        if (scene === '1') drawRidges(false);
        else if (scene === '1c') drawRidges(true);
        else if (scene === '2') drawNeon(t);
        else if (scene === '3') drawHair(t);
        else drawGlowWaves(t);
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
        setScene: function (n) { scene = String(n); },
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
