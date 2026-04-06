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

// УРЛИ ГУГЛ-СКРИПТІВ
const MUSIC_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzjzr5afDgy4pAWlwKVsatYaAK4JZC6c7itGdJaeScLCp-2iZP4PZ-8j_Kid7t0jIw/exec";
const SUBS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyiNvM7G8qf2JsBFVrII76c8WafveUvK1GXynFeAOV9wNXBX9fvWXz5iyu-9WrQ_DT2/exec";

// НАЛАШТУВАННЯ
const BACKEND_URL = "https://andreygerc11-music-site.onrender.com"; 
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN; 
const MONO_TOKEN = process.env.MONO_TOKEN; 
const TELEGRAM_CHAT_ID = "556627059"; 

// КЛЮЧІ ДЛЯ ШІ
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
    } catch (error) { console.error("Помилка Моно:", error.response?.data || error.message); res.status(500).json({ error: "Не вдалося створити платіж" }); }
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
    } catch (error) { console.error("Помилка Моно Підписка:", error.response?.data || error.message); res.status(500).json({ error: "Не вдалося створити підписку" }); }
});

app.post('/api/webhook', async (req, res) => {
    const paymentData = req.body;
    console.log("Отримано Вебхук:", paymentData.reference, paymentData.status);
    
    if (paymentData.status === 'success') {
        const refParts = paymentData.reference.split('|');
        const ref = refParts[0];
        const email = refParts[1] || '';

        if (ref.startsWith('sub_')) {
            const nextDate = new Date(); nextDate.setDate(nextDate.getDate() + 5); 
            await axios.post(SUBS_SCRIPT_URL, { action: "new_sub", subId: ref, walletId: paymentData.walletId, nextPaymentDate: nextDate.toISOString().split('T')[0], email: email });
            await sendTelegramMessage(`🔥 <b>НОВА ПІДПИСКА!</b>\n📧 Юзер: ${email}\nНаступне списання: ${nextDate.toISOString().split('T')[0]}`);
        } 
        else if (ref.startsWith('ren_')) { await sendTelegramMessage(`💸 <b>АВТОМАТИЧНЕ СПИСАННЯ УСПІШНЕ!</b>\nЮзер подовжив підписку.`); }
        else { await sendTelegramMessage(`✅ <b>Оплата за пісню!</b>\nID файлу: <code>${ref}</code>`); }
    }
    res.status(200).send('OK');
});


// ==========================================
// ГЕНЕРАЦІЯ ЗОБРАЖЕНЬ (ОНОВЛЕНО ДО IMAGEN 4)
// ==========================================
app.post('/api/generate-image', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) {
            console.error("Критична помилка: GEMINI_API_KEY не знайдено!");
            return res.status(500).json({ error: "Ключ Gemini не налаштовано на сервері" });
        }

        const { title, lyrics, format, customPrompt } = req.body;
        
        let aspectRatio = "1:1"; 
        if (format === 'vertical' || format === 'portrait') aspectRatio = "9:16"; 
        if (format === 'horizontal' || format === 'cinema') aspectRatio = "16:9";

        let finalSubject = "";
        if (customPrompt && customPrompt.length > 2) {
            finalSubject = `Subject: ${customPrompt}.`;
        } else {
            let safeText = lyrics ? lyrics.substring(0, 50).replace(/[\n\r]/g, ' ') : "";
            finalSubject = `Theme: ${title}. Vibe based on: ${safeText}.`;
        }

        let aiPrompt = `A stunning hyper-realistic background image. Cinematic lighting, highly detailed, 8k. NO text, NO words, NO letters. Subject matter: ${finalSubject}`;
        
        console.log(`Відправляю промпт до Gemini Imagen 4: [${aiPrompt}]`);

        // СТУКАЄМО В НОВІ ДВЕРІ: imagen-4.0-generate-001
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GEMINI_API_KEY}`, {
            instances: [ { prompt: aiPrompt } ],
            parameters: { sampleCount: 1, aspectRatio: aspectRatio }
        }, { headers: { 'Content-Type': 'application/json' } });

        if (response.data && response.data.predictions && response.data.predictions[0] && response.data.predictions[0].bytesBase64Encoded) {
            const base64Image = response.data.predictions[0].bytesBase64Encoded;
            res.json({ imageUrl: `data:image/jpeg;base64,${base64Image}` });
        } else {
            console.error("Неочікувана структура відповіді:", JSON.stringify(response.data));
            throw new Error("Неочікувана структура відповіді від ШІ");
        }

    } catch (error) {
        console.error("--- ПОМИЛКА ГЕНЕРАЦІЇ ШІ ---");
        console.error("Повідомлення:", error.message);
        
        if (error.response && error.response.data) {
            console.error("ДЕТАЛІ ВІД GOOGLE:", JSON.stringify(error.response.data));
            if (error.response.status === 400) {
                return res.status(500).json({ error: "ШІ заблокував запит. Спробуйте написати щось просте у поле 'Свій опис для ШІ'." });
            }
        }
        res.status(500).json({ error: "Внутрішня помилка сервера при генерації." });
    }
});


// ==========================================
// АВТО-СИНХРОНІЗАЦІЯ ТЕКСТУ (WHISPER ЧЕРЕЗ GROQ)
// ==========================================
app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    try {
        if (!GROQ_API_KEY) return res.status(500).json({ error: "Ключ Groq API не налаштовано на сервері!" });
        if (!req.file) return res.status(400).json({ error: "Аудіофайл не отримано сервером." });

        const formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path), req.file.originalname);
        formData.append('model', 'whisper-large-v3'); 
        formData.append('response_format', 'verbose_json'); 

        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() },
            maxBodyLength: Infinity
        });

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

// КРОН-ДЖОБ
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