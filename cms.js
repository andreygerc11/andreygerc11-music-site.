/* Повне керування сторінками сайту для власника (кабінет nadiya.pp.ua/#admin → «Сторінки сайту»).
   Відвідувач бачить збережені зміни; власник у режимі #edit може:
   • змінити будь-який текст, фото, адресу посилання/кнопки;
   • пересунути блок ↑↓, сховати/показати, додати новий блок (заголовок, текст, фото, кнопка, відео) і видалити його;
   • дизайн (кольори, шрифти, розмір) — у кабінеті, розділ «Дизайн»; нові сторінки — /p.html?s=назва. */
(function () {
    const API = 'https://andreygerc11-music-site.onrender.com';
    const KEY = 'nadiya_admin_creds';
    if (/^#admin\b/i.test(location.hash) && !/owner/.test(location.pathname)) { location.replace('/owner.html'); return; }

    let creds = null;
    try { creds = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) {}
    const inFrame = window.top !== window;
    const wantEdit = !!creds && /#edit\b/.test(location.hash);   // редагування лише за явним #edit (перегляд у кабінеті — без нього)
    const isP = /\/p(\.html)?$/.test(location.pathname);
    const slug = (new URLSearchParams(location.search).get('s') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
    const page = isP ? 'pg_' + slug : ((location.pathname.replace(/\/+$/, '/index').replace(/\.html$/, '').replace(/^\//, '') || 'index').replace(/[^a-zA-Z0-9_-]/g, '_'));
    const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|SVG|PATH|CODE|PRE|IFRAME|VIDEO|AUDIO|CANVAS|TEMPLATE|HEAD|TITLE|META|LINK)$/;
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    const ownTexts = el => [...el.childNodes].filter(n => n.nodeType === 3 && n.nodeValue.trim());
    const ownText = el => ownTexts(el).map(n => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim();
    function setOwnText(el, v) {
        const t = ownTexts(el);
        if (!t.length) { el.appendChild(document.createTextNode(v)); return; }
        const lead = (t[0].nodeValue.match(/^\s*/) || [''])[0], tail = (t[t.length - 1].nodeValue.match(/\s*$/) || [''])[0];
        t[0].nodeValue = lead + v + tail;
        for (let i = 1; i < t.length; i++) t[i].nodeValue = ' ';
    }
    const blocked = el => !!el.closest('#hzCmsBar,#hzCmsDlg,.hz-tools,[data-no-cms],#adminBar,#adminLogin');

    // ---- ключі рахуються один раз на ПОЧАТКОВІЙ сторінці (до будь-яких змін) ----
    function tagAll() {
        document.body.querySelectorAll('*').forEach(el => {
            if (SKIP.test(el.tagName) || blocked(el) || el.closest('.hz-block')) return;
            if (el.hasAttribute('data-cms') || ownTexts(el).length) el.dataset.hzT = el.getAttribute('data-cms') || 'a:' + page + ':' + hash(domPath(el));
            if (el.tagName === 'IMG') el.dataset.hzI = el.getAttribute('data-cms-img') || 'i:' + page + ':' + hash(domPath(el));
            if (el.tagName === 'A') el.dataset.hzH = 'h:' + page + ':' + hash(domPath(el));
        });
        topSections().forEach(el => { if (!el.dataset.hzSec) el.dataset.hzSec = el.id ? 'id_' + el.id : 's' + hash(domPath(el)); });
    }
    function topSections() {
        return [...document.querySelectorAll('section,header,footer,.hz-block')]
            .filter(el => !blocked(el) && !(el.parentElement && el.parentElement.closest('section,header,footer,.hz-block')));
    }

    let content = {};
    const J = (k, d) => { try { return content[k] ? JSON.parse(content[k]) : d; } catch (e) { return d; } };
    let blocks = [];

    // ---- нові блоки ----
    function ytId(u) { const m = String(u || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/); return m ? m[1] : null; }
    function fmt(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); }
    function renderBlock(b) {
        const s = document.createElement('section');
        s.className = 'hz-block'; s.dataset.hzBlock = b.id; s.dataset.hzSec = 'blk_' + b.id;
        if (b.bg) s.style.background = b.bg;
        const v = ytId(b.video);
        s.innerHTML = '<div class="hz-bw" style="text-align:' + (b.align === 'center' ? 'center' : 'left') + '">' +
            (b.img ? '<img src="' + esc(b.img) + '" alt="">' : '') + (b.title ? '<h2>' + esc(b.title) + '</h2>' : '') +
            (b.text ? '<div class="hz-bt">' + fmt(b.text) + '</div>' : '') +
            (v ? '<div class="hz-vid"><iframe src="https://www.youtube.com/embed/' + v + '" allowfullscreen loading="lazy"></iframe></div>' : '') +
            (b.btn && b.url ? '<a class="hz-bb" href="' + esc(b.url) + '">' + esc(b.btn) + '</a>' : '') + '</div>';
        return s;
    }
    function placeBlock(el, after) {
        const ref = after && document.querySelector('[data-hz-sec="' + after + '"]');
        if (ref) { ref.after(el); return; }
        const host = document.getElementById('hzPage');
        if (host) { host.appendChild(el); return; }
        const foot = [...document.querySelectorAll('footer')].pop();
        if (foot) foot.before(el); else document.body.appendChild(el);
    }
    function blockCss() {
        const s = document.createElement('style');
        s.textContent = '.hz-block{padding:56px 20px;position:relative}.hz-bw{max-width:900px;margin:0 auto}' +
            '.hz-block img{max-width:100%;border-radius:16px;margin:0 0 18px;display:inline-block}' +
            '.hz-block h2{font-size:clamp(1.6rem,4vw,2.4rem);margin:0 0 14px;line-height:1.2}' +
            '.hz-bt{line-height:1.75;opacity:.92}.hz-vid{position:relative;padding-top:56.25%;margin:18px 0}' +
            '.hz-vid iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:14px}' +
            '.hz-bb{display:inline-block;margin-top:20px;padding:14px 28px;border-radius:60px;background:var(--accent,#20c997);color:#04140f;font-weight:800;text-decoration:none}';
        document.head.appendChild(s);
    }

    // ---- дизайн усього сайту ----
    function applyTheme(t) {
        if (!t) return;
        const fonts = [t.font, t.head].filter(Boolean);
        if (fonts.length) {
            const l = document.createElement('link'); l.rel = 'stylesheet';
            l.href = 'https://fonts.googleapis.com/css2?' + fonts.map(f => 'family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@400;600;700;800;900').join('&') + '&display=swap';
            document.head.appendChild(l);
        }
        let css = '';
        if (t.accent) css += ':root{--accent:' + t.accent + ';--accent-dark:' + t.accent + '}';
        if (t.bg) css += 'body{background:' + t.bg + '!important}';
        if (t.text) css += 'body{color:' + t.text + '}';
        if (t.font) css += 'body,p,li,a,button,span,div,label,input,textarea{font-family:"' + t.font + '",system-ui,sans-serif}';
        if (t.head) css += 'h1,h2,h3,h4,.display-text,.logo{font-family:"' + t.head + '",serif!important}';
        if (t.size) css += 'html{font-size:' + (+t.size || 100) + '%}';
        if (t.css) css += t.css;
        const s = document.createElement('style'); s.id = 'hzTheme'; s.textContent = css; document.head.appendChild(s);
    }

    // ---- застосувати все збережене ----
    function applyAll() {
        document.querySelectorAll('[data-hz-t]').forEach(el => {
            const k = el.dataset.hzT;
            if (!(k in content) || el.hasAttribute('data-cms')) return;      // data-cms застосовує сама сторінка
            setOwnText(el, content[k]);
            if (!content[k]) el.dataset.hzEmpty = '1';
        });
        document.querySelectorAll('img[data-hz-i]').forEach(img => { if (!img.hasAttribute('data-cms-img') && content[img.dataset.hzI]) img.src = content[img.dataset.hzI]; });
        document.querySelectorAll('a[data-hz-h]').forEach(a => { const v = content[a.dataset.hzH]; if (v) a.setAttribute('href', v); });
        blocks = J('b:' + page, []);
        blocks.forEach(b => placeBlock(renderBlock(b), b.after));
        // порядок блоків
        const order = J('o:' + page, null);
        if (Array.isArray(order) && order.length) {
            const groups = new Map();
            topSections().forEach(el => { const p = el.parentElement; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(el); });
            groups.forEach(kids => {
                const idx = el => { const i = order.indexOf(el.dataset.hzSec); return i < 0 ? 1e6 + kids.indexOf(el) : i; };
                const sorted = [...kids].sort((a, b) => idx(a) - idx(b));
                const marks = kids.map(k => { const c = document.createComment('hz'); k.before(c); return c; });
                marks.forEach((m, i) => { m.replaceWith(sorted[i]); });
            });
        }
        hiddenApply();
    }
    function hiddenApply() {
        topSections().forEach(el => {
            const hid = content['x:' + page + ':' + el.dataset.hzSec] === '1';
            el.classList.toggle('hz-hidden', hid);
            if (!editing) el.style.display = hid ? 'none' : '';
        });
        document.querySelectorAll('[data-hz-empty="1"]').forEach(el => { if (!editing) el.style.display = 'none'; });
    }

    // ================= режим редагування =================
    let editing = false;
    const changed = {};
    function mark(k, v) { changed[k] = v; content[k] = v; const b = document.getElementById('hzSave'); if (b) b.textContent = '💾 Зберегти (' + Object.keys(changed).length + ')'; msg('Є зміни — натисніть «Зберегти», щоб їх побачили всі.'); }
    function msg(t) { const m = document.getElementById('hzMsg'); if (m) m.textContent = t; }
    function editCss() {
        const s = document.createElement('style');
        s.textContent = `
        body.hz-edit [data-hz-t]:hover{outline:2px dashed #20c997;outline-offset:2px;cursor:text}
        body.hz-edit img[data-hz-i]:hover,body.hz-edit [data-team-avatar]:hover{outline:3px solid #20c997;cursor:pointer}
        body.hz-edit .hz-hidden{opacity:.35;outline:2px dashed #f59e0b}
        body.hz-edit [data-hz-empty="1"]{opacity:.35}
        body.hz-edit section,body.hz-edit header,body.hz-edit footer,body.hz-edit .hz-block{position:relative}
        .hz-tools{position:absolute;top:8px;right:8px;z-index:2147482000;display:flex;gap:4px;background:rgba(12,21,18,.92);border:1px solid #20c99766;border-radius:10px;padding:4px}
        .hz-tools button{border:0;background:transparent;color:#e8fff7;font:600 13px system-ui,sans-serif;padding:6px 8px;border-radius:7px;cursor:pointer}
        .hz-tools button:hover{background:#20c99733}
        #hzCmsBar{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#0c1512;border-top:2px solid #20c997;color:#e8fff7;
          font:600 14px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;gap:10px;align-items:center;padding:10px 14px;flex-wrap:wrap}
        #hzCmsBar b{color:#20c997}#hzCmsBar .sp{flex:1}
        #hzCmsBar button{font:inherit;border:0;border-radius:8px;padding:9px 14px;cursor:pointer}
        #hzCmsBar .pri{background:#20c997;color:#04140f}#hzCmsBar .gh{background:transparent;color:#8fe6cb;border:1px solid #20c99755}
        #hzCmsDlg{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px}
        #hzCmsDlg .box{background:#111a17;color:#e8fff7;border:1px solid #20c99766;border-radius:14px;padding:18px;width:min(640px,100%);max-height:92vh;overflow:auto;font:15px/1.4 system-ui,sans-serif}
        #hzCmsDlg label{display:block;font-size:13px;opacity:.75;margin-top:10px}
        #hzCmsDlg textarea,#hzCmsDlg input,#hzCmsDlg select{width:100%;box-sizing:border-box;margin:4px 0 6px;background:#08100d;color:#fff;border:1px solid #20c99755;border-radius:10px;padding:10px;font:15px/1.4 system-ui,sans-serif}
        #hzCmsDlg textarea{min-height:120px}
        #hzCmsDlg .act{margin-top:12px}#hzCmsDlg .act button{font:600 14px system-ui,sans-serif;border:0;border-radius:8px;padding:9px 14px;margin-right:8px;cursor:pointer}
        #hzCmsDlg .pri{background:#20c997;color:#04140f}#hzCmsDlg .gh{background:transparent;color:#8fe6cb;border:1px solid #20c99755}
        #hzCmsDlg .red{background:transparent;color:#fca5a5;border:1px solid #ef444466}`;
        document.head.appendChild(s);
    }
    function dialog(title, fields, onOk, extra) {
        const d = document.createElement('div'); d.id = 'hzCmsDlg';
        d.innerHTML = '<div class="box"><b>' + esc(title) + '</b>' + fields.map(f => '<label>' + esc(f.label) + '</label>' +
            (f.type === 'area' ? '<textarea data-f="' + f.k + '"></textarea>'
                : f.type === 'select' ? '<select data-f="' + f.k + '">' + f.opts.map(o => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select>'
                    : '<input data-f="' + f.k + '"' + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + '>') +
            (f.upload ? '<button type="button" class="gh" data-up="' + f.k + '" style="font:600 13px system-ui;border-radius:8px;padding:7px 12px;cursor:pointer;background:transparent;color:#8fe6cb;border:1px solid #20c99755">📷 Завантажити фото</button>' : '')).join('') +
            '<div class="act"><button class="pri">Готово</button><button class="gh">Скасувати</button>' + (extra ? '<button class="red">' + esc(extra.label) + '</button>' : '') + '</div></div>';
        document.body.appendChild(d);
        fields.forEach(f => { const el = d.querySelector('[data-f="' + f.k + '"]'); el.value = f.v == null ? '' : f.v; });
        d.querySelectorAll('[data-up]').forEach(b => b.onclick = () => uploadFile('image/*', url => { d.querySelector('[data-f="' + b.dataset.up + '"]').value = url; }, 'blk_' + page));
        d.querySelector('.act .gh').onclick = () => d.remove();
        if (extra) d.querySelector('.act .red').onclick = () => { d.remove(); extra.run(); };
        d.querySelector('.act .pri').onclick = () => {
            const out = {}; fields.forEach(f => { out[f.k] = d.querySelector('[data-f="' + f.k + '"]').value; });
            d.remove(); onOk(out);
        };
        const first = d.querySelector('[data-f]'); if (first) first.focus();
    }
    function uploadFile(accept, done, keyHint) {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept;
        inp.onchange = async () => {
            const f = inp.files[0]; if (!f) return;
            if (f.size > 5 * 1024 * 1024) { msg('Файл завеликий (до 5 МБ)'); return; }
            msg('Завантажую файл…');
            try {
                const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
                const r = await fetch(API + '/api/admin/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login: creds.login, password: creds.password, dataUrl, key: (keyHint || 'img').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 30) }) });
                const j = await r.json().catch(() => ({}));
                if (r.ok && j.url) { done(j.url); msg('Файл завантажено'); } else msg(j.error || 'Не вдалося завантажити');
            } catch (e) { msg('Немає зв’язку із сервером'); }
        };
        inp.click();
    }

    function editText(el) {
        const k = el.dataset.hzT, a = el.closest('a[data-hz-h]');
        const cur = el.hasAttribute('data-cms') ? el.textContent.replace(/\s+/g, ' ').trim() : ownText(el);
        const fields = [{ k: 't', label: 'Текст (порожньо — сховати)', type: 'area', v: cur }];
        if (a) fields.push({ k: 'h', label: 'Куди веде посилання / кнопка (адреса)', v: a.getAttribute('href') || '', ph: 'https://… або /сторінка.html' });
        dialog('✏️ Змінити', fields, o => {
            const v = o.t.replace(/\s+/g, ' ').trim();
            if (v !== cur) {
                if (el.hasAttribute('data-cms')) el.textContent = v; else setOwnText(el, v);
                el.dataset.hzEmpty = v ? '' : '1';
                mark(k, v);
            }
            if (a && o.h.trim() !== (a.getAttribute('href') || '')) { a.setAttribute('href', o.h.trim()); mark(a.dataset.hzH, o.h.trim()); }
        });
    }
    function editLinkOnly(a) {
        dialog('🔗 Посилання', [{ k: 'h', label: 'Куди веде (адреса)', v: a.getAttribute('href') || '' }], o => { a.setAttribute('href', o.h.trim()); mark(a.dataset.hzH, o.h.trim()); });
    }

    // блоки: додати / змінити / видалити
    function blockFields(b) {
        return [
            { k: 'title', label: 'Заголовок', v: b.title }, { k: 'text', label: 'Текст (**жирний**, новий рядок — Enter)', type: 'area', v: b.text },
            { k: 'img', label: 'Фото (адреса або кнопка «Завантажити»)', v: b.img, upload: true },
            { k: 'btn', label: 'Текст кнопки', v: b.btn }, { k: 'url', label: 'Куди веде кнопка', v: b.url, ph: 'https://… або /contacts.html' },
            { k: 'video', label: 'Відео з Ютуба (посилання)', v: b.video },
            { k: 'align', label: 'Вирівнювання', type: 'select', v: b.align || 'left', opts: [['left', 'Ліворуч'], ['center', 'По центру']] },
            { k: 'bg', label: 'Колір фону блоку (необов’язково)', v: b.bg, ph: '#141416 або порожньо' }
        ];
    }
    function saveBlocks() { mark('b:' + page, JSON.stringify(blocks)); }
    function addBlock(afterKey) {
        dialog('➕ Новий блок', blockFields({}), o => {
            if (!o.title && !o.text && !o.img && !o.video && !o.btn) return;
            const b = Object.assign({ id: Date.now().toString(36), after: afterKey || '' }, o);
            blocks.push(b);
            const el = renderBlock(b); placeBlock(el, b.after); decorate(el); saveBlocks(); saveOrder();
        });
    }
    function editBlock(el) {
        const b = blocks.find(x => x.id === el.dataset.hzBlock); if (!b) return;
        dialog('✏️ Блок', blockFields(b), o => {
            Object.assign(b, o);
            const n = renderBlock(b); el.replaceWith(n); decorate(n); saveBlocks();
        }, { label: '🗑 Видалити блок', run: () => { if (!confirm('Видалити цей блок?')) return; blocks = blocks.filter(x => x !== b); el.remove(); saveBlocks(); saveOrder(); } });
    }
    function saveOrder() { mark('o:' + page, JSON.stringify(topSections().map(e => e.dataset.hzSec))); }
    function move(el, dir) {
        const sibs = topSections().filter(x => x.parentElement === el.parentElement);
        const i = sibs.indexOf(el), j = i + dir;
        if (j < 0 || j >= sibs.length) return;
        if (dir < 0) sibs[j].before(el); else sibs[j].after(el);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        saveOrder();
    }
    function toggleHide(el) {
        const k = 'x:' + page + ':' + el.dataset.hzSec;
        const hid = !el.classList.contains('hz-hidden');
        el.classList.toggle('hz-hidden', hid);
        mark(k, hid ? '1' : '');
        decorate(el);
    }
    function decorate(el) {
        let t = el.querySelector(':scope > .hz-tools'); if (t) t.remove();
        t = document.createElement('div'); t.className = 'hz-tools';
        const isB = !!el.dataset.hzBlock, hid = el.classList.contains('hz-hidden');
        t.innerHTML = (isB ? '<button data-a="edit">✏️ Блок</button>' : '') + '<button data-a="up" title="Вище">↑</button><button data-a="down" title="Нижче">↓</button>' +
            '<button data-a="hide">' + (hid ? '👁 Показати' : '🙈 Сховати') + '</button><button data-a="add">➕ Блок нижче</button>';
        t.onclick = e => {
            const b = e.target.closest('button[data-a]'); if (!b) return;
            e.preventDefault(); e.stopPropagation();
            ({ edit: () => editBlock(el), up: () => move(el, -1), down: () => move(el, 1), hide: () => toggleHide(el), add: () => addBlock(el.dataset.hzSec) })[b.dataset.a]();
        };
        el.appendChild(t);
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
            if (r.ok && j.success) { Object.keys(changed).forEach(k => delete changed[k]); document.getElementById('hzSave').textContent = '💾 Зберегти (0)'; msg('✅ Збережено — зміни вже на сайті'); }
            else if (r.status === 403) msg('Сесія недійсна — увійдіть у кабінет знову');
            else msg(j.error || 'Не вдалося зберегти');
        } catch (e) { msg('Немає зв’язку із сервером'); }
    }
    function startEdit() {
        editing = true;
        editCss();
        document.body.classList.add('hz-edit');
        topSections().forEach(el => { el.style.display = ''; decorate(el); });
        document.querySelectorAll('[data-hz-empty="1"]').forEach(el => { el.style.display = ''; });
        const bar = document.createElement('div'); bar.id = 'hzCmsBar';
        bar.innerHTML = '<b>✏️ Редагування</b><span id="hzMsg">Натисніть текст, фото чи посилання, щоб змінити. Кнопки ↑ ↓ 🙈 ➕ — у кутку кожного блоку.</span><span class="sp"></span>' +
            '<button class="gh" id="hzAdd">➕ Блок у кінець</button><button class="pri" id="hzSave">💾 Зберегти (0)</button>' +
            (inFrame ? '' : '<button class="gh" id="hzOwner">⚙️ Кабінет</button>') + '<button class="gh" id="hzExit">Вийти</button>';
        document.body.appendChild(bar);
        document.body.style.paddingBottom = '76px';
        document.getElementById('hzSave').onclick = save;
        document.getElementById('hzAdd').onclick = () => addBlock('');
        const o = document.getElementById('hzOwner'); if (o) o.onclick = () => { location.href = '/owner.html'; };
        document.getElementById('hzExit').onclick = () => { if (Object.keys(changed).length && !confirm('Є незбережені зміни. Вийти без збереження?')) return; location.hash = ''; location.reload(); };
        document.addEventListener('click', e => {
            if (blocked(e.target)) return;
            const blk = e.target.closest('.hz-block');
            if (blk) { e.preventDefault(); e.stopPropagation(); editBlock(blk); return; }
            const av = e.target.closest('[data-team-avatar]'), dip = e.target.closest('[data-team-diploma]');
            if (av || dip) {
                e.preventDefault(); e.stopPropagation();
                const n = (av || dip).getAttribute(av ? 'data-team-avatar' : 'data-team-diploma');
                const key = av ? 'team' + n + '.photo' : 'team' + n + '.diploma';
                return uploadFile(av ? 'image/*' : 'image/*,application/pdf', url => {
                    if (av) { av.textContent = ''; av.style.backgroundImage = "url('" + url + "')"; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center'; }
                    else dip.innerHTML = '<a href="' + url + '" target="_blank" rel="noopener" style="color:#20c997">📎 Диплом / сертифікат</a>';
                    mark(key, url);
                }, key);
            }
            const img = e.target.closest('img[data-hz-i]');
            if (img) { e.preventDefault(); e.stopPropagation(); return uploadFile('image/*', url => { img.src = url; mark(img.dataset.hzI, url); }, 'img_' + page); }
            const t = e.target.closest('[data-hz-t]');
            if (t) { e.preventDefault(); e.stopPropagation(); return editText(t); }
            const a = e.target.closest('a[data-hz-h]');
            if (a) { e.preventDefault(); e.stopPropagation(); return editLinkOnly(a); }
        }, true);
        window.addEventListener('beforeunload', e => { if (Object.keys(changed).length) { e.preventDefault(); e.returnValue = ''; } });
    }

    async function boot() {
        tagAll();
        blockCss();
        try { const r = await fetch(API + '/api/site-content', { cache: 'no-store' }); if (r.ok) content = await r.json(); } catch (e) {}
        applyTheme(J('theme', null));
        if (isP) {
            const pg = (J('pages', []) || []).find(x => x.slug === slug);
            const h = document.getElementById('hzTitle');
            if (pg) { document.title = pg.title + ' | Надія'; if (h) h.textContent = pg.title; }
            else if (h && !wantEdit) h.textContent = 'Сторінку не знайдено';
        }
        applyAll();
        if (wantEdit) startEdit();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
