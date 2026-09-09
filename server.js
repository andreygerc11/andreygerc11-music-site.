const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
// Render працює за проксі: без цього express-rate-limit кидає помилку
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR і ламає захищені роути (логін, реєстрація,
// запис на консультацію, кабінет лікаря). Довіряємо одному проксі Render.
app.set('trust proxy', 1);
app.use(cors({ origin: ['https://golos-proty-raku.pp.ua', 'https://www.golos-proty-raku.pp.ua'] }));
app.use(express.json({ limit: '50mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

const upload = multer({ dest: '/tmp/', limits: { fileSize: 50 * 1024 * 1024 } });

const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Забагато спроб. Спробуйте пізніше." }
});

// === ЗМІННІ З RENDER ===
const GROQ_API_KEY = process.env.GROQ_API_KEY; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const MONO_TOKEN = process.env.MONO_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
// Окремий ПРИВАТНИЙ репозиторій для медичних даних пацієнтів — НЕ той, що обслуговує
// GitHub Pages для сайту. Формат: "власник/репозиторій", напр. "andreygerc11/nadiya-patients-private".
const PATIENTS_REPO = process.env.PATIENTS_REPO;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "5853625377";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
// Email-сповіщення (Resend API). EMAIL_FROM напр. "Надія <no-reply@golos-proty-raku.pp.ua>".
const EMAIL_API_KEY = process.env.EMAIL_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;

// === ТВІЙ ID ПАПКИ GOOGLE DRIVE З ПОВНИМИ ТРЕКАМИ ===
const FULL_FOLDER_ID = "1FGNuLTq9mFHqoUSqp-7PSKHixZHq3W2j";

// === ГЛОБАЛЬНІ ЗМІННІ ТА КЕШ ===
let aiBlogPosts = [];
let globalMusicList = [];
let usersDB = [];
let usersSha = '';
let siteReviews = [];
let reviewsSha = '';

// Редагований контент сайту (CMS). Плоский об'єкт ключ→текст; головна сторінка
// підставляє значення поверх дефолтів за атрибутом data-cms. Зберігається у
// публічному репо (site_content.json) — тексти не є чутливими.
let siteContent = {};
let siteContentSha = '';

// Записи на прийом (календар). Чутливі дані (пацієнт+лікар+час) — зберігаємо у
// ПРИВАТНОМУ репо одним файлом appointments.json, щоб легко перевіряти зайняті слоти.
let appointments = [];
let appointmentsSha = '';
// Робочі години: слоти по 60 хв, 09:00–18:00 (останній прийом 17:00). Пн–Пт.
const SLOT_TIMES = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

// ==========================================
// 1. ТЕЛЕГРАМ БОТ ТА АДМІН-ФУНКЦІЇ
// ==========================================
const ADMIN_ID = 5853625377;
const CHANNEL_ID = process.env.CHANNEL_ID || "@golosprotyraku"; 
const BOT_PRICE = 3736; 

let bot;
if (BOT_TOKEN) {
    bot = new TelegramBot(BOT_TOKEN, { 
        polling: { autoStart: true, params: { timeout: 10 } } 
    });
    bot.on('polling_error', (error) => {
        if (error.code !== 'ETELEGRAM') {
            console.log("Telegram Error:", error.message);
        }
    });
    console.log("✅ Telegram Bot успішно запущено.");

    // Нативне меню команд Telegram (кнопка «Меню» / список при вводі «/»)
    bot.setMyCommands([
        { command: 'menu', description: '📋 Головне меню' },
        { command: 'start', description: '▶️ Почати / перезапустити бота' }
    ]).catch(() => {});

    // Сесія майстра запису на прийом (chatId → { email, doctorLogin, date })
    const botApptSession = {};

    const getMainMenu = () => {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📅 Записатися на прийом до лікаря", callback_data: "appt_start" }],
                    [{ text: "🏥 Онлайн-консультація (400 грн)", callback_data: "book_consultation" }],
                    [{ text: "👤 Особистий кабінет", url: "https://golos-proty-raku.pp.ua/login.html" }, { text: "📝 Реєстрація", url: "https://golos-proty-raku.pp.ua/register.html" }],
                    [{ text: "ℹ️ Про центр «Надія»", callback_data: "about_project" }],
                    [{ text: "🎵 Каталог пісень (37,36 грн)", callback_data: "show_menu" }],
                    [{ text: "🗣 Об'єднані голоси", callback_data: "united_voices" }],
                    [{ text: "📰 Читати блог", url: "https://golos-proty-raku.pp.ua/blog.html" }, { text: "🌐 Наш сайт", url: "https://golos-proty-raku.pp.ua" }],
                    [{ text: "🤝 Підтримати (Офіційно)", callback_data: "support_project" }]
                ]
            }
        };
    };

    // --- Кнопки майстра запису на прийом ---
    function apptDoctorButtons() {
        const rows = doctorsList.map(d => [{ text: `👨‍⚕️ ${d.name || d.login}`, callback_data: `appt_doc_${d.login}` }]);
        rows.push([{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]);
        return { inline_keyboard: rows };
    }
    function apptDayButtons() {
        const names = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const now = new Date();
        const rows = [];
        for (let i = 1; rows.length < 8 && i <= 21; i++) {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
            const dow = d.getDay();
            if (dow === 0 || dow === 6) continue; // лише Пн–Пт
            const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            rows.push([{ text: `${names[dow]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`, callback_data: `appt_day_${iso}` }]);
        }
        rows.push([{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]);
        return { inline_keyboard: rows };
    }
    function apptSlotButtons(doctorLogin, date) {
        const free = freeSlotsFor(doctorLogin, date);
        if (free.length === 0) return null;
        const rows = [];
        for (let i = 0; i < free.length; i += 3) {
            rows.push(free.slice(i, i + 3).map(t => ({ text: `🕒 ${t}`, callback_data: `appt_slot_${t}` })));
        }
        rows.push([{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]);
        return { inline_keyboard: rows };
    }

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
            ? `Вітаю! Це офіційний бот реабілітаційного центру «Надія».\n\nТут ви можете записатися на онлайн-консультацію з фізичної реабілітації, зайти у свій особистий кабінет, а також підтримати нашу благодійну музичну ініціативу.\n\nОберіть потрібний розділ:`
            : `📍 Головне меню:\nОберіть потрібний розділ нижче:`;

        bot.sendMessage(chatId, welcomeText, getMainMenu());
    });

    bot.on('callback_query', async (query) => {
        try { await bot.answerCallbackQuery(query.id); } catch (e) {}
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        try {
            if (query.data === 'about_project') {
                const aboutText = `<b>Про центр «Надія»</b>\n\n«Надія» — центр фізичної реабілітації. Ми допомагаємо відновлюватися після травм, операцій та захворювань: індивідуальні програми відновлення, робота кваліфікованих фізичних терапевтів, онлайн-консультації.\n\n🏥 Записатися на онлайн-консультацію (${CONSULTATION_PRICE_UAH} грн) можна прямо тут, у боті, або в особистому кабінеті на сайті.\n\nОкремо ми розвиваємо благодійну музичну ініціативу «Голос проти раку» — її пісні також доступні в цьому боті. 💙`;
                await bot.editMessageText(aboutText, { 
                    chat_id: chatId, 
                    message_id: messageId, 
                    parse_mode: 'HTML', 
                    reply_markup: { inline_keyboard: [[{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]] } 
                });
            }

            if (query.data === 'support_project') {
                const supportText = `<b>🤝 Офіційна підтримка проєкту</b>\n\nПроєкт зареєстрований як ФОП, усі платежі проходять офіційно, зі сплатою податків.\n\nНайкращий спосіб підтримати проєкт — придбати пісню з каталогу або записатися на консультацію з фізичної реабілітації.`;
                await bot.editMessageText(supportText, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [
                        [{ text: "🏥 Записатися на консультацію", callback_data: "book_consultation" }],
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

            if (query.data === 'book_consultation') {
                const promptText = `Щоб записатися на онлайн-консультацію з фізичної реабілітації (400 грн), напишіть, будь ласка, ваш email у відповідь на це повідомлення — на нього ми прив'яжемо запис і історію консультацій у вашому особистому кабінеті на сайті.`;
                await bot.sendMessage(chatId, promptText, { reply_markup: { force_reply: true } });
            }

            if (query.data === 'back_to_main') {
                await bot.editMessageText(`📍 Головне меню:\nОберіть потрібний розділ нижче:`, {
                    chat_id: chatId, 
                    message_id: messageId, 
                    ...getMainMenu() 
                });
            }

            if (query.data === 'appt_start') {
                await bot.sendMessage(chatId, `Щоб записатися на ПРИЙОМ до лікаря, напишіть, будь ласка, ваш email у відповідь на це повідомлення (той самий, під яким ви зареєстровані на сайті).`, { reply_markup: { force_reply: true } });
                return;
            }

            if (query.data.startsWith('appt_doc_')) {
                const doctorLogin = query.data.replace('appt_doc_', '');
                const sess = botApptSession[chatId];
                if (!sess || !sess.email) { await bot.sendMessage(chatId, "Сесія завершилась. Почніть знову: /menu → «Записатися на прийом»."); return; }
                sess.doctorLogin = doctorLogin;
                const doc = doctorsList.find(d => d.login === doctorLogin);
                await bot.editMessageText(`Лікар: <b>${doc ? doc.name : doctorLogin}</b>\n\nОберіть день прийому (Пн–Пт):`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: apptDayButtons() });
                return;
            }

            if (query.data.startsWith('appt_day_')) {
                const date = query.data.replace('appt_day_', '');
                const sess = botApptSession[chatId];
                if (!sess || !sess.email || !sess.doctorLogin) { await bot.sendMessage(chatId, "Сесія завершилась. Почніть знову: /menu → «Записатися на прийом»."); return; }
                sess.date = date;
                await syncAppointmentsFromGitHub();
                const kb = apptSlotButtons(sess.doctorLogin, date);
                if (!kb) { await bot.editMessageText(`На цей день вільних годин немає. Оберіть інший день:`, { chat_id: chatId, message_id: messageId, reply_markup: apptDayButtons() }); return; }
                await bot.editMessageText(`Оберіть вільний час на <b>${date}</b> (прийом ~60 хв):`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: kb });
                return;
            }

            if (query.data.startsWith('appt_slot_')) {
                const time = query.data.replace('appt_slot_', '');
                const sess = botApptSession[chatId];
                if (!sess || !sess.email || !sess.doctorLogin || !sess.date) { await bot.sendMessage(chatId, "Сесія завершилась. Почніть знову: /menu → «Записатися на прийом»."); return; }
                try {
                    const appt = await bookAppointmentCore(sess.email, sess.doctorLogin, sess.date, time, chatId);
                    delete botApptSession[chatId];
                    await bot.editMessageText(`✅ <b>Вас записано!</b>\n\nЛікар: <b>${appt.doctorName}</b>\nДата: <b>${appt.date}</b> о <b>${appt.time}</b>\n\nІсторію записів і призначення дивіться в особистому кабінеті на сайті.`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "🌐 Відкрити кабінет", url: "https://golos-proty-raku.pp.ua/login.html" }], [{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]] } });
                } catch (e) {
                    const msgMap = { TAKEN: "Цей час щойно зайняли. Оберіть інший.", PAST: "Цей час уже минув. Оберіть інший.", NOT_REGISTERED: "Email не зареєстрований на сайті." };
                    const kb = apptSlotButtons(sess.doctorLogin, sess.date);
                    await bot.editMessageText(`❌ ${msgMap[e.code] || 'Не вдалося записатися. Спробуйте ще раз.'}`, { chat_id: chatId, message_id: messageId, reply_markup: kb || apptDayButtons() });
                }
                return;
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
            console.error(`❌ Помилка обробки кнопки:`, error.message);
        }
    });

    bot.on('message', async (msg) => {
        if (msg.reply_to_message && msg.reply_to_message.text && msg.reply_to_message.text.includes("Напишіть вашу історію")) {
            const userHistory = msg.text;
            const userName = msg.from.first_name || "Користувач";
            const userHandle = msg.from.username ? `@${msg.from.username}` : "Немає юзернейму";

            await bot.sendMessage(ADMIN_ID, `📩 <b>Нова історія для «Об'єднаних голосів»!</b>\nВід: ${userName} (${userHandle})\n\n${userHistory}`, { parse_mode: 'HTML' });
            bot.sendMessage(msg.chat.id, "Дякую, що поділилися! Ваша історія отримана. Разом ми сильніші. 💙");
            return;
        }

        if (msg.reply_to_message && msg.reply_to_message.text && msg.reply_to_message.text.includes("Щоб записатися на ПРИЙОМ до лікаря")) {
            const email = (msg.text || '').trim();
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailPattern.test(email)) {
                bot.sendMessage(msg.chat.id, "❌ Це не схоже на email. Спробуйте ще раз через меню «Записатися на прийом».");
                return;
            }
            const user = usersDB.find(u => (u.email || '').trim().toLowerCase() === email.toLowerCase());
            if (!user) {
                await bot.sendMessage(msg.chat.id,
                    `❌ Email <b>${email}</b> не зареєстрований на сайті. Записатися на прийом можуть лише зареєстровані пацієнти.`,
                    { parse_mode: "HTML", reply_markup: { inline_keyboard: [
                        [{ text: "📝 Зареєструватися на сайті", url: "https://golos-proty-raku.pp.ua/register.html" }],
                        [{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]
                    ] } });
                return;
            }
            if (doctorsList.length === 0) {
                bot.sendMessage(msg.chat.id, "Наразі немає доступних лікарів для запису. Спробуйте пізніше.");
                return;
            }
            botApptSession[msg.chat.id] = { email: user.email };
            await bot.sendMessage(msg.chat.id, `Дякуємо! Оберіть лікаря, до якого хочете записатися:`, { reply_markup: apptDoctorButtons() });
            return;
        }

        if (msg.reply_to_message && msg.reply_to_message.text && msg.reply_to_message.text.includes("Щоб записатися на онлайн-консультацію")) {
            const email = (msg.text || '').trim();
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailPattern.test(email)) {
                bot.sendMessage(msg.chat.id, "❌ Це не схоже на email. Спробуйте ще раз, натиснувши кнопку «Записатися на консультацію» в меню.");
                return;
            }
            try {
                const result = await createConsultationInvoiceForEmail(email, msg.chat.id);
                await bot.sendMessage(msg.chat.id,
                    `Дякуємо! Запис створено на <b>${email}</b>.\n\nІсторію консультацій та нотатки лікаря ви зможете побачити в особистому кабінеті на сайті (вхід за цим самим email).`,
                    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "💳 Оплатити 400 грн", url: result.url }]] } }
                );
            } catch (e) {
                if (e && e.code === 'NOT_REGISTERED') {
                    await bot.sendMessage(msg.chat.id,
                        `❌ Email <b>${email}</b> не зареєстрований на сайті.\n\nЗаписатися на консультацію можуть лише зареєстровані пацієнти. Будь ласка, спочатку створіть акаунт на сайті (за цим самим email), а потім поверніться сюди й натисніть «Записатися на консультацію».`,
                        { parse_mode: "HTML", reply_markup: { inline_keyboard: [
                            [{ text: "📝 Зареєструватися на сайті", url: "https://golos-proty-raku.pp.ua/register.html" }],
                            [{ text: "⬅️ До головного меню", callback_data: "back_to_main" }]
                        ] } }
                    );
                } else {
                    bot.sendMessage(msg.chat.id, "❌ Помилка створення оплати. Спробуйте пізніше або напишіть нам напряму.");
                }
            }
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
}

