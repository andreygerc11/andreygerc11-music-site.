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
// ГЕНЕРАЦІЯ ЗОБРАЖЕНЬ (ЧИСТИЙ УНІВЕРСАЛЬНИЙ ПРОМПТ)
// ==========================================
app.post('/api/generate-image', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) return res.status(500).json({ error: "Ключ Gemini не налаштовано на сервері" });

        const { lyrics, format, customPrompt } = req.body;
        
        let aspectRatio = "1:1"; 
        if (format === 'vertical' || format === 'portrait') aspectRatio = "9:16"; 
        if (format === 'horizontal' || format === 'cinema') aspectRatio = "16:9";

        // Нейтральний дефолт (якщо немає тексту або аналіз впав)
        let safeVisualDescription = "beautiful abstract cinematic background, elegant lighting, 8k resolution";

        if (customPrompt && customPrompt.length > 2) {
            safeVisualDescription = customPrompt;
        } else if (lyrics && lyrics.length > 5) {
            try {
                // Абсолютно чистий універсальний промпт для аналізатора
                const textAnalyzePrompt = `Read the following song lyrics and extract the core visual atmosphere, setting, and objects. Create ONLY ONE SENTENCE in English describing a highly detailed, cinematic background image for an album cover that PERFECTLY MATCHES the song's vibe. Do NOT include instructions to write text. Lyrics: "${lyrics.substring(0, 800)}"`;
                
                const textResponse = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                    contents: [{ parts: [{ text: textAnalyzePrompt }] }]
                });
                
                if (textResponse.data && textResponse.data.candidates) {
                    safeVisualDescription = textResponse.data.candidates[0].content.parts[0].text.trim();
                    console.log("ШІ проаналізував текст і видав:", safeVisualDescription);
                }
            } catch (e) {
                console.error("Аналіз тексту не вдався, залишаємо нейтральний дефолт:", e.message);
            }
        }

        // КРОК 2: Генерація картинки
        let aiPrompt = `A stunning hyper-realistic album cover background WITHOUT ANY TEXT. Visuals: ${safeVisualDescription}. Cinematic lighting, highly detailed, 8k resolution. Aspect ratio: ${aspectRatio}.`;
        
        console.log(`Відправляю промпт до графічної моделі: [${aiPrompt}]`);

        const imageModel = "gemini-3.1-flash-image-preview"; 

        const generateResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent?key=${GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: aiPrompt }] }],
                generationConfig: { responseModalities: ["IMAGE"] }
            },
            { headers: { 'Content-Type': 'application/json' } }
        );

        if (generateResponse.data && generateResponse.data.candidates && generateResponse.data.candidates[0].content.parts) {
            const part = generateResponse.data.candidates[0].content.parts.find(p => p.inlineData || p.inline_data);
            if (part) {
                const inlineData = part.inlineData || part.inline_data;
                const base64Image = inlineData.data;
                const mimeType = inlineData.mimeType || "image/jpeg";
                return res.json({ imageUrl: `data:${mimeType};base64,${base64Image}` });
            }
        }
        
        throw new Error("Відповідь успішна, але зображення не знайдено");

    } catch (error) {
        console.error("--- ПОМИЛКА ГЕНЕРАЦІЇ ЗОБРАЖЕННЯ ---");
        
        let clientErrorMessage = "ШІ не зміг згенерувати обкладинку. Перевірте логи.";
        
        if (error.response) {
            const errorData = JSON.stringify(error.response.data);
            console.error("Status:", error.response.status);
            console.error("Data:", errorData);
            
            if (error.response.status === 429) {
                clientErrorMessage = "Ваш API ключ ще не оновився до платного. Зачекайте 15 хвилин.";
            } else if (error.response.status === 400 && errorData.includes("SAFETY")) {
                clientErrorMessage = "ШІ заблокував генерацію через фільтр безпеки. Напишіть нейтральний опис.";
            } else if (error.response.status === 404) {
                clientErrorMessage = "Модель не знайдена. Перевірте назву моделі в коді.";
            } else {
                clientErrorMessage = `Помилка Google API (${error.response.status}).`;
            }
        } else {
            console.error("Full error:", error.message);
            clientErrorMessage = "Серверна помилка: " + error.message;
        }
        
        res.status(500).json({ error: clientErrorMessage });
    }
});


// АВТО-СИНХРОНІЗАЦІЯ ТЕКСТУ (WHISPER)
app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    try {
        if (!GROQ_API_KEY) return res.status(500).json({ error: "Ключ Groq API не налаштовано!" });
        if (!req.file) return res.status(400).json({ error: "Аудіофайл не отримано." });

        const lyricsText = req.body.lyricsText;

        const formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path), req.file.originalname);
        formData.append('model', 'whisper-large-v3'); 
        formData.append('response_format', 'verbose_json'); 
        formData.append('language', 'uk'); 

        if (lyricsText && lyricsText.trim().length > 0) {
            formData.append('prompt', lyricsText.substring(0, 1000));
        }

        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() },
            maxBodyLength: Infinity
        });

        fs.unlinkSync(req.file.path);

        let lrcText = "";
        if (response.data.segments) {
            response.data.segments.forEach(seg => {
                let d = new Date(seg.start * 1000);
                let m = String(d.getUTCMinutes()).padStart(2, '0');
                let s = String(d.getUTCSeconds()).padStart(2, '0');
                let ms = String(Math.floor(d.getUTCMilliseconds() / 10)).padStart(2, '0');
                lrcText += `[${m}:${s}.${ms}] ${seg.text.trim()}\n`;
            });
        }
        res.json({ lrc: lrcText });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: "Помилка розпізнавання Whisper." });
    }
});

cron.schedule('0 10 * * *', async () => { /* Функція крон-джобів залишається */ });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));