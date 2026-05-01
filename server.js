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
app.use(express.json());

const upload = multer({ dest: '/tmp/', limits: { fileSize: 50 * 1024 * 1024 } });

// === ЗМІННІ З RENDER ===
const GROQ_API_KEY = process.env.GROQ_API_KEY;
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
let globalMusicList = [];

const hdMedicalImages = [
    "https://images.unsplash.com/photo-1530497610245-94d3c16cda28?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1579154204601-01588f351e67?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1584036561566-baf8f5f1b144?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1576086213369-97a306d36557?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1631815589968-fdb09a223b1e?q=80&w=1200&auto=format&fit=crop"
];

// ==========================================
// 1. ТЕЛЕГРАМ БОТ ТА АДМІН-ФУНКЦІЇ
// ==========================================
const ADMIN_ID = 5853625377;
const CHANNEL_ID = process.env.CHANNEL_ID || "@golosprotyraku"; 
const BOT_PRICE = 3736; // 37.36 грн

let bot;
if (BOT_TOKEN) {
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    console.log("✅ Telegram Bot успішно запущено.");

    // === ГОЛОВНЕ МЕНЮ ===
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

    // Обробка кнопок
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        if (query.data === 'about_project') {
            const aboutText = `<b>Про проєкт «Голос проти раку»</b>\n\nМій бій триває — і в шпиталі, і в строю. Я, Андрій Герц, створив цей проєкт, щоб об'єднати музику та технології у боротьбі за життя.\n\nЦе не лише моя особиста історія, а й шлях для допомоги кожному, хто зіткнувся з хворобою раку. Кожна ваша підтримка допомагає нам розвивати цю спільноту та боротися далі. Дякую, що ви поруч! 🇺🇦`;
            const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]] } };
            bot.editMessageText(aboutText, { chat_id: chatId, message_id: messageId, ...opts }).catch(e => {});
        }

        if (query.data === 'support_project') {
            const supportText = `<b>🤝 Офіційна підтримка проєкту</b>\n\nОскільки я є військовослужбовцем та діючим ФОП, усі платежі проходять абсолютно офіційно зі сплатою податків.\n\nНайкращий спосіб підтримати проєкт та нашу боротьбу — це придбати пісню з каталогу або оформити підписку Hertz Spectrum PRO на сайті.`;
            const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "👑 Оформити підписку на сайті", url: "https://golos-proty-raku.pp.ua/#generator" }], [{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]] } };
            bot.editMessageText(supportText, { chat_id: chatId, message_id: messageId, ...opts }).catch(e => {});
        }

        if (query.data === 'united_voices') {
            const voicesText = `<b>🗣 Об'єднані голоси</b>\n\nУ цій боротьбі ніхто не має залишатися сам. Цей розділ створений для того, щоб ми підтримували один одного.\n\nВи можете поділитися своєю історією незламності або приєднатися до нашого чату для спілкування.`;
            const opts = { 
                parse_mode: 'HTML', 
                reply_markup: { 
                    inline_keyboard: [
                        [{ text: "📝 Розповісти свою історію", callback_data: "write_story" }],
                        [{ text: "💬 Чат незламних", url: "https://t.me/golos_pidtrymka" }],
                        [{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]
                    ] 
                } 
            };
            bot.editMessageText(voicesText, { chat_id: chatId, message_id: messageId, ...opts }).catch(e => {});
        }

        if (query.data === 'write_story') {
            const promptText = `Напишіть вашу історію прямо тут, у повідомленні. \n\nВи можете розповісти про свій шлях, поділитися порадою або просто словами підтримки. Я отримаю ваше повідомлення і ми разом вирішимо, як воно зможе допомогти іншим.`;
            bot.sendMessage(chatId, promptText, { reply_markup: { force_reply: true } });
        }

        if (query.data === 'back_to_main') {
            bot.editMessageText(`📍 Головне меню проєкту:\nОберіть потрібний розділ нижче:`, { chat_id: chatId, message_id: messageId, ...getMainMenu() }).catch(e => {});
        }

        if (query.data.startsWith('show_menu')) {
            if (globalMusicList.length === 0) await fetchMusicFromDrive();
            if (globalMusicList.length === 0) return bot.sendMessage(chatId, "Пісні ще завантажуються, спробуйте через хвилину.");

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

            try {
                await bot.editMessageText(`Оберіть пісню для завантаження (Сторінка ${page + 1} з ${totalPages}):`, { 
                    chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } 
                });
            } catch (e) {}
        }

        if (query.data.startsWith('buy_')) {
            const trackId = query.data.replace('buy_', '');
            await sendBotInvoice(chatId, trackId, messageId);
        }
        
        try { bot.answerCallbackQuery(query.id); } catch (e) {}
    });

    // Обробка вхідних історій
    bot.on('message', async (msg) => {
        if (msg.reply_to_message && msg.reply_to_message.text && msg.reply_to_message.text.includes("Напишіть вашу історію")) {
            const userHistory = msg.text;
            const userName = msg.from.first_name || "Користувач";
            const userHandle = msg.from.username ? `@${msg.from.username}` : "Немає юзернейму";
            
            await bot.sendMessage(ADMIN_ID, `📩 <b>Нова історія для «Об'єднаних голосів»!</b>\nВід: ${userName} (${userHandle})\n\n${userHistory}`, { parse_mode: 'HTML' });
            bot.sendMessage(msg.chat.id, "Дякую, що поділилися! Ваша історія отримана. Разом ми сильніші. 💙");
        }
    });

    // Формування посилання на оплату
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

    // Розсилка новин на канал
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

