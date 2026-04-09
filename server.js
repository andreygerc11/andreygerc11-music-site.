const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => {
        const ext = file.originalname.includes('.') ? file.originalname.split('.').pop() : 'mp3';
        cb(null, `${Date.now()}_original.${ext}`);
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } });

const BACKEND_URL = "https://andreygerc11-music-site.onrender.com";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MONO_TOKEN = process.env.MONO_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Введіть email та пароль" });
        const response = await axios.post(GOOGLE_SCRIPT_URL, { action: "register", email, password });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Помилка сервера при реєстрації" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Введіть email та пароль" });
        const response = await axios.post(GOOGLE_SCRIPT_URL, { action: "login", email, password });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Помилка сервера при вході" });
    }
});

app.post('/api/pay-subscription', async (req, res) => {
    try {
        if (!MONO_TOKEN) throw new Error("Відсутній MONO_TOKEN");
        const { email } = req.body;
        const amount = 3900;
        const monoReq = {
            amount: amount,
            ccy: 980,
            merchantPaymInfo: {
                reference: `sub_${email}_${Date.now()}`,
                destination: `Підписка PRO (5 днів) для ${email || 'користувача'}`
            },
            redirectUrl: `${BACKEND_URL}/success.html`,
            webHookUrl: `${BACKEND_URL}/api/mono-webhook`
        };
        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', monoReq, {
            headers: { 'X-Token': MONO_TOKEN }
        });
        res.json({ url: response.data.pageUrl, invoiceId: response.data.invoiceId });
    } catch (error) {
        res.status(500).json({ error: "Помилка створення платежу" });
    }
});

app.post('/api/pay', async (req, res) => {
    try {
        if (!MONO_TOKEN) throw new Error("Відсутній MONO_TOKEN");
        const { email, trackId } = req.body;
        const amount = 3736;
        const monoReq = {
            amount: amount,
            ccy: 980,
            merchantPaymInfo: {
                reference: `track_${trackId}_${Date.now()}`,
                destination: `Купівля треку для ${email || 'користувача'}`
            },
            redirectUrl: `${BACKEND_URL}/success.html`,
            webHookUrl: `${BACKEND_URL}/api/mono-webhook`
        };
        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', monoReq, {
            headers: { 'X-Token': MONO_TOKEN }
        });
        res.json({ url: response.data.pageUrl });
    } catch (error) {
        res.status(500).json({ error: "Помилка створення платежу" });
    }
});

app.post('/api/mono-webhook', async (req, res) => {
    try {
        const { invoiceId, status, reference } = req.body;
        if (status === 'success' && reference && reference.startsWith('sub_')) {
            const email = reference.split('_')[1];
            const nextDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
            await axios.post(GOOGLE_SCRIPT_URL, {
                action: "new_sub", subId: invoiceId, walletId: "monobank", nextPaymentDate: nextDate, email: email
            });
        }
        res.status(200).send('OK');
    } catch (error) {
        res.status(200).send('OK');
    }
});

app.post('/api/generate-image', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) return res.status(500).json({ error: "Ключ Gemini" });
        const { lyrics, format, customPrompt } = req.body;
        let aspectRatio = "1:1";
        if (format === 'vertical' || format === 'portrait') aspectRatio = "9:16";
        if (format === 'horizontal' || format === 'cinema') aspectRatio = "16:9";
        let safeVisualDescription = "abstract cinematic background, elegant lighting, 8k resolution, empty background";
        if (customPrompt && customPrompt.length > 2) {
            safeVisualDescription = customPrompt;
        } else if (lyrics && lyrics.length > 5) {
            try {
                if (!GROQ_API_KEY) throw new Error("Немає ключа Groq");
                const textResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: 'llama3-8b-8192',
                    messages: [{ role: 'user', content: `Read this: "${lyrics.substring(0, 300)}". Create ONE SENTENCE describing a background image for this song. NO TEXT ON IMAGE. NO LETTERS.` }]
                }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                if (textResponse.data && textResponse.data.choices) safeVisualDescription = textResponse.data.choices[0].message.content.trim();
            } catch (e) {
                console.log("Помилка Groq");
            }
        }
        let aiPrompt = `Create an album cover. Visual scene: ${safeVisualDescription}. NO TEXT, NO LETTERS, NO WATERMARKS.`;
        const generateResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${GEMINI_API_KEY}`,
            { instances: [{ prompt: aiPrompt }], parameters: { sampleCount: 1, aspectRatio: aspectRatio } },
            { headers: { 'Content-Type': 'application/json' } }
        );
        if (generateResponse.data && generateResponse.data.predictions && generateResponse.data.predictions.length > 0) {
            const base64Image = generateResponse.data.predictions[0].bytesBase64Encoded;
            const mimeType = generateResponse.data.predictions[0].mimeType || "image/jpeg";
            return res.json({ imageUrl: `data:${mimeType};base64,${base64Image}` });
        }
        throw new Error("Зображення не знайдено");
    } catch (error) {
        res.status(500).json({ error: "Не вдалося згенерувати ШІ-фон." });
    }
});

function compressAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioBitrate('32k').audioChannels(1).audioFrequency(16000).toFormat('mp3')
            .on('end', () => resolve(outputPath)).on('error', (err) => reject(err)).save(outputPath);
    });
}

app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    let compressedPath = null;
    try {
        if (!GROQ_API_KEY) return res.status(500).json({ error: "Ключ Groq API не налаштовано!" });
        if (!req.file) return res.status(400).json({ error: "Аудіофайл не отримано." });
        compressedPath = req.file.path + '_compressed.mp3';
        await compressAudio(req.file.path, compressedPath);
        const formData = new FormData();
        formData.append('file', fs.createReadStream(compressedPath), 'audio.mp3');
        formData.append('model', 'whisper-large-v3');
        formData.append('response_format', 'verbose_json');
        formData.append('language', 'uk');
        formData.append('temperature', '0.0');
        formData.append('condition_on_previous_text', 'false');
        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() },
            maxBodyLength: Infinity, timeout: 60000
        });
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
        let lrcText = "";
        if (response.data.segments) {
            response.data.segments.forEach(seg => {
                let text = seg.text.trim();
                if (text.length > 0) {
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
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
        res.status(500).json({ error: "Помилка розпізнавання." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));