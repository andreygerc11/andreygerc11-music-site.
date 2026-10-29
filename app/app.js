// Застосунок «Надія»: листування пацієнта з адміністратором і лікарем, платні консультації.
// Та сама сторінка — для пацієнта, лікаря й адміністратора (у застосунку на телефоні й у браузері).
'use strict';
(() => {
  const API = (new URLSearchParams(location.search).get('api') || 'https://family-radar-server.onrender.com/nadiya/api').replace(/\/$/, '');
  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const NA = window.NadiyaApp || null; // міст Андроїд-застосунку (якщо відкрито в ньому)

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  const S = {
    token: store.get('nadiya_token'),
    me: (() => { try { return JSON.parse(store.get('nadiya_me') || 'null'); } catch { return null; } })(),
    threads: [], tab: null, listTimer: null, cur: null, blobs: new Map(),
  };

  // ---------- дрібниці ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  let toastT;
  function toast(msg, ms = 3500) {
    $toast.textContent = msg; $toast.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => $toast.classList.remove('on'), ms);
  }
  const TZ = { timeZone: 'Europe/Kyiv' };
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('uk-UA', { ...TZ, hour: '2-digit', minute: '2-digit' });
  const fmtDay = (ts) => new Date(ts).toLocaleDateString('uk-UA', { ...TZ, day: 'numeric', month: 'long' });
  const fmtShort = (ts) => {
    const d = new Date(ts), n = new Date();
    return d.toDateString() === n.toDateString() ? fmtTime(ts) : d.toLocaleDateString('uk-UA', { ...TZ, day: '2-digit', month: '2-digit' });
  };
  function left(ms) {
    if (ms <= 0) return 'час минув';
    const hh = Math.floor(ms / 3600000), mm = Math.floor((ms % 3600000) / 60000);
    return hh ? `${hh} год ${mm} хв` : `${mm} хв`;
  }
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const newClientId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const isStaff = () => S.me && S.me.role !== 'patient';
  const STATUS = { pending_payment: 'Очікує оплати', active: 'Активна', closed: 'Завершена', expired: 'Час минув', open: '' };

  // ---------- звертання до сервера ----------
  class ApiErr extends Error { constructor(status, code, msg) { super(msg); this.status = status; this.code = code; } }
  async function api(method, path, { body, raw, headers = {}, blob } = {}) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 90000);
    const hd = { ...headers };
    if (S.token) hd.Authorization = 'Bearer ' + S.token;
    if (body !== undefined) hd['Content-Type'] = 'application/json';
    let r;
    try {
      r = await fetch(API + path, { method, headers: hd, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal });
    } catch (e) {
      throw new ApiErr(0, 'network', 'Немає зв\'язку з сервером. Перевірте інтернет.');
    } finally { clearTimeout(t); }
    if (blob && r.ok) return r.blob();
    let d = {};
    try { d = await r.json(); } catch {}
    if (r.status === 401 && path !== '/login') { logout(true); throw new ApiErr(401, 'unauthorized', 'Увійдіть знову.'); }
    if (!r.ok || d.ok === false) {
      const msg = d.message || (r.status >= 500 ? 'Сервер тимчасово недоступний. Спробуйте за хвилину.' : 'Помилка запиту.');
      throw new ApiErr(r.status, d.error || 'error', msg);
    }
    return d;
  }

  // ---------- сповіщення застосунку ----------
  function registerPush(token) {
    if (!S.token) return;
    let t = token;
    if (!t && NA && NA.getPushToken) { try { t = NA.getPushToken(); } catch {} }
    if (t) api('POST', '/push/register', { body: { token: t, platform: 'android' } }).catch(() => {});
  }
  window.__nadiyaPushToken = (t) => registerPush(t);
  window.__nadiyaOpenThread = (id) => { if (id) location.hash = '#/t/' + id; };

  // ---------- вхід / вихід ----------
  function saveAuth(d) {
    S.token = d.token; S.me = d.me;
    store.set('nadiya_token', d.token); store.set('nadiya_me', JSON.stringify(d.me));
    registerPush();
  }
  function logout(silent) {
    if (!silent && S.token) api('POST', '/logout').catch(() => {});
    S.token = null; S.me = null; S.threads = [];
    store.set('nadiya_token', null); store.set('nadiya_me', null);
    stopTimers();
    for (const u of S.blobs.values()) URL.revokeObjectURL(u);
    S.blobs.clear();
    if (location.hash !== '#/login') location.hash = '#/login'; else route();
  }

  function stopTimers() {
    clearInterval(S.listTimer); S.listTimer = null;
    if (S.cur) { clearTimeout(S.cur.timer); clearInterval(S.cur.clock); S.cur = null; }
  }

  // Повтори, поки сервер клініки прокидається (до ~хвилини)
  async function withWake(fn, $msg) {
    for (let i = 0; ; i++) {
      try { return await fn(); }
      catch (e) {
        if (e.code !== 'site_unavailable' || i >= 5) throw e;
        $msg.textContent = 'Сервер клініки прокидається — ще кілька секунд…';
        await new Promise((r) => setTimeout(r, 12000));
      }
    }
  }

  function viewLogin() {
    const err = h('div', { class: 'err', role: 'alert' });
    const login = h('input', { type: 'text', autocomplete: 'username', required: true, inputmode: 'email' });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Увійти' });
    const form = h('form', { class: 'card auth', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = 'Входимо…';
      try {
        const d = await withWake(() => api('POST', '/login', { body: { login: login.value.trim(), password: pass.value } }), err);
        saveAuth(d); location.hash = '#/';
      } catch (ex) { err.textContent = ex.message; }
      finally { btn.disabled = false; btn.textContent = 'Увійти'; }
    } },
      h('h1', { text: 'Вхід' }),
      h('p', { class: 'lead', text: 'Консультації лікаря й чат з клінікою «Надія». Той самий акаунт, що й на сайті.' }),
      h('label', { class: 'f' }, 'Пошта (лікарі — логін)', login),
      h('label', { class: 'f' }, 'Пароль', pass),
      err, btn,
      h('div', { class: 'switch' }, 'Немає акаунта? ', h('button', { type: 'button', text: 'Зареєструватися', onclick: () => { location.hash = '#/register'; } })));
    $app.replaceChildren(topBar(), h('div', { class: 'center' }, form));
    login.focus();
  }

  function viewRegister() {
    const err = h('div', { class: 'err', role: 'alert' });
    const f = {
      fullName: h('input', { type: 'text', autocomplete: 'name', required: true }),
      email: h('input', { type: 'email', autocomplete: 'email', required: true }),
      phone: h('input', { type: 'tel', autocomplete: 'tel', placeholder: '+380…' }),
      birthDate: h('input', { type: 'date' }),
      password: h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '6' }),
    };
    const agree = h('input', { type: 'checkbox', required: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Створити акаунт' });
    const form = h('form', { class: 'card auth', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      if (f.password.value.length < 6) { err.textContent = 'Пароль — щонайменше 6 символів.'; return; }
      btn.disabled = true; btn.textContent = 'Створюємо…';
      try {
        const body = { fullName: f.fullName.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), birthDate: f.birthDate.value, password: f.password.value };
        const d = await withWake(() => api('POST', '/register', { body }), err);
        saveAuth(d); location.hash = '#/';
      } catch (ex) { err.textContent = ex.message; }
      finally { btn.disabled = false; btn.textContent = 'Створити акаунт'; }
    } },
      h('h1', { text: 'Реєстрація' }),
      h('p', { class: 'lead', text: 'Акаунт діє і в застосунку, і на сайті nadiya.pp.ua.' }),
      h('label', { class: 'f' }, "Прізвище, ім'я, по батькові", f.fullName),
      h('label', { class: 'f' }, 'Пошта', f.email),
      h('label', { class: 'f' }, 'Телефон', f.phone),
      h('label', { class: 'f' }, 'Дата народження', f.birthDate),
      h('label', { class: 'f' }, 'Пароль (від 6 символів)', f.password),
      h('label', { class: 'check' }, agree, h('span', {}, 'Погоджуюсь на обробку персональних даних згідно з ',
        h('a', { href: '/privacy_policy', target: '_blank', rel: 'noopener', text: 'Політикою конфіденційності' }))),
      err, btn,
      h('div', { class: 'switch' }, 'Вже є акаунт? ', h('button', { type: 'button', text: 'Увійти', onclick: () => { location.hash = '#/login'; } })));
    $app.replaceChildren(topBar(), h('div', { class: 'center' }, form));
  }

  function topBar(extra) {
    return h('div', { class: 'top' },
      h('div', { class: 'logo' }, h('img', { src: '/logo.png', alt: '' }), h('div', {}, 'Наді', h('span', { text: 'я' }))),
      h('div', { class: 'grow' }), extra || null);
  }

  // ---------- головний екран: список розмов ----------
  let $listPane, $chatPane;
  function viewMain(threadId) {
    if (!$listPane || !$app.contains($listPane)) {
      const who = h('div', { class: 'grow' },
        h('div', { class: 'title', text: S.me.name }),
        h('div', { class: 'sub', text: S.me.role === 'patient' ? S.me.email : S.me.role === 'admin' ? 'Адміністратор' : 'Лікар' }));
      const head = h('div', { class: 'top' },
        h('div', { class: 'logo' }, h('img', { src: '/logo.png', alt: '' })), who,
        h('button', { class: 'icon-btn', 'aria-label': 'Оновити', title: 'Оновити', onclick: () => loadThreads() }, h('i', { class: 'fa-solid fa-rotate' })),
        h('button', { class: 'icon-btn', 'aria-label': 'Вийти', title: 'Вийти', onclick: () => { if (confirm('Вийти з акаунта?')) logout(); } }, h('i', { class: 'fa-solid fa-right-from-bracket' })));
      // ліва колонка (на телефоні ховається, коли відкрита розмова) і права — розмова
      $listPane = h('div', { class: 'pane-list' }, head);
      $listPane.$body = h('div', { class: 'list-body' });
      $listPane.append($listPane.$body);
      $chatPane = h('div', { class: 'pane-chat empty' });
      $app.replaceChildren(h('div', { class: 'split two' }, $listPane, $chatPane));
      renderList();
      loadThreads();
      if (S.me.role === 'patient' && !S.promo) loadPromo();
      clearInterval(S.listTimer);
      S.listTimer = setInterval(() => { if (!document.hidden) loadThreads(); }, 15000);
    }
    if (threadId) { $listPane.classList.add('has-chat'); $chatPane.classList.remove('empty'); openThread(threadId); }
    else {
      $listPane.classList.remove('has-chat'); $chatPane.classList.add('empty');
      if (S.cur) { clearTimeout(S.cur.timer); clearInterval(S.cur.clock); S.cur = null; }
      $chatPane.replaceChildren(h('div', { class: 'center muted', text: isStaff() ? 'Оберіть розмову зліва' : '' }));
      renderList();
    }
  }

  async function loadThreads() {
    try {
      const d = await api('GET', '/threads');
      S.threads = d.threads;
      renderList();
    } catch (e) { if (e.status !== 401) toast(e.message); }
  }

  function threadTitle(t) {
    if (t.type === 'support') return S.me.role === 'patient' ? 'Адміністратор клініки' : t.patient.name || t.patient.email;
    return S.me.role === 'patient' ? (t.doctor ? t.doctor.name : 'Лікар') : t.patient.name || t.patient.email;
  }

  function threadRow(t) {
    const sup = t.type === 'support';
    const prev = t.lastMessage ? t.lastMessage.text : sup ? 'Напишіть нам — допоможемо із записом і питаннями' : '';
    const sub = sup ? prev : [S.me.role !== 'patient' && t.doctor && S.me.role === 'admin' ? `→ ${t.doctor.name}` : null, prev].filter(Boolean).join(' · ');
    const on = S.cur && S.cur.id === t.id;
    return h('button', { class: 'row' + (on ? ' on' : ''), onclick: () => { location.hash = '#/t/' + t.id; } },
      h('div', { class: 'ava' + (sup ? ' sup' : '') }, sup && S.me.role === 'patient' ? h('i', { class: 'fa-solid fa-headset' }) : initials(threadTitle(t))),
      h('div', { class: 'mid' },
        h('div', { class: 'name', text: threadTitle(t) }),
        h('div', { class: 'prev', text: sub })),
      h('div', { class: 'right' },
        h('span', { text: t.lastMessage ? fmtShort(t.lastMessage.at) : '' }),
        !sup ? h('span', { class: 'chip ' + t.status, text: STATUS[t.status] || t.status }) : null,
        t.unread ? h('span', { class: 'badge', text: String(t.unread) }) : null));
  }

  function renderList() {
    if (!$listPane || !$listPane.$body) return;
    const body = $listPane.$body, kids = [];
    const ths = S.threads;
    if (S.me.role === 'patient') {
      kids.push(h('div', { class: 'cta' },
        h('h2', { text: 'Консультація лікаря' }),
        h('p', { text: 'Опишіть проблему, оплатіть — і 24 години листуйтеся з обраним лікарем прямо тут. Наприкінці — висновок і призначення.' }),
        h('button', { class: 'btn primary', onclick: () => { location.hash = '#/new'; } }, h('i', { class: 'fa-solid fa-user-doctor' }), 'Нова консультація')));
      const sup = ths.find((t) => t.type === 'support');
      kids.push(h('div', { class: 'section', text: 'Чат з клінікою — безкоштовно' }));
      kids.push(sup ? threadRow(sup) : h('button', { class: 'row', onclick: openSupport },
        h('div', { class: 'ava sup' }, h('i', { class: 'fa-solid fa-headset' })),
        h('div', { class: 'mid' }, h('div', { class: 'name', text: 'Адміністратор клініки' }), h('div', { class: 'prev', text: 'Запис, оплата, організаційні питання' }))));
      const cons = ths.filter((t) => t.type === 'consult');
      kids.push(h('div', { class: 'section', text: 'Мої консультації' }));
      if (!cons.length) kids.push(h('div', { class: 'empty-note', text: 'Ще немає консультацій.' }));
      cons.forEach((t) => kids.push(threadRow(t)));
      if (S.promo) kids.push(promoEl(S.promo));
    } else {
      const tabs = S.me.role === 'admin'
        ? [['support', 'Чати з пацієнтами'], ['active', 'Активні консультації'], ['all', 'Усі консультації']]
        : [['active', 'Активні'], ['all', 'Усі']];
      if (!S.tab || !tabs.some(([k]) => k === S.tab)) S.tab = tabs[0][0];
      const unreadIn = (k) => ths.filter((t) => match(t, k)).reduce((s, t) => s + t.unread, 0);
      kids.push(h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, label]) => {
        const n = unreadIn(k);
        return h('button', { class: 'tab' + (S.tab === k ? ' on' : ''), role: 'tab', 'aria-selected': String(S.tab === k), onclick: () => { S.tab = k; renderList(); } }, label + (n ? ` (${n})` : ''));
      })));
      const list = ths.filter((t) => match(t, S.tab));
      if (!list.length) kids.push(h('div', { class: 'empty-note', text: S.tab === 'support' ? 'Повідомлень від пацієнтів поки немає.' : 'Консультацій поки немає.' }));
      list.forEach((t) => kids.push(threadRow(t)));
    }
    body.replaceChildren(...kids);
  }
  function match(t, k) {
    if (k === 'support') return t.type === 'support';
    if (k === 'active') return t.type === 'consult' && (t.status === 'active' || (t.status === 'expired' && !t.conclusion));
    return t.type === 'consult';
  }

  // Реклама інших застосунків Hertz Electronics (список і банери — promo/promo.json на сайті; будь-яка помилка — без банера)
  function loadPromo() {
    fetch('https://nadiya.pp.ua/promo/promo.json', { cache: 'no-cache' }).then((r) => r.json()).then((j) => {
      const l = (j.items || []).filter((x) => x && x.code !== 'nadiya' && /^https:\/\//.test(x.img || '') && /^https:\/\//.test(x.url || ''));
      if (!l.length) return;
      S.promo = { title: j.title || 'Інші застосунки Hertz Electronics', item: l[Math.floor(Math.random() * l.length)] };
      renderList();
    }).catch(() => {});
  }
  function promoEl(p) {
    if (p.el) return p.el; // один елемент на весь сеанс — без перезавантаження картинки при оновленні списку
    const go = () => {
      if (NA && NA.openExternal) NA.openExternal(p.item.url);
      else window.open(p.item.url, '_blank', 'noopener');
    };
    return (p.el = h('div', { class: 'promo' },
      h('div', { class: 'section', style: 'padding:0 0 8px', text: p.title }),
      h('img', { src: p.item.img, alt: p.item.name, role: 'link', tabindex: '0', onclick: go, onkeydown: (e) => { if (e.key === 'Enter') go(); } })));
  }

  async function openSupport() {
    try { const d = await api('GET', '/support'); location.hash = '#/t/' + d.thread.id; }
    catch (e) { toast(e.message); }
  }

  // ---------- нова консультація ----------
  async function viewNew() {
    stopTimers(); $listPane = null;
    const back = h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => { location.hash = '#/'; } }, h('i', { class: 'fa-solid fa-arrow-left' }));
    const body = h('div', { class: 'wrap' }, h('div', { class: 'center' }, h('div', { class: 'spin', 'aria-label': 'Завантаження' })));
    $app.replaceChildren(h('div', { class: 'top' }, back, h('div', { class: 'grow' }, h('div', { class: 'title', text: 'Нова консультація' }))),
      h('div', { style: 'flex:1;overflow-y:auto;' }, body));
    const msg = h('div', { class: 'muted' });
    let d;
    try { body.replaceChildren(msg); d = await withWake(() => api('GET', '/doctors'), msg); }
    catch (e) {
      body.replaceChildren(h('div', { class: 'err', text: e.message }), h('button', { class: 'btn ghost', text: 'Спробувати ще', onclick: viewNew }));
      return;
    }
    let pick = d.doctors.length === 1 ? d.doctors[0].login : null;
    const opts = d.doctors.map((doc) => {
      const r = h('input', { type: 'radio', name: 'doc', value: doc.login });
      if (pick === doc.login) r.checked = true;
      const lab = h('label', { class: 'doc-opt' + (pick === doc.login ? ' on' : '') }, r, h('div', { class: 'ava', text: initials(doc.name) }), h('div', {}, h('div', { class: 'name', text: doc.name }), h('div', { class: 'muted', text: 'Лікар клініки «Надія»' })));
      r.addEventListener('change', () => { pick = doc.login; opts.forEach((o) => o.classList.toggle('on', o === lab)); });
      return lab;
    });
    const complaint = h('textarea', { rows: '6', maxlength: '4000', placeholder: 'Що турбує, як давно, які обстеження вже були, які ліки приймаєте…' });
    const err = h('div', { class: 'err', role: 'alert' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, h('i', { class: 'fa-solid fa-credit-card' }), `Перейти до оплати ${d.price} грн`);
    const form = h('form', { onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      if (!pick) { err.textContent = 'Оберіть лікаря.'; return; }
      if (complaint.value.trim().length < 3) { err.textContent = 'Опишіть коротко, що вас турбує.'; return; }
      btn.disabled = true;
      try {
        const r = await withWake(() => api('POST', '/consultations', { body: { doctorLogin: pick, complaint: complaint.value.trim() } }), err);
        location.href = r.payUrl; // сторінка оплати Монобанку → повернення на #/t/<id>
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    } },
      h('div', { class: 'section', style: 'padding-left:0', text: '1. Оберіть лікаря' }),
      d.doctors.length ? h('div', { class: 'doc-pick', role: 'radiogroup' }, opts) : h('div', { class: 'empty-note', text: 'Зараз немає доступних лікарів.' }),
      h('div', { class: 'section', style: 'padding-left:0', text: '2. Опишіть проблему' }),
      h('label', { class: 'f' }, 'Цей опис стане першим повідомленням — лікар побачить його після оплати', complaint),
      h('div', { class: 'price' }, h('div', {}, h('div', { text: 'Консультація' }), h('div', { class: 'muted', text: `${d.hours} години листування з лікарем, висновок і призначення` })), h('b', { text: `${d.price} грн` })),
      err, btn,
      h('p', { class: 'muted', style: 'text-align:center', text: 'Оплата через Монобанк. Після оплати лікар отримає сповіщення.' }));
    body.replaceChildren(form);
  }

  // ---------- розмова ----------
  async function openThread(id) {
    id = Number(id);
    if (S.cur && S.cur.id === id) return;
    if (S.cur) { clearTimeout(S.cur.timer); clearInterval(S.cur.clock); }
    const cur = S.cur = { id, thread: null, msgs: new Map(), byClient: new Map(), lastId: 0, lastDay: '', delay: 3000, sig: '' };
    const back = h('button', { class: 'icon-btn back', 'aria-label': 'Назад до списку', onclick: () => { location.hash = '#/'; } }, h('i', { class: 'fa-solid fa-arrow-left' }));
    cur.$title = h('div', { class: 'title', text: 'Розмова' });
    cur.$sub = h('div', { class: 'sub' });
    cur.$status = h('div', { class: 'status hidden' });
    cur.$concl = h('div', { class: 'hidden' });
    cur.$msgs = h('div', { class: 'msgs', role: 'log', 'aria-label': 'Повідомлення' }, h('div', { class: 'center' }, h('div', { class: 'spin' })));
    cur.$bottom = h('div');
    $chatPane.replaceChildren(h('div', { class: 'top' }, back, h('div', { class: 'grow' }, cur.$title, cur.$sub)), cur.$status, cur.$concl, cur.$msgs, cur.$bottom);
    renderList();
    cur.clock = setInterval(() => { if (cur.thread) renderStatus(cur); }, 30000);
    await poll(cur, true);
  }

  async function poll(cur, first) {
    if (S.cur !== cur) return;
    clearTimeout(cur.timer);
    if (document.hidden && !first) { cur.timer = setTimeout(() => poll(cur), 3000); return; }
    // з першого власного непрочитаного — щоб оновити галочки «прочитано»
    let after = cur.lastId;
    for (const m of cur.msgs.values()) if (m.mine && !m.readAt && m.id && m.id <= after) after = Math.min(after, m.id - 1);
    try {
      const d = await api('GET', `/threads/${cur.id}/messages?after=${after}`);
      if (S.cur !== cur) return;
      if (first) cur.$msgs.replaceChildren();
      applyThread(cur, d.thread);
      const atBottom = cur.$msgs.scrollHeight - cur.$msgs.scrollTop - cur.$msgs.clientHeight < 80;
      let added = false;
      for (const m of d.messages) added = upsertMsg(cur, m) || added;
      if (first || (added && atBottom)) cur.$msgs.scrollTop = cur.$msgs.scrollHeight;
      if (first && !d.messages.length) cur.$msgs.append(h('div', { class: 'empty-note', text: cur.thread.type === 'support' ? 'Напишіть адміністратору — відповімо якнайшвидше.' : 'Повідомлень ще немає.' }));
      if (added) { const t = S.threads.find((x) => x.id === cur.id); if (t) { t.unread = 0; renderList(); } }
      cur.delay = 3000; cur.$sub.textContent = subLine(cur.thread);
    } catch (e) {
      if (S.cur !== cur) return;
      if (e.status === 404) { toast('Розмову не знайдено.'); location.hash = '#/'; return; }
      if (e.status === 401) return;
      cur.delay = Math.min(cur.delay * 2, 30000);
      cur.$sub.textContent = e.code === 'network' ? 'Немає зв\'язку…' : 'Сервер недоступний, повторюю…';
      if (first) cur.$msgs.replaceChildren(h('div', { class: 'empty-note', text: e.message }));
    }
    cur.timer = setTimeout(() => poll(cur), cur.delay);
  }

  function subLine(t) {
    if (t.type === 'support') return S.me.role === 'patient' ? 'Безкоштовно · запис, оплата, питання' : t.patient.email;
    if (S.me.role === 'patient') return 'Консультація лікаря';
    return t.patient.email + (S.me.role === 'admin' && t.doctor ? ` · ${t.doctor.name}` : '');
  }

  function applyThread(cur, t) {
    const sig = [t.status, t.canWrite, t.conclusion, t.prescription, t.expiresAt].join('|');
    cur.thread = t;
    cur.$title.textContent = threadTitle(t);
    if (sig === cur.sig) return;
    cur.sig = sig;
    renderStatus(cur); renderConclusion(cur); renderBottom(cur);
  }

  function renderStatus(cur) {
    const t = cur.thread, el = cur.$status;
    if (t.type === 'support') { el.className = 'status hidden'; return; }
    const staffCan = isStaff() && ['active', 'expired'].includes(t.status);
    const fin = staffCan ? h('button', { class: 'btn ghost', style: 'padding:7px 14px', onclick: () => completeDialog(cur) }, h('i', { class: 'fa-solid fa-file-medical' }), 'Завершити') : null;
    let cls = 'status', text;
    if (t.status === 'pending_payment') { cls += ' warn'; text = S.me.role === 'patient' ? `Очікує оплати ${t.price} грн. Якщо ви вже оплатили — зачекайте кілька секунд.` : 'Пацієнт ще не оплатив.'; }
    else if (t.status === 'active') { cls += ' ok'; text = `Консультація активна до ${fmtTime(t.expiresAt)} · залишилось ${left(t.expiresAt - Date.now())}`; }
    else if (t.status === 'expired') text = isStaff() ? 'Час консультації минув. Додайте висновок і призначення.' : 'Час консультації минув. Лікар ще може додати висновок.';
    else if (t.status === 'closed') text = `Консультацію завершено ${t.closedAt ? fmtDay(t.closedAt) : ''}.`;
    else text = STATUS[t.status] || t.status;
    const pay = t.status === 'pending_payment' && S.me.role === 'patient'
      ? h('button', { class: 'btn primary', style: 'padding:7px 14px', onclick: async (e) => {
          e.target.disabled = true;
          try { const r = await api('POST', `/consultations/${t.id}/pay`); location.href = r.payUrl; }
          catch (ex) { toast(ex.message); e.target.disabled = false; }
        } }, 'Оплатити') : null;
    el.className = cls;
    el.replaceChildren(...[h('i', { class: t.status === 'active' ? 'fa-regular fa-clock' : 'fa-solid fa-circle-info' }), h('span', { class: 'grow', text }), pay, fin].filter(Boolean));
  }

  function renderConclusion(cur) {
    const t = cur.thread;
    if (t.type !== 'consult' || (!t.conclusion && !t.prescription)) { cur.$concl.className = 'hidden'; return; }
    cur.$concl.className = 'conclusion';
    cur.$concl.replaceChildren(...[
      t.conclusion ? h('h3', { text: 'Висновок лікаря' }) : null, t.conclusion ? h('div', { text: t.conclusion }) : null,
      t.prescription ? h('h3', { text: 'Призначення' }) : null, t.prescription ? h('div', { text: t.prescription }) : null].filter(Boolean));
  }

  function renderBottom(cur) {
    const t = cur.thread;
    if (!t.canWrite) {
      const note = h('div', { class: 'closed-note' }, t.status === 'pending_payment' ? 'Писати лікарю можна після оплати.' : 'Розмова лише для читання.');
      if (S.me.role === 'patient' && t.type === 'consult' && ['closed', 'expired'].includes(t.status)) {
        note.append(h('br'), h('button', { class: 'btn primary', onclick: () => { location.hash = '#/new'; } }, 'Нова консультація'));
      }
      cur.$bottom.replaceChildren(note);
      return;
    }
    if (cur.$composer && cur.$bottom.contains(cur.$composer)) return;
    const ta = h('textarea', { rows: '1', maxlength: '4000', placeholder: 'Повідомлення…', 'aria-label': 'Текст повідомлення' });
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
    ta.addEventListener('input', grow);
    const fine = window.matchMedia && matchMedia('(pointer:fine)').matches;
    const send = () => { const v = ta.value.trim(); if (!v) return; ta.value = ''; grow(); sendText(cur, v); ta.focus(); };
    ta.addEventListener('keydown', (e) => { if (fine && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    const file = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, class: 'hidden' });
    file.addEventListener('change', () => { for (const f of file.files) sendFile(cur, f); file.value = ''; });
    cur.$composer = h('div', { class: 'composer' }, file,
      h('button', { class: 'icon-btn', 'aria-label': 'Додати фото або PDF', title: 'Фото або PDF', onclick: () => file.click() }, h('i', { class: 'fa-solid fa-paperclip' })),
      ta,
      h('button', { class: 'icon-btn send', 'aria-label': 'Надіслати', onclick: send }, h('i', { class: 'fa-solid fa-paper-plane' })));
    cur.$bottom.replaceChildren(cur.$composer);
  }

  // ---------- повідомлення ----------
  function isMine(m) {
    if (m.senderRole === 'system') return false;
    return S.me.role === 'patient' ? m.senderRole === 'patient' : m.senderRole !== 'patient';
  }

  function upsertMsg(cur, m) {
    const mine = isMine(m);
    const prev = cur.msgs.get(m.id) || (m.clientId && cur.byClient.get(m.clientId));
    const rec = { ...m, mine };
    if (prev) {
      if (prev.readAt === m.readAt && prev.id === m.id && !prev.local) return false;
      rec.el = prev.el;
      cur.msgs.delete(prev.id || ('local:' + prev.clientId));
      const el = msgEl(rec);
      prev.el.replaceWith(el); rec.el = el;
    } else {
      const day = fmtDay(m.createdAt);
      if (day !== cur.lastDay) { cur.lastDay = day; cur.$msgs.append(h('div', { class: 'day', text: day })); }
      rec.el = msgEl(rec);
      cur.$msgs.querySelector('.empty-note')?.remove();
      cur.$msgs.append(rec.el);
    }
    cur.msgs.set(m.id, rec);
    if (m.clientId) cur.byClient.set(m.clientId, rec);
    if (m.id > cur.lastId) cur.lastId = m.id;
    return !prev;
  }

  function msgEl(m) {
    if (m.senderRole === 'system') return h('div', { class: 'msg sys', text: m.text });
    const meta = h('div', { class: 'meta' }, m.createdAt ? fmtTime(m.createdAt) : '');
    if (m.mine) {
      if (m.failed) meta.replaceChildren('⚠ не надіслано — натисніть, щоб повторити');
      else if (m.local) meta.append(' ', h('i', { class: 'fa-regular fa-clock', 'aria-label': 'надсилається' }));
      else meta.append(' ', h('span', { class: m.readAt ? 'read' : '', 'aria-label': m.readAt ? 'прочитано' : 'надіслано', text: m.readAt ? '✓✓' : '✓' }));
    }
    const showWho = !m.mine && (isStaff() ? m.senderRole !== 'patient' : true) && m.senderName;
    const el = h('div', { class: 'msg ' + (m.mine ? 'mine' : 'theirs') + (m.failed ? ' failed' : '') },
      showWho ? h('div', { class: 'who', text: m.senderName }) : null,
      m.file ? fileEl(m) : null,
      m.text ? h('div', { text: m.text }) : null,
      meta);
    if (m.failed) el.addEventListener('click', () => m.retry && m.retry());
    return el;
  }

  async function blobUrl(fileId) {
    if (S.blobs.has(fileId)) return S.blobs.get(fileId);
    const b = await api('GET', '/files/' + fileId, { blob: true });
    const u = URL.createObjectURL(b);
    S.blobs.set(fileId, u);
    if (S.blobs.size > 150) { const [k, v] = S.blobs.entries().next().value; URL.revokeObjectURL(v); S.blobs.delete(k); }
    return u;
  }

  function fileEl(m) {
    const f = m.file;
    if (m.local) return h('div', { class: 'muted', text: '📎 ' + f.name + ' — надсилаю…' });
    if (f.mime.startsWith('image/')) {
      const img = h('img', { class: 'ph', alt: f.name });
      blobUrl(f.id).then((u) => { img.src = u; }).catch(() => { img.alt = 'Не вдалося завантажити фото'; });
      img.addEventListener('click', () => { if (img.src) lightbox(img.src, f.name); });
      return img;
    }
    return h('button', { class: 'doc', onclick: () => openDoc(f) }, h('i', { class: 'fa-solid fa-file-pdf' }),
      h('div', {}, h('div', { text: f.name }), h('div', { class: 'muted', text: Math.max(1, Math.round(f.size / 1024)) + ' КБ · відкрити' })));
  }

  async function openDoc(f) {
    try {
      const u = await blobUrl(f.id);
      if (NA && NA.saveFile) {
        const b = await (await fetch(u)).blob();
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
        NA.saveFile(b64, f.name, f.mime);
      } else {
        const a = h('a', { href: u, target: '_blank', rel: 'noopener' });
        document.body.append(a); a.click(); a.remove();
      }
    } catch (e) { toast(e.message || 'Не вдалося відкрити файл.'); }
  }

  function lightbox(src, alt) {
    const close = () => box.remove();
    const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': alt, onclick: close },
      h('img', { src, alt }),
      h('button', { class: 'icon-btn', 'aria-label': 'Закрити', onclick: close }, h('i', { class: 'fa-solid fa-xmark' })));
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    document.body.append(box);
  }

  function addLocal(cur, rec) {
    rec.local = true; rec.mine = true; rec.createdAt = Date.now();
    const day = fmtDay(rec.createdAt);
    if (day !== cur.lastDay) { cur.lastDay = day; cur.$msgs.append(h('div', { class: 'day', text: day })); }
    cur.$msgs.querySelector('.empty-note')?.remove();
    rec.el = msgEl(rec);
    cur.$msgs.append(rec.el);
    cur.byClient.set(rec.clientId, rec);
    cur.$msgs.scrollTop = cur.$msgs.scrollHeight;
  }

  function failLocal(cur, rec, e, retry) {
    if (e.status === 409) { toast(e.message); poll(cur); }
    else if (e.status !== 401) toast(e.message);
    rec.failed = true; rec.retry = () => { rec.failed = false; const el = msgEl(rec); rec.el.replaceWith(el); rec.el = el; retry(); };
    const el = msgEl(rec); rec.el.replaceWith(el); rec.el = el;
  }

  function sendText(cur, text) {
    const rec = { clientId: newClientId(), text, senderRole: S.me.role };
    addLocal(cur, rec);
    const go = async () => {
      try { const d = await api('POST', `/threads/${cur.id}/messages`, { body: { clientId: rec.clientId, text } }); if (S.cur === cur) upsertMsg(cur, d.message); }
      catch (e) { if (S.cur === cur) failLocal(cur, rec, e, go); }
    };
    go();
  }

  function sendFile(cur, file) {
    const okType = /^image\/(jpeg|png|webp)$/.test(file.type) || file.type === 'application/pdf';
    if (!okType) { toast('Можна надсилати фото (jpg, png, webp) або PDF.'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Файл завеликий (до 10 МБ).'); return; }
    const rec = { clientId: newClientId(), text: '', senderRole: S.me.role, file: { name: file.name, mime: file.type, size: file.size } };
    addLocal(cur, rec);
    const go = async () => {
      try {
        const d = await api('POST', `/threads/${cur.id}/files`, { raw: file, headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name), 'X-Client-Id': rec.clientId } });
        if (S.cur === cur) upsertMsg(cur, d.message);
      } catch (e) { if (S.cur === cur) failLocal(cur, rec, e, go); }
    };
    go();
  }

  function completeDialog(cur) {
    const t = cur.thread;
    const concl = h('textarea', { rows: '5', maxlength: '5000', value: t.conclusion || '' });
    const presc = h('textarea', { rows: '5', maxlength: '5000', value: t.prescription || '' });
    const err = h('div', { class: 'err', role: 'alert' });
    const close = () => modal.remove();
    const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Завершити консультацію' });
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      if (!concl.value.trim() && !presc.value.trim()) { err.textContent = 'Напишіть висновок або призначення.'; return; }
      btn.disabled = true;
      try {
        const d = await api('POST', `/consultations/${t.id}/complete`, { body: { conclusion: concl.value.trim(), prescription: presc.value.trim() } });
        close(); if (S.cur === cur) { applyThread(cur, d.thread); poll(cur); }
        loadThreads(); toast('Консультацію завершено. Пацієнт отримав висновок.');
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    } },
      h('h2', { text: 'Завершення консультації' }),
      h('p', { class: 'muted', text: `Пацієнт: ${t.patient.name || t.patient.email}. Висновок і призначення з'являться вгорі розмови, писати після цього не можна.` }),
      h('label', { class: 'f' }, 'Висновок', concl),
      h('label', { class: 'f' }, 'Призначення', presc),
      err,
      h('div', { class: 'acts' }, h('button', { class: 'btn ghost', type: 'button', text: 'Скасувати', onclick: close }), btn)));
    document.body.append(modal);
    concl.focus();
  }

  // ---------- маршрути ----------
  function route() {
    const hash = location.hash || '#/';
    if (!S.token || !S.me) {
      stopTimers(); $listPane = null;
      return hash === '#/register' ? viewRegister() : viewLogin();
    }
    if (hash === '#/login' || hash === '#/register') { location.hash = '#/'; return; }
    if (hash === '#/new') return S.me.role === 'patient' ? viewNew() : (location.hash = '#/');
    const m = /^#\/t\/(\d+)$/.exec(hash);
    viewMain(m ? Number(m[1]) : null);
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !S.token) return;
    if (S.cur) poll(S.cur);
    if ($listPane) loadThreads();
  });
  route();
  if (S.token) {
    registerPush();
    api('GET', '/me').then((d) => { S.me = d.me; store.set('nadiya_me', JSON.stringify(d.me)); }).catch(() => {});
  }
})();