async function sendTelegramMessage(text) {
    if (!TELEGRAM_CHAT_ID) return;
    try {
        if (bot) {
            await bot.sendMessage(TELEGRAM_CHAT_ID, text, { parse_mode: 'HTML' });
        } else if (BOT_TOKEN) {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'HTML' });
        }
    } catch (e) {}
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
    } catch (e) { }
}

// ==========================================
// 2В. ВІДГУКИ ПАЦІЄНТІВ (публічний репозиторій — це не медичні дані)
// ==========================================
async function syncReviewsFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    try {
        const res = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/reviews.json`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });
        siteReviews = JSON.parse(Buffer.from(res.data.content, 'base64').toString('utf8'));
        reviewsSha = res.data.sha;
        console.log(`⭐ Завантажено ${siteReviews.length} відгуків з GitHub`);
    } catch (e) {
        siteReviews = [];
    }
}

async function saveReviewsToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/reviews.json`;
        let sha = reviewsSha;
        if (!sha) {
            try {
                const getRes = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = getRes.data.sha;
            } catch (e) {}
        }
        const contentEncoded = Buffer.from(JSON.stringify(siteReviews, null, 2), 'utf8').toString('base64');
        const res = await axios.put(url, {
            message: `Оновлення відгуків`,
            content: contentEncoded,
            sha: sha || undefined
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        reviewsSha = res.data.content.sha;
    } catch (e) { }
}

async function syncSiteContentFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    try {
        const res = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/site_content.json`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });
        siteContent = JSON.parse(Buffer.from(res.data.content, 'base64').toString('utf8'));
        siteContentSha = res.data.sha;
        console.log(`📝 Завантажено контент сайту: ${Object.keys(siteContent).length} полів`);
    } catch (e) {
        siteContent = {};
    }
}

async function saveSiteContentToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return false;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/site_content.json`;
        let sha = siteContentSha;
        if (!sha) {
            try {
                const getRes = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = getRes.data.sha;
            } catch (e) {}
        }
        const contentEncoded = Buffer.from(JSON.stringify(siteContent, null, 2), 'utf8').toString('base64');
        const res = await axios.put(url, {
            message: `Оновлення контенту сайту (адмін-панель)`,
            content: contentEncoded,
            sha: sha || undefined
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        siteContentSha = res.data.content.sha;
        return true;
    } catch (e) { return false; }
}

async function syncAppointmentsFromGitHub() {
    if (!GITHUB_TOKEN || !PATIENTS_REPO) return;
    try {
        const res = await axios.get(`https://api.github.com/repos/${PATIENTS_REPO}/contents/appointments.json`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });
        appointments = JSON.parse(Buffer.from(res.data.content, 'base64').toString('utf8'));
        appointmentsSha = res.data.sha;
        console.log(`📅 Завантажено записів на прийом: ${appointments.length}`);
    } catch (e) {
        appointments = [];
    }
}

async function saveAppointmentsToGitHub() {
    if (!GITHUB_TOKEN || !PATIENTS_REPO) return false;
    try {
        const url = `https://api.github.com/repos/${PATIENTS_REPO}/contents/appointments.json`;
        let sha = appointmentsSha;
        if (!sha) {
            try {
                const getRes = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = getRes.data.sha;
            } catch (e) {}
        }
        const contentEncoded = Buffer.from(JSON.stringify(appointments, null, 2), 'utf8').toString('base64');
        const res = await axios.put(url, {
            message: `Оновлення записів на прийом`,
            content: contentEncoded,
            sha: sha || undefined
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        appointmentsSha = res.data.content.sha;
        return true;
    } catch (e) { return false; }
}

// ==========================================
// 2Б. МЕДИЧНІ КАРТКИ ПАЦІЄНТІВ (ПРИВАТНИЙ РЕПОЗИТОРІЙ)
// ==========================================
// Кожен пацієнт — окремий файл у ПРИВАТНОМУ репозиторії (не тому, що обслуговує
// публічний сайт через GitHub Pages). Ім'я файлу — хеш email, а не сам email,
// щоб навіть у службових URL/логах не світилась реальна адреса.
const CONSULTATION_PRICE_UAH = 400;

function patientFileKey(email) {
    return crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
}

async function getPatientRecord(email) {
    if (!GITHUB_TOKEN || !PATIENTS_REPO || !email) return null;
    const key = patientFileKey(email);
    try {
        const res = await axios.get(`https://api.github.com/repos/${PATIENTS_REPO}/contents/patients/${key}.json`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });
        const record = JSON.parse(Buffer.from(res.data.content, 'base64').toString('utf8'));
        record._sha = res.data.sha;
        return record;
    } catch (e) {
        return null; // картки ще немає — пацієнт ще не заповнював профіль
    }
}

async function getPatientRecordByKey(key) {
    if (!GITHUB_TOKEN || !PATIENTS_REPO || !key) return null;
    try {
        const res = await axios.get(`https://api.github.com/repos/${PATIENTS_REPO}/contents/patients/${key}.json`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });
        const record = JSON.parse(Buffer.from(res.data.content, 'base64').toString('utf8'));
        record._sha = res.data.sha;
        return record;
    } catch (e) {
        return null;
    }
}

async function savePatientRecord(email, record) {
    if (!GITHUB_TOKEN || !PATIENTS_REPO || !email) return false;
    const key = patientFileKey(email);
    const url = `https://api.github.com/repos/${PATIENTS_REPO}/contents/patients/${key}.json`;
    try {
        let sha = record._sha;
        if (!sha) {
            try {
                const getRes = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                sha = getRes.data.sha;
            } catch (e) {}
        }
        const toSave = { ...record };
        delete toSave._sha;
        const contentEncoded = Buffer.from(JSON.stringify(toSave, null, 2), 'utf8').toString('base64');
        const res = await axios.put(url, {
            message: `Оновлення картки пацієнта`,
            content: contentEncoded,
            sha: sha || undefined
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        return res.data.content.sha;
    } catch (e) {
        return false;
    }
}

async function listPatientSummaries() {
    if (!GITHUB_TOKEN || !PATIENTS_REPO) return [];
    try {
        const listRes = await axios.get(`https://api.github.com/repos/${PATIENTS_REPO}/contents/patients`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });
        const files = (listRes.data || []).filter(f => f.name.endsWith('.json'));
        const records = await Promise.all(files.map(async f => {
            try {
                const key = f.name.replace(/\.json$/, '');
                const record = await getPatientRecordByKey(key);
                if (!record) return null;
                const consultations = record.consultations || [];
                return {
                    key,
                    email: record.email || '',
                    fullName: record.fullName || '',
                    phone: record.phone || '',
                    consultationsCount: consultations.length,
                    lastConsultationDate: consultations.length ? consultations[consultations.length - 1].createdAt : null
                };
            } catch (e) { return null; }
        }));
        return records.filter(Boolean);
    } catch (e) {
        return [];
    }
}

// ==========================================
// 3. БЕЗПЕКА ТА ЛІМІТИ GEMINI API
// ==========================================

function sanitizeUser(user) {
    if (!user) return user;
    const { password, ...safeUser } = user;
    return safeUser;
}

app.post('/api/auth/user', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email обов'язковий" });

    let user = usersDB.find(u => u.email === email);
    if (!user) {
        user = { email: email, status: "free", clips_left: 1 };
        usersDB.push(user);
        await saveUsersToGitHub();
        console.log(`🎉 Зареєстровано нового користувача: ${email}`);
    }

    if (email === 'admin@dev.com' || email === 'administration@dev.com') {
        user.status = 'premium';
        user.clips_left = 999;
    }

    res.json(sanitizeUser(user));
});

app.post('/api/gemini/text', async (req, res) => {
    const { email, payload, isStoryboard } = req.body;
    
    if (!GEMINI_API_KEY) return res.status(500).json({ error: "Немає GEMINI_API_KEY" });
    if (!email) return res.status(400).json({ error: "Авторизація обов'язкова" });

    let user = usersDB.find(u => u.email === email);
    if (!user) return res.status(403).json({ error: "Користувача не знайдено" });

    if (isStoryboard) {
        if (user.clips_left <= 0) {
            return res.status(403).json({ error: "Ліміт вичерпано", code: "NO_TOKENS" });
        }
        user.clips_left -= 1;
        await saveUsersToGitHub();
    }

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            payload,
            { headers: { 'Content-Type': 'application/json' } }
        );
        res.json(response.data);
    } catch (error) {
        if (isStoryboard) {
            user.clips_left += 1;
            await saveUsersToGitHub();
        }
        res.status(500).json({ error: "Помилка генерації через ШІ" });
    }
});

