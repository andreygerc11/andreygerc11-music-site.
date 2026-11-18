(function () {
    var TEAL = '32,201,151';
    var CYAN = '56,208,240';
    var cv = document.createElement('canvas');
    cv.id = 'musicBg';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;';
    var cx = cv.getContext('2d');
    var W = 0, H = 0, DPR = 1;
    var ROWS = 26, COLS = 38, BANDS = 48, NP = 260;

    var st = { playing: false, bass: 0, mid: 0, treb: 0, lvl: 0, kick: 0, speed: 0, phase: 0, amp: 0.45, ema: 0.2, lastKick: 0, breathe: 0, sp: new Float32Array(BANDS) };
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
        var tgtSpeed = st.playing ? 0.35 + st.bass * 2.4 + st.kick * 1.6 : 0;
        st.speed = ease(st.speed, tgtSpeed, st.playing ? 5 : 2.2, dt);
        st.phase += st.speed * dt;
        var tgtAmp = st.playing ? 0.6 + st.lvl * 1.15 + st.kick * 0.35 : 0.5;
        st.amp = ease(st.amp, tgtAmp, 6, dt);
        st.breathe = 0.5 + 0.5 * Math.sin(t * 0.8);
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

    function drawGlow() {
        var hz = H * 0.58;
        var ga = 0.07 + 0.08 * st.breathe + 0.26 * st.lvl + 0.2 * st.kick;
        var g = cx.createRadialGradient(W / 2, hz, 0, W / 2, hz, Math.max(W, H) * 0.62);
        g.addColorStop(0, 'rgba(' + TEAL + ',' + ga + ')');
        g.addColorStop(0.45, 'rgba(' + CYAN + ',' + (ga * 0.25) + ')');
        g.addColorStop(1, 'rgba(' + TEAL + ',0)');
        cx.globalCompositeOperation = 'lighter';
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    }

    function drawRibbons(t) {
        cx.globalCompositeOperation = 'lighter';
        cx.lineCap = 'round';
        var drive = st.playing ? 1 : 0.35;
        for (var r = 0; r < 4; r++) {
            var by = H * (0.14 + 0.085 * r);
            var step = Math.max(8, W / 90);
            var pts = [];
            for (var x = -step; x <= W + step; x += step) {
                var u = x / W;
                var band = st.sp[Math.min(BANDS - 1, Math.floor(Math.abs(u - 0.5) * 2 * (BANDS - 1)))];
                var y = by
                    + Math.sin(x * 0.0042 * (1 + r * 0.25) + t * (0.32 + r * 0.11) + r * 2.1) * H * 0.028 * (0.8 + st.amp * 0.4)
                    + Math.sin(x * 0.012 - t * (0.55 + r * 0.1) + r) * H * 0.07 * (0.12 + band * 1.5) * drive;
                pts.push([x, y]);
            }
            var a = 0.35 + 0.5 * st.lvl + 0.3 * st.kick;
            var col = r % 2 ? CYAN : TEAL;
            cx.beginPath();
            for (var i = 0; i < pts.length; i++) { if (i === 0) cx.moveTo(pts[i][0], pts[i][1]); else cx.lineTo(pts[i][0], pts[i][1]); }
            cx.strokeStyle = 'rgba(' + col + ',' + (0.09 * a + 0.03) + ')';
            cx.lineWidth = 7; cx.stroke();
            cx.strokeStyle = 'rgba(' + col + ',' + Math.min(0.85, 0.22 + 0.5 * a) + ')';
            cx.lineWidth = 1.2; cx.stroke();
            var q = ((t * (0.05 + st.speed * 0.05) + r * 0.31) % 1);
            var idx = Math.min(pts.length - 1, Math.floor(q * (pts.length - 1)));
            var dx = pts[idx][0], dy = pts[idx][1];
            var rg = cx.createRadialGradient(dx, dy, 0, dx, dy, 14 + 18 * st.kick);
            rg.addColorStop(0, 'rgba(220,255,248,' + (0.55 + 0.35 * st.lvl) + ')');
            rg.addColorStop(1, 'rgba(' + col + ',0)');
            cx.fillStyle = rg; cx.fillRect(dx - 34, dy - 34, 68, 68);
        }
    }

    function rowPath(pts, closeDown) {
        cx.beginPath();
        if (closeDown) cx.moveTo(pts[0][0], H + 4); else cx.moveTo(pts[0][0], pts[0][1]);
        if (closeDown) cx.lineTo(pts[0][0], pts[0][1]);
        for (var c = 0; c < pts.length - 1; c++) {
            var mx = (pts[c][0] + pts[c + 1][0]) / 2, my = (pts[c][1] + pts[c + 1][1]) / 2;
            cx.quadraticCurveTo(pts[c][0], pts[c][1], mx, my);
        }
        cx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        if (closeDown) { cx.lineTo(pts[pts.length - 1][0], H + 4); cx.closePath(); }
    }

    function drawTerrain() {
        var hz = H * 0.58, span = H - hz;
        var f = st.phase % 1, base = Math.floor(st.phase);
        var prev = null;
        var midRow = Math.floor(ROWS * 0.62);
        for (var k = 0; k < ROWS; k++) {
            var d = (k + f + 0.15) / (ROWS + 0.15);
            var y = hz + span * d * d;
            var sw = (0.06 + Math.pow(d, 1.25) * 1.55) * W * 0.5;
            var rid = base - k;
            var pts = [];
            for (var c = 0; c < COLS; c++) {
                var xw = (c / (COLS - 1)) * 2 - 1, ax = Math.abs(xw);
                var edge = smooth(0.1, 0.92, ax);
                var n = vnoise(xw * 3.1 + 11, rid * 0.5);
                n = 0.3 + n * n * 1.5;
                var band = st.sp[Math.min(BANDS - 1, Math.floor((1 - ax) * (BANDS - 1)))];
                var hh = edge * n * (0.35 + band * 1.25) * st.amp;
                var hp = hh * span * 0.42 * (0.15 + d * 1.05);
                pts.push([W / 2 + xw * sw, y - hp]);
            }
            if (k === midRow) ridge = pts;
            cx.globalCompositeOperation = 'source-over';
            rowPath(pts, true);
            cx.fillStyle = 'rgba(6,14,19,0.93)'; cx.fill();
            var a = 0.14 + 0.86 * Math.pow(d, 0.7);
            var br = Math.min(1, st.kick * 0.8);
            var cr = Math.round(32 + 190 * br), cg = Math.round(201 + 40 * br), cb = Math.round(151 + 90 * br);
            cx.globalCompositeOperation = 'lighter';
            if (prev) {
                cx.strokeStyle = 'rgba(' + TEAL + ',' + (a * 0.32) + ')';
                cx.lineWidth = 0.6 + d * 0.5;
                cx.beginPath();
                for (c = 0; c < COLS; c++) { cx.moveTo(prev[c][0], prev[c][1]); cx.lineTo(pts[c][0], pts[c][1]); }
                cx.stroke();
            }
            rowPath(pts, false);
            cx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (a * 0.14) + ')';
            cx.lineWidth = 4 + d * 7; cx.stroke();
            cx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + Math.min(1, a * (0.8 + 0.2 * st.lvl)) + ')';
            cx.lineWidth = 0.8 + d * 1.2; cx.stroke();
            prev = pts;
        }
    }

    function drawParticles(dt, t, kicked) {
        var rate = (st.playing ? 36 + st.lvl * 120 : 10) * dt;
        var i, n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
        for (i = 0; i < n; i++) {
            var px = Math.random() * W, py = H * (0.45 + Math.random() * 0.55);
            spawn(px, py, (Math.random() - 0.5) * 14, -(10 + Math.random() * 34) * (st.playing ? 1 + st.lvl * 2 : 0.6), 2 + Math.random() * 3, 0.6 + Math.random() * 1.6, Math.random() < 0.7 ? 0 : 1);
        }
        if (kicked && ridge) {
            for (i = 0; i < 46; i++) {
                var rp = ridge[Math.floor(Math.random() * ridge.length)];
                var ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = 40 + Math.random() * 150;
                spawn(rp[0], rp[1], Math.cos(ang) * sp, Math.sin(ang) * sp, 0.9 + Math.random() * 1.3, 0.9 + Math.random() * 1.9, Math.random() < 0.5 ? 0 : 1);
            }
        }
        cx.globalCompositeOperation = 'lighter';
        for (i = 0; i < NP; i++) {
            var p = P[i];
            if (!p.on) continue;
            p.life -= dt;
            if (p.life <= 0) { p.on = false; continue; }
            p.x += p.vx * dt; p.y += p.vy * dt;
            p.vx *= 1 - 0.4 * dt; p.vy *= 1 - 0.25 * dt;
            var k = p.life / p.max;
            var al = Math.sin(Math.min(1, k) * Math.PI) * (0.55 + 0.4 * Math.sin(t * 5 + i));
            if (al <= 0.02) continue;
            cx.fillStyle = 'rgba(' + (p.hue ? CYAN : TEAL) + ',' + (al * 0.28) + ')';
            cx.beginPath(); cx.arc(p.x, p.y, p.s * 3.2, 0, 6.2832); cx.fill();
            cx.fillStyle = 'rgba(225,255,250,' + al + ')';
            cx.beginPath(); cx.arc(p.x, p.y, p.s * 0.8, 0, 6.2832); cx.fill();
        }
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (document.hidden) { last = now; return; }
        var t = now / 1000, dt = Math.min(0.05, last ? t - last : 0.016);
        last = t;
        var kicked = readAudio(dt, t);
        drawSky();
        drawGlow();
        drawRibbons(t);
        drawTerrain();
        drawParticles(dt, t, kicked);
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
