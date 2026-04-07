const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({ dest: '/tmp/' });

const MUSIC_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzjzr5afDgy4pAWlwKVsatYaAK4JZC6c7itGdJaeScLCp-2iZP4PZ-8j_Kid7t0jIw/exec";
const SUBS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyiNvM7G8qf2JsBFVrII76c8WafveUvK1GXynFeAOV9wNXBX9fvWXz5iyu-9WrQ_DT2/exec";

const BACKEND_URL = "https://andreygerc11-music-site.onrender.com"; 
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN; 
const MONO_TOKEN = process.env.MONO_TOKEN; 
const TELEGRAM_CHAT_ID = "556627059"; 

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const GROQ_API_KEY = process.env.GROQ_API_KEY; 

async function sendTelegramMessage(text) {
    if (!TELEGRAM_BOT_TOKEN) return;
    try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'HTML' }); } catch (e) { console.error("Помилка ТГ:", e.message); }
}

app.get('/api/music', async (req, res) => {
    try { const response = await axios.get(MUSIC_SCRIPT_URL, { maxRedirects: 5 }); res.json(response.data); } 
    catch (error) { res.status(500).json({ error: "Помилка зв'язку з Google" }); }
});

app.post('/api/register', async (req, res) => {
    try { const response = await axios.post(SUBS_SCRIPT_URL, { action: "register", email: req.body.email, password: req.body.password }); res.json(response.data); } catch (e) { res.status(500).json({ error: "Помилка сервера" }); }
});

app.post('/api/login', async (req, res) => {
    try { const response = await axios.post(SUBS_SCRIPT_URL, { action: "login", email: req.body.email, password: req.body.password }); res.json(response.data); } catch (e) { res.status(500).json({ error: "Помилка сервера" }); }
});

app.post('/api/pay', async (req, res) => {
    try {
        const { songId, songName } = req.body;
        if (!MONO_TOKEN) return res.status(500).json({ error: "Ключ Монобанку не налаштовано" });
        
        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3736, ccy: 980, redirectUrl: `https://golos-proty-raku.pp.ua/success.html?file=${songId}`, webHookUrl: `${BACKEND_URL}/api/webhook`, 
            merchantPaymInfo: { reference: songId, destination: `Оплата за трек: ${songName}` }
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: response.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Не вдалося створити платіж" }); }
});

app.post('/api/pay-subscription', async (req, res) => {
    try {
        if (!MONO_TOKEN) return res.status(500).json({ error: "Ключ Монобанку не налаштовано" });
        const subId = 'sub_' + Date.now(); 
        const email = req.body.email || '';
        
        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3900, ccy: 980, redirectUrl: `https://golos-proty-raku.pp.ua/generator.html?status=subscribed`, webHookUrl: `${BACKEND_URL}/api/webhook`, 
            saveCardData: { saveCard: true },
            merchantPaymInfo: { reference: subId + '|' + email, destination: `Пробний період Hertz Spectrum` }
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: response.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Не вдалося створити підписку" }); }
});

app.post('/api/webhook', async (req, res) => {
    const paymentData = req.body;
    if (paymentData.status === 'success') {
        const refParts = paymentData.reference.split('|');
        const ref = refParts[0];
        const email = refParts[1] || '';

        if (ref.startsWith('sub_')) {
            const nextDate = new Date(); nextDate.setDate(nextDate.getDate() + 5); 
            await axios.post(SUBS_SCRIPT_URL, { action: "new_sub", subId: ref, walletId: paymentData.walletId, nextPaymentDate: nextDate.toISOString().split('T')[0], email: email });
            await sendTelegramMessage(`🔥 <b>НОВА ПІДПИСКА!</b>\n📧 Юзер: ${email}`);
        } 
        else if (ref.startsWith('ren_')) { await sendTelegramMessage(`💸 <b>АВТОМАТИЧНЕ СПИСАННЯ УСПІШНЕ!</b>`); }
        else { await sendTelegramMessage(`✅ <b>Оплата за пісню!</b>\nID: <code>${ref}</code>`); }
    }
    res.status(200).send('OK');
});


// ==========================================
// ГЕНЕРАЦІЯ ЗОБРАЖЕНЬ (ІМАГЕН 3.0 ЧЕРЕЗ GEMINI API)
// ==========================================
app.post('/api/generate-image', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) return res.status(500).json({ error: "Ключ Gemini не налаштовано на сервері" });

        const { title, lyrics, format, customPrompt, author } = req.body;
        
        let aspectRatio = "1:1"; 
        if (format === 'vertical' || format === 'portrait') aspectRatio = "9:16"; 
        if (format === 'horizontal' || format === 'cinema') aspectRatio = "16:9";

        // КРОК 1: АНАЛІЗ ТЕКСТУ ЧЕРЕЗ GEMINI
        let safeVisualDescription = "abstract cinematic background, elegant, 8k";

        if (customPrompt && customPrompt.length > 2) {
            safeVisualDescription = customPrompt;
        } else if (lyrics && lyrics.length > 5) {
            try {
                // Промпт для Gemini, щоб він створив безпечний опис для Imagen
                const textAnalyzePrompt = `Ти - професійний арт-директор музичних кліпів. Прочитай цей текст пісні і створи ОДНИМ РЕЧЕННЯМ англійською мовою безпечний візуальний опис для фону обкладинки. Уникай будь-яких слів про смерть, кров, війну, біль, насилля (щоб не спрацювали фільтри безпеки Google Imagen). Напиши лише візуальну атмосферу (наприклад: cinematic autumn landscape, dramatic beautiful lighting). Текст: "${lyrics.substring(0, 800)}"`;
                
                const textResponse = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                    contents: [{ parts: [{ text: textAnalyzePrompt }] }]
                });
                
                if (textResponse.data && textResponse.data.candidates) {
                    safeVisualDescription = textResponse.data.candidates[0].content.parts[0].text.trim();
                    console.log("Gemini зрозумів пісню і створив опис:", safeVisualDescription);
                }
            } catch (analyzeErr) {
                console.error("Помилка аналізу тексту Gemini:", analyzeErr.message);
                // Якщо аналіз не вдався, використовуємо стандартний опис
            }
        }

        // КРОК 2: МАЛЮВАННЯ ТА ДОДАВАННЯ ТЕКСТУ НА КАРТИНКУ
        let textOverlayPrompt = "";
        let finalTitle = title ? title.replace(/["']/g, '') : ""; // Прибираємо лапки з назви
        let finalAuthor = author ? author.replace(/["']/g, '') : ""; // Прибираємо лапки з автора

        if (finalTitle) {
            textOverlayPrompt = `Typography: Beautifully and elegantly write the text "${finalTitle}"`;
            if (finalAuthor) {
                textOverlayPrompt += ` and author "${finalAuthor}"`;
            }
            textOverlayPrompt += ` on the image. `;
        }

        // Промпт для Imagen 3.0
        let aiPrompt = `A stunning hyper-realistic album cover. Visuals: ${safeVisualDescription}. Cinematic lighting, highly detailed, 8k resolution. Aspect ratio: ${aspectRatio}. ${textOverlayPrompt}`;
        
        console.log(`Відправляю промпт до Google Imagen: [${aiPrompt}]`);

        // ВИКЛИК ГОЛОВНОЇ ШІ-МОДЕЛІ МАЛЮВАННЯ (IMAGEN 3.0)
        // Модель gemini-3.1-flash-image-preview працює через ендпоінт generateContent з параметром responseModalities
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`, {
            contents: [
                { parts: [ { text: aiPrompt } ] }
            ],
            generationConfig: {
                responseModalities: ["IMAGE"] // ВАЖЛИВО!
            }
        }, { headers: { 'Content-Type': 'application/json' } });

        // Обробка відповіді (структура Imagen 3 інша, ніж у Imagen 2)
        if (response.data && response.data.candidates && response.data.candidates[0].content.parts[0]) {
            const inlineData = response.data.candidates[0].content.parts[0].inlineData || response.data.candidates[0].content.parts[0].inline_data;
            if (inlineData && inlineData.data) {
                const base64Image = inlineData.data;
                const mimeType = inlineData.mimeType || "image/jpeg";
                return res.json({ imageUrl: `data:${mimeType};base64,${base64Image}` });
            }
        }
        
        throw new Error("Не вдалося знайти дані зображення у відповіді API");

    } catch (error) {
        // === ОСЬ ТУТ ПОКРАЩЕНО ОБРОБКУ ПОМИЛОК КВОТИ ===
        console.error("--- ПОМИЛКА ГЕНЕРАЦІЇ ЗОБРАЖЕННЯ ---");
        
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", JSON.stringify(error.response.data, null, 2));

            // Специфічне повідомлення для помилки квоти 429
            if (error.response.status === 429) {
                return res.status(429).json({ error: "ШІ-модель перевантажена. Спробуйте через 1-2 хвилини, або перейдіть на платний тариф Google." });
            }
            
            // Специфічне повідомлення для помилки фільтрів безпеки 400
            if (error.response.status === 400 && error.response.data && JSON.stringify(error.response.data).includes('SAFETY')) {
                return res.status(400).json({ error: "ШІ відхилив запит через опис. Спробуйте інший текст пісні або опис." });
            }
        } else {
            console.error("Повідомлення:", error.message);
        }
        
        // Загальне повідомлення для всіх інших помилок
        res.status(500).json({ error: "ШІ не зміг згенерувати обкладинку. Спробуйте інший опис." });
    }
});


// АВТО-СИНХРОНІЗАЦІЯ ТЕКСТУ (WHISPER ЧЕРЕЗ GROQ)
app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    try {
        if (!GROQ_API_KEY) return res.status(500).json({ error: "Ключ Groq API не налаштовано на сервері!" });
        if (!req.file) return res.status(400).json({ error: "Аудіофайл не отримано сервером." });

        const formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path), req.file.originalname);
        formData.append('model', 'whisper-large-v3'); 
        formData.append('response_format', 'verbose_json'); 
        formData.append('language', 'uk'); 

        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() },
            maxBodyLength: Infinity
        });

        // Видаляємо тимчасовий файл
        fs.unlinkSync(req.file.path);

        const segments = response.data.segments;
        let lrcText = "";
        
        if (segments && segments.length > 0) {
            segments.forEach(seg => {
                let date = new Date(seg.start * 1000);
                let m = String(date.getUTCMinutes()).padStart(2, '0');
                let s = String(date.getUTCSeconds()).padStart(2, '0');
                let ms = String(Math.floor(date.getUTCMilliseconds() / 10)).padStart(2, '0');
                lrcText += `[${m}:${s}.${ms}] ${seg.text.trim()}\n`;
            });
        }
        res.json({ lrc: lrcText });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error("Помилка Whisper Groq:", error.response?.data || error.message);
        res.status(500).json({ error: "ШІ не зміг розпізнати пісню. Можливо, файл завеликий (ліміт ~25MB)." });
    }
});

// КРОН-ДЖОБ ДЛЯ АВТО-СПИСАННЯ ПІДПИСОК (кожен день о 10:00)
cron.schedule('0 10 * * *', async () => {
    if (!MONO_TOKEN) return;
    try {
        const response = await axios.get(`${SUBS_SCRIPT_URL}?action=getSubs`);
        const subs = response.data;
        const today = new Date().toISOString().split('T')[0];

        for (let sub of subs) {
            if (sub.Status === 'active' && sub.NextPaymentDate && sub.NextPaymentDate <= today) {
                try {
                    // Списання через Монобанк
                    await axios.post('https://api.monobank.ua/api/merchant/wallet/payment', {
                        walletId: sub.WalletId, amount: 19900, ccy: 980, reference: 'ren_' + sub.SubID + '_' + Date.now(), destination: "Місячна підписка Hertz Spectrum"
                    }, { headers: { 'X-Token': MONO_TOKEN } });

                    // Оновлення дати в таблиці Google
                    const nextDate = new Date(); nextDate.setDate(nextDate.getDate() + 30);
                    await axios.post(SUBS_SCRIPT_URL, { action: "update_sub", subId: sub.SubID, nextPaymentDate: nextDate.toISOString().split('T')[0] });
                } catch (chargeError) {
                    await sendTelegramMessage(`❌ <b>Помилка списання 199 грн!</b>\nНе вдалося зняти гроші за підписку <code>${sub.SubID}</code>.`);
                    await axios.post(SUBS_SCRIPT_URL, { action: "update_sub", subId: sub.SubID, status: "failed" });
                }
            }
        }
    } catch (err) { console.error("Помилка роботи Cron:", err.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));