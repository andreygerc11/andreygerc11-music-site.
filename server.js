const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.json());

// ОСЬ ВАШЕ НОВЕ ПОСИЛАННЯ
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzjzr5afDgy4pAWlwKVsatYaAK4JZC6c7itGdJaeScLCp-2iZP4PZ-8j_Kid7t0jIw/exec";
const BACKEND_URL = "https://andreygerc11-music-site.onrender.com"; 

const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN; 
const MONO_TOKEN = process.env.MONO_TOKEN; 
const TELEGRAM_CHAT_ID = "556627059"; 

async function sendTelegramMessage(text) {
    if (!TELEGRAM_BOT_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error("Помилка відправки в Telegram:", error.message);
    }
}

app.get('/api/music', async (req, res) => {
    try {
        const response = await axios.get(GOOGLE_SCRIPT_URL, { maxRedirects: 5 });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Помилка зв'язку з Google" });
    }
});

app.post('/api/pay', async (req, res) => {
    try {
        const { songId, songName } = req.body;
        if (!MONO_TOKEN) return res.status(500).json({ error: "Токен Монобанку не налаштовано" });

        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3736, // 37.36 грн (щоб чистими було рівно 35 грн)
            ccy: 980,
            redirectUrl: `https://golos-proty-raku.pp.ua/success.html?file=${songId}`,
            webHookUrl: `${BACKEND_URL}/api/webhook`, 
            merchantPaymInfo: {
                reference: songId,
                destination: `Оплата за трек: ${songName}`
            }
        }, {
            headers: { 'X-Token': MONO_TOKEN }
        });
        
        res.json({ url: response.data.pageUrl });
    } catch (error) {
        res.status(500).json({ error: "Не вдалося створити платіж" });
    }
});

app.post('/api/webhook', async (req, res) => {
    const paymentData = req.body;
    if (paymentData.status === 'success') {
        const message = `✅ <b>Успішна оплата на сайті!</b>\n\n🎵 <b>ID пісні:</b> <code>${paymentData.reference}</code>\n💰 <b>Сума:</b> ${(paymentData.amount / 100).toFixed(2)} грн\n\n<i>Гроші на рахунку.</i>`;
        await sendTelegramMessage(message);
    }
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));