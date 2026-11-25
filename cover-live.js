(function () {
    var img, tim = null, ready = false, srcNow = '', cv, gl, prog, loc = {}, tex = null, texFor = null, S = 0, clock = 0, last = 0, ok = false;

    var VS = 'attribute vec2 a;varying vec2 uv;void main(){uv=a*0.5+0.5;gl_Position=vec4(a,0.0,1.0);}';
    var FS = [
        'precision mediump float;',
        'uniform sampler2D tex;uniform float t,bass,mid,treb,kick,lvl;varying vec2 uv;',
        'float h(float n){return fract(sin(n*91.345)*47453.5453);}',
        'void main(){',
        ' vec2 p=uv;float yt=1.0-p.y;',
        ' float mask=smoothstep(0.06,0.28,yt)*(1.0-smoothstep(0.58,0.78,yt));',
        ' float a=(0.004+0.011*lvl+0.009*mid)*mask;',
        ' p.x+=sin(p.y*7.0+t*1.1)*a+sin(p.y*15.0-t*1.9)*a*0.3*treb;',
        ' p.y+=sin(p.x*6.0+t*0.9)*a*0.8;',
        ' p=(p-0.5)/(1.035+0.045*bass+0.03*kick)+0.5;',
        ' vec3 col=texture2D(tex,p).rgb;',
        ' col*=1.0+0.1*bass+0.1*kick;',
        ' float s=fract(t*0.09)*1.9-0.45;float d=(uv.x*0.7+(1.0-uv.y)*0.3)-s;',
        ' col+=vec3(0.45,0.8,1.0)*exp(-d*d*55.0)*(0.06+0.2*lvl);',
        ' for(int i=0;i<10;i++){float f=float(i);',
        '  vec2 c=vec2(h(f+1.0)+0.03*sin(t*0.4+f),fract(h(f+7.0)-t*(0.012+0.03*h(f+3.0))*(0.5+bass)));',
        '  float r=0.025+0.05*h(f+5.0);float dd=length(uv-c);',
        '  vec3 bc=mix(vec3(0.35,0.85,1.0),vec3(0.6,0.5,1.0),h(f+9.0));',
        '  col+=bc*smoothstep(r,0.0,dd)*(0.1+0.14*bass);}',
        ' gl_FragColor=vec4(col,1.0);}'
    ].join('\n');

    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; }

    function setup() {
        gl = cv.getContext('webgl', { antialias: false, premultipliedAlpha: false });
        if (!gl) return false;
        var v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
        if (!v || !f) return false;
        prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
        gl.useProgram(prog);
        var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        var a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
        ['t', 'bass', 'mid', 'treb', 'kick', 'lvl', 'tex'].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
        return true;
    }

    function loadTex() {
        var s = img.getAttribute('src');
        if (!s || s === srcNow) return;
        srcNow = s; ready = false;
        var im = new Image();
        im.onload = function () { tim = im; ready = true; };
        im.src = img.src;
    }

    function upload() {
        var side = Math.min(tim.naturalWidth, tim.naturalHeight);
        var tc = document.createElement('canvas'); tc.width = tc.height = 1024;
        tc.getContext('2d').drawImage(tim, (tim.naturalWidth - side) / 2, (tim.naturalHeight - side) / 2, side, side, 0, 0, 1024, 1024);
        if (!tex) tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, tc);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        texFor = srcNow;
    }

    function fin(x) { return isFinite(x) ? x : 0; }

    function frame(now) {
        requestAnimationFrame(frame);
        if (!ok || !img || document.hidden || (gl && gl.isContextLost())) { last = now; return; }
        loadTex();
        if (!ready) { last = now; return; }
        var dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
        last = now;
        if (texFor !== srcNow) upload();
        var st = window.MusicBG && MusicBG.getState ? MusicBG.getState() : null;
        var playing = !!(st && st.playing);
        clock += dt * (playing ? 1 : 0.35);
        var w = cv.clientWidth || 300, dpr = Math.min(window.devicePixelRatio || 1, 2), size = Math.round(w * dpr);
        if (cv.width !== size) { cv.width = size; cv.height = size; }
        gl.viewport(0, 0, size, size);
        gl.uniform1f(loc.t, clock);
        gl.uniform1f(loc.bass, st ? fin(st.bass) : 0);
        gl.uniform1f(loc.mid, st ? Math.min(1, fin(st.mid) * 1.5) : 0);
        gl.uniform1f(loc.treb, st ? Math.min(1, fin(st.treb) * 2.6) : 0);
        gl.uniform1f(loc.kick, st ? fin(st.kick) : 0);
        gl.uniform1f(loc.lvl, st ? fin(st.lvl) : 0);
        gl.uniform1i(loc.tex, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function init() {
        img = document.getElementById('apCoverImg');
        if (!img) return;
        cv = document.createElement('canvas');
        cv.id = 'apCoverLive';
        img.parentNode.insertBefore(cv, img);
        cv.addEventListener('webglcontextlost', function (e) {
            e.preventDefault(); ok = false; cv.style.display = 'none';
            img.parentNode.classList.remove('live');
        });
        cv.addEventListener('webglcontextrestored', function () {
            tex = null; texFor = null; ready = false; srcNow = '';
            ok = setup();
            if (ok) { cv.style.display = ''; img.parentNode.classList.add('live'); }
        });
        ok = setup();
        if (!ok) { cv.remove(); return; }
        img.parentNode.classList.add('live');
        requestAnimationFrame(frame);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
