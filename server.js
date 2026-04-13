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

// Змінні з Render
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MONO_TOKEN = process.env.MONO_TOKEN;
const BOT_TOKEN = process.env.BOT_TOKEN; 
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL; 
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "ТВІЙ_ID_ЯКЩО_НЕ_ДОДАВ_У_RENDER";

// Твої ID папок
const PREVIEW_FOLDER_ID = "1Vmwzr3kt98gDYIOaPTsZ0f6FwqcOMQ7S"; 
const FULL_FOLDER_ID = "1FGNuLTq9mFHqoUSqp-7PSKHixZHq3W2j";

async function sendTelegramMessage(text) {
    if (!BOT_TOKEN || !TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID === "ТВІЙ_ID_ЯКЩО_НЕ_ДОДАВ_У_RENDER") return;
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (e) {
        console.error("Помилка Telegram:", e.message);
    }
}

// === РЕЄСТРАЦІЯ ТА ЛОГІН ===
app.post('/api/register', async (req, res) => {
    try { 
        const response = await axios.post(GOOGLE_SHEETS_URL, { action: 'register', ...req.body }); 
        res.json(response.data); 
    } catch (e) { res.status(500).json({ error: "Помилка реєстрації" }); }
});

app.post('/api/login', async (req, res) => {
    try { 
        const response = await axios.post(GOOGLE_SHEETS_URL, { action: 'login', ...req.body }); 
        res.json(response.data); 
    } catch (e) { res.status(500).json({ error: "Помилка входу" }); }
});

// === ОТРИМАННЯ СПИСКУ ПІСЕНЬ ===
app.get('/api/music', async (req, res) => {
    try {
        if (!GOOGLE_API_KEY) throw new Error("Немає GOOGLE_API_KEY");

        const prevRes = await axios.get(`https://www.googleapis.com/drive/v3/files?q='${PREVIEW_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name,createdTime)&key=${GOOGLE_API_KEY}`);
        const fullRes = await axios.get(`https://www.googleapis.com/drive/v3/files?q='${FULL_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&key=${GOOGLE_API_KEY}`);

        const musicList = prevRes.data.files.map(f => {
            const cleanName = f.name.replace(/\.[^/.]+$/, "").replace(" (Прев'ю)", "").trim();
            const fullFile = fullRes.data.files.find(full => full.name.replace(/\.[^/.]+$/, "").trim() === cleanName);
            
            return {
                name: cleanName,
                previewId: f.id,
                fullId: fullFile ? fullFile.id : null,
                date: f.createdTime
            };
        }).filter(m => m.fullId);

        res.json(musicList);
    } catch (error) {
        console.error("Помилка завантаження списку:", error.message);
        res.status(500).json({ error: "Не вдалося завантажити музику" });
    }
});

// === СТРІМІНГ АУДІО (ОБХІД БЛОКУВАННЯ GOOGLE) ===
app.get('/api/stream/:fileId', async (req, res) => {
    try {
        if (!GOOGLE_API_KEY) throw new Error("Немає GOOGLE_API_KEY");
        
        // Сервер сам завантажує медіа-файл з Диску як потік
        const response = await axios({
            method: 'get',
            url: `https://www.googleapis.com/drive/v3/files/${req.params.fileId}?alt=media&key=${GOOGLE_API_KEY}`,
            responseType: 'stream'
        });

        // Віддаємо його браузеру як чистий MP3
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');
        response.data.pipe(res);

    } catch (error) {
        console.error("Помилка стрімінгу:", error.message);
        res.status(500).send("Помилка відтворення");
    }
});

// === ОПЛАТИ ===
app.post('/api/pay-subscription', async (req, res) => {
    try {
        const { email } = req.body;
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3900, 
            ccy: 980,
            merchantPaymInfo: { destination: "Підписка Hertz Spectrum PRO", comment: email },
            redirectUrl: "https://golos-proty-raku.pp.ua/success.html",
            webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка оплати" }); }
});

app.post('/api/pay', async (req, res) => {
    try {
        const { songId, songName } = req.body;
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3736, 
            ccy: 980,
            merchantPaymInfo: { destination: `Трек: ${songName}`, reference: songId },
            redirectUrl: "https://golos-proty-raku.pp.ua/success.html",
            webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка оплати" }); }
});

app.post('/api/webhook', async (req, res) => {
    try {
        const { invoiceId, status, reference } = req.body;
        if (status === 'success') {
            await axios.post(GOOGLE_SHEETS_URL, { action: 'update_sub', invoiceId, status });
            await sendTelegramMessage(`🔥 <b>Нова оплата!</b>\nРеференс: ${reference}`);
        }
        res.status(200).send("OK");
    } catch (e) { res.status(500).send("Error"); }
});

// === WHISPER ТА ГЕНЕРАТОР ===
function compressAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioChannels(1).audioFrequency(16000).audioBitrate('64k')
            .audioFilters(['highpass=f=100', 'lowpass=f=5000', 'volume=2.0', 'acompressor=threshold=-20dB:ratio=4:makeup=5'])
            .toFormat('mp3').on('end', () => resolve(outputPath)).on('error', reject).save(outputPath);
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
        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() }
        });
        res.json({ lrc: response.data.text }); 
    } catch (error) { res.status(500).json({ error: "Whisper Error" }); }
    finally { 
        if (req.file) fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
    }
});

app.post('/api/generate-image', async (req, res) => {
    try {
        const { lyrics, customPrompt } = req.body;
        const prompt = customPrompt || lyrics || "Cinematic background";
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&nologo=true`;
        res.json({ imageUrl });
    } catch (error) { res.status(500).send("Error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Порт: ${PORT}`); });