app.post('/api/gemini/image', async (req, res) => {
    const { email, payload } = req.body;
    
    if (!GEMINI_API_KEY) return res.status(500).json({ error: "Немає GEMINI_API_KEY" });
    if (!email) return res.status(400).json({ error: "Авторизація обов'язкова" });

    let user = usersDB.find(u => u.email === email);
    if (!user) return res.status(403).json({ error: "Користувача не знайдено" });

    const promptText = Array.isArray(payload.instances) ? payload.instances[0].prompt : payload.instances.prompt;
    const aspect = payload.parameters?.aspectRatio || "1:1";
    
    const geminiPayload = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
            responseModalities: ["IMAGE"], 
            imageConfig: { aspectRatio: aspect }
        }
    };

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
            geminiPayload,
            { headers: { 'Content-Type': 'application/json' } }
        );
        const base64Image = response.data.candidates[0].content.parts[0].inlineData.data;
        res.json({ predictions: [{ bytesBase64Encoded: base64Image }] });
    } catch (error) {
        res.status(503).json({ error: "ШІ перевантажений" });
    }
});

// ==========================================
// 4. СИСТЕМА КОРИСТУВАЧІВ ТА АВТОРИЗАЦІЯ (ЧЕРЕЗ GITHUB)
// ==========================================

