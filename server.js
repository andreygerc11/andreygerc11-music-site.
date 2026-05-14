const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const TelegramBot = require('node-telegram-bot-api');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ dest: '/tmp/', limits: { fileSize: 50 * 1024 * 1024 } });

// === ЗМІННІ З RENDER ===
const GROQ_API_KEY = process.env.GROQ_API_KEY; // Залишається для генерації Блогу
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Ключ для ШІ-Режисера та Слуху
const MONO_TOKEN = process.env.MONO_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; 
const BOT_TOKEN = process.env.BOT_TOKEN; 
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "5853625377";

// === ТВОЇ ID ПАПОК GOOGLE DRIVE ===
const PREVIEW_FOLDER_ID = "1Vmwzr3kt98gDYIOaPTsZ0f6FwqcOMQ7S"; 
const FULL_FOLDER_ID = "1FGNuLTq9mFHqoUSqp-7PSKHixZHq3W2j";

// === ГЛОБАЛЬНІ ЗМІННІ ТА КЕШ ===
let aiBlogPosts = [];
let blogSha = '';

let globalMusicList = [];

// НОВА БАЗА КОРИСТУВАЧІВ
let usersDB = [];
let usersSha = '';

// ==========================================
// 1. ТЕЛЕГРАМ БОТ ТА АДМІН-ФУНКЦІЇ
// ==========================================
const ADMIN_ID = 5853625377;
const CHANNEL_ID = process.env.CHANNEL_ID || "@golosprotyraku"; 
const BOT_PRICE = 3736; 

let bot;
if (BOT_TOKEN) {
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    console.log("✅ Telegram Bot успішно запущено.");

    const getMainMenu = () => {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🎵 Каталог пісень (37,36 грн)", callback_data: "show_menu" }],
                    [{ text: "🗣 Об'єднані голоси", callback_data: "united_voices" }],
                    [{ text: "ℹ️ Про проєкт та автора", callback_data: "about_project" }],
                    [{ text: "🎬 Створити свій кліп (ШІ-Студія)", url: "https://golos-proty-raku.pp.ua/#generator" }],
                    [{ text: "📰 Читати блог", url: "https://golos-proty-raku.pp.ua/#blog" }, { text: "🌐 Наш сайт", url: "https://golos-proty-raku.pp.ua" }],
                    [{ text: "🤝 Підтримати проєкт (Офіційно)", callback_data: "support_project" }]
                ]
            }
        };
    };

    bot.onText(/\/(start|menu)(.*)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const command = match[1]; 
        const payload = match[2] ? match[2].trim() : '';

        if (command === 'start' && payload.startsWith('buy_')) {
            const trackId = payload.replace('buy_', '');
            await sendBotInvoice(chatId, trackId);
            return;
        }

        const welcomeText = command === 'start' 
            ? `Вітаю! Це офіційний бот проєкту «Голос проти раку».\nТут ви можете підтримати автора, отримати повні версії пісень та знайти підтримку.\n\nОберіть потрібний розділ:`
            : `📍 Головне меню проєкту:\nОберіть потрібний розділ нижче:`;

        bot.sendMessage(chatId, welcomeText, getMainMenu());
    });

    bot.on('callback_query', async (query) => {
        try { await bot.answerCallbackQuery(query.id); } catch (e) {}
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        console.log(`🔘 Натиснуто кнопку: ${query.data}`); 

        try {
            if (query.data === 'about_project') {
                const aboutText = `<b>Про проєкт «Голос проти раку»</b>\n\nМій бій триває — і в шпиталі, і в строю. Я, Андрій Герц, створив цей проєкт, щоб об'єднати музику та технології у боротьбі за життя.\n\nЦе не лише моя особиста історія, а й шлях для допомоги кожному, хто зіткнувся з хворобою раку. Кожна ваша підтримка допомагає нам розвивати цю спільноту та боротися далі. Дякую, що ви поруч! 🇺🇦`;
                await bot.editMessageText(aboutText, { 
                    chat_id: chatId, 
                    message_id: messageId, 
                    parse_mode: 'HTML', 
                    reply_markup: { inline_keyboard: [[{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]] } 
                });
            }

            if (query.data === 'support_project') {
                const supportText = `<b>🤝 Офіційна підтримка проєкту</b>\n\nОскільки я є військовослужбовцем та діючим ФОП, усі платежі проходять абсолютно офіційно зі сплатою податків.\n\nНайкращий спосіб підтримати проєкт та нашу боротьбу — це придбати пісню з каталогу або оформити підписку Hertz Spectrum PRO на сайті.`;
                await bot.editMessageText(supportText, { 
                    chat_id: chatId, 
                    message_id: messageId, 
                    parse_mode: 'HTML', 
                    reply_markup: { inline_keyboard: [
                        [{ text: "👑 Оформити підписку на сайті", url: "https://golos-proty-raku.pp.ua/#generator" }], 
                        [{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]
                    ] } 
                });
            }

            if (query.data === 'united_voices') {
                const voicesText = `<b>🗣 Об'єднані голоси</b>\n\nУ цій боротьбі ніхто не має залишатися сам. Цей розділ створений для того, щоб ми підтримували один одного.\n\nВи можете поділитися своєю історією незламності або приєднатися до нашого чату для спілкування.`;
                await bot.editMessageText(voicesText, { 
                    chat_id: chatId, 
                    message_id: messageId, 
                    parse_mode: 'HTML', 
                    reply_markup: { inline_keyboard: [
                        [{ text: "📝 Розповісти свою історію", callback_data: "write_story" }],
                        [{ text: "💬 Чат незламних", url: "https://t.me/golos_pidtrymka" }],
                        [{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]
                    ] } 
                });
            }

            if (query.data === 'write_story') {
                const promptText = `Напишіть вашу історію прямо тут, у повідомленні. \n\nВи можете розповісти про свій шлях, поділитися порадою або просто словами підтримки. Я отримаю ваше повідомлення і ми разом вирішимо, як воно зможе допомогти іншим.`;
                await bot.sendMessage(chatId, promptText, { reply_markup: { force_reply: true } });
            }

            if (query.data === 'back_to_main') {
                await bot.editMessageText(`📍 Головне меню проєкту:\nОберіть потрібний розділ нижче:`, { 
                    chat_id: chatId, 
                    message_id: messageId, 
                    ...getMainMenu() 
                });
            }

            if (query.data.startsWith('show_menu')) {
                if (globalMusicList.length === 0) await fetchMusicFromDrive();
                if (globalMusicList.length === 0) {
                    await bot.sendMessage(chatId, "⏳ Пісні ще завантажуються, спробуйте через хвилину.");
                    return;
                }

                const parts = query.data.split('_');
                let page = 0;
                if (parts.length === 3) page = parseInt(parts[2]); 

                const ITEMS_PER_PAGE = 10; 
                const totalPages = Math.ceil(globalMusicList.length / ITEMS_PER_PAGE);
                const currentList = globalMusicList.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

                const keyboard = currentList.map(t => [{ text: `🎵 ${t.name} – 37,36 грн`, callback_data: `buy_${t.fullId}` }]);

                const navButtons = [];
                if (page > 0) navButtons.push({ text: "⬅️ Назад", callback_data: `show_menu_${page - 1}` });
                if (page < totalPages - 1) navButtons.push({ text: "Вперед ➡️", callback_data: `show_menu_${page + 1}` });
                
                if (navButtons.length > 0) keyboard.push(navButtons);
                keyboard.push([{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]); 

                await bot.editMessageText(`Оберіть пісню для завантаження (Сторінка ${page + 1} з ${totalPages}):`, { 
                    chat_id: chatId, 
                    message_id: messageId, 
                    reply_markup: { inline_keyboard: keyboard } 
                });
            }

            if (query.data.startsWith('buy_')) {
                const trackId = query.data.replace('buy_', '');
                await sendBotInvoice(chatId, trackId, messageId);
            }

        } catch (error) {
            console.error(`❌ Помилка обробки кнопки ${query.data}:`, error.message);
        }
    });

    bot.on('message', async (msg) => {
        if (msg.reply_to_message && msg.reply_to_message.text && msg.reply_to_message.text.includes("Напишіть вашу історію")) {
            const userHistory = msg.text;
            const userName = msg.from.first_name || "Користувач";
            const userHandle = msg.from.username ? `@${msg.from.username}` : "Немає юзернейму";
            
            await bot.sendMessage(ADMIN_ID, `📩 <b>Нова історія для «Об'єднаних голосів»!</b>\nВід: ${userName} (${userHandle})\n\n${userHistory}`, { parse_mode: 'HTML' });
            bot.sendMessage(msg.chat.id, "Дякую, що поділилися! Ваша історія отримана. Разом ми сильніші. 💙");
        }
    });

    async function sendBotInvoice(chatId, trackId, messageId = null) {
        const track = globalMusicList.find(t => t.fullId === trackId);
        if (!track) return bot.sendMessage(chatId, "❌ Трек не знайдено.");

        try {
            const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
                amount: BOT_PRICE, ccy: 980,
                merchantPaymInfo: { destination: `Трек: ${track.name}`, reference: `tg_${chatId}_${track.fullId}` },
                webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
            }, { headers: { 'X-Token': MONO_TOKEN } });

            const text = `Ви обрали: <b>${track.name}</b>\n\n✅ Після оплати бот МИТТЄВО надішле вам аудіофайл прямо сюди.`;
            const opts = { 
                parse_mode: "HTML", 
                reply_markup: { 
                    inline_keyboard: [
                        [{ text: "💳 Оплатити 37,36 грн", url: monoRes.data.pageUrl }],
                        [{ text: "⬅️ Назад до списку", callback_data: "show_menu" }]
                    ] 
                } 
            };

            if (messageId) bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
            else bot.sendMessage(chatId, text, opts);
        } catch (e) { bot.sendMessage(chatId, "❌ Помилка сервісу оплати."); }
    }

    bot.onText(/\/send/, async (msg) => {
        if (msg.from.id !== ADMIN_ID) return;
        const text = msg.text.replace('/send', '').trim();
        if (!text) return bot.sendMessage(msg.chat.id, "Введіть текст після команди /send");
        
        try {
            await bot.sendMessage(CHANNEL_ID, text, { parse_mode: "HTML" });
            bot.sendMessage(msg.chat.id, "✅ Опубліковано на каналі!");
        } catch (e) { bot.sendMessage(msg.chat.id, `❌ Помилка публікації: ${e.message}`); }
    });
}

async function sendTelegramMessage(text) {
    if (!TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID === "ТВІЙ_ID_ЯКЩО_НЕ_ДОДАВ_У_RENDER") return;
    try {
        if (bot) {
            await bot.sendMessage(TELEGRAM_CHAT_ID, text, { parse_mode: 'HTML' });
        } else if (BOT_TOKEN) {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'HTML' });
        }
    } catch (e) { console.error("Помилка Telegram:", e.message); }
}

