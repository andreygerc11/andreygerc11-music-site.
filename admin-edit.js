/* Живе редагування сайту прямо на сторінці — тільки для адміністратора.
   Гість нічого не бачить. Щоб увійти: відкрити сторінку з #admin у кінці адреси
   (напр. golos-proty-raku.pp.ua/#admin) і ввести логін/пароль адміна. */
(function () {
    const API = 'https://andreygerc11-music-site.onrender.com';
    const KEY = 'nadiya_admin_creds';
    let creds = null;
    try { creds = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) {}

    const wantLogin = /admin/i.test(location.hash) || /admin/i.test(location.search);
    if (!creds && !wantLogin) return; // звичайний відвідувач — нічого не показуємо

    const editedImages = {}; // key -> url (завантажені цієї сесії)
    let editing = false;

    // ---- стилі ----
    const css = document.createElement('style');
    css.textContent = `
      #adminBar{position:fixed;left:0;right:0;bottom:0;z-index:100000;background:#0c1512;border-top:2px solid #20c997;
        color:#eaf2ef;font-family:Montserrat,sans-serif;display:flex;align-items:center;gap:10px;padding:10px 16px;flex-wrap:wrap;box-shadow:0 -6px 24px rgba(0,0,0,.45)}
      #adminBar b{color:#20c997}
      #adminBar .sp{flex:1}
      #adminBar button{font-family:inherit;font-weight:800;border:none;border-radius:8px;padding:9px 15px;cursor:pointer;font-size:.85rem}
      #adminBar .primary{background:#20c997;color:#04140f}
      #adminBar .ghost{background:transparent;color:#8fe6cb;border:1px solid #20c99755}
      #adminBar .msg{font-size:.82rem;color:#8fe6cb;max-width:340px}
      body.admin-editing [data-cms]{outline:1px dashed rgba(32,201,151,.55);outline-offset:3px;border-radius:2px}
      body.admin-editing [data-cms]:hover{outline:1px solid #20c997;background:rgba(32,201,151,.07)}
      body.admin-editing [data-cms]:focus{outline:2px solid #20c997;background:rgba(32,201,151,.1)}
      .img-edit-chip{position:absolute;z-index:70;top:10px;left:10px;background:#20c997;color:#04140f;border:none;border-radius:8px;
        padding:7px 12px;font-size:.75rem;font-weight:800;cursor:pointer;font-family:Montserrat,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.5)}
      .img-edit-chip.inline{position:static;display:inline-block;margin-top:8px}
      #adminLogin{position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px}
      #adminLogin .box{background:#121917;border:1px solid #ffffff22;border-radius:16px;padding:28px;width:340px;font-family:Montserrat,sans-serif;color:#eaf2ef}
      #adminLogin h3{margin-bottom:14px;font-size:1.1rem}
      #adminLogin input{width:100%;padding:12px;margin:7px 0;background:#0c1512;border:1px solid #ffffff22;border-radius:8px;color:#fff;font-family:inherit}
      #adminLogin .err{color:#ff6b6b;font-size:.82rem;min-height:18px;margin:4px 0}
      #adminLogin button{width:100%;padding:12px;border:none;border-radius:8px;font-weight:800;cursor:pointer;font-family:inherit}
      #adminLogin .go{background:#20c997;color:#04140f}
      #adminLogin .cancel{background:transparent;color:#8fe6cb;border:1px solid #ffffff22;margin-top:6px}
    `;
    document.head.appendChild(css);

    // ---- ціль зображень ----
    function imageTargets() {
        const t = [];
        const heroImg = document.querySelector('[data-cms-img="hero.bg"]');
        if (heroImg) t.push({ key: 'hero.bg', container: document.querySelector('.hero-inner') || heroImg.parentElement, label: '📷 Фото банера', inline: false, apply: url => { heroImg.src = url; } });
        const aboutImg = document.querySelector('[data-cms-img="about.img"]');
        if (aboutImg) t.push({ key: 'about.img', container: aboutImg.parentElement, label: '📷 Змінити фото', inline: false, apply: url => { aboutImg.src = url; } });
        for (let i = 1; i <= 5; i++) {
            const av = document.querySelector(`[data-team-avatar="${i}"]`);
            if (av) t.push({ key: `team${i}.photo`, container: av.closest('.team-card') || av, label: '📷 Фото', inline: false, apply: url => { av.textContent = ''; av.style.backgroundImage = `url('${url}')`; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center'; } });
            const dip = document.querySelector(`[data-team-diploma="${i}"]`);
            if (dip) t.push({ key: `team${i}.diploma`, container: dip, label: '📎 Диплом', inline: true, apply: url => { dip.innerHTML = `<a href="${url}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;color:#20c997;text-decoration:none;font-size:.82rem;font-weight:700;"><i class="fas fa-certificate"></i> Диплом / сертифікат</a>`; } });
        }
        return t;
    }
    const TARGETS = imageTargets();

    function pickAndUpload(key, cb) {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*,application/pdf';
        inp.onchange = async () => {
            const file = inp.files[0]; if (!file) return;
            const msg = document.getElementById('ab_msg');
            if (file.size > 5 * 1024 * 1024) { if (msg) msg.textContent = 'Файл завеликий (макс 5 МБ)'; return; }
            if (msg) msg.textContent = 'Завантаження файлу...';
            try {
                const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
                const resp = await fetch(`${API}/api/admin/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: creds.login, password: creds.password, dataUrl, key }) });
                const data = await resp.json().catch(() => ({}));
                if (resp.ok && data.url) { editedImages[key] = data.url; cb(data.url); if (msg) msg.textContent = '✅ Файл завантажено. Натисніть «Зберегти».'; }
                else if (msg) msg.textContent = data.error || 'Помилка завантаження';
            } catch (e) { if (msg) msg.textContent = 'Помилка зв\'язку'; }
        };
        inp.click();
    }

    function setEditing(on) {
        editing = on;
        document.body.classList.toggle('admin-editing', on);
        document.querySelectorAll('[data-cms]').forEach(el => { el.contentEditable = on ? 'true' : 'false'; });
        // чипи на зображеннях
        document.querySelectorAll('.img-edit-chip').forEach(c => c.remove());
        if (on) {
            TARGETS.forEach(t => {
                if (!t.container) return;
                if (getComputedStyle(t.container).position === 'static') t.container.style.position = 'relative';
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'img-edit-chip' + (t.inline ? ' inline' : '');
                chip.textContent = t.label;
                chip.onclick = (e) => { e.preventDefault(); e.stopPropagation(); pickAndUpload(t.key, t.apply); };
                t.container.appendChild(chip);
            });
        }
        const tgl = document.getElementById('ab_toggle'); if (tgl) tgl.textContent = on ? '👁 Режим перегляду' : '✏️ Редагувати сторінку';
        const sv = document.getElementById('ab_save'); if (sv) sv.style.display = on ? '' : 'none';
    }

    async function save() {
        const msg = document.getElementById('ab_msg'); if (msg) msg.textContent = 'Збереження...';
        const pageContent = {};
        document.querySelectorAll('[data-cms]').forEach(el => {
            const k = el.getAttribute('data-cms');
            const v = (el.textContent || '').replace(/\s+/g, ' ').trim();
            // Зберігаємо значення завжди, навіть порожнє — щоб можна було ПРИБРАТИ текст із сайту
            // (порожнє = приховати; без цього очищене поле поверталося до дефолту).
            pageContent[k] = v;
        });
        Object.assign(pageContent, editedImages);
        try {
            let existing = {};
            try { const r = await fetch(`${API}/api/site-content`); if (r.ok) existing = await r.json(); } catch (e) {}
            const merged = Object.assign({}, existing, pageContent);
            const res = await fetch(`${API}/api/admin/site-content`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: creds.login, password: creds.password, content: merged }) });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success) { if (msg) msg.textContent = '✅ Збережено! Зміни вже на сайті.'; }
            else if (res.status === 403) { if (msg) msg.textContent = 'Сесія недійсна — увійдіть знову.'; }
            else if (msg) msg.textContent = data.error || 'Не вдалося зберегти.';
        } catch (e) { if (msg) msg.textContent = 'Помилка зв\'язку.'; }
    }

    function buildBar() {
        if (document.getElementById('adminBar')) return;
        const bar = document.createElement('div');
        bar.id = 'adminBar';
        bar.innerHTML = `<b>🔧 Адмін</b>
            <button class="primary" id="ab_toggle">✏️ Редагувати сторінку</button>
            <button class="ghost" id="ab_save" style="display:none">💾 Зберегти</button>
            <span class="msg" id="ab_msg">Тексти редагуються прямо на сторінці. Фото/аватари/дипломи — кнопкою на елементі.</span>
            <span class="sp"></span>
            <button class="ghost" id="ab_exit">Вийти</button>`;
        document.body.appendChild(bar);
        document.body.style.paddingBottom = '72px';
        document.getElementById('ab_toggle').onclick = () => setEditing(!editing);
        document.getElementById('ab_save').onclick = save;
        document.getElementById('ab_exit').onclick = () => { sessionStorage.removeItem(KEY); location.hash = ''; location.reload(); };
    }

    function showLogin() {
        if (document.getElementById('adminLogin')) return;
        const wrap = document.createElement('div');
        wrap.id = 'adminLogin';
        wrap.innerHTML = `<div class="box">
            <h3>🔒 Вхід адміністратора</h3>
            <input id="al_login" placeholder="Логін" value="administration@dev.com" autocomplete="username">
            <input id="al_pass" type="password" placeholder="Пароль" autocomplete="current-password">
            <div class="err" id="al_err"></div>
            <button class="go" id="al_go">Увійти й редагувати</button>
            <button class="cancel" id="al_cancel">Скасувати</button>
        </div>`;
        document.body.appendChild(wrap);
        document.getElementById('al_cancel').onclick = () => { wrap.remove(); };
        document.getElementById('al_go').onclick = async () => {
            const login = document.getElementById('al_login').value.trim();
            const password = document.getElementById('al_pass').value;
            const err = document.getElementById('al_err');
            err.textContent = 'Перевірка...';
            try {
                const res = await fetch(`${API}/api/wife-blog/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
                if (res.ok) { creds = { login, password }; sessionStorage.setItem(KEY, JSON.stringify(creds)); wrap.remove(); buildBar(); setEditing(true); }
                else err.textContent = 'Невірний логін або пароль';
            } catch (e) { err.textContent = 'Помилка зв\'язку із сервером'; }
        };
    }

    // старт
    if (creds) buildBar();
    else if (wantLogin) showLogin();
})();
