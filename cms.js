/* Редагування БУДЬ-ЯКОГО тексту й фото на будь-якій сторінці сайту — для власника.
   Відвідувач: підставляються збережені правки (тексти/фото).
   Власник: заходить у кабінет nadiya.pp.ua/#admin → «Сторінки сайту» → сторінка відкривається з #edit:
   клік по тексту — змінити текст, клік по фото — замінити фото, «Зберегти» — зміни на сайті для всіх. */
(function () {
    const API = 'https://andreygerc11-music-site.onrender.com';
    const KEY = 'nadiya_admin_creds';
    // будь-яка сторінка з #admin → кабінет власника
    if (/^#admin\b/i.test(location.hash) && !/owner/.test(location.pathname)) { location.replace('/owner.html'); return; }

    let creds = null;
    try { creds = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) {}
    const inFrame = window.top !== window;
    const wantEdit = !!creds && (/#edit\b/.test(location.hash) || inFrame);

    const page = (location.pathname.replace(/\/+$/, '/index').replace(/\.html$/, '').replace(/^\//, '') || 'index').replace(/[^a-zA-Z0-9_-]/g, '_');
    const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|SVG|PATH|CODE|PRE|IFRAME|VIDEO|AUDIO|CANVAS|TEMPLATE)$/;

    function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
    function domPath(el) {
        const parts = [];
        while (el && el !== document.body && el.nodeType === 1) {
            if (el.id) { parts.unshift('#' + el.id); break; }
            let i = 1, s = el;
            while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++;
            parts.unshift(el.tagName.toLowerCase() + i);
            el = el.parentElement;
        }
        return parts.join('>');
    }
    function ownTexts(el) { return [...el.childNodes].filter(n => n.nodeType === 3 && n.nodeValue.trim()); }
    function ownText(el) { return ownTexts(el).map(n => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim(); }
    function setOwnText(el, v) {
        const t = ownTexts(el);
        if (!t.length) { el.appendChild(document.createTextNode(v)); return; }
        const lead = (t[0].nodeValue.match(/^\s*/) || [''])[0], tail = (t[t.length - 1].nodeValue.match(/\s*$/) || [''])[0];
        t[0].nodeValue = lead + v + tail;
        for (let i = 1; i < t.length; i++) t[i].nodeValue = ' ';
    }
    function blocked(el) { return !!el.closest('#hzCmsBar,#hzCmsDlg,[data-no-cms],#adminBar,#adminLogin'); }
    function textKey(el) { return el.hasAttribute('data-cms') ? el.getAttribute('data-cms') : 'a:' + page + ':' + hash(domPath(el)); }
    function imgKey(el) { return el.hasAttribute('data-cms-img') ? el.getAttribute('data-cms-img') : 'i:' + page + ':' + hash(domPath(el)); }

    function textEls() {
        return [...document.body.querySelectorAll('*')].filter(el => !SKIP.test(el.tagName) && !blocked(el) && (el.hasAttribute('data-cms') || ownTexts(el).length));
    }

    // ---- відвідувач: застосувати збережені правки ----
    let content = {};
    async function applySaved() {
        try { const r = await fetch(API + '/api/site-content', { cache: 'no-store' }); if (r.ok) content = await r.json(); } catch (e) { return; }
        textEls().forEach(el => {
            const k = textKey(el);
            if (!(k in content) || el.hasAttribute('data-cms')) return;   // data-cms застосовує сама сторінка
            setOwnText(el, content[k]);
            if (!content[k]) el.style.display = 'none';
        });
        document.querySelectorAll('img').forEach(img => {
            if (blocked(img) || img.hasAttribute('data-cms-img')) return;
            const v = content[imgKey(img)];
            if (v) img.src = v;
        });
    }

    // ---- власник: редагування ----
    const changed = {};
    function css() {
        const s = document.createElement('style');
        s.textContent = `
        body.hz-edit [data-hz-t]:hover{outline:2px dashed #20c997;outline-offset:2px;cursor:text}
        body.hz-edit img[data-hz-i]:hover{outline:3px solid #20c997;cursor:pointer}
        #hzCmsBar{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#0c1512;border-top:2px solid #20c997;color:#e8fff7;
          font:600 14px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;gap:10px;align-items:center;padding:10px 14px;flex-wrap:wrap}
        #hzCmsBar b{color:#20c997}#hzCmsBar .sp{flex:1}
        #hzCmsBar button{font:inherit;border:0;border-radius:8px;padding:9px 14px;cursor:pointer}
        #hzCmsBar .pri{background:#20c997;color:#04140f}#hzCmsBar .gh{background:transparent;color:#8fe6cb;border:1px solid #20c99755}
        #hzCmsDlg{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px}
        #hzCmsDlg .box{background:#111a17;color:#e8fff7;border:1px solid #20c99766;border-radius:14px;padding:18px;width:min(640px,100%);font:15px/1.4 system-ui,sans-serif}
        #hzCmsDlg textarea{width:100%;box-sizing:border-box;min-height:140px;margin:10px 0;background:#08100d;color:#fff;border:1px solid #20c99755;border-radius:10px;padding:10px;font:15px/1.4 system-ui,sans-serif}
        #hzCmsDlg button{font:600 14px system-ui,sans-serif;border:0;border-radius:8px;padding:9px 14px;margin-right:8px;cursor:pointer}
        #hzCmsDlg .pri{background:#20c997;color:#04140f}#hzCmsDlg .gh{background:transparent;color:#8fe6cb;border:1px solid #20c99755}`;
        document.head.appendChild(s);
    }
    function msg(t) { const m = document.getElementById('hzMsg'); if (m) m.textContent = t; }
    function count() { const b = document.getElementById('hzSave'); if (b) b.textContent = '💾 Зберегти (' + Object.keys(changed).length + ')'; }

    function editText(el) {
        const k = textKey(el);
        const cur = el.hasAttribute('data-cms') ? el.textContent.replace(/\s+/g, ' ').trim() : ownText(el);
        const d = document.createElement('div'); d.id = 'hzCmsDlg';
        d.innerHTML = '<div class="box"><b>✏️ Текст</b><div style="opacity:.7;font-size:13px">Порожньо — сховати цей текст на сайті</div><textarea></textarea><button class="pri">Готово</button><button class="gh">Скасувати</button></div>';
        document.body.appendChild(d);
        const ta = d.querySelector('textarea'); ta.value = cur; ta.focus();
        d.querySelector('.gh').onclick = () => d.remove();
        d.querySelector('.pri').onclick = () => {
            const v = ta.value.replace(/\s+/g, ' ').trim();
            if (el.hasAttribute('data-cms')) el.textContent = v; else setOwnText(el, v);
            el.style.opacity = v ? '' : '.35';
            changed[k] = v; count(); msg('Змінено. Натисніть «Зберегти», щоб зміни побачили всі.');
            d.remove();
        };
    }
    function editImg(img) { uploadTo(imgKey(img), 'image/*', url => { img.src = url; }); }
    function uploadTo(k, accept, apply) {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept;
        inp.onchange = async () => {
            const f = inp.files[0]; if (!f) return;
            if (f.size > 5 * 1024 * 1024) { msg('Фото завелике (до 5 МБ)'); return; }
            msg('Завантажую фото…');
            try {
                const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
                const r = await fetch(API + '/api/admin/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login: creds.login, password: creds.password, dataUrl, key: 'img_' + page + '_' + hash(k) }) });
                const j = await r.json().catch(() => ({}));
                if (r.ok && j.url) { apply(j.url); changed[k] = j.url; count(); msg('Файл замінено. Натисніть «Зберегти».'); }
                else msg(j.error || 'Не вдалося завантажити фото');
            } catch (e) { msg('Немає зв’язку із сервером'); }
        };
        inp.click();
    }
    async function save() {
        if (!Object.keys(changed).length) { msg('Немає змін'); return; }
        msg('Зберігаю…');
        try {
            let cur = {};
            try { const r = await fetch(API + '/api/site-content', { cache: 'no-store' }); if (r.ok) cur = await r.json(); } catch (e) {}
            const r = await fetch(API + '/api/admin/site-content', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login: creds.login, password: creds.password, content: Object.assign({}, cur, changed) }) });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j.success) { Object.keys(changed).forEach(k => delete changed[k]); count(); msg('✅ Збережено — зміни вже на сайті'); }
            else if (r.status === 403) msg('Сесія недійсна — увійдіть у кабінет знову');
            else msg(j.error || 'Не вдалося зберегти');
        } catch (e) { msg('Немає зв’язку із сервером'); }
    }
    function startEdit() {
        css();
        document.body.classList.add('hz-edit');
        textEls().forEach(el => el.setAttribute('data-hz-t', ''));
        document.querySelectorAll('img').forEach(i => { if (!blocked(i)) i.setAttribute('data-hz-i', ''); });
        const bar = document.createElement('div'); bar.id = 'hzCmsBar';
        bar.innerHTML = '<b>✏️ Редагування</b><span id="hzMsg">Натисніть на будь-який текст або фото, щоб змінити</span><span class="sp"></span>' +
            '<button class="pri" id="hzSave">💾 Зберегти (0)</button>' + (inFrame ? '' : '<button class="gh" id="hzOwner">⚙️ Кабінет</button>') + '<button class="gh" id="hzExit">Вийти з редагування</button>';
        document.body.appendChild(bar);
        document.body.style.paddingBottom = '70px';
        document.getElementById('hzSave').onclick = save;
        const o = document.getElementById('hzOwner'); if (o) o.onclick = () => { location.href = '/owner.html'; };
        document.getElementById('hzExit').onclick = () => { if (Object.keys(changed).length && !confirm('Є незбережені зміни. Вийти без збереження?')) return; location.hash = ''; location.reload(); };
        // клік у режимі редагування — не переходити за посиланнями, а редагувати
        document.addEventListener('click', e => {
            if (blocked(e.target)) return;
            // фото й дипломи команди (головна) — окремі поля
            const av = e.target.closest('[data-team-avatar]'), dip = e.target.closest('[data-team-diploma]');
            if (av || dip) {
                e.preventDefault(); e.stopPropagation();
                const n = (av || dip).getAttribute(av ? 'data-team-avatar' : 'data-team-diploma');
                return uploadTo(av ? 'team' + n + '.photo' : 'team' + n + '.diploma', av ? 'image/*' : 'image/*,application/pdf', url => {
                    if (av) { av.textContent = ''; av.style.backgroundImage = "url('" + url + "')"; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center'; }
                    else dip.innerHTML = '<a href="' + url + '" target="_blank" rel="noopener" style="color:#20c997">📎 Диплом / сертифікат</a>';
                });
            }
            const img = e.target.closest('img[data-hz-i]');
            const t = e.target.closest('[data-hz-t]');
            if (!img && !t) return;
            e.preventDefault(); e.stopPropagation();
            if (img) editImg(img); else editText(t);
        }, true);
        window.addEventListener('beforeunload', e => { if (Object.keys(changed).length) { e.preventDefault(); e.returnValue = ''; } });
    }

    function boot() { applySaved().then(() => { if (wantEdit) startEdit(); }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
