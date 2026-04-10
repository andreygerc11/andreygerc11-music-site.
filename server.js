const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: '/tmp/', limits: { fileSize: 50 * 1024 * 1024 } });

// === ЗМІННІ ОТОЧЕННЯ ===
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MONO_TOKEN = process.env.MONO_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL;

// === TELEGRAM БОТ ===
async function sendTelegramMessage(text) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (e) { console.error("Помилка Telegram:", e.message); }
}

// === БАЗА ДАНИХ (GOOGLE SHEETS) ===
app.post('/api/register', async (req, res) => {
    try { const response = await axios.post(GOOGLE_SHEETS_URL, { action: 'register', ...req.body }); res.json(response.data); } 
    catch (e) { res.status(500).json({ error: "Помилка реєстрації" }); }
});

app.post('/api/login', async (req, res) => {
    try { const response = await axios.post(GOOGLE_SHEETS_URL, { action: 'login', ...req.body }); res.json(response.data); } 
    catch (e) { res.status(500).json({ error: "Помилка входу" }); }
});

// === ОПЛАТА MONOBANK ===
app.post('/api/pay-subscription', async (req, res) => {
    try {
        const { email, amount } = req.body;
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: amount || 5000,
            ccy: 980,
            merchantPaymInfo: { destination: "Підтримка проєкту 'Голос проти раку'", comment: email },
            redirectUrl: "https://golos-proty-raku.pp.ua/success.html",
            webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ pageUrl: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка створення платежу" }); }
});

app.post('/api/webhook', async (req, res) => {
    try {
        const { invoiceId, status, reference } = req.body;
        if (status === 'success') {
            await axios.post(GOOGLE_SHEETS_URL, { action: 'update_sub', invoiceId, status });
            await sendTelegramMessage(`🔥 <b>Новий донат/підписка!</b>\nСтатус: Оплачено\nEmail: ${reference}`);
        }
        res.status(200).send("OK");
    } catch (e) { res.status(500).send("Webhook Error"); }
});

// === ГЕНЕРАЦІЯ ОБКЛАДИНКИ ЗА ВІРШЕМ (GROQ + GEMINI) ===
app.post('/api/generate-image', async (req, res) => {
    try {
        const { lyrics, format, customPrompt } = req.body;
        
        let aspectRatio = "1:1";
        if (format === 'vertical') aspectRatio = "9:16";
        else if (format === 'horizontal') aspectRatio = "16:9";
        else if (format === 'portrait') aspectRatio = "3:4";
        else if (format === 'cinema') aspectRatio = "21:9";
        
        // ВИПРАВЛЕННЯ: Жорстке очищення тексту від символів, які ламають JSON
        let textToAnalyze = customPrompt || lyrics || "Beautiful cinematic background";
        textToAnalyze = textToAnalyze.substring(0, 800); // Обрізаємо, щоб не перевантажувати запит
        const safeText = textToAnalyze.replace(/[\r\n\t"']/g, " ").replace(/[^a-zA-Zа-яА-ЯіїєґІЇЄҐ0-9 \.,!?-]/g, "");

        const promptContent = `Analyze the following song lyrics: "${safeText}". Based on the mood, atmosphere, and imagery of these lyrics, write ONE short sentence in English describing a visual scene for a background image. NO TEXT ON IMAGE. Cinematic style.`;

        let finalPrompt = "";
        try {
            const groqPromptRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: 'llama3-8b-8192',
                messages: [{ role: 'user', content: promptContent }]
            }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
            
            finalPrompt = groqPromptRes.data.choices[0].message.content.trim();
            console.log("Успішно проаналізовано через Groq:", finalPrompt);
        } catch (groqError) {
            console.error("Аналіз пісні не вдався (Groq Llama API Error):", groqError.response ? groqError.response.data : groqError.message);
            // Надійний запасний варіант без проблемного тексту
            finalPrompt = "Abstract cinematic background, elegant lighting, highly detailed.";
        }

        const fullGeminiPrompt = `${finalPrompt}. Aspect ratio: ${aspectRatio}. ABSOLUTELY NO TEXT, NO LETTERS, NO TITLES ON IMAGE. Cinematic lighting, highly detailed, 8k resolution.`;
        console.log("Промпт до художника:", fullGeminiPrompt);

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: fullGeminiPrompt }] }], generationConfig: { responseModalities: ["IMAGE"] } }
        );

        const part = response.data.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
        if (part) {
            const data = part.inlineData || part.inline_data;
            return res.json({ imageUrl: `data:${data.mimeType};base64,${data.data}` });
        }
        throw new Error("Не вдалося згенерувати зображення (відповідь не містить даних).");
    } catch (error) { 
        console.error("--- ПОМИЛКА ГЕНЕРАЦІЇ ЗОБРАЖЕННЯ ---", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Помилка генерації фону" }); 
    }
});

// === СИНХРОНІЗАЦІЯ ТЕКСТУ (WHISPER) ===
function compressAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath).audioBitrate('32k').audioChannels(1).audioFrequency(16000).toFormat('mp3')
            .on('end', () => resolve(outputPath)).on('error', reject).save(outputPath);
    });
}

app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    let compressedPath = null;
    try {
        if (!req.file) return res.status(400).json({ error: "Аудіофайл не отримано." });
        
        compressedPath = req.file.path + '_compressed.mp3';
        await compressAudio(req.file.path, compressedPath);

        const formData = new FormData();
        formData.append('file', fs.createReadStream(compressedPath), 'audio.mp3');
        formData.append('model', 'whisper-large-v3'); 
        formData.append('response_format', 'verbose_json'); 
        formData.append('temperature', '0'); 
        
        // ВИПРАВЛЕННЯ: Ми ПОВНІСТЮ видалили параметр prompt.
        // Передача інструкцій (типу "Ignore Russian") у prompt викликає помилку 400 Bad Request від Whisper API.
        // Мову Whisper визначить сам, а фільтрацію ми зробимо в JavaScript нижче.

        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() },
            maxBodyLength: Infinity,
            timeout: 120000
        });

        let lrcText = "";
        if (response.data.segments) {
            response.data.segments.forEach(seg => {
                let text = seg.text.trim();
                
                // ЖОРСТКІ ФІЛЬТРИ ДЛЯ ВІДСІКАННЯ СМІТТЯ ТА РОСІЙСЬКОЇ МОВИ
                const isTooShort = text.length <= 2;
                const hasArabic = /[\u0600-\u06FF]/.test(text);
                const hasRussian = /[ыЫэЭъЪёЁ]/.test(text); // <-- Блокування російської
                const isRepeatingChar = /^(.)\1+$/.test(text.replace(/\s/g, ''));
                const isMusicMarker = text.toLowerCase().includes("музика") || text.toLowerCase().includes("програш");

                if (!isTooShort && !hasArabic && !hasRussian && !isRepeatingChar && !isMusicMarker) {
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
        console.error("Whisper Error:", error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(500).json({ error: "Помилка розпізнавання." });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Сервер працює на порту ${PORT}`); });