app.post('/api/register', authRateLimiter, async (req, res) => {
    try {
        const { email, password, name, fullName, birthDate, phone, website, elapsedMs, human } = req.body;

        // --- Захист від ботів/спаму ---
        if (website) return res.json({ error: "Реєстрацію відхилено." });                    // honeypot заповнений = бот
        if (human !== true) return res.json({ error: "Підтвердіть, що ви не робот." });        // чекбокс «я не робот»
        if (typeof elapsedMs === 'number' && elapsedMs < 2500) {                                // форму заповнено миттєво = бот
            return res.json({ error: "Занадто швидко. Заповніть форму й спробуйте ще раз." });
        }

        // --- Валідація ---
        const em = String(email || '').trim().toLowerCase();
        const displayName = String(fullName || name || '').trim();
        if (!em || !password || !displayName) return res.json({ error: "Заповніть ПІБ, email і пароль." });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.json({ error: "Некоректний email." });
        if (String(password).length < 6) return res.json({ error: "Пароль має бути мінімум 6 символів." });
        if (phone && !/^[+()\d\s-]{7,20}$/.test(String(phone))) return res.json({ error: "Некоректний номер телефону." });
        if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate))) return res.json({ error: "Некоректна дата народження." });
        if (usersDB.find(u => (u.email || '').toLowerCase() === em)) {
            return res.json({ error: "Користувач з таким email вже існує" });
        }

        // Публічний users.json тримаємо мінімальним (без телефону/дати — це PII).
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = { email: em, password: hashedPassword, name: displayName.slice(0, 150), status: "free", clips_left: 1, createdAt: new Date().toISOString() };
        usersDB.push(newUser);
        await saveUsersToGitHub();

        // ПІБ/телефон/дату народження зберігаємо у ПРИВАТНІЙ медкартці (не в публічному репо).
        try {
            let rec = await getPatientRecord(em);
            if (!rec) rec = { email: em, fullName: '', phone: '', birthDate: '', medicalHistory: '', consultations: [] };
            rec.fullName = displayName.slice(0, 150);
            if (phone) rec.phone = String(phone).trim().slice(0, 20);
            if (birthDate) rec.birthDate = String(birthDate).slice(0, 10);
            await savePatientRecord(em, rec);
        } catch (e) { /* профіль можна дозаповнити пізніше в кабінеті */ }

        res.json({ success: true, user: sanitizeUser(newUser) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Універсальний вхід: лікар / адмін / пацієнт. Повертає role для маршрутизації.
app.post('/api/login', authRateLimiter, async (req, res) => {
    try {
        const { email, password } = req.body; // "email" — це або логін лікаря, або email пацієнта
        const id = String(email || '').trim();

        // 1) Лікар або адміністратор (логіни з DOCTORS_JSON / administration@dev.com)
        const dAuth = getDoctorAuth(id, password);
        if (dAuth) {
            return res.json({ success: true, role: dAuth.isAdmin ? 'admin' : 'doctor', doctorName: dAuth.name, login: id });
        }

        // 2) Пацієнт (email + пароль)
        const user = usersDB.find(u => (u.email || '').toLowerCase() === id.toLowerCase());
        const passwordMatches = user && user.password && await bcrypt.compare(password || '', user.password);
        if (passwordMatches) {
            return res.json({ success: true, role: 'patient', user: sanitizeUser(user) });
        }

        res.json({ error: "Невірний логін або пароль" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/social-auth', authRateLimiter, async (req, res) => {
    try {
        const { email, name } = req.body;
        let user = usersDB.find(u => u.email === email);
        if (!user) {
            user = { email, name, status: "free", clips_left: 1 };
            usersDB.push(user);
            await saveUsersToGitHub();
        }
        res.json({ success: true, user: sanitizeUser(user) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 5. МУЗИКА З GOOGLE DRIVE ТА ОПЛАТИ
// ==========================================
async function fetchMusicFromDrive() {
    try {
        if (!GOOGLE_API_KEY) return [];
        let files = [];
        let pageToken;
        do {
            const res = await axios.get('https://www.googleapis.com/drive/v3/files', {
                params: {
                    q: `'${FULL_FOLDER_ID}' in parents and trashed=false`,
                    fields: 'nextPageToken, files(id,name,createdTime)',
                    pageSize: 1000,
                    pageToken,
                    key: GOOGLE_API_KEY
                }
            });
            files = files.concat(res.data.files || []);
            pageToken = res.data.nextPageToken;
        } while (pageToken);

        globalMusicList = files.map(f => {
            const cleanName = f.name.replace(/\.[^/.]+$/, "").trim();
            return { name: cleanName, fullId: f.id, date: f.createdTime };
        });
        return globalMusicList;
    } catch (error) { return globalMusicList; }
}

app.get('/api/music', async (req, res) => {
    const list = await fetchMusicFromDrive();
    res.json(list);
});

app.get('/api/stream/:fileId', async (req, res) => {
    try {
        if (!GOOGLE_API_KEY) throw new Error("Немає GOOGLE_API_KEY");

        // Проксіюємо Range-заголовок до Google Drive, щоб браузер міг
        // коректно перемотувати та буферизувати потік, а не отримувати
        // щоразу весь файл наново під виглядом часткової відповіді.
        const headers = {};
        if (req.headers.range) headers.Range = req.headers.range;

        const response = await axios({
            method: 'get',
            url: `https://www.googleapis.com/drive/v3/files/${req.params.fileId}?alt=media&key=${GOOGLE_API_KEY}`,
            responseType: 'stream',
            headers,
            validateStatus: s => s === 200 || s === 206
        });

        res.status(response.status);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');
        if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
        if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);

        response.data.pipe(res);
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

app.post('/api/pay-subscription', async (req, res) => {
    try {
        const { email } = req.body;
        if (!MONO_TOKEN) return res.json({ url: "https://send.monobank.ua/" });
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 34900, 
            ccy: 980, 
            merchantPaymInfo: { destination: "Пакет PRO: 10 Генерацій Кліпу", reference: email },
            redirectUrl: "https://golos-proty-raku.pp.ua/success.html", 
            webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка оплати пакету" }); }
});

let cachedMonoPubKey = null;
async function getMonoPubKey() {
    if (cachedMonoPubKey) return cachedMonoPubKey;
    const res = await axios.get('https://api.monobank.ua/api/merchant/pubkey', { headers: { 'X-Token': MONO_TOKEN } });
    cachedMonoPubKey = Buffer.from(res.data.key, 'base64');
    return cachedMonoPubKey;
}

async function isValidMonoSignature(req) {
    const signature = req.headers['x-sign'];
    if (!signature || !req.rawBody) return false;
    try {
        const pubKey = await getMonoPubKey();
        const verifier = crypto.createVerify('SHA256');
        verifier.update(req.rawBody);
        verifier.end();
        return verifier.verify(pubKey, signature, 'base64');
    } catch (e) {
        console.error('❌ Помилка перевірки підпису вебхука Monobank:', e.message);
        return false;
    }
}

app.post('/api/webhook', async (req, res) => {
    try {
        if (MONO_TOKEN && !(await isValidMonoSignature(req))) {
            console.error('❌ Вебхук відхилено: невалідний підпис Monobank');
            return res.status(400).send('Invalid signature');
        }

        const { invoiceId, status, reference } = req.body;
        if (status === 'success') {
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
                    const fileUrl = `https://drive.google.com/uc?export=download&id=${tgTrackId}`;
                    const opts = { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "⬇️ Скачати трек", url: fileUrl }]] } };
                    await bot.sendMessage(tgChatId, `🎉 <b>Дякую за підтримку!</b>\nОсь ваше посилання на файл: <b>${track.name}</b>`, opts);
                }
            } else if (reference && reference.startsWith('consult_')) {
                const match = reference.match(/^consult_([0-9a-f]{64})_(\d+)$/);
                if (match) {
                    const [, patientKey, consultationIdStr] = match;
                    const consultationId = Number(consultationIdStr);
                    const record = await getPatientRecordByKey(patientKey);
                    if (record) {
                        const consultation = (record.consultations || []).find(c => c.id === consultationId);
                        if (consultation && consultation.status === 'pending_payment') {
                            consultation.status = 'paid';
                            consultation.paidAt = new Date().toISOString();
                            await savePatientRecord(record.email, record);
                            await sendTelegramMessage(`📅 Оплачено онлайн-консультацію (${CONSULTATION_PRICE_UAH} грн)\nПацієнт: ${record.email}`);

                            // Якщо запис створено через бот — підтверджуємо оплату користувачу
                            // прямо в чаті бота (для запису з сайту telegramChatId === null).
                            if (consultation.telegramChatId && bot) {
                                try {
                                    await bot.sendMessage(consultation.telegramChatId,
                                        `🎉 <b>Оплату отримано! Дякуємо.</b>\n\nВаш запис на онлайн-консультацію з фізичної реабілітації підтверджено. Наш фахівець зв'яжеться з вами найближчим часом.\n\nІсторію консультацій, нотатки та призначення лікаря ви завжди знайдете в особистому кабінеті на сайті (вхід за email <b>${record.email}</b>).`,
                                        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🌐 Відкрити кабінет", url: "https://golos-proty-raku.pp.ua/login.html" }]] } }
                                    );
                                } catch (notifyErr) {
                                    console.error('❌ Не вдалося надіслати підтвердження консультації в бот:', notifyErr.message);
                                }
                            }
                        }
                    }
                }
            } else if (reference && reference.includes('@')) {
                let user = usersDB.find(u => u.email === reference);
                if (!user) {
                    user = { email: reference, status: "premium", clips_left: 10 };
                    usersDB.push(user);
                } else {
                    user.status = "premium";
                    user.clips_left = (user.clips_left || 0) + 10;
                }
                await saveUsersToGitHub();
            }
        }
        res.status(200).send("OK");
    } catch (e) { res.status(500).send("Error"); }
});

// ==========================================
// 5. РОЗПІЗНАВАННЯ АУДІО ЧЕРЕЗ GEMINI 2.5 FLASH 
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
        await compressAudio(req.file.path, compressedPath);
        
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
        
        lrcText = lrcText.replace(/\x60\x60\x60[a-z]*\n?/g, '').replace(/\x60\x60\x60/g, '').trim();

        res.json({ lrc: lrcText }); 
    } catch (error) { 
        res.status(500).json({ error: "Помилка розпізнавання ШІ (Gemini)" }); 
    } finally { 
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
    }
});

// ==========================================
// 6. АВТОМАТИЧНИЙ БЛОГ (Llama 3.3 через Groq)
// ==========================================
// Окремі набори банерів під кожну категорію блогу
const NEWS_BANNERS = ['banner_news_1.svg', 'banner_news_2.svg', 'banner_news_3.svg'];
const PSY_BANNERS = ['banner_psy_1.svg', 'banner_psy_2.svg', 'banner_psy_3.svg'];
const REHAB_BANNERS = ['banner_rehab_1.svg', 'banner_rehab_2.svg', 'banner_rehab_3.svg'];
const BANNERS_BY_CATEGORY = { news: NEWS_BANNERS, psychology: PSY_BANNERS, rehab: REHAB_BANNERS };
function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomNewsBanner() { return randomFrom(NEWS_BANNERS); }

// Одноразова міграція: кожній категорії — свій набір банерів (стабільно за індексом).
// Замінює старі однакові фото/банери. Сервер володіє blog_posts.json → durable.
async function migrateCategoryBanners() {
    let changed = 0;
    aiBlogPosts.forEach((p, i) => {
        if (!p) return;
        const set = BANNERS_BY_CATEGORY[p.category];
        if (set && !set.includes(p.imageUrl)) {
            p.imageUrl = set[i % set.length];
            changed++;
        }
    });
    if (changed > 0) {
        await saveBlogToGitHub();
        console.log(`🎨 Оновлено банери у ${changed} постах (свій набір на кожну категорію).`);
    }
}

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
    } catch (e) {}
}

const allBlogSources = [
    // === НОВИНИ ===
    { type: "news", url: "https://news.google.com/rss/search?q=%D0%BE%D0%BD%D0%BA%D0%BE%D0%BB%D0%BE%D0%B3%D1%96%D1%8F+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA&hl=uk&gl=UA&ceid=UA:uk" },
    { type: "news", url: "https://news.google.com/rss/search?q=%D0%BB%D0%B5%D0%B9%D0%BA%D0%B5%D0%BC%D1%96%D1%8F+%D1%82%D0%B5%D1%80%D0%B0%D0%BF%D1%96%D1%8F&hl=uk&gl=UA&ceid=UA:uk" },
    { type: "news", url: "https://news.google.com/rss/search?q=%D1%96%D0%BD%D0%BD%D0%BE%D0%B2%D0%B0%D1%86%D1%96%D1%97+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA%D1%83&hl=uk&gl=UA&ceid=UA:uk" },
    { type: "news", url: "https://news.google.com/rss/search?q=cancer+research+breakthrough&hl=en-US&gl=US&ceid=US:en" },
    { type: "news", url: "https://news.google.com/rss/search?q=leukemia+treatment+advances&hl=en-US&gl=US&ceid=US:en" },
    
    // === ПСИХОЛОГІЯ ===
    { type: "psychology", url: "https://news.google.com/rss/search?q=%D0%BE%D0%BD%D0%BA%D0%BE%D0%BF%D1%81%D0%B8%D0%B7%D0%BE%D0%BB%D0%BE%D0%B3%D1%96%D1%8F&hl=uk&gl=UA&ceid=UA:uk" },
    { type: "psychology", url: "https://news.google.com/rss/search?q=%D0%BF%D1%81%D0%B8%D1%85%D0%BE%D0%BB%D0%BE%D0%B3%D1%96%D1%87%D0%BD%D0%B0+%D0%BF%D1%96%D0%B4%D1%82%D1%80%D0%B8%D0%BC%D0%BA%D0%B0+%D1%80%D0%B0%D0%BA&hl=uk&gl=UA&ceid=UA:uk" },
    { type: "psychology", url: "https://news.google.com/rss/search?q=cancer+psychological+support&hl=en-US&gl=US&ceid=US:en" },
    { type: "psychology", url: "https://news.google.com/rss/search?q=coping+with+cancer+diagnosis&hl=en-US&gl=US&ceid=US:en" },
    { type: "psychology", url: "https://news.google.com/rss/search?q=mental+health+cancer+patients&hl=en-US&gl=US&ceid=US:en" },
    
    // === РЕАБІЛІТАЦІЯ ===
    { type: "rehab", url: "https://news.google.com/rss/search?q=%D1%84%D1%96%D0%B7%D0%B8%D1%87%D0%BD%D0%B0+%D1%80%D0%B5%D0%B0%D0%B1%D1%96%D0%BB%D1%96%D1%82%D0%B0%D1%86%D1%96%D1%8F+%D0%B2%D1%96%D0%B4%D0%BD%D0%BE%D0%B2%D0%B0%D0%BB%D0%B5%D0%BD%D0%BD%D1%8F+%D1%80%D1%83%D1%85%D1%83&hl=uk&gl=UA&ceid=UA:uk" },
    { type: "rehab", url: "https://news.google.com/rss/search?q=%D0%BA%D1%96%D0%BD%D0%B5%D0%B7%D1%96%D0%BE%D1%82%D0%B5%D0%B9%D0%BF%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D0%B0%D0%BF%D0%B0%D1%80%D0%B0%D1%82%D0%BD%D0%B0+%D1%80%D0%B5%D0%B0%D0%B1%D1%96%D0%BB%D1%96%D1%82%D0%B0%D1%86%D1%96%D1%8F&hl=uk&gl=UA&ceid=UA:uk" },
    { type: "rehab", url: "https://news.google.com/rss/search?q=%D0%B5%D1%80%D0%B3%D0%BE%D1%82%D0%B5%D1%80%D0%B0%D0%BF%D1%96%D1%8F+%D0%B0%D0%B4%D0%B0%D0%BF%D1%82%D0%B0%D1%86%D1%96%D1%8F&hl=uk&gl=UA&ceid=UA:uk" },
    { type: "rehab", url: "https://news.google.com/rss/search?q=physical+therapy+kinesiology+breakthrough&hl=en-US&gl=US&ceid=US:en" },
    { type: "rehab", url: "https://news.google.com/rss/search?q=%D1%80%D0%B5%D0%B0%D0%B1%D1%96%D0%BB%D1%96%D1%82%D0%B0%D1%86%D1%96%D1%8F+%D0%BF%D1%96%D1%81%D0%BB%D1%8F+%D0%BF%D0%BE%D1%80%D0%B0%D0%BD%D0%B5%D0%BD%D0%BD%D1%8F&hl=uk&gl=UA&ceid=UA:uk" },
    { type: "rehab", url: "https://news.google.com/rss/search?q=%D1%84%D1%96%D0%B7%D1%96%D0%BE%D1%82%D0%B5%D1%80%D0%B0%D0%BF%D1%96%D1%8F+%D1%81%D1%83%D1%87%D0%B0%D1%81%D0%BD%D1%96+%D0%BC%D0%B5%D1%82%D0%BE%D0%B4%D0%B8&hl=uk&gl=UA&ceid=UA:uk" },
    { type: "rehab", url: "https://news.google.com/rss/search?q=occupational+therapy+recovery+innovation&hl=en-US&gl=US&ceid=US:en" },
    { type: "rehab", url: "https://news.google.com/rss/search?q=rehabilitation+technology+breakthrough&hl=en-US&gl=US&ceid=US:en" }
];

async function fetchAndRewriteBlog() {
    if (!GROQ_API_KEY) { console.log("❌ GROQ_API_KEY не налаштований"); return; }
    console.log("🔄 Запуск автоматичної генерації блогу (5 новин + 3 психологія)...");
    
    let addedCount = 0;
    
    // === НОВИНИ ===
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
                if (aiBlogPosts.some(p => p.originalTitle === rawTitle)) continue;

                console.log(`✍️ Генерую новину: ${cleanTitle}`);
                let pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toLocaleDateString('uk-UA') : new Date().toLocaleDateString('uk-UA');

                const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: "Ти — професійний український журналіст. Переклади англійську новину та напиши аналітичну статтю українською. Використовуй <h2>. Перший рядок — ЗАГОЛОВОК, далі текст." }, 
                        { role: "user", content: `Новина: ${rawTitle}` }
                    ],
                    max_tokens: 2000, temperature: 0.3 
                }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                const fullResponse = groqRes.data.choices[0].message.content.trim();
                const lines = fullResponse.split('\n');
                const translatedTitle = lines[0].replace(/[*#]/g, '').trim(); 
                const articleContent = lines.slice(1).join('\n').trim(); 

                aiBlogPosts.unshift({
                    id: Date.now() + Math.floor(Math.random() * 1000), 
                    date: pubDate, category: "news", originalTitle: rawTitle,
                    title: translatedTitle, content: articleContent, imageUrl: randomNewsBanner()
                });
                addedCount++; newsAddedThisRun++;

                if (bot && CHANNEL_ID) {
                    try {
                        const shortText = articleContent.replace(/\*/g, '').replace(/</g, '').replace(/>/g, '').substring(0, 280).replace(/\n/g, ' ');
                        await bot.sendMessage(CHANNEL_ID, `📰 <b>${translatedTitle}</b>\n\n${shortText}...\n\n👉 <a href="https://golos-proty-raku.pp.ua/blog.html">Читати повністю на сайті</a>`, { parse_mode: 'HTML' });
                    } catch (e) {}
                }
                await new Promise(r => setTimeout(r, 6000)); 
            }
        } catch (e) {}
    }

    // === ПСИХОЛОГІЯ ===
    let psychAddedThisRun = 0;
    const psychUrls = allBlogSources.filter(src => src.type === "psychology").map(src => src.url);
    const shuffledPsychRss = psychUrls.sort(() => 0.5 - Math.random());

    for (const rssUrl of shuffledPsychRss) {
        if (psychAddedThisRun >= 3) break; 
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
                if (aiBlogPosts.some(p => p.originalTitle === rawTitle)) continue;

                console.log(`🫂 Генерую статтю підтримки: ${cleanTitle}`);
                let pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toLocaleDateString('uk-UA') : new Date().toLocaleDateString('uk-UA');

                const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: "Ти психолог проєкту 'Голос проти раку'. Адаптуй статтю українською. Використовуй <h2>. Перший рядок — ЗАГОЛОВОК, потім текст. В кінці: 'Важливо: Цей матеріал створено для емоційної підтримки. Він не замінює консультацію лікаря'." }, 
                        { role: "user", content: `Матеріал: ${rawTitle}` }
                    ],
                    max_tokens: 2200, temperature: 0.3
                }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                const fullResponse = groqRes.data.choices[0].message.content.trim();
                const lines = fullResponse.split('\n');
                const translatedTitle = lines[0].replace(/[*#]/g, '').trim(); 
                const articleContent = lines.slice(1).join('\n').trim(); 

                aiBlogPosts.unshift({
                    id: Date.now() + Math.floor(Math.random() * 1000), 
                    date: pubDate, category: "psychology", originalTitle: rawTitle, 
                    title: translatedTitle || cleanTitle, content: articleContent, imageUrl: randomFrom(PSY_BANNERS)
                });
                addedCount++; psychAddedThisRun++;

                await new Promise(r => setTimeout(r, 6000));
            }
        } catch (e) {}
    }

    // === РЕАБІЛІТАЦІЯ ===
    let rehabAddedThisRun = 0;
    const rehabUrls = allBlogSources.filter(src => src.type === "rehab").map(src => src.url);
    const shuffledRehabRss = rehabUrls.sort(() => 0.5 - Math.random());

    for (const rssUrl of shuffledRehabRss) {
        if (rehabAddedThisRun >= 2) break; 
        try {
            const response = await axios.get(rssUrl, { timeout: 10000 });
            const xml = response.data;
            const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/) || xml.match(/<entry>([\s\S]*?)<\/entry>/);
            if (!itemMatch) continue;

            const itemXml = itemMatch[1];
            const titleMatch = itemXml.match(/<title>(.*?)<\/title>/);
            const pubDateMatch = itemMatch[1].match(/<pubDate>(.*?)<\/pubDate>/) || itemMatch[1].match(/<published>(.*?)<\/published>/);

            if (titleMatch) {
                let rawTitle = titleMatch[1].replace("<![CDATA[", "").replace("]]>", "").trim();
                if (aiBlogPosts.some(p => p.originalTitle === rawTitle)) continue;

                console.log(`💪 Генерую статтю реабілітації: ${rawTitle.split(" - ")[0]}`);
                let pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toLocaleDateString('uk-UA') : new Date().toLocaleDateString('uk-UA');

                const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: "Ти — провідний експерт із фізичної реабілітації та ерготерапії. Твоє завдання: адаптувати статтю. ПИШИ ВИКЛЮЧНО УКРАЇНСЬКОЮ МОВОЮ. КАТЕГОРИЧНО ЗАБОРОНЕНО згадувати слова 'рак', 'онкологія' чи 'пухлина'. Пиши про загальну реабілітацію, відновлення руху, ерготерапію, сучасні інструменти (тейпування тощо) та психологічну опору після травм. Використовуй емоційні підзаголовки <h2>. Першим рядком твоєї відповіді має бути СКОРЕГОВАНИЙ УКРАЇНСЬКИЙ ЗАГОЛОВОК, а потім сам текст. Додай секцію 'Як це працює'. Закінчуй дисклеймером: 'Важливо: Цей матеріал має ознайомчий характер. Перед застосуванням обов’язково проконсультуйтеся з фізичним терапевтом'." }, 
                        { role: "user", content: `Новина для адаптації: ${rawTitle}` }
                    ],
                    max_tokens: 2200, temperature: 0.3
                }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                const fullResponse = groqRes.data.choices[0].message.content.trim();
                const lines = fullResponse.split('\n');
                const translatedTitle = lines[0].replace(/[*#]/g, '').trim(); 
                const articleContent = lines.slice(1).join('\n').trim(); 

                aiBlogPosts.unshift({
                    id: Date.now() + Math.floor(Math.random() * 1000), 
                    date: pubDate, category: "rehab", originalTitle: rawTitle, 
                    title: translatedTitle, content: articleContent, imageUrl: randomFrom(REHAB_BANNERS)
                });
                addedCount++; rehabAddedThisRun++;

                await new Promise(r => setTimeout(r, 6000));
            }
        } catch (e) {}
    }
    
    if (addedCount > 0) {
        await saveBlogToGitHub();
        console.log(`🎉 Автооновлення завершено. Додано нових матеріалів: ${addedCount}`);
    } else {
        console.log("✅ Перевірка завершена. Нових публікацій немає.");
    }
}

app.get('/api/blog', (req, res) => {
    res.json(aiBlogPosts); 
});

// === НОВІ ШЛЯХИ ДЛЯ БЛОГУ ДРУЖИНИ ===
function isValidWifeAuth(login, password) {
    return login === 'administration@dev.com' && ADMIN_PASSWORD && password === ADMIN_PASSWORD;
}

// Лікарі з індивідуальними логіном/паролем. Джерело — env DOCTORS_JSON:
// масив об'єктів [{ "login": "...", "password": "...", "name": "Прізвище Ім'я По батькові" }].
let doctorsList = [];
try {
    if (process.env.DOCTORS_JSON) doctorsList = JSON.parse(process.env.DOCTORS_JSON);
    if (!Array.isArray(doctorsList)) doctorsList = [];
} catch (e) {
    console.error('❌ DOCTORS_JSON має бути валідним JSON-масивом:', e.message);
    doctorsList = [];
}
console.log(`👩‍⚕️ Завантажено лікарів з індивідуальним доступом: ${doctorsList.length}`);

// Повертає { name, isAdmin } для валідних креденшлів лікаря або адміна, інакше null.
// Кожен лікар бачить усіх пацієнтів (спільний доступ), але заходить під своїм паролем,
// щоб нотатки й призначення підписувалися його іменем.
function getDoctorAuth(login, password) {
    const l = (login || '').trim();
    const p = password || '';
    const doc = doctorsList.find(d => d && typeof d.login === 'string' && d.login.toLowerCase() === l.toLowerCase() && d.password === p);
    if (doc) return { name: (doc.name || l), login: doc.login, isAdmin: false };
    if (isValidWifeAuth(l, p)) return { name: 'Адміністратор', login: 'admin', isAdmin: true };
    return null;
}

// ==========================================
// КАБІНЕТ ПАЦІЄНТА
// ==========================================
function sanitizePatientRecord(record) {
    if (!record) return record;
    const { _sha, ...safe } = record;
    return safe;
}

app.post('/api/patient/profile', authRateLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email обов'язковий" });

        let record = await getPatientRecord(email);
        if (!record) {
            record = { email, fullName: '', phone: '', birthDate: '', medicalHistory: '', consultations: [] };
        }
        return res.json(sanitizePatientRecord(record));
    } catch (e) { res.status(500).json({ error: "Помилка сервера" }); }
});

app.put('/api/patient/profile', authRateLimiter, async (req, res) => {
    try {
        const { email, fullName, phone, birthDate, medicalHistory } = req.body;
        if (!email) return res.status(400).json({ error: "Email обов'язковий" });

        let record = await getPatientRecord(email);
        if (!record) record = { email, consultations: [] };

        record.fullName = (fullName || '').slice(0, 200);
        record.phone = (phone || '').slice(0, 40);
        record.birthDate = (birthDate || '').slice(0, 20);
        record.medicalHistory = (medicalHistory || '').slice(0, 5000);
        if (!record.consultations) record.consultations = [];

        const saved = await savePatientRecord(email, record);
        if (!saved) return res.status(500).json({ error: "Не вдалося зберегти дані" });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Помилка сервера" }); }
});

// Спільна логіка для запису на консультацію — використовується і з
// сайту (/api/patient/book-consultation), і з Telegram-бота напряму.
async function createConsultationInvoiceForEmail(email, telegramChatId = null) {
    // Записатися на консультацію може лише зареєстрований на сайті користувач.
    // Це відсікає випадкові email із бота — запис прив'язується до реального
    // акаунта, під яким людина потім зайде в кабінет і побачить історію.
    const normalizedEmail = (email || '').trim().toLowerCase();
    const registeredUser = usersDB.find(u => (u.email || '').trim().toLowerCase() === normalizedEmail);
    if (!registeredUser) {
        const err = new Error('NOT_REGISTERED');
        err.code = 'NOT_REGISTERED';
        throw err;
    }

    if (!MONO_TOKEN) return { url: "https://send.monobank.ua/" };

    let record = await getPatientRecord(email);
    if (!record) record = { email, fullName: '', phone: '', birthDate: '', medicalHistory: '', consultations: [] };
    if (!record.consultations) record.consultations = [];
    // Запам'ятовуємо Telegram пацієнта — для майбутніх сповіщень про зміни прийому.
    if (telegramChatId) record.telegramChatId = String(telegramChatId);

    const consultationId = Date.now();
    record.consultations.push({
        id: consultationId,
        createdAt: new Date().toISOString(),
        status: 'pending_payment',
        amount: CONSULTATION_PRICE_UAH,
        doctorName: null,
        notes: null,
        prescription: null,
        paidAt: null,
        // Якщо запис зроблено через Telegram-бот — зберігаємо chatId, щоб після
        // оплати надіслати підтвердження прямо в бот (для запису з сайту — null).
        telegramChatId: telegramChatId ? String(telegramChatId) : null
    });

    const saved = await savePatientRecord(email, record);
    if (!saved) throw new Error("Не вдалося створити запис пацієнта");

    const key = patientFileKey(email);
    const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
        amount: CONSULTATION_PRICE_UAH * 100,
        ccy: 980,
        merchantPaymInfo: { destination: "Онлайн-консультація «Надія»", reference: `consult_${key}_${consultationId}` },
        redirectUrl: "https://golos-proty-raku.pp.ua/profile.html",
        webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
    }, { headers: { 'X-Token': MONO_TOKEN } });

    return { url: monoRes.data.pageUrl };
}

app.post('/api/patient/book-consultation', authRateLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email обов'язковий" });
        const result = await createConsultationInvoiceForEmail(email);
        res.json(result);
    } catch (error) {
        if (error && error.code === 'NOT_REGISTERED') {
            return res.status(403).json({ error: "Записатися на консультацію можуть лише зареєстровані пацієнти. Спочатку створіть акаунт на сайті." });
        }
        res.status(500).json({ error: "Помилка створення оплати консультації" });
    }
});

// Метадані документів, які пацієнт зберігає у СВОЄМУ Google Диску (файли
// туди вантажаться напряму з браузера пацієнта — сервер їх не бачить і не
// зберігає, лише посилання/назву/дату для списку в кабінеті й лікаря).
app.post('/api/patient/documents', authRateLimiter, async (req, res) => {
    try {
        const { email, name, driveFileId, webViewLink, mimeType } = req.body;
        if (!email || !driveFileId) return res.status(400).json({ error: "Email і driveFileId обов'язкові" });

        let record = await getPatientRecord(email);
        if (!record) record = { email, fullName: '', phone: '', birthDate: '', medicalHistory: '', consultations: [] };
        if (!record.documents) record.documents = [];

        record.documents.push({
            id: Date.now(),
            name: (name || 'Документ').slice(0, 200),
            driveFileId,
            webViewLink: webViewLink || null,
            mimeType: mimeType || null,
            uploadedAt: new Date().toISOString()
        });

        const saved = await savePatientRecord(email, record);
        if (!saved) return res.status(500).json({ error: "Не вдалося зберегти документ" });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Помилка сервера" }); }
});

app.post('/api/patient/review', authRateLimiter, async (req, res) => {
    try {
        const { email, name, text } = req.body;
        if (!email || !text || !text.trim()) return res.status(400).json({ error: "Текст відгуку обов'язковий" });

        siteReviews.push({
            id: Date.now(),
            email,
            name: (name || 'Пацієнт').slice(0, 100),
            text: text.trim().slice(0, 1000),
            status: 'pending',
            createdAt: new Date().toISOString()
        });
        await saveReviewsToGitHub();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Помилка сервера" }); }
});

app.get('/api/reviews', (req, res) => {
    res.json(siteReviews.filter(r => r.status === 'approved'));
});

// ==========================================
// КОНТЕНТ САЙТУ (CMS) — публічне читання + редагування тільки адміном
// ==========================================
app.get('/api/site-content', (req, res) => {
    res.json(siteContent || {});
});

app.post('/api/admin/site-content', authRateLimiter, async (req, res) => {
    const { login, password, content } = req.body;
    if (!isValidWifeAuth(login, password)) return res.status(403).json({ error: "Доступ лише для адміністратора" });
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
        return res.status(400).json({ error: "Некоректні дані" });
    }
    // Зберігаємо лише рядкові значення (плоский ключ→текст), обрізаємо надто довгі.
    const cleaned = {};
    for (const [k, v] of Object.entries(content)) {
        if (typeof v === 'string') cleaned[String(k).slice(0, 100)] = v.slice(0, 4000);
    }
    siteContent = cleaned;
    const saved = await saveSiteContentToGitHub();
    if (!saved) return res.status(500).json({ error: "Не вдалося зберегти" });
    res.json({ success: true });
});

// Завантаження зображень/дипломів у публічний репо (лише адмін). Повертає URL,
// який адмін-панель потім зберігає у site_content (напр. hero.bg, team1.photo).
app.post('/api/admin/upload', authRateLimiter, async (req, res) => {
    const { login, password, dataUrl, key } = req.body;
    if (!isValidWifeAuth(login, password)) return res.status(403).json({ error: "Доступ лише для адміністратора" });
    if (!GITHUB_TOKEN || !GITHUB_REPO) return res.status(500).json({ error: "Немає доступу до репозиторію" });
    if (!dataUrl || typeof dataUrl !== 'string') return res.status(400).json({ error: "Немає файлу" });

    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: "Некоректний формат файлу" });
    const mime = m[1];
    const b64 = m[2];
    const extMap = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
    const ext = extMap[mime];
    if (!ext) return res.status(400).json({ error: "Дозволені лише зображення (JPG/PNG/WEBP) або PDF" });

    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > 5 * 1024 * 1024) return res.status(400).json({ error: "Файл завеликий (макс 5 МБ)" });

    const safeKey = String(key || 'file').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 40);
    const path = `uploads/${safeKey}-${Date.now()}.${ext}`;
    try {
        await axios.put(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
            message: `Завантаження ${path} (адмін-панель)`,
            content: b64
        }, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        res.json({ success: true, url: `https://golos-proty-raku.pp.ua/${path}` });
    } catch (e) {
        res.status(500).json({ error: "Не вдалося завантажити файл" });
    }
});

// ==========================================
// КАЛЕНДАР ЗАПИСУ ДО ЛІКАРЯ (слоти по 60 хв, Пн–Пт 09:00–18:00)
// ==========================================
function publicDoctorsList() {
    return doctorsList.map(d => ({ login: d.login, name: d.name || d.login }));
}
function isWeekday(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay(); // 0=нд, 6=сб
    return day >= 1 && day <= 5;
}

// Список лікарів для вибору пацієнтом (без паролів)
app.get('/api/doctors', (req, res) => {
    res.json(publicDoctorsList());
});

// Вільні/зайняті слоти лікаря на конкретну дату
app.post('/api/appointments/slots', authRateLimiter, (req, res) => {
    const { doctorLogin, date } = req.body;
    if (!doctorLogin || !date) return res.status(400).json({ error: "Оберіть лікаря та дату" });
    const taken = appointments
        .filter(a => a.doctorLogin === doctorLogin && a.date === date && a.status !== 'cancelled')
        .map(a => a.time);
    const slots = SLOT_TIMES.map(t => ({ time: t, taken: taken.includes(t) }));
    res.json({ date, weekday: isWeekday(date), slots });
});

// Вільні слоти лікаря на дату (список часу)
function freeSlotsFor(doctorLogin, date) {
    const taken = appointments
        .filter(a => a.doctorLogin === doctorLogin && a.date === date && a.status !== 'cancelled')
        .map(a => a.time);
    return SLOT_TIMES.filter(t => !taken.includes(t));
}

// Спільна логіка бронювання прийому (сайт і бот). Кидає Error з .code при помилці.
async function bookAppointmentCore(email, doctorLogin, date, time, telegramChatId = null) {
    const fail = (code) => { const e = new Error(code); e.code = code; return e; };
    if (!email || !doctorLogin || !date || !time) throw fail('MISSING');
    const normEmail = String(email).trim().toLowerCase();
    const user = usersDB.find(u => (u.email || '').trim().toLowerCase() === normEmail);
    if (!user) throw fail('NOT_REGISTERED');
    const doctor = doctorsList.find(d => d.login === doctorLogin);
    if (!doctor) throw fail('NO_DOCTOR');
    if (!SLOT_TIMES.includes(time)) throw fail('BAD_TIME');
    if (!isWeekday(date)) throw fail('NOT_WEEKDAY');
    const slotDate = new Date(`${date}T${time}:00`);
    if (isNaN(slotDate.getTime()) || slotDate.getTime() < Date.now()) throw fail('PAST');

    await syncAppointmentsFromGitHub(); // свіжий стан перед перевіркою накладок
    const clash = appointments.find(a => a.doctorLogin === doctorLogin && a.date === date && a.time === time && a.status !== 'cancelled');
    if (clash) throw fail('TAKEN');

    const appt = {
        id: Date.now(),
        doctorLogin,
        doctorName: doctor.name || doctorLogin,
        patientEmail: user.email,
        patientName: user.name || '',
        date, time,
        status: 'booked',
        createdAt: new Date().toISOString(),
        telegramChatId: telegramChatId ? String(telegramChatId) : null
    };
    appointments.push(appt);
    const saved = await saveAppointmentsToGitHub();
    if (!saved) throw fail('SAVE_FAILED');

    // Запам'ятовуємо Telegram пацієнта в медкартці — щоб потім слати сповіщення про зміни.
    if (telegramChatId) {
        try {
            let rec = await getPatientRecord(user.email);
            if (!rec) rec = { email: user.email, fullName: user.name || '', phone: '', birthDate: '', medicalHistory: '', consultations: [] };
            if (rec.telegramChatId !== String(telegramChatId)) { rec.telegramChatId = String(telegramChatId); await savePatientRecord(user.email, rec); }
        } catch (e) {}
    }

    await sendTelegramMessage(`📅 Новий запис на прийом\nЛікар: ${appt.doctorName}\nДата: ${date} ${time}\nПацієнт: ${user.email}`);
    return appt;
}

const APPT_ERROR_MAP = {
    MISSING: [400, "Заповніть усі поля"],
    NOT_REGISTERED: [403, "Записатися може лише зареєстрований пацієнт"],
    NO_DOCTOR: [400, "Такого лікаря немає"],
    BAD_TIME: [400, "Некоректний час"],
    NOT_WEEKDAY: [400, "Прийом лише у робочі дні (Пн–Пт)"],
    PAST: [400, "Оберіть майбутню дату й час"],
    TAKEN: [409, "Цей час уже зайнятий, оберіть інший"],
    SAVE_FAILED: [500, "Не вдалося зберегти запис"]
};

// Бронювання слоту — лише зареєстрований пацієнт
app.post('/api/appointments/book', authRateLimiter, async (req, res) => {
    const { email, doctorLogin, date, time } = req.body;
    try {
        const appt = await bookAppointmentCore(email, doctorLogin, date, time);
        res.json({ success: true, appointment: appt });
    } catch (e) {
        const [code, message] = APPT_ERROR_MAP[e.code] || [500, "Помилка бронювання"];
        res.status(code).json({ error: message });
    }
});

// Записи конкретного пацієнта
app.post('/api/appointments/my', authRateLimiter, (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email обов'язковий" });
    const normEmail = String(email).trim().toLowerCase();
    const list = appointments
        .filter(a => (a.patientEmail || '').toLowerCase() === normEmail)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    res.json(list);
});

// Скасувати свій запис
app.post('/api/appointments/cancel', authRateLimiter, async (req, res) => {
    const { email, id } = req.body;
    const normEmail = String(email || '').trim().toLowerCase();
    const appt = appointments.find(a => a.id === id && (a.patientEmail || '').toLowerCase() === normEmail);
    if (!appt) return res.status(404).json({ error: "Запис не знайдено" });
    appt.status = 'cancelled';
    await saveAppointmentsToGitHub();
    res.json({ success: true });
});

// Записи для кабінету лікаря (свої; адмін бачить усі)
app.post('/api/doctor/appointments', authRateLimiter, (req, res) => {
    const { login, password } = req.body;
    const auth = getDoctorAuth(login, password);
    if (!auth) return res.status(403).json({ error: "Невірний логін або пароль" });
    let list = appointments.filter(a => a.status !== 'cancelled');
    if (!auth.isAdmin) list = list.filter(a => a.doctorLogin === auth.login);
    list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    res.json(list);
});

// Надіслати email пацієнту (через Resend API). Потрібні env EMAIL_API_KEY + EMAIL_FROM.
async function sendEmail(to, subject, html) {
    if (!EMAIL_API_KEY || !EMAIL_FROM || !to) return false;
    try {
        await axios.post('https://api.resend.com/emails',
            { from: EMAIL_FROM, to: [to], subject, html },
            { headers: { 'Authorization': `Bearer ${EMAIL_API_KEY}`, 'Content-Type': 'application/json' } });
        return true;
    } catch (e) {
        console.error('❌ Email не надіслано:', (e.response && e.response.data) || e.message);
        return false;
    }
}

// Надіслати пацієнту повідомлення в Telegram про його запис (якщо знаємо його chatId).
// chatId беремо із запису або з медкартки пацієнта (де він осідає після взаємодії з ботом).
async function notifyPatientTelegram(appt, text) {
    if (!bot) return false;
    let chatId = appt.telegramChatId;
    if (!chatId && appt.patientEmail) {
        try { const rec = await getPatientRecord(appt.patientEmail); if (rec && rec.telegramChatId) chatId = rec.telegramChatId; } catch (e) {}
    }
    if (!chatId) return false;
    try { await bot.sendMessage(String(chatId), text, { parse_mode: 'HTML' }); return true; }
    catch (e) { console.error('❌ Не вдалося сповістити пацієнта:', e.message); return false; }
}

// Лікар переносить/редагує СВІЙ запис (адмін — будь-який). Пацієнту йде сповіщення в Telegram.
app.post('/api/doctor/appointment/update', authRateLimiter, async (req, res) => {
    const { login, password, id, date, time } = req.body;
    const auth = getDoctorAuth(login, password);
    if (!auth) return res.status(403).json({ error: "Невірний логін або пароль" });
    await syncAppointmentsFromGitHub();
    const appt = appointments.find(a => a.id === id && a.status !== 'cancelled');
    if (!appt) return res.status(404).json({ error: "Запис не знайдено" });
    if (!auth.isAdmin && appt.doctorLogin !== auth.login) return res.status(403).json({ error: "Це не ваш запис" });
    if (!SLOT_TIMES.includes(time)) return res.status(400).json({ error: "Некоректний час" });
    if (!isWeekday(date)) return res.status(400).json({ error: "Прийом лише у робочі дні (Пн–Пт)" });
    const slotDate = new Date(`${date}T${time}:00`);
    if (isNaN(slotDate.getTime()) || slotDate.getTime() < Date.now()) return res.status(400).json({ error: "Оберіть майбутню дату й час" });
    const clash = appointments.find(a => a.id !== id && a.doctorLogin === appt.doctorLogin && a.date === date && a.time === time && a.status !== 'cancelled');
    if (clash) return res.status(409).json({ error: "Цей час уже зайнятий, оберіть інший" });

    const oldDate = appt.date, oldTime = appt.time;
    appt.date = date; appt.time = time; appt.updatedAt = new Date().toISOString();
    const saved = await saveAppointmentsToGitHub();
    if (!saved) return res.status(500).json({ error: "Не вдалося зберегти" });

    const emailed = await sendEmail(appt.patientEmail, 'Зміна запису на прийом — центр «Надія»',
        `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.6;">
            <h2 style="color:#14997a;">Зміна запису на прийом</h2>
            <p>Ваш запис у реабілітаційному центрі «Надія» перенесено:</p>
            <p><b>Лікар:</b> ${appt.doctorName}<br><b>Було:</b> ${oldDate} о ${oldTime}<br><b>Стало:</b> ${date} о ${time}</p>
            <p>Якщо новий час не підходить — зайдіть у свій кабінет на сайті або напишіть нам.</p>
            <p style="color:#888;font-size:13px;">golos-proty-raku.pp.ua</p>
        </div>`);
    const notified = await notifyPatientTelegram(appt,
        `🔔 <b>Зміна запису на прийом — центр «Надія»</b>\n\nЛікар: <b>${appt.doctorName}</b>\nБуло: ${oldDate} о ${oldTime}\n<b>Стало: ${date} о ${time}</b>\n\nЯкщо час не підходить — напишіть нам.`);
    if (!emailed && !notified) await sendTelegramMessage(`ℹ️ Перенесено запис (${appt.doctorName}) на ${date} ${time}\nПацієнт: ${appt.patientEmail}\n⚠️ Ні email, ні Telegram не надіслано — попередьте вручну.`);
    res.json({ success: true, emailed, notified });
});

// Лікар скасовує СВІЙ запис. Пацієнту йде сповіщення в Telegram.
app.post('/api/doctor/appointment/cancel', authRateLimiter, async (req, res) => {
    const { login, password, id } = req.body;
    const auth = getDoctorAuth(login, password);
    if (!auth) return res.status(403).json({ error: "Невірний логін або пароль" });
    await syncAppointmentsFromGitHub();
    const appt = appointments.find(a => a.id === id);
    if (!appt) return res.status(404).json({ error: "Запис не знайдено" });
    if (!auth.isAdmin && appt.doctorLogin !== auth.login) return res.status(403).json({ error: "Це не ваш запис" });
    appt.status = 'cancelled'; appt.updatedAt = new Date().toISOString();
    const saved = await saveAppointmentsToGitHub();
    if (!saved) return res.status(500).json({ error: "Не вдалося зберегти" });

    const emailed = await sendEmail(appt.patientEmail, 'Запис скасовано — центр «Надія»',
        `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.6;">
            <h2 style="color:#c0392b;">Ваш запис скасовано</h2>
            <p>На жаль, ваш запис у центрі «Надія» скасовано:</p>
            <p><b>Лікар:</b> ${appt.doctorName}<br><b>Було:</b> ${appt.date} о ${appt.time}</p>
            <p>Ви можете записатися на інший зручний час у боті або на сайті.</p>
            <p style="color:#888;font-size:13px;">golos-proty-raku.pp.ua</p>
        </div>`);
    const notified = await notifyPatientTelegram(appt,
        `🔕 <b>Ваш запис скасовано — центр «Надія»</b>\n\nЛікар: <b>${appt.doctorName}</b>\nБуло: ${appt.date} о ${appt.time}\n\nЗапишіться на інший зручний час у боті або на сайті.`);
    if (!emailed && !notified) await sendTelegramMessage(`ℹ️ Скасовано запис (${appt.doctorName}) ${appt.date} ${appt.time}\nПацієнт: ${appt.patientEmail}\n⚠️ Ні email, ні Telegram не надіслано.`);
    res.json({ success: true, emailed, notified });
});

// ==========================================
// КАБІНЕТ ЛІКАРЯ (доступ мають усі лікарі — спільний пароль, як і для блогу)
// ==========================================
app.post('/api/doctor/patients', authRateLimiter, async (req, res) => {
    const { login, password } = req.body;
    if (!getDoctorAuth(login, password)) return res.status(403).json({ error: "Невірний логін або пароль" });
    const summaries = await listPatientSummaries();
    res.json(summaries);
});

app.post('/api/doctor/patient', authRateLimiter, async (req, res) => {
    const { login, password, email } = req.body;
    if (!getDoctorAuth(login, password)) return res.status(403).json({ error: "Невірний логін або пароль" });
    if (!email) return res.status(400).json({ error: "Email обов'язковий" });

    const record = await getPatientRecord(email);
    if (!record) return res.status(404).json({ error: "Пацієнта не знайдено" });
    res.json(sanitizePatientRecord(record));
});

app.post('/api/doctor/patient/note', authRateLimiter, async (req, res) => {
    const { login, password, email, consultationId, doctorName, notes, prescription } = req.body;
    const noteAuth = getDoctorAuth(login, password);
    if (!noteAuth) return res.status(403).json({ error: "Невірний логін або пароль" });
    if (!email) return res.status(400).json({ error: "Email обов'язковий" });

    const record = await getPatientRecord(email);
    if (!record) return res.status(404).json({ error: "Пацієнта не знайдено" });
    if (!record.consultations) record.consultations = [];

    let consultation = record.consultations.find(c => c.id === consultationId);
    if (!consultation) {
        // Дозволяємо лікарю додати нотатку навіть без окремої оплаченої консультації
        // (наприклад, після очного прийому) — створюємо запис вручну.
        consultation = { id: Date.now(), createdAt: new Date().toISOString(), status: 'completed', amount: 0, paidAt: null };
        record.consultations.push(consultation);
    }
    // Підпис — ім'я лікаря, під яким виконано вхід (адмін може вказати ім'я вручну).
    consultation.doctorName = ((noteAuth.isAdmin && doctorName) ? doctorName : noteAuth.name).slice(0, 200);
    consultation.notes = (notes || '').slice(0, 5000);
    consultation.prescription = (prescription || '').slice(0, 5000);
    if (consultation.status === 'paid') consultation.status = 'completed';

    const saved = await savePatientRecord(email, record);
    if (!saved) return res.status(500).json({ error: "Не вдалося зберегти" });
    res.json({ success: true });
});

app.post('/api/doctor/reviews', authRateLimiter, async (req, res) => {
    const { login, password } = req.body;
    if (!getDoctorAuth(login, password)) return res.status(403).json({ error: "Невірний логін або пароль" });
    res.json(siteReviews);
});

app.post('/api/doctor/reviews/moderate', authRateLimiter, async (req, res) => {
    const { login, password, id, action } = req.body;
    if (!getDoctorAuth(login, password)) return res.status(403).json({ error: "Невірний логін або пароль" });

    const review = siteReviews.find(r => r.id === id);
    if (!review) return res.status(404).json({ error: "Відгук не знайдено" });

    if (action === 'approve') review.status = 'approved';
    else if (action === 'reject') review.status = 'rejected';
    else return res.status(400).json({ error: "Невідома дія" });

    await saveReviewsToGitHub();
    res.json({ success: true });
});

app.post('/api/doctor/verify', authRateLimiter, (req, res) => {
    const { login, password } = req.body;
    const auth = getDoctorAuth(login, password);
    if (!auth) return res.status(403).json({ error: "Невірний логін або пароль" });
    res.json({ success: true, doctorName: auth.name });
});

// Редагування блогу / медхабу — доступне КОЖНОМУ лікарю (getDoctorAuth); публікація
// підписується його іменем. Категорії: rehab_wife (порада медхабу) або блог news/psychology/rehab.
app.post('/api/wife-blog/verify', (req, res) => {
    const { login, password } = req.body;
    const auth = getDoctorAuth(login, password);
    if (auth) return res.json({ success: true, doctorName: auth.name });
    res.status(403).json({ error: "Невірний логін або пароль" });
});

app.post('/api/wife-blog', async (req, res) => {
    const { login, password, title, content, category } = req.body;
    const auth = getDoctorAuth(login, password);
    if (!auth) return res.status(403).json({ error: "Доступ лише для лікаря або адміністратора" });
    if (!title || !title.trim() || !content || !content.trim()) {
        return res.status(400).json({ error: "Заголовок і текст обов'язкові" });
    }
    const cat = ['rehab_wife', 'news', 'psychology', 'rehab'].includes(category) ? category : 'rehab_wife';
    const bannerByCat = {
        rehab_wife: 'banner_medhub_1.svg',
        news: randomFrom(NEWS_BANNERS),
        psychology: randomFrom(PSY_BANNERS),
        rehab: randomFrom(REHAB_BANNERS)
    };
    const article = {
        id: Date.now(),
        isWifeTip: cat === 'rehab_wife',
        category: cat,
        title: String(title).trim().slice(0, 300),
        content: String(content).trim().slice(0, 20000),
        author: auth.name,
        date: new Date().toLocaleDateString('uk-UA'),
        imageUrl: bannerByCat[cat] || 'banner_medhub_1.svg'
    };
    aiBlogPosts.unshift(article);
    await saveBlogToGitHub();
    res.json({ success: true });
});

app.post('/api/wife-blog/delete', async (req, res) => {
    const { login, password, id } = req.body;
    if (!getDoctorAuth(login, password)) {
        return res.status(403).json({ error: "Доступ лише для лікаря або адміністратора" });
    }
    aiBlogPosts = aiBlogPosts.filter(p => p.id !== id);
    await saveBlogToGitHub();
    res.json({ success: true });
});

// ==========================================
// 7. ЗАПУСК СЕРВЕРА
// ==========================================
const PORT = process.env.PORT || 10000;

Promise.all([syncBlogFromGitHub(), fetchMusicFromDrive(), syncUsersFromGitHub(), syncReviewsFromGitHub(), syncSiteContentFromGitHub(), syncAppointmentsFromGitHub()]).then(() => {
    migrateCategoryBanners().catch(e => console.error('Помилка міграції банерів:', e.message));
    app.listen(PORT, '0.0.0.0', () => {
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
