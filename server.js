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

// Обмеження 25 МБ для Groq, щоб сервер не падав
const upload = multer({ 
    dest: '/tmp/',
    limits: { fileSize: 25 * 1024 * 1024 } 
});

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
// ГЕНЕРАЦІЯ ЗОБРАЖЕНЬ (GROQ LLAMA 3 + GEMINI IMAGE)
// ==========================================
app.post('/api/generate-image', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) return res.status(500).json({ error: "Ключ Gemini не налаштовано на сервері" });

        const { lyrics, format, customPrompt } = req.body;
        
        // Визначаємо формат для ШІ
        let aspectRatio = "1:1"; 
        if (format === 'vertical' || format === 'portrait') aspectRatio = "9:16"; 
        if (format === 'horizontal' || format === 'cinema') aspectRatio = "16:9";

        let safeVisualDescription = "abstract cinematic background, elegant lighting, 8k resolution";

        // АНАЛІЗ ТЕКСТУ (Швидка та надійна Llama 3)
        if (customPrompt && customPrompt.length > 2) {
            safeVisualDescription = customPrompt;
        } else if (lyrics && lyrics.length > 5) {
            try {
                if (!GROQ_API_KEY) throw new Error("Немає ключа Groq");
                
                const textAnalyzePrompt = `You are a visionary art director. Read the following song lyrics: "${lyrics.substring(0, 600)}". Create ONLY ONE SENTENCE in English describing a highly detailed, cinematic background image to be used as the album cover for this song. Describe the specific visual scene, mood, and objects based on the lyrics. Do NOT generate text or words on the image.`;
                
                const textResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: 'llama3-8b-8192',
                    messages: [{ role: 'user', content: textAnalyzePrompt }]
                }, {
                    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }
                });
                
                if (textResponse.data && textResponse.data.choices) {
                    safeVisualDescription = textResponse.data.choices[0].message.content.trim();
                    console.log("Llama 3 придумала обкладинку:", safeVisualDescription);
                }
            } catch (e) {
                console.error("Аналіз пісні не вдався:", e.message);
                safeVisualDescription = "Cinematic background inspired by this text: " + lyrics.substring(0, 100).replace(/\n/g, ' ');
            }
        }

        // ГЕНЕРАЦІЯ КАРТИНКИ (з жорсткою вимогою розміру)
        let aiPrompt = `Create a beautiful album cover based on a song. Visual scene: ${safeVisualDescription}. STRICT REQUIREMENT: Generate the image EXACTLY in ${aspectRatio} aspect ratio. Do not include any text, letters, or titles on the image. Cinematic lighting, highly detailed, 8k resolution.`;
        
        console.log(`Промпт до художника: [${aiPrompt}]`);

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
        let clientErrorMessage = "ШІ не зміг згенерувати обкладинку.";
        
        if (error.response) {
            if (error.response.status === 429) clientErrorMessage = "Зачекайте кілька секунд. Модель перевантажена.";
            else if (error.response.status === 400) clientErrorMessage = "ШІ заблокував генерацію через фільтр безпеки.";
            else clientErrorMessage = `Помилка Google API (${error.response.status}).`;
        }
        res.status(500).json({ error: clientErrorMessage });
    }
});


// ==========================================
// АВТО-СИНХРОНІЗАЦІЯ ТЕКСТУ (WHISPER + ФІЛЬТР)
// ==========================================
app.post('/api/sync-lyrics', function(req, res, next) {
    // Відловлюємо помилку перевищення ліміту розміру файлу
    upload.single('audio')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: "Помилка: файл завеликий (макс. 25МБ)." });
        } else if (err) {
            return res.status(500).json({ error: "Помилка передачі файлу." });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!GROQ_API_KEY) return res.status(500).json({ error: "Ключ Groq API не налаштовано!" });
        if (!req.file) return res.status(400).json({ error: "Аудіофайл не отримано." });

        const lyricsText = req.body.lyricsText;

        const formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path), req.file.originalname);
        formData.append('model', 'whisper-large-v3'); 
        formData.append('response_format', 'verbose_json'); 
        formData.append('language', 'uk'); 
        
        // Жорстко забороняємо ШІ фантазувати (знижуємо галюцинації)
        formData.append('temperature', '0.0'); 

        // Передаємо текст як підказку (до 800 символів, почищений від [таймінгів])
        if (lyricsText && lyricsText.trim().length > 0) {
            let cleanPrompt = lyricsText.replace(/\[.*?\]/g, '').replace(/\n/g, ' ').substring(0, 800);
            formData.append('prompt', cleanPrompt);
        }

        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() },
            maxBodyLength: Infinity,
            timeout: 60000 // Таймаут 60 сек, щоб не висіло вічно
        });

        fs.unlinkSync(req.file.path);

        let lrcText = "";
        
        if (response.data.segments) {
            response.data.segments.forEach(seg => {
                let text = seg.text.trim();
                
                // === ЖОРСТКИЙ ФІЛЬТР СМІТТЯ ===
                const isTooShort = text.length <= 2;
                const hasArabic = /[\u0600-\u06FF]/.test(text); // Блокуємо арабську в'язь
                const isRepeatingChar = /^(.)\1+$/.test(text.replace(/\s/g, '')); // Блокуємо "н н н" або "аааа"
                const isMusicMarker = text.toLowerCase() === "музика" || text.toLowerCase() === "програш" || text === "Ооо" || text.toLowerCase() === "о-о-о";

                // Записуємо тільки нормальні слова
                if (!isTooShort && !hasArabic && !isRepeatingChar && !isMusicMarker) {
                    let d = new Date(seg.start * 1000);
                    let m = String(d.getUTCMinutes()).padStart(2, '0');
                    let s = String(d.getUTCSeconds()).padStart(2, '0');
                    let ms = String(Math.floor(d.getUTCMilliseconds() / 10)).padStart(2, '0');
                    lrcText += `[${m}:${s}.${ms}] ${text}\n`;
                }
            });
        }
        res.json({ lrc: lrcText });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        
        let errorMessage = "Помилка розпізнавання.";
        if (error.code === 'ECONNABORTED') {
            errorMessage = "Час очікування вийшов (пісня занадто довга).";
        } else if (error.response) {
            errorMessage = `Сервер відхилив запит (${error.response.status}).`;
        }
        
        res.status(500).json({ error: errorMessage });
    }
});

cron.schedule('0 10 * * *', async () => { /* Функція крон-джобів */ });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));