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

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MONO_TOKEN = process.env.MONO_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL; // Твій скрипт, який керує і юзерами, і музикою на G-Drive

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

// === РЕЄСТРАЦІЯ ТА ЛОГІН (ЧЕРЕЗ APPS SCRIPT) ===
app.post('/api/register', async (req, res) => {
    try { 
        if (!GOOGLE_SHEETS_URL) throw new Error("GOOGLE_SHEETS_URL не налаштовано!");
        const response = await axios.post(GOOGLE_SHEETS_URL, { action: 'register', ...req.body }); 
        res.json(response.data); 
    } 
    catch (e) { res.status(500).json({ error: "Помилка реєстрації" }); }
});

app.post('/api/login', async (req, res) => {
    try { 
        if (!GOOGLE_SHEETS_URL) throw new Error("GOOGLE_SHEETS_URL не налаштовано!");
        const response = await axios.post(GOOGLE_SHEETS_URL, { action: 'login', ...req.body }); 
        res.json(response.data); 
    } 
    catch (e) { res.status(500).json({ error: "Помилка входу" }); }
});

// === ЗАВАНТАЖЕННЯ ПІСЕНЬ З GOOGLE DRIVE ===
app.get('/api/music', async (req, res) => {
    try {
        if (!GOOGLE_SHEETS_URL) throw new Error("GOOGLE_SHEETS_URL не налаштовано!");
        
        // Звертаємось до Apps Script, щоб він віддав список треків з Google Drive
        const response = await axios.get(`${GOOGLE_SHEETS_URL}?action=getMusic`);
        res.json(response.data);
    } catch (error) {
        console.error("Помилка завантаження пісень з Apps Script:", error.message);
        res.status(500).json({ error: "Не вдалося завантажити музику з Google Drive." });
    }
});

// === ОПЛАТА ПІДПИСКИ PRO (39 грн) ===
app.post('/api/pay-subscription', async (req, res) => {
    try {
        const { email } = req.body;
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3900, 
            ccy: 980,
            merchantPaymInfo: { 
                destination: "Підписка Hertz Spectrum PRO (39 грн / 5 днів)", 
                comment: email || "PRO Підписка" 
            },
            redirectUrl: "https://golos-proty-raku.pp.ua/success.html",
            webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        
        res.json({ url: monoRes.data.pageUrl, pageUrl: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка створення платежу" }); }
});

// === ОПЛАТА ОКРЕМОГО ТРЕКУ (37.36 грн) ===
app.post('/api/pay', async (req, res) => {
    try {
        const { songId, songName } = req.body;
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3736, 
            ccy: 980,
            merchantPaymInfo: { 
                destination: `Придбання треку: ${songName}`, 
                reference: songId 
            },
            redirectUrl: "https://golos-proty-raku.pp.ua/success.html",
            webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        
        res.json({ url: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка створення платежу" }); }
});

// === ВЕБХУК МОНОБАНКУ ===
app.post('/api/webhook', async (req, res) => {
    try {
        const { invoiceId, status, reference } = req.body;
        if (status === 'success') {
            await axios.post(GOOGLE_SHEETS_URL, { action: 'update_sub', invoiceId, status });
            await sendTelegramMessage(`🔥 <b>Новий донат/оплата!</b>\nСтатус: Оплачено\nДеталі: ${reference}`);
        }
        res.status(200).send("OK");
    } catch (e) { res.status(500).send("Webhook Error"); }
});

// === ГЕНЕРАЦІЯ ОБКЛАДИНКИ ===
app.post('/api/generate-image', async (req, res) => {
    try {
        const { lyrics, format, customPrompt } = req.body;
        let width = 1080, height = 1920;
        if (format === 'horizontal') { width = 1920; height = 1080; }
        else if (format === 'square') { width = 1080; height = 1080; }
        else if (format === 'portrait') { width = 1080; height = 1350; }
        else if (format === 'cinema') { width = 2560; height = 1080; }

        let rawText = (customPrompt || lyrics || "").substring(0, 1500);
        rawText = rawText.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
        
        let finalPrompt = "Beautiful cinematic background, highly detailed.";

        if (rawText.length > 10) {
            try {
                const promptContent = `Analyze the following lyrics and write EXACTLY ONE short sentence in English describing a visual background scene. Capture the true emotional core (e.g., if it's a birthday, show warm spring celebration vibes, absolutely NO winter or Christmas). NO TEXT ON IMAGE. Lyrics: ${rawText}`;
                
                const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: 'llama-3.1-8b-instant', 
                    messages: [{ role: 'user', content: promptContent }],
                    temperature: 0.2
                }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } });
                
                if (groqRes.data.choices && groqRes.data.choices[0]) {
                    finalPrompt = groqRes.data.choices[0].message.content.trim();
                }
            } catch (e) {
                finalPrompt = "Beautiful atmospheric cinematic background, spring vibes.";
            }
        }

        finalPrompt = finalPrompt.replace(/[^a-zA-Z0-9 \.,!?-]/g, "");
        const fullPrompt = `${finalPrompt}, highly detailed, 8k resolution, cinematic lighting, masterpiece, no text, no letters.`;
        
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=${width}&height=${height}&nologo=true&seed=${Math.floor(Math.random()*100000)}`;
        res.json({ imageUrl: imageUrl });

    } catch (error) { 
        res.status(500).json({ error: "Помилка формування запиту" }); 
    }
});

// === СТУДІЙНИЙ ФІЛЬТР ЗВУКУ (ДЛЯ ШІ) ===
function compressAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioChannels(1) 
            .audioFrequency(16000) 
            .audioBitrate('64k') 
            .audioFilters([
                'highpass=f=100',  
                'lowpass=f=5000',  
                'volume=2.0',      
                'acompressor=threshold=-20dB:ratio=4:makeup=5' 
            ])
            .toFormat('mp3')
            .on('end', () => resolve(outputPath))
            .on('error', reject)
            .save(outputPath);
    });
}

// === СИНХРОНІЗАЦІЯ ТЕКСТУ (WHISPER) ===
app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    let compressedPath = null;
    try {
        if (!req.file) return res.status(400).json({ error: "Аудіо не отримано" });
        compressedPath = req.file.path + '_comp.mp3';
        
        await compressAudio(req.file.path, compressedPath);

        const formData = new FormData();
        formData.append('file', fs.createReadStream(compressedPath));
        formData.append('model', 'whisper-large-v3');
        formData.append('response_format', 'verbose_json');
        formData.append('language', 'uk'); 
        formData.append('temperature', '0');

        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() },
            maxBodyLength: Infinity,
            timeout: 120000
        });

        let lrc = "";
        if (response.data.segments) {
            response.data.segments.forEach(seg => {
                let text = seg.text.trim();
                if (text.length > 1 && !/[ыЫэЭъЪёЁ]/.test(text)) {
                    let d = new Date(seg.start * 1000);
                    let m = String(d.getUTCMinutes()).padStart(2, '0');
                    let s = String(d.getUTCSeconds()).padStart(2, '0');
                    let ms = String(Math.floor(d.getUTCMilliseconds() / 10)).padStart(2, '0');
                    lrc += `[${m}:${s}.${ms}] ${text}\n`;
                }
            });
        }
        res.json({ lrc });
    } catch (error) {
        console.error("Whisper Error:", error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(500).json({ error: "Помилка Whisper" });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Порт: ${PORT}`); });