// Технічні сповіщення для адміна
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
// 2. GOOGLE SHEETS
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
// 3. МУЗИКА З GOOGLE DRIVE ТА ОПЛАТИ
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
            redirectUrl: "https://andreygerc11.github.io/music_confession/success.html", webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка оплати" }); }
});

app.post('/api/pay-subscription', async (req, res) => {
    try {
        const { email } = req.body;
        if (!MONO_TOKEN) return res.json({ url: "https://send.monobank.ua/" });
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 39999, ccy: 980, merchantPaymInfo: { destination: "Підписка Hertz Spectrum PRO", comment: email },
            redirectUrl: "https://andreygerc11.github.io/music_confession/success.html", webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка оплати" }); }
});

// === ЄДИНИЙ WEBHOOK ДЛЯ САЙТУ ТА БОТА ===
app.post('/api/webhook', async (req, res) => {
    try {
        const { invoiceId, status, reference } = req.body;
        if (status === 'success') {
            await sendToGoogle({ action: 'update_sub', invoiceId, status });
            await sendTelegramMessage(`🔥 <b>Нова оплата!</b>\nРеференс: ${reference}`);

            if (reference && reference.startsWith('tg_') && bot) {
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
            }
        }
        res.status(200).send("OK");
    } catch (e) { res.status(500).send("Error"); }
});

// ==========================================
// 4. ГЕНЕРАТОР ВІДЕО, ШІ-РЕЖИСЕР ТА БЛОГ
// ==========================================
function compressAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath).audioChannels(1).audioFrequency(16000).audioBitrate('64k').toFormat('mp3').on('end', () => resolve(outputPath)).on('error', reject).save(outputPath);
    });
}

app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    let compressedPath = null;
    try {
        compressedPath = req.file.path + '_comp.mp3';
        await compressAudio(req.file.path, compressedPath);
        
        const formData = new FormData(); 
        formData.append('file', fs.createReadStream(compressedPath)); 
        formData.append('model', 'whisper-large-v3'); 
        formData.append('language', 'uk');
        formData.append('response_format', 'verbose_json');

        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, { 
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() } 
        });
        
        let lrcText = "";
        if (response.data.segments && response.data.segments.length > 0) {
            response.data.segments.forEach(seg => {
                let mins = Math.floor(seg.start / 60); let secs = (seg.start % 60).toFixed(2);
                lrcText += `[${mins < 10 ? '0'+mins : mins}:${secs < 10 ? '0'+secs : secs}] ${seg.text.trim()}\n`;
            });
        } else { lrcText = response.data.text; }
        
        res.json({ lrc: lrcText }); 
    } catch (error) { 
        res.status(500).json({ error: "Whisper Error" }); 
    } finally { 
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
    }
});

// === ВІДНОВЛЕНИЙ БЛОК ГЕНЕРАЦІЇ ФОНУ ===
app.post('/api/generate-image', async (req, res) => {
    try {
        const { lyrics, customPrompt, format } = req.body;
        let textToTranslate = "";
        
        if (customPrompt && lyrics) textToTranslate = `Сцена: ${customPrompt}. Настрій: ${lyrics.substring(0, 500)}`;
        else if (customPrompt) textToTranslate = `Сцена: ${customPrompt}`;
        else if (lyrics) textToTranslate = `Настрій: ${lyrics.substring(0, 600)}`;
        else textToTranslate = "Modern minimalistic music studio background";

        let basePrompt = "ultra realistic photography, 8k resolution";
        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "You are a visionary music video director. Find the core emotional metaphor in the text. Create a highly descriptive English prompt (max 45 words) for a dark, cinematic AI image. Focus on lighting, atmosphere, and symbolism. Output ONLY the English prompt. NO text in image." },
                    { role: "user", content: String(textToTranslate) }
                ],
                temperature: 0.7, max_tokens: 200
            }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } });
            basePrompt = groqRes.data.choices[0].message.content.trim();
        } catch (e) { basePrompt = "ultra realistic documentary photography, cinematic lighting, 8k, photorealistic"; }

        const finalPrompt = `${basePrompt}, masterpiece, raw photo, highly detailed, dramatic cinematic lighting, photorealistic, 8k resolution`;
        
        let w = 1080, h = 1920;
        if (format === 'horizontal' || format === 'cinema') { w = 1920; h = 1080; }
        else if (format === 'square') { w = 1080; h = 1080; }
        else if (format === 'portrait') { w = 1080; h = 1350; }

        res.json({ imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=${w}&height=${h}&nologo=true&enhance=true&seed=${Math.floor(Math.random() * 10000000)}&model=flux` });
    } catch (error) { res.status(500).json({ error: "Помилка генерації зображення" }); }
});
// =======================================

app.post('/api/generate-storyboard', async (req, res) => {
    const { lyrics } = req.body;
    if (!lyrics) return res.status(400).json({ error: 'Текст пісні не надано' });

    // === ЗМІНЕНО: Більше сцен, менші шматки тексту для динаміки кліпу ===
    const promptText = `
    You are a visionary, professional music video director. 
    CRITICAL INSTRUCTION: Break the lyrics down into MANY dynamic scenes. 
    Group ONLY 2 to 4 lines together into one single scene block. A typical song should have between 10 to 20 scenes to keep the video visually engaging. DO NOT merge entire verses into a single scene.
    
    For the "prompt" field, DO NOT translate the lyrics literally. Instead, find the deep emotional metaphor. Describe the lighting, atmosphere, and main subjects in English for an AI Image Generator. 
    IMPORTANT: The description MUST be for a STRICTLY PHOTOREALISTIC, LIVE-ACTION cinematic movie scene. NEVER describe cartoons, illustrations, 3D renders, anime, or paintings. Describe real humans, real cameras, and real environments. NO words, no text, no UI in the image.
    
    Return ONLY a valid JSON array of objects. No markdown formatting, no backticks, no extra text.
    Format MUST be exactly like this:
    [
      { "id": 1, "time": "00:00 - 00:10", "lyrics": "2-3 original ukrainian lyric lines...", "prompt": "Photorealistic live-action wide shot, cinematic lighting, real human..." }
    ]
    Lyrics:\n${lyrics}`;

    try {
        const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: promptText }],
            temperature: 0.7, max_tokens: 4000
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } });

        const cleanJson = groqRes.data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
        res.json(JSON.parse(cleanJson));
    } catch (error) { res.status(500).json({ error: 'Помилка генерації сценарію' }); }
});

// ==========================================
// 4. АВТОМАТИЧНИЙ БЛОГ (Новини + Психологічна підтримка)
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
        console.log("Блог ще не створено або порожній");
        aiBlogPosts = []; 
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
        
        console.log(`✅ Блог успішно збережено (${aiBlogPosts.length} постів)`);
    } catch (e) { 
        console.error("❌ Помилка збереження на GitHub:", e.message); 
    }
}

// ==================== RSS ДЖЕРЕЛА ДЛЯ МЕДИЧНИХ НОВИН ====================
const rssNewsSources = [
    "https://news.google.com/rss/search?q=%D0%BE%D0%BD%D0%BA%D0%BE%D0%BB%D0%BE%D0%B3%D1%96%D1%8F+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=%D0%BB%D0%B5%D0%B9%D0%BA%D0%B5%D0%BC%D1%96%D1%8F+%D1%82%D0%B5%D1%80%D0%B0%D0%BF%D1%96%D1%8F+%D0%BF%D1%80%D0%BE%D1%80%D0%B8%D0%B2&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=cancer+research+breakthrough&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=leukemia+treatment+advances&hl=en-US&gl=US&ceid=US:en",
    "https://medicalxpress.com/rss-feed/cancer-news/",
    "https://www.sciencedaily.com/rss/health_medicine/cancer.xml"
];

// ==================== ДЖЕРЕЛА ДЛЯ ПСИХОЛОГІЧНОЇ ПІДТРИМКИ ====================
const psychologySources = [
    // Реальні українські сайти
    "https://upoa.info/",                                      // Українська психоонкологічна асоціація
    "https://vartozhyty.com.ua/",                              // #ВАРТО ЖИТИ — психологічна допомога
    "https://unci.org.ua/psyhologichna-pidtrymka",             // Національний інститут раку
    "https://www.clinic-target.com/uk/psyhologichna-pidtrymka-pacziyentiv-z-onkologiyeyu/",
    
    // Теми для генерації
    "психологічна підтримка онкологія Україна",
    "як не падати духом при діагнозі рак",
    "психоонколог допомога",
    "прийняти діагноз рак як жити далі",
    "психологічна підтримка для онкохворих",
    "емоційна підтримка родичів онкопацієнтів",
    "страх рецидиву при раку",
    "мотивація під час хіміотерапії",
    "як впоратися з тривогою після діагнозу рак"
];

async function fetchAndRewriteNews() {
    if (!GROQ_API_KEY) return;
    console.log("🔄 Початок автоматичного оновлення блогу (новини + психологія)...");

    let addedCount = 0;

    // 1. МЕДИЧНІ НОВИНИ
    for (const rssUrl of rssNewsSources) {
        try {
            const response = await axios.get(rssUrl, { timeout: 12000 });
            const xml = response.data;
            const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/);
            if (!itemMatch) continue;

            const itemXml = itemMatch[1];
            const titleMatch = itemXml.match(/<title>(.*?)<\/title>/);
            if (!titleMatch) continue;

            let rawTitle = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
            if (aiBlogPosts.some(p => p.originalTitle === rawTitle)) continue;

            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: "llama-3.3-70b-versatile",
                messages: [{ 
                    role: "system", 
                    content: "Ти — автор проєкту 'Голос проти раку'. Пиши розгорнуту, мотивуючу статтю УКРАЇНСЬКОЮ (5-7 абзаців) з підзаголовками. Стиль теплий, щирий, з надією." 
                }, { 
                    role: "user", 
                    content: `Напиши статтю на тему: ${rawTitle}` 
                }],
                max_tokens: 2200,
                temperature: 0.75
            }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

            const articleContent = groqRes.data.choices[0].message.content.trim();

            aiBlogPosts.unshift({
                id: Date.now() + Math.floor(Math.random() * 10000),
                date: new Date().toLocaleDateString('uk-UA'),
                category: "news",
                originalTitle: rawTitle,
                title: rawTitle.split(" - ")[0] || rawTitle,
                content: articleContent,
                imageUrl: "baner_novunu.png"
            });

            addedCount++;
            console.log(`📰 Додано новину: ${rawTitle.substring(0, 60)}...`);

            await new Promise(r => setTimeout(r, 7000));

        } catch (e) {}
    }

    // 2. ПСИХОЛОГІЧНА ПІДТРИМКА
    for (const source of psychologySources) {
        try {
            let topic = source;
            if (source.startsWith('http')) {
                topic = "психологічна підтримка онкологія";
            }

            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: "llama-3.3-70b-versatile",
                messages: [{ 
                    role: "system", 
                    content: "Ти — Андрій Герц, автор проєкту «Голос проти раку». Пиши щиру, емоційну, мотивуючу статтю УКРАЇНСЬКОЮ від першої особи. Використовуй теплий людяний стиль, елементи особистого досвіду, практичні поради та сильну надію. 6–8 абзаців з підзаголовками." 
                }, { 
                    role: "user", 
                    content: `Напиши глибоку статтю про психологічну підтримку при онкології на основі теми: ${topic}` 
                }],
                max_tokens: 2500,
                temperature: 0.78
            }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

            const articleContent = groqRes.data.choices[0].message.content.trim();
            const title = `Психологічна підтримка: ${topic.charAt(0).toUpperCase() + topic.slice(1)}`;

            if (aiBlogPosts.some(p => p.title.includes(topic))) continue;

            aiBlogPosts.unshift({
                id: Date.now() + Math.floor(Math.random() * 10000),
                date: new Date().toLocaleDateString('uk-UA'),
                category: "psychology",
                originalTitle: topic,
                title: title,
                content: articleContent,
                imageUrl: "article_support.png"
            });

            addedCount++;
            console.log(`🫂 Додано психологічну статтю: ${title}`);

            // Публікація в Telegram
            if (bot && CHANNEL_ID) {
                const shortText = articleContent.substring(0, 280).replace(/\n/g, ' ');
                const tgText = `🫂 <b>${title}</b>\n\n${shortText}...\n\n👉 <a href="https://golos-proty-raku.pp.ua/#blog">Читати повністю на сайті</a>`;
                await bot.sendMessage(CHANNEL_ID, tgText, { parse_mode: 'HTML' }).catch(() => {});
            }

            await new Promise(r => setTimeout(r, 9500));

        } catch (e) {
            console.log(`Помилка генерації психологічної статті для: ${source}`);
        }
    }

    if (addedCount > 0) {
        await saveBlogToGitHub();
    }
}

// Ендпоінт для блогу
app.get('/api/blog', (req, res) => {
    const { category } = req.query;
    let posts = aiBlogPosts;

    if (category && category !== 'all') {
        posts = aiBlogPosts.filter(p => p.category === category);
    }

    posts.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(posts);
});

// ==========================================
// 5. ЗАПУСК СЕРВЕРА
// ==========================================
const PORT = process.env.PORT || 10000;

Promise.all([syncBlogFromGitHub(), fetchMusicFromDrive()]).then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Сервер успішно запущено на порту ${PORT}`);
        setTimeout(fetchAndRewriteNews, 30000); 
        setInterval(fetchAndRewriteNews, 24 * 60 * 60 * 1000);
    });
});
