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

// Налаштування для тимчасового збереження аудіофайлів
const upload = multer({ dest: '/tmp/' });

const MUSIC_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzjzr5afDgy4pAWlwKVsatYaAK4JZC6c7itGdJaeScLCp-2iZP4PZ-8j_Kid7t0jIw/exec";
const SUBS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyiNvM7G8qf2JsBFVrII76c8WafveUvK1GXynFeAOV9wNXBX9fvWXz5iyu-9WrQ_DT2/exec";

const BACKEND_URL = "https://andreygerc11-music-site.onrender.com"; 
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN; 
const MONO_TOKEN = process.env.MONO_TOKEN; 
const TELEGRAM_CHAT_ID = "556627059"; 

// КЛЮЧІ ДЛЯ ШІ
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const GROQ_API_KEY = process.env.GROQ_API_KEY; 

async function sendTelegramMessage(text) {
    if (!TELEGRAM_BOT_TOKEN) return;
    try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'HTML' }); } catch (e) {}
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
        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3736, ccy: 980, redirectUrl: `https://golos-proty-raku.pp.ua/success.html?file=${songId}`, webHookUrl: `${BACKEND_URL}/api/webhook`, 
            merchantPaymInfo: { reference: songId, destination: `Оплата за трек: ${songName}` }
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: response.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Не вдалося створити платіж" }); }
});

app.post('/api/pay-subscription', async (req, res) => {
    try {
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
        const refRaw = paymentData.reference;
        const refParts = refRaw.split('|');
        const ref = refParts[0];
        const email = refParts[1] || '';

        if (ref.startsWith('sub_')) {
            const nextDate = new Date(); nextDate.setDate(nextDate.getDate() + 5); 
            await axios.post(SUBS_SCRIPT_URL, { action: "new_sub", subId: ref, walletId: paymentData.walletId, nextPaymentDate: nextDate.toISOString().split('T')[0], email: email });
            await sendTelegramMessage(`🔥 <b>НОВА ПІДПИСКА!</b>\n📧 Юзер: ${email}\nНаступне списання: ${nextDate.toISOString().split('T')[0]}`);
        } 
        else if (ref.startsWith('ren_')) { await sendTelegramMessage(`💸 <b>АВТОМАТИЧНЕ СПИСАННЯ УСПІШНЕ!</b>\nПідписку подовжено.`); }
        else { await sendTelegramMessage(`✅ <b>Оплата за пісню!</b>\nID: <code>${ref}</code>`); }
    }
    res.status(200).send('OK');
});

// ГЕНЕРАЦІЯ ЗОБРАЖЕНЬ (GEMINI)
app.post('/api/generate-image', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) return res.status(500).json({ error: "Ключ Gemini не налаштовано на сервері" });

        const { title, lyrics, format, customPrompt } = req.body;
        
        let aspectRatio = "1:1"; 
        if (format === 'vertical' || format === 'portrait') aspectRatio = "9:16"; 
        if (format === 'horizontal' || format === 'cinema') aspectRatio = "16:9";

        let aiPrompt = "";
        if (customPrompt && customPrompt.length > 2) {
            aiPrompt = `Hyper-realistic cinematic background image. IMPORTANT: NO text, NO words, NO letters. Subject: ${customPrompt}. Cinematic lighting, highly detailed, 8k resolution masterpiece.`;
        } else {
            aiPrompt = `Hyper-realistic cinematic background image. IMPORTANT: NO text, NO words, NO letters. Atmospheric and emotional setting perfectly matching the Ukrainian song "${title}". Poem snippet: "${lyrics ? lyrics.substring(0, 300) : title}". Cinematic lighting, highly detailed, 8k resolution masterpiece.`;
        }

        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-images:predict?key=${GEMINI_API_KEY}`, {
            instances: [ { prompt: aiPrompt } ],
            parameters: { sampleCount: 1, aspectRatio: aspectRatio }
        }, { headers: { 'Content-Type': 'application/json' } });

        const base64Image = response.data.predictions[0].bytesBase64Encoded;
        const imageUrl = `data:image/jpeg;base64,${base64Image}`;

        res.json({ imageUrl: imageUrl });
    } catch (error) {
        console.error("Помилка генерації Google Imagen:", error.response?.data || error.message);
        res.status(500).json({ error: "Не вдалося згенерувати зображення. Можливо, текст порушує правила безпеки." });
    }
});

// АВТО-СИНХРОНІЗАЦІЯ ТЕКСТУ (WHISPER ЧЕРЕЗ GROQ)
app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    try {
        if (!GROQ_API_KEY) return res.status(500).json({ error: "Ключ Groq API не налаштовано на сервері!" });
        if (!req.file) return res.status(400).json({ error: "Аудіофайл не отримано сервером." });

        // Формуємо дані для відправки на Groq
        const formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path), req.file.originalname);
        formData.append('model', 'whisper-large-v3'); // Найкраща модель розпізнавання
        formData.append('response_format', 'verbose_json'); // Щоб отримати таймкоди

        // Відправляємо запит до Groq
        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                ...formData.getHeaders()
            },
            maxBodyLength: Infinity
        });

        // Обов'язково видаляємо аудіофайл з нашого сервера після відправки, щоб пам'ять не забивалася
        fs.unlinkSync(req.file.path);

        const segments = response.data.segments;
        let lrcText = "";
        
        // Збираємо LRC текст з таймкодами
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
        // Якщо сталася помилка, все одно видаляємо файл
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error("Помилка Whisper Groq:", error.response?.data || error.message);
        res.status(500).json({ error: "ШІ не зміг розпізнати пісню. Можливо файл завеликий (ліміт ~25MB)." });
    }
});

cron.schedule('0 10 * * *', async () => {
    if (!MONO_TOKEN) return;
    try {
        const response = await axios.get(`${SUBS_SCRIPT_URL}?action=getSubs`);
        const subs = response.data;
        const today = new Date().toISOString().split('T')[0];

        for (let sub of subs) {
            if (sub.Status === 'active' && sub.NextPaymentDate && sub.NextPaymentDate <= today) {
                try {
                    await axios.post('https://api.monobank.ua/api/merchant/wallet/payment', {
                        walletId: sub.WalletId, amount: 19900, ccy: 980, reference: 'ren_' + sub.SubID + '_' + Date.now(), destination: "Місячна підписка Hertz Spectrum"
                    }, { headers: { 'X-Token': MONO_TOKEN } });

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