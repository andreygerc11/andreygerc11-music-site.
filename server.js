const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

// Встановлюємо шлях до стискача аудіо
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(cors());
app.use(express.json());

// Мультер тепер може приймати великі файли від користувача (до 50 МБ), 
// бо ми їх все одно стиснемо перед відправкою на ШІ.
const upload = multer({ 
    dest: '/tmp/',
    limits: { fileSize: 50 * 1024 * 1024 } 
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
        const ref = refParts[0]; const email = refParts[1] || '';
        if (ref.startsWith('sub_')) {
            const nextDate = new Date(); nextDate.setDate(nextDate.getDate() + 5); 
            await axios.post(SUBS_SCRIPT_URL, { action: "new_sub", subId: ref, walletId: paymentData.walletId, nextPaymentDate: nextDate.toISOString().split('T')[0], email: email });
            await sendTelegramMessage(`🔥 <b>НОВА ПІДПИСКА!</b>\n📧 Юзер: ${email}`);
        } 
    }
    res.status(200).send('OK');
});

// ==========================================
// ГЕНЕРАЦІЯ ЗОБРАЖЕНЬ
// ==========================================
app.post('/api/generate-image', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) return res.status(500).json({ error: "Ключ Gemini не налаштовано" });
        const { lyrics, format, customPrompt } = req.body;
        
        let aspectRatio = "1:1"; 
        if (format === 'vertical' || format === 'portrait') aspectRatio = "9:16"; 
        if (format === 'horizontal' || format === 'cinema') aspectRatio = "16:9";

        let safeVisualDescription = "abstract cinematic background, elegant lighting, 8k resolution";

        if (customPrompt && customPrompt.length > 2) {
            safeVisualDescription = customPrompt;
        } else if (lyrics && lyrics.length > 5) {
            try {
                if (!GROQ_API_KEY) throw new Error("Немає ключа Groq");
                const textAnalyzePrompt = `Read the following song lyrics: "${lyrics.substring(0, 600)}". Create ONLY ONE SENTENCE in English describing a highly detailed, cinematic background image for this song. Do NOT generate text or words on the image.`;
                const textResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: 'llama3-8b-8192', messages: [{ role: 'user', content: textAnalyzePrompt }]
                }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                if (textResponse.data && textResponse.data.choices) {
                    safeVisualDescription = textResponse.data.choices[0].message.content.trim();
                }
            } catch (e) {
                safeVisualDescription = "Cinematic background inspired by this text: " + lyrics.substring(0, 100).replace(/\n/g, ' ');
            }
        }

        let aiPrompt = `Create a beautiful album cover based on a song. Visual scene: ${safeVisualDescription}. STRICT REQUIREMENT: Generate the image EXACTLY in ${aspectRatio} aspect ratio. Do not include any text, letters, or titles on the image. Cinematic lighting, highly detailed, 8k resolution.`;
        
        const generateResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: aiPrompt }] }], generationConfig: { responseModalities: ["IMAGE"] } },
            { headers: { 'Content-Type': 'application/json' } }
        );

        if (generateResponse.data && generateResponse.data.candidates && generateResponse.data.candidates[0].content.parts) {
            const part = generateResponse.data.candidates[0].content.parts.find(p => p.inlineData || p.inline_data);
            if (part) {
                const inlineData = part.inlineData || part.inline_data;
                return res.json({ imageUrl: `data:${inlineData.mimeType || "image/jpeg"};base64,${inlineData.data}` });
            }
        }
        throw new Error("Відповідь успішна, але зображення не знайдено");
    } catch (error) {
        res.status(500).json({ error: "ШІ не зміг згенерувати обкладинку. Спробуйте ще раз." });
    }
});

// Функція для стиснення аудіо
function compressAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioBitrate('32k')       // Дуже низький бітрейт (вистачить для голосу)
            .audioChannels(1)          // Моно (робить файл вдвічі меншим)
            .audioFrequency(16000)     // Знижуємо частоту
            .toFormat('mp3')           // Конвертуємо в легкий mp3
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .save(outputPath);
    });
}

// ==========================================
// WHISPER (ЗІ СТИСНЕННЯМ ФОРМАТУ ТА БЕЗ ЧИТАННЯ ТЕКСТУ)
// ==========================================
app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    let compressedPath = null;
    
    try {
        if (!GROQ_API_KEY) return res.status(500).json({ error: "Ключ Groq API не налаштовано!" });
        if (!req.file) return res.status(400).json({ error: "Аудіофайл не отримано." });

        // 1. Стискаємо файл перед відправкою (щоб не було тайм-аутів і перевищень ліміту)
        compressedPath = req.file.path + '_compressed.mp3';
        console.log("Починаю стиснення файлу...");
        await compressAudio(req.file.path, compressedPath);
        console.log("Файл успішно стиснуто!");

        // 2. Готуємо дані для Whisper
        const formData = new FormData();
        formData.append('file', fs.createReadStream(compressedPath), 'audio.mp3');
        formData.append('model', 'whisper-large-v3'); 
        formData.append('response_format', 'verbose_json'); 
        formData.append('language', 'uk'); // Тільки українська
        formData.append('temperature', '0.0'); // Без галюцинацій
        
        // Я ПРИБРАВ prompt (читання тексту), як ти і просив. 
        // Тепер ШІ просто слухає аудіо і видає текст.

        console.log("Відправляю стиснутий файл на Groq...");
        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() },
            maxBodyLength: Infinity,
            timeout: 60000 // 60 секунд має вистачити з головою для стиснутого файлу
        });

        // 3. Видаляємо тимчасові файли
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);

        let lrcText = "";
        
        if (response.data.segments) {
            response.data.segments.forEach(seg => {
                let text = seg.text.trim();
                
                // Жорсткий фільтр сміття
                const isTooShort = text.length <= 2;
                const hasArabic = /[\u0600-\u06FF]/.test(text);
                const isRepeatingChar = /^(.)\1+$/.test(text.replace(/\s/g, ''));
                const isMusicMarker = text.toLowerCase() === "музика" || text.toLowerCase() === "програш" || text === "Ооо";

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
        // Зачищаємо сліди при помилці
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
        
        console.error("Whisper Error:", error.message);
        let errorMessage = "Помилка розпізнавання.";
        if (error.code === 'ECONNABORTED') errorMessage = "Час очікування вийшов.";
        else if (error.response) errorMessage = `Сервер відхилив запит (${error.response.status}).`;
        
        res.status(500).json({ error: errorMessage });
    }
});

cron.schedule('0 10 * * *', async () => { /* Функція крон-джобів */ });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));