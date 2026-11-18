(function () {
    var TEAL = '32,201,151';
    var cv = document.createElement('canvas');
    cv.id = 'musicBg';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;';
    var cx = cv.getContext('2d');
    var sunCv = document.createElement('canvas');
    var sx = sunCv.getContext('2d');
    var W = 0, H = 0, DPR = 1;
    var ROWS = 26, COLS = 38, BANDS = 48;

    var st = { playing: false, bass: 0, mid: 0, treb: 0, lvl: 0, kick: 0, speed: 0, phase: 0, amp: 0.45, ema: 0.2, lastKick: 0, sp: new Float32Array(BANDS) };
    var ctx = null, an = null, srcNode = null, data = null, audioEl = null, real = false, errs = 0, last = 0;
    var stars = [];
    var rs = 7;
    function rnd() { rs = (rs * 16807) % 2147483647; return rs / 2147483647; }
    for (var i = 0; i < 80; i++) stars.push([rnd(), rnd() * 0.55, 0.5 + rnd() * 1.1, rnd() * 6.28]);

    function hash(a, b) { var h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); }
    function vnoise(x, y) {
        var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
        var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        var a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, 1.5);
        W = window.innerWidth; H = window.innerHeight;
        cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
        cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    function ease(cur, target, k, dt) { return cur + (target - cur) * Math.min(1, k * dt); }

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
            for (i = 0; i < BANDS; i++) sp[i] = ease(sp[i], 0.12, 3, dt);
        }
        st.bass = ease(st.bass, bass, bass > st.bass ? 22 : 5, dt);
        st.mid = ease(st.mid, mid, mid > st.mid ? 16 : 5, dt);
        st.treb = ease(st.treb, treb, treb > st.treb ? 16 : 6, dt);
        st.lvl = st.bass * 0.6 + st.mid * 0.4;
        st.ema = ease(st.ema, bass, 1.2, dt);
        if (st.playing && bass > 0.3 && bass > st.ema * 1.22 + 0.04 && t - st.lastKick > 0.2) { st.kick = 1; st.lastKick = t; }
        st.kick = Math.max(0, st.kick - dt * 3.2);
        var tgtSpeed = st.playing ? 0.35 + st.bass * 2.4 + st.kick * 1.6 : 0;
        st.speed = ease(st.speed, tgtSpeed, st.playing ? 5 : 2.2, dt);
        st.phase += st.speed * dt;
        var tgtAmp = st.playing ? 0.6 + st.lvl * 1.15 + st.kick * 0.35 : 0.5;
        st.amp = ease(st.amp, tgtAmp, 6, dt);
        var rt = document.documentElement.style;
        rt.setProperty('--bass', st.bass.toFixed(3));
        rt.setProperty('--lvl', st.lvl.toFixed(3));
        rt.setProperty('--kick', st.kick.toFixed(3));
    }

    function drawSky(t) {
        var g = cx.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, Math.max(W, H) * 0.75);
        g.addColorStop(0, '#12202b'); g.addColorStop(1, '#08090b');
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
        var hz = H * 0.58;
        for (var i = 0; i < stars.length; i++) {
            var s = stars[i];
            cx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.3 + s[3]));
            cx.fillStyle = '#cfeee6';
            cx.fillRect(s[0] * W, s[1] * hz, s[2], s[2]);
        }
        cx.globalAlpha = 1;
    }

    function drawSun(t) {
        var hz = H * 0.58;
        var R = Math.min(W, H) * 0.17 * (1 + 0.05 * st.bass + 0.08 * st.kick);
        var scx = W / 2, scy = hz - R * 0.42;
        var halo = cx.createRadialGradient(scx, scy, R * 0.6, scx, scy, R * 2.6);
        var ha = 0.16 + 0.3 * st.lvl + 0.2 * st.kick;
        halo.addColorStop(0, 'rgba(255,150,40,' + ha + ')'); halo.addColorStop(1, 'rgba(255,150,40,0)');
        cx.fillStyle = halo; cx.fillRect(0, 0, W, H);
        var S = Math.ceil(R * 2);
        if (sunCv.width !== S) { sunCv.width = S; sunCv.height = S; }
        sx.clearRect(0, 0, S, S);
        sx.globalCompositeOperation = 'source-over';
        var lg = sx.createLinearGradient(0, 0, 0, S);
        lg.addColorStop(0, '#ffe14d'); lg.addColorStop(0.5, '#ff9f1c'); lg.addColorStop(1, '#ff3f7f');
        sx.fillStyle = lg; sx.beginPath(); sx.arc(R, R, R, 0, 6.2832); sx.fill();
        sx.globalCompositeOperation = 'destination-out';
        var shift = ((t * 0.05) % 1) * R * 0.2;
        for (var i = 0; i < 7; i++) {
            var th = R * (0.03 + i * 0.022);
            var y0 = R * 1.05 + i * R * 0.2 + shift - th;
            sx.fillRect(0, y0, S, th);
        }
        cx.drawImage(sunCv, scx - R, scy - R);
    }

    function drawTerrain() {
        var hz = H * 0.58, span = H - hz;
        var f = st.phase % 1, base = Math.floor(st.phase);
        var prev = null;
        var fillCol = '#091218';
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
            cx.beginPath();
            cx.moveTo(pts[0][0], H + 4);
            for (c = 0; c < COLS; c++) cx.lineTo(pts[c][0], pts[c][1]);
            cx.lineTo(pts[COLS - 1][0], H + 4);
            cx.closePath();
            cx.fillStyle = fillCol; cx.fill();
            var a = 0.12 + 0.88 * Math.pow(d, 0.75);
            var br = Math.min(1, st.kick * 0.7);
            var col = br > 0.05 ? 'rgba(' + Math.round(32 + 200 * br) + ',' + Math.round(201 + 40 * br) + ',' + Math.round(151 + 90 * br) + ',' : 'rgba(' + TEAL + ',';
            cx.strokeStyle = col + a + ')';
            cx.lineWidth = 0.7 + d * 1.1;
            cx.beginPath();
            for (c = 0; c < COLS; c++) { if (c === 0) cx.moveTo(pts[c][0], pts[c][1]); else cx.lineTo(pts[c][0], pts[c][1]); }
            cx.stroke();
            if (prev) {
                cx.strokeStyle = 'rgba(' + TEAL + ',' + (a * 0.55) + ')';
                cx.lineWidth = 0.6 + d * 0.6;
                cx.beginPath();
                for (c = 0; c < COLS; c++) { cx.moveTo(prev[c][0], prev[c][1]); cx.lineTo(pts[c][0], pts[c][1]); }
                cx.stroke();
            }
            prev = pts;
        }
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (document.hidden) { last = now; return; }
        var t = now / 1000, dt = Math.min(0.05, last ? t - last : 0.016);
        last = t;
        readAudio(dt, t);
        drawSky(t);
        drawSun(t);
        drawTerrain();
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
            audio.addEventListener('play', function () { setPlaying(true); });
            audio.addEventListener('playing', function () { errs = 0; setPlaying(true); ensureGraph(); });
            audio.addEventListener('pause', function () { setPlaying(false); });
            audio.addEventListener('ended', function () { setPlaying(false); });
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