// ==========================================
// 2. СИНХРОНІЗАЦІЯ БАЗИ КОРИСТУВАЧІВ (GITHUB)
// ==========================================
async function syncUsersFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    try {
        const res = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/users.json`, { 
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` } 
        });
        usersDB = JSON.parse(Buffer.from(res.data.content, 'base64').toString('utf8'));
        usersSha = res.data.sha;
        console.log(`👤 Завантажено ${usersDB.length} користувачів з GitHub`);
    } catch (e) { 
        usersDB = []; 
        console.log("users.json не знайдено, створюємо пусту базу.");
    }
}

async function saveUsersToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/users.json`;
        let sha = usersSha;
        if (!sha) {
            try { 
                const getRes = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }); 
                sha = getRes.data.sha; 
            } catch (e) {}
        }
        const contentEncoded = Buffer.from(JSON.stringify(usersDB, null, 2), 'utf8').toString('base64');
        const res = await axios.put(url, { 
            message: `Оновлення бази користувачів`, 
            content: contentEncoded, 
            sha: sha || undefined 
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        usersSha = res.data.content.sha;
    } catch (e) { 
        console.error("Помилка збереження користувачів:", e.message); 
    }
}

// ==========================================
// 3. БЕЗПЕКА ТА ЛІМІТИ GEMINI API
// ==========================================

// АВТОРИЗАЦІЯ ТА ВИДАЧА ТРІАЛУ (1 КЛІП)
app.post('/api/auth/user', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email обов'язковий" });

    let user = usersDB.find(u => u.email === email);
    if (!user) {
        user = { email: email, status: "free", clips_left: 1 };
        usersDB.push(user);
        await saveUsersToGitHub();
        console.log(`🎉 Зареєстровано нового користувача: ${email} (+1 безкоштовний кліп)`);
    }

    if (email === 'admin@dev.com') {
        user.status = 'premium';
        user.clips_left = 999; 
    }

    res.json(user);
});

// ПРОКСІ: GEMINI TEXT (Розкадровка, Текст Пісні)
app.post('/api/gemini/text', async (req, res) => {
    const { email, payload, isStoryboard } = req.body;

    if (!GEMINI_API_KEY) return res.status(500).json({ error: "Немає GEMINI_API_KEY" });
    if (!email) return res.status(400).json({ error: "Авторизація обов'язкова" });

    let user = usersDB.find(u => u.email === email);
    // Для адміна створимо віртуального користувача, якщо його випадково немає в базі
    if (!user && email === 'admin@dev.com') {
        user = { email: 'admin@dev.com', status: 'premium', clips_left: 999 };
    } else if (!user) {
        return res.status(403).json({ error: "Користувача не знайдено" });
    }

    // СПИСУЄМО ЛІМІТ ТІЛЬКИ ЗА КЛІП (РОЗКАДРОВКУ) — АДМІНА ПРОПУСКАЄМО
    if (isStoryboard && email !== 'admin@dev.com') {
        if (user.clips_left <= 0) {
            return res.status(403).json({ error: "Ліміт вичерпано", code: "NO_TOKENS" });
        }
        user.clips_left -= 1;
        await saveUsersToGitHub();
        console.log(`🎬 Користувач ${email} генерує кліп. Залишок: ${user.clips_left}`);
    } else if (isStoryboard && email === 'admin@dev.com') {
        console.log(`👑 Адміністратор ${email} генерує кліп безкоштовно.`);
    }

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            payload,
            { headers: { 'Content-Type': 'application/json' } }
        );
        res.json(response.data);
    } catch (error) {
        console.error("Gemini Text API Error:", error?.response?.data || error.message);
        // Якщо сталася помилка Гугла, повертаємо токен людині (але не чіпаємо адміна)
        if (isStoryboard && email !== 'admin@dev.com') {
            user.clips_left += 1;
            await saveUsersToGitHub();
        }
        res.status(500).json({ error: "Помилка генерації через ШІ" });
    }
});

// ПРОКСІ: GEMINI IMAGE (Imagen 4 для кадрів)
app.post('/api/gemini/image', async (req, res) => {
    const { email, payload } = req.body;
    
    if (!GEMINI_API_KEY) return res.status(500).json({ error: "Немає GEMINI_API_KEY" });
    if (!email) return res.status(400).json({ error: "Авторизація обов'язкова" });

    let user = usersDB.find(u => u.email === email);
    if (!user) return res.status(403).json({ error: "Користувача не знайдено" });

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GEMINI_API_KEY}`,
            payload,
            { headers: { 'Content-Type': 'application/json' } }
        );
        res.json(response.data);
    } catch (error) {
        console.error("Imagen API Error:", error?.response?.data || error.message);
        res.status(500).json({ error: "Помилка відмальовки кадру" });
    }
});

// ==========================================
// 4. GOOGLE SHEETS
// ==========================================
async function sendToGoogle(data) {
    if (!GOOGLE_SHEETS_URL) return { success: true };
    const response = await fetch(GOOGLE_SHEETS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), redirect: 'follow' });
    if (!response.ok) throw new Error(`Google Script повернув статус: ${response.status}`);
    const textResponse = await response.text();
    try { return JSON.parse(textResponse); } catch (e) { return { success: true }; }
}

app.post('/api/register', async (req, res) => { try { res.json(await sendToGoogle({ action: 'register', ...req.body })); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/login', async (req, res) => { try { res.json(await sendToGoogle({ action: 'login', ...req.body })); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/social-auth', async (req, res) => { try { res.json(await sendToGoogle({ action: 'social_auth', email: req.body.email, name: req.body.name })); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/subscriptions', async (req, res) => { try { res.json(await sendToGoogle({ action: 'new_sub', ...req.body })); } catch (error) { res.status(500).json({ error: error.message }); } });
app.get('/api/subscriptions', async (req, res) => {
    if (!GOOGLE_SHEETS_URL) return res.json([]);
    try { const response = await fetch(`${GOOGLE_SHEETS_URL}?action=getSubs`, { redirect: 'follow' }); const data = await response.json(); res.json(data); } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// 5. МУЗИКА З GOOGLE DRIVE ТА ОПЛАТИ
// ==========================================
async function fetchMusicFromDrive() {
    try {
        if (!GOOGLE_API_KEY) return [];
        const prevRes = await axios.get(`https://www.googleapis.com/drive/v3/files?q='${PREVIEW_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name,createdTime)&key=${GOOGLE_API_KEY}`);
        const fullRes = await axios.get(`https://www.googleapis.com/drive/v3/files?q='${FULL_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&key=${GOOGLE_API_KEY}`);
        globalMusicList = prevRes.data.files.map(f => {
            const cleanName = f.name.replace(/\.[^/.]+$/, "").replace(" (Прев'ю)", "").trim();
            const fullFile = fullRes.data.files.find(full => full.name.replace(/\.[^/.]+$/, "").trim() === cleanName);
            return { name: cleanName, previewId: f.id, fullId: fullFile ? fullFile.id : null, date: f.createdTime };
        }).filter(m => m.fullId);
        return globalMusicList;
    } catch (error) { console.error("Drive Fetch Error"); return globalMusicList; }
}

app.get('/api/music', async (req, res) => {
    const list = await fetchMusicFromDrive();
    res.json(list);
});

app.get('/api/stream/:fileId', async (req, res) => {
    try {
        if (!GOOGLE_API_KEY) throw new Error("Немає GOOGLE_API_KEY");
        const response = await axios({ method: 'get', url: `https://www.googleapis.com/drive/v3/files/${req.params.fileId}?alt=media&key=${GOOGLE_API_KEY}`, responseType: 'stream' });
        res.setHeader('Content-Type', 'audio/mpeg'); res.setHeader('Accept-Ranges', 'bytes'); response.data.pipe(res);
    } catch (error) { res.status(500).send("Помилка відтворення"); }
});

app.post('/api/pay', async (req, res) => {
    try {
        const { songId, songName } = req.body;
        if (!MONO_TOKEN) return res.json({ url: "https://send.monobank.ua/" });
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3736, ccy: 980, merchantPaymInfo: { destination: `Трек: ${songName}`, reference: songId },
            redirectUrl: "https://golos-proty-raku.pp.ua/success.html", webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка оплати" }); }
});

// ПЛАТІЖ: 349 грн за 10 Кліпів
app.post('/api/pay-subscription', async (req, res) => {
    try {
        const { email } = req.body;
        if (!MONO_TOKEN) return res.json({ url: "https://send.monobank.ua/" });
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 34900, // 349 грн
            ccy: 980, 
            merchantPaymInfo: { destination: "Пакет PRO: 10 Генерацій Кліпу", reference: email },
            redirectUrl: "https://golos-proty-raku.pp.ua/success.html", 
            webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка оплати пакету" }); }
});

// === ЄДИНИЙ WEBHOOK ДЛЯ САЙТУ ТА БОТА ===
app.post('/api/webhook', async (req, res) => {
    try {
        const { invoiceId, status, reference } = req.body;
        if (status === 'success') {
            await sendToGoogle({ action: 'update_sub', invoiceId, status });
            await sendTelegramMessage(`🔥 <b>Нова оплата!</b>\nРеференс: ${reference}`);

            if (reference && reference.startsWith('tg_') && bot) {
                // ЛОГІКА ДЛЯ КУПІВЛІ ТРЕКУ В БОТІ
                const parts = reference.split('_');
                const tgChatId = parts[1];
                const tgTrackId = parts[2];
                const track = globalMusicList.find(t => t.fullId === tgTrackId) || { name: "Ваш трек" };

                try {
                    await bot.sendMessage(tgChatId, `🎉 <b>Оплата успішна!</b>\nЗавантажую файл <b>${track.name}</b>... Зачекайте пару секунд ⏳`, { parse_mode: "HTML" });

                    const fileStreamRes = await axios({ 
                        method: 'get', 
                        url: `https://www.googleapis.com/drive/v3/files/${tgTrackId}?alt=media&key=${GOOGLE_API_KEY}`, 
                        responseType: 'stream' 
                    });

                    await bot.sendAudio(tgChatId, fileStreamRes.data, {
                        caption: `💙 Дякую за підтримку!\nОсь ваш трек: <b>${track.name}</b>`,
                        parse_mode: "HTML",
                        title: track.name,
                        performer: "Андрій Герц (Golos Proty Raku)"
                    }, { filename: `${track.name}.mp3`, contentType: 'audio/mpeg' });

                } catch (audioErr) {
                    console.error("Помилка відправки файлу в ТГ:", audioErr.message);
                    const fileUrl = `https://drive.google.com/uc?export=download&id=${tgTrackId}`;
                    const opts = { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "⬇️ Скачати трек", url: fileUrl }]] } };
                    await bot.sendMessage(tgChatId, `🎉 <b>Дякую за підтримку!</b>\nОсь ваше посилання на файл: <b>${track.name}</b>`, opts);
                }
            } else if (reference && reference.includes('@')) {
                // ЛОГІКА ДЛЯ КУПІВЛІ ПАКЕТУ КЛІПІВ (ПО EMAIL)
                let user = usersDB.find(u => u.email === reference);
                if (!user) {
                    user = { email: reference, status: "premium", clips_left: 10 };
                    usersDB.push(user);
                } else {
                    user.status = "premium";
                    user.clips_left = (user.clips_left || 0) + 10; // +10 КЛІПІВ
                }
                await saveUsersToGitHub();
                console.log(`💰 УСПІШНА ОПЛАТА ПАКЕТУ! Email: ${reference}. Баланс: ${user.clips_left}`);
            }
        }
        res.status(200).send("OK");
    } catch (e) { res.status(500).send("Error"); }
});

// ==========================================
// 5. РОЗПІЗНАВАННЯ АУДІО ЧЕРЕЗ GEMINI 2.5 FLASH (Заміна Whisper)
// ==========================================
function compressAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath).audioChannels(1).audioFrequency(16000).audioBitrate('32k').toFormat('mp3').on('end', () => resolve(outputPath)).on('error', reject).save(outputPath);
    });
}

app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    let compressedPath = null;
    try {
        if (!GEMINI_API_KEY) return res.status(500).json({ error: "Немає GEMINI_API_KEY" });

        compressedPath = req.file.path + '_comp.mp3';
        // Стискаємо аудіо, щоб воно легко пройшло через API
        await compressAudio(req.file.path, compressedPath);
        
        // Читаємо файл і перетворюємо у Base64
        const fileBuffer = fs.readFileSync(compressedPath);
        const base64Audio = fileBuffer.toString('base64');

        const payload = {
            contents: [{
                parts: [
                    { text: "Ти експерт з транскрибації пісень. Уважно прослухай цей трек. Розпізнай слова пісні українською мовою і поверни їх у форматі LRC з точними таймкодами [MM:SS.xx] для кожного рядка. Відстань між рядками приблизно 5-10 секунд. ВИВЕДИ ТІЛЬКИ ТЕКСТ У ФОРМАТІ LRC, без жодних інших слів чи коментарів." },
                    { inlineData: { mimeType: "audio/mp3", data: base64Audio } }
                ]
            }]
        };

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            payload,
            { headers: { 'Content-Type': 'application/json' } }
        );

        let lrcText = response.data.candidates[0].content.parts[0].text;
        
        // Очищення від маркдауну, якщо Gemini додав ```
        lrcText = lrcText.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();

        res.json({ lrc: lrcText }); 
    } catch (error) { 
        console.error("Gemini Audio Error:", error?.response?.data || error.message);
        res.status(500).json({ error: "Помилка розпізнавання ШІ (Gemini)" }); 
    } finally { 
        // Видалення тимчасових файлів
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
    }
});

// ==========================================
// 6. АВТОМАТИЧНИЙ БЛОГ (Llama через Groq)
// ==========================================
async function syncBlogFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    try {
        const res = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/blog_posts.json`, { 
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` } 
        });
        aiBlogPosts = JSON.parse(Buffer.from(res.data.content, 'base64').toString('utf8'));
        console.log(`📚 Завантажено ${aiBlogPosts.length} постів з GitHub`);
    } catch (e) { 
        aiBlogPosts = []; 
        console.log("Створено новий масив постів (Файл ще не існує)");
    }
}

async function saveBlogToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/blog_posts.json`;
        let sha = null;
        try { 
            const getRes = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }); 
            sha = getRes.data.sha; 
        } catch (e) {}

        const contentEncoded = Buffer.from(JSON.stringify(aiBlogPosts, null, 2), 'utf8').toString('base64');
        
        await axios.put(url, { 
            message: `Автооновлення блогу (${new Date().toLocaleDateString('uk-UA')})`, 
            content: contentEncoded, 
            sha 
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        
        console.log("✅ Блог успішно збережено на GitHub");
    } catch (e) { 
        console.error("Помилка збереження на GitHub:", e.message); 
    }
}

const allBlogSources = [
    { type: "news", url: "[https://news.google.com/rss/search?q=%D0%BE%D0%BD%D0%BA%D0%BE%D0%BB%D0%BE%D0%B3%D1%96%D1%8F+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA&hl=uk&gl=UA&ceid=UA:uk](https://news.google.com/rss/search?q=%D0%BE%D0%BD%D0%BA%D0%BE%D0%BB%D0%BE%D0%B3%D1%96%D1%8F+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA&hl=uk&gl=UA&ceid=UA:uk)" },
    { type: "news", url: "[https://news.google.com/rss/search?q=%D0%BB%D0%B5%D0%B9%D0%BA%D0%B5%D0%BC%D1%96%D1%8F+%D1%82%D0%B5%D1%80%D0%B0%D0%BF%D1%96%D1%8F&hl=uk&gl=UA&ceid=UA:uk](https://news.google.com/rss/search?q=%D0%BB%D0%B5%D0%B9%D0%BA%D0%B5%D0%BC%D1%96%D1%8F+%D1%82%D0%B5%D1%80%D0%B0%D0%BF%D1%96%D1%8F&hl=uk&gl=UA&ceid=UA:uk)" },
    { type: "news", url: "[https://news.google.com/rss/search?q=%D1%96%D0%BD%D0%BD%D0%BE%D0%B2%D0%B0%D1%86%D1%96%D1%97+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA%D1%83&hl=uk&gl=UA&ceid=UA:uk](https://news.google.com/rss/search?q=%D1%96%D0%BD%D0%BD%D0%BE%D0%B2%D0%B0%D1%86%D1%96%D1%97+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA%D1%83&hl=uk&gl=UA&ceid=UA:uk)" },
    { type: "news", url: "[https://news.google.com/rss/search?q=cancer+research+breakthrough&hl=en-US&gl=US&ceid=US:en](https://news.google.com/rss/search?q=cancer+research+breakthrough&hl=en-US&gl=US&ceid=US:en)" },
    { type: "news", url: "[https://news.google.com/rss/search?q=leukemia+treatment+advances&hl=en-US&gl=US&ceid=US:en](https://news.google.com/rss/search?q=leukemia+treatment+advances&hl=en-US&gl=US&ceid=US:en)" },
    { type: "news", url: "[https://medicalxpress.com/rss-feed/cancer-news/](https://medicalxpress.com/rss-feed/cancer-news/)" },
    { type: "news", url: "[https://www.sciencedaily.com/rss/health_medicine/cancer.xml](https://www.sciencedaily.com/rss/health_medicine/cancer.xml)" }
];

const psychologyTopics = [
    "Як прийняти діагноз: перші кроки після того, як ви дізналися про рак",
    "Як правильно спілкуватися з близькою людиною, яка хворіє на онкологію",
    "Де знайти внутрішні сили під час виснажливої хіміотерапії",
    "Страх рецидиву: як жити повноцінно в стані ремісії",
    "Як пояснити дітям про хворобу батьків",
    "Важливість груп підтримки: чому не варто проходити цей шлях наодинці",
    "Як впоратися з емоційним вигоранням, якщо ви доглядаєте за онкохворим",
    "Техніки релаксації та дихання для зняття тривоги перед операцією",
    "Як зберегти позитивне мислення, коли здається, що надії немає",
    "Вплив творчості та арт-терапії на одужання онкопацієнтів"
];

async function fetchAndRewriteBlog() {
    if (!GROQ_API_KEY) { console.log("❌ GROQ_API_KEY не налаштований"); return; }
    console.log("🔄 Запуск автоматичної генерації блогу (5 новин + 3 психологія)...");
    
    let addedCount = 0;
    let newsAddedThisRun = 0;
    
    const newsUrls = allBlogSources.filter(src => src.type === "news").map(src => src.url);
    const shuffledRss = newsUrls.sort(() => 0.5 - Math.random());

    for (const rssUrl of shuffledRss) {
        if (newsAddedThisRun >= 5) break; 

        try {
            const response = await axios.get(rssUrl, { timeout: 10000 }); 
            const xml = response.data;
            
            const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/) || xml.match(/<entry>([\s\S]*?)<\/entry>/);
            if (!itemMatch) continue;

            const itemXml = itemMatch[1];
            const titleMatch = itemXml.match(/<title>(.*?)<\/title>/);
            const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/) || itemXml.match(/<published>(.*?)<\/published>/);

            if (titleMatch) {
                let rawTitle = titleMatch[1].replace("<![CDATA[", "").replace("]]>", "").trim();
                let cleanTitle = rawTitle.split(" - ")[0]; 
                
                const isDuplicate = aiBlogPosts.some(p => p.originalTitle === rawTitle);
                if (isDuplicate) {
                    console.log(`⏭ Новину пропущено (вже є): ${cleanTitle}`);
                    continue;
                }

                console.log(`✍️ Генерую новину: ${cleanTitle}`);
                
                let pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toLocaleDateString('uk-UA') : new Date().toLocaleDateString('uk-UA');

                const groqRes = await axios.post('[https://api.groq.com/openai/v1/chat/completions](https://api.groq.com/openai/v1/chat/completions)', {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { 
                            role: "system", 
                            content: "Ти — професійний український журналіст. Твоє завдання: перекласти англійську новину та написати аналітичну статтю. КАТЕГОРИЧНО ЗАБОРОНЕНО використовувати іноземні слова, латиницю або ієрогліфи. Тільки чиста українська мова. Використовуй цікаві підзаголовки <h2>. Першим рядком твоєї відповіді має бути ПЕРЕКЛАДЕНИЙ ТА ВІДКОРЕГОВАНИЙ ЗАГОЛОВОК (без тегів), а потім (з нового рядка) — сам текст статті з <h2> заголовками. Пиши від імені команди 'Голос проти раку'." 
                        }, 
                        { role: "user", content: `Новина для аналізу: ${rawTitle}` }
                    ],
                    max_tokens: 2000,
                    temperature: 0.3 
                }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                const fullResponse = groqRes.data.choices[0].message.content.trim();
                const lines = fullResponse.split('\n');
                const translatedTitle = lines[0].replace(/[*#]/g, '').trim(); 
                const articleContent = lines.slice(1).join('\n').trim(); 

                const post = {
                    id: Date.now() + Math.floor(Math.random() * 1000), 
                    date: pubDate, 
                    category: "news",
                    originalTitle: rawTitle, 
                    title: translatedTitle, 
                    content: articleContent, 
                    imageUrl: "baner_novunu.png"
                };

                aiBlogPosts.unshift(post);
                addedCount++;
                newsAddedThisRun++;

                if (bot && CHANNEL_ID) {
                    try {
                        const cleanContent = articleContent.replace(/\*/g, '').replace(/</g, '').replace(/>/g, '');
                        const shortText = cleanContent.substring(0, 280).replace(/\n/g, ' ');
                        const tgText = `📰 <b>${translatedTitle}</b>\n\n${shortText}...\n\n👉 <a href="https://golos-proty-raku.pp.ua/#blog">Читати повністю на сайті</a>`;
                        await bot.sendMessage(CHANNEL_ID, tgText, { parse_mode: 'HTML' });
                    } catch (tgErr) {}
                }

                await new Promise(r => setTimeout(r, 6000)); 
            }
        } catch (e) { }
    }

    let psychAddedThisRun = 0;
    
    for (let i = 0; i < 10; i++) { 
        if (psychAddedThisRun >= 3) break;

        const availableTopics = psychologyTopics.filter(topic => 
            !aiBlogPosts.some(p => p.originalTopic === topic)
        );

        if (availableTopics.length === 0) break; 

        const selectedTopic = availableTopics[Math.floor(Math.random() * availableTopics.length)];
        console.log(`🫂 Генерую підтримку на тему: ${selectedTopic}`);

        try {
            const groqRes = await axios.post('[https://api.groq.com/openai/v1/chat/completions](https://api.groq.com/openai/v1/chat/completions)', {
                model: "llama-3.3-70b-versatile",
                messages: [
                    { 
                        role: "system", 
                        content: "Ти — досвідчений волонтер проєкту 'Голос проти раку'. Пиши теплу статтю підтримки. ПИШИ ВИКЛЮЧНО УКРАЇНСЬКОЮ МОВОЮ. Категорично заборонено використовувати латиницю, іспанські, в'єтнамські слова чи китайські ієрогліфи. Пиши як жива людина, без шаблонів 'Вступ/Висновок'. Використовуй емоційні підзаголовки <h2>. ЗАКІНЧУЙ статтю обов'язковим абзацом: 'Важливо: Цей матеріал створено для емоційної підтримки. Він не замінює консультацію з лікарем-онкологом або професійним психотерапевтом'." 
                    }, 
                    { role: "user", content: `Тема статті: ${selectedTopic}` }
                ],
                max_tokens: 2200,
                temperature: 0.3
            }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

            const articleContent = groqRes.data.choices[0].message.content.trim();

            const post = {
                id: Date.now() + Math.floor(Math.random() * 1000), 
                date: new Date().toLocaleDateString('uk-UA'), 
                category: "psychology",
                originalTopic: selectedTopic, 
                title: selectedTopic,
                content: articleContent, 
                imageUrl: "article_support.png"
            };

            aiBlogPosts.unshift(post);
            addedCount++;
            psychAddedThisRun++;

            if (bot && CHANNEL_ID) {
                try {
                    const cleanContent = articleContent.replace(/\*/g, '').replace(/</g, '').replace(/>/g, '');
                    const shortText = cleanContent.substring(0, 280).replace(/\n/g, ' ');
                    const tgText = `🫂 <b>${selectedTopic}</b>\n\n${shortText}...\n\n👉 <a href="https://golos-proty-raku.pp.ua/#blog">Читати повністю на сайті</a>`;
                    await bot.sendMessage(CHANNEL_ID, tgText, { parse_mode: 'HTML' });
                } catch (tgErr) {}
            }
            
            await new Promise(r => setTimeout(r, 6000)); 

        } catch (e) {}
    }

    if (addedCount > 0) {
        await saveBlogToGitHub();
        console.log(`🎉 Успішно згенеровано та збережено статей: ${addedCount}`);
    } else {
        console.log("✅ Немає нових унікальних тем або новин. Публікація пропущена.");
    }
}

app.get('/api/blog', (req, res) => {
    res.json(aiBlogPosts); 
});

// ==========================================
// 7. ЗАПУСК СЕРВЕРА
// ==========================================
const PORT = process.env.PORT || 10000;

Promise.all([syncBlogFromGitHub(), fetchMusicFromDrive(), syncUsersFromGitHub()]).then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Сервер успішно запущено на порту ${PORT}`);

        setTimeout(fetchAndRewriteBlog, 30000);

        function scheduleChecks() {
            const now = new Date();
            const kyivTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Kiev" }));
            const currentHour = kyivTime.getHours();
            const currentMinutes = kyivTime.getMinutes();

            if ((currentHour === 8 && currentMinutes < 5) || (currentHour === 20 && currentMinutes < 5)) {
                console.log(`🕒 Запуск генерації блогу о ${currentHour}:00 (Київ)`);
                fetchAndRewriteBlog();
            }
        }
        setInterval(scheduleChecks, 5 * 60 * 1000);
        console.log("⏰ Налаштовано перевірку щодня о 08:00 та 20:00 (Київський час)");
    });
});
