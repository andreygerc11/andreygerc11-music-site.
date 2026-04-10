const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: '/tmp/', limits: { fileSize: 25 * 1024 * 1024 } });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MONO_TOKEN = process.env.MONO_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL;

async function sendTelegramMessage(text) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (e) {}
}

app.post('/api/register', async (req, res) => {
    try { const response = await axios.post(GOOGLE_SHEETS_URL, { action: 'register', ...req.body }); res.json(response.data); } 
    catch (e) { res.status(500).json({ error: "Помилка реєстрації" }); }
});

app.post('/api/login', async (req, res) => {
    try { const response = await axios.post(GOOGLE_SHEETS_URL, { action: 'login', ...req.body }); res.json(response.data); } 
    catch (e) { res.status(500).json({ error: "Помилка входу" }); }
});

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

app.post('/api/generate-image', async (req, res) => {
    try {
        const { lyrics, format, customPrompt } = req.body;
        
        let width = 1080; let height = 1080;
        if (format === 'vertical') { width = 1080; height = 1920; }
        else if (format === 'horizontal') { width = 1920; height = 1080; }
        else if (format === 'portrait') { width = 1080; height = 1350; }
        else if (format === 'cinema') { width = 2560; height = 1080; }
        
        let textToAnalyze = customPrompt || lyrics || "Beautiful cinematic background";
        textToAnalyze = textToAnalyze.substring(0, 300).replace(/[^a-zA-Zа-яА-ЯіїєґІЇЄҐ0-9 ]/g, " ");

        let finalPrompt = "Abstract cinematic background, elegant lighting, highly detailed.";
        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: 'llama3-8b-8192',
                messages: [{ role: 'user', content: `Translate to English and write ONE short sentence describing a background image for this song: "${textToAnalyze}". NO TEXT ON IMAGE.` }]
            }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
            
            if (groqRes.data.choices && groqRes.data.choices.length > 0) {
                finalPrompt = groqRes.data.choices[0].message.content.trim();
            }
        } catch (e) {
            console.error("Groq Llama Error:", e.response ? e.response.data : e.message);
        }

        const fullPrompt = `${finalPrompt}, highly detailed, 8k resolution, cinematic lighting, no text, no letters.`;
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=${width}&height=${height}&nologo=true`;
        
        const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
        const base64 = Buffer.from(imageRes.data, 'binary').toString('base64');
        
        res.json({ imageUrl: `data:image/jpeg;base64,${base64}` });

    } catch (error) { 
        console.error("Image Gen Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Помилка генерації фону" }); 
    }
});

app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Аудіофайл не отримано." });

        const formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path), {
            filename: req.file.originalname || 'audio.mp3',
            contentType: req.file.mimetype || 'audio/mpeg'
        });
        formData.append('model', 'whisper-large-v3'); 
        formData.append('response_format', 'verbose_json'); 

        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 120000
        });

        let lrcText = "";
        if (response.data.segments) {
            response.data.segments.forEach(seg => {
                let text = seg.text.trim();
                
                const isTooShort = text.length <= 2;
                const hasArabic = /[\u0600-\u06FF]/.test(text);
                const hasRussian = /[ыЫэЭъЪёЁ]/.test(text);
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
        console.error("Whisper Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Помилка розпізнавання." });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Сервер працює на порту ${PORT}`); });