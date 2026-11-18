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

    function drawSky() {
        var g = cx.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, Math.max(W, H) * 0.75);
        g.addColorStop(0, '#12202b'); g.addColorStop(1, '#08090b');
        cx.globalCompositeOperation = 'source-over';
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    }

    var peaks = new Float32Array(256);
    var gScroll = 0, relief = 0;

    function gk() { return Math.max(0, Math.min(1.3, (st.K - 0.2) / 0.65)); }

    function drawSpectrum(t) {
        var g0 = gk();
        if (g0 < 0.02) return;
        var hz = H * 0.5;
        var N = Math.max(24, Math.min(160, Math.floor(W / 8)));
        var bw = W / N;
        cx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < N; i++) {
            var u = i / (N - 1);
            var fi = u * (BANDS - 1), lo = Math.floor(fi), hi = Math.min(BANDS - 1, lo + 1);
            var v = st.sp[lo] + (st.sp[hi] - st.sp[lo]) * (fi - lo);
            var val = v * (0.75 + 0.3 * st.lvl + 0.4 * (1 - u) * st.kick);
            var h = val * hz * 0.9;
            var x = i * bw;
            var g = cx.createLinearGradient(0, hz, 0, hz - h);
            g.addColorStop(0, 'rgba(' + TEAL + ',' + (0.32 * g0) + ')');
            g.addColorStop(1, 'rgba(' + TEAL + ',0)');
            cx.fillStyle = g;
            cx.fillRect(x + bw * 0.2, hz - h, bw * 0.6, h);
            peaks[i] = Math.max(peaks[i] - 0.004, val);
            cx.fillStyle = 'rgba(190,235,225,' + (0.4 * g0) + ')';
            cx.fillRect(x + bw * 0.2, hz - peaks[i] * hz * 0.9 - 3, bw * 0.6, 2);
        }
    }

    function drawGrid(dt, t) {
        var g0 = gk();
        gScroll += (2.5 + st.speed * 42) * dt;
        relief = ease(relief, st.playing ? 0.4 + 1.2 * st.lvl + 0.5 * st.kick : 0, 6, dt);
        var CS = 50, off = gScroll % CS, base = Math.floor(gScroll / CS);
        var VMAX = 480, VMIN = -H * 1.0;
        var alpha = 0.045 + 0.5 * g0;
        function lift(u, v) {
            var ax = Math.min(1, Math.abs(u) / W);
            var wall = smooth(0.1, 0.7, ax);
            var r = (v - off) / CS - base;
            var n = vnoise(u / 120 + 7, r * 0.55);
            var band = st.sp[Math.min(BANDS - 1, Math.floor(ax * 0.9 * (BANDS - 1)))];
            return relief * wall * (0.2 + n) * (26 + band * 260);
        }
        function proj(u, v) {
            var z = v * 0.866;
            if (z >= 430) return null;
            var sc = 500 / (500 - z);
            return [W / 2 + u * sc, H / 2 + v * 0.5 * sc - lift(u, v) * sc, sc];
        }
        var bright = st.kick * 0.5;
        var col = 'rgba(' + Math.round(32 + 160 * bright) + ',' + Math.round(201 + 34 * bright) + ',' + Math.round(151 + 74 * bright) + ',';
        cx.globalCompositeOperation = 'lighter';
        cx.lineJoin = 'round';
        for (var pass = 0; pass < 2; pass++) {
            if (pass === 0 && g0 < 0.12) continue;
            var A = pass === 0 ? alpha * 0.16 : alpha;
            cx.beginPath();
            var jmin = Math.floor(VMIN / CS) - 1, jmax = Math.ceil(VMAX / CS);
            var uStep = 40, i, p;
            for (var j = jmin; j <= jmax; j++) {
                var v = j * CS + off, started = false;
                for (var u = -W; u <= W + 1; u += uStep) {
                    p = proj(u, v);
                    if (!p) { started = false; continue; }
                    if (!started) { cx.moveTo(p[0], p[1]); started = true; } else cx.lineTo(p[0], p[1]);
                }
            }
            var imax = Math.ceil(W / CS);
            for (i = -imax; i <= imax; i++) {
                var uu = i * CS, st2 = false;
                for (var vv = VMIN + off; vv <= VMAX; vv += 25) {
                    p = proj(uu, vv);
                    if (!p) { st2 = false; continue; }
                    if (!st2) { cx.moveTo(p[0], p[1]); st2 = true; } else cx.lineTo(p[0], p[1]);
                }
            }
            cx.strokeStyle = col + Math.min(0.9, A) + ')';
            cx.lineWidth = pass === 0 ? 5 : 1;
            cx.stroke();
        }
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (document.hidden) { last = now; return; }
        var t = now / 1000, dt = Math.min(0.05, last ? t - last : 0.016);
        last = t;
        readAudio(dt, t);
        drawSky();
        drawSpectrum(t);
        drawGrid(dt, t);
        cx.globalCompositeOperation = 'source-over';
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
