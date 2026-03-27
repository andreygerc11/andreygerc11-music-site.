const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.json());

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx-ZZyOgiOwl67Pvypqw2Tej6ylWGFATEPAwqE6zpuVDMIzg9XPRBfyhPkoo9R1NB_C/exec";
const BACKEND_URL = "https://andreygerc11-music-site.onrender.com"; 

// Підтягуємо токени з налаштувань Render (Environment Variables)
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN; 
const MONO_TOKEN = process.env.MONO_TOKEN; // ТЕПЕР ТОКЕН У БЕЗПЕЦІ
const TELEGRAM_CHAT_ID = "556627059"; 

// Функція для відправки сповіщень тобі в Телеграм
async function sendTelegramMessage(text) {
    if (!TELEGRAM_BOT_TOKEN) {
        console.log("Токен бота не знайдено у змінних оточення.");
        return;
    }
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

// Отримання списку пісень з Google Sheets
app.get('/api/music', async (req, res) => {
    try {
        const response = await axios.get(GOOGLE_SCRIPT_URL, { maxRedirects: 5 });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Помилка зв'язку з Google" });
    }
});

// Створення інвойсу в Монобанку
app.post('/api/pay', async (req, res) => {
    try {
        const { songId, songName } = req.body;
        
        if (!MONO_TOKEN) {
            return res.status(500).json({ error: "Помилка сервера: Токен Монобанку не налаштовано" });
        }

        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 5000, // 50 грн в копійках
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
        console.error("Помилка Монобанку:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Не вдалося створити платіж" });
    }
});

// Маршрут для прийому вебхука від Монобанку
app.post('/api/webhook', async (req, res) => {
    const paymentData = req.body;
    
    // Перевіряємо, чи оплата дійсно пройшла успішно
    if (paymentData.status === 'success') {
        console.log(`[УСПІХ] Гроші зайшли! Трек ID: ${paymentData.reference}`);
        
        const message = `✅ <b>Успішна оплата на сайті!</b>\n\n🎵 <b>ID пісні:</b> <code>${paymentData.reference}</code>\n💰 <b>Сума:</b> ${(paymentData.amount / 100).toFixed(2)} грн\n\n<i>Гроші на рахунку. Якщо людина випадково закрила сайт і не отримала трек, вона напише в підтримку.</i>`;
        
        await sendTelegramMessage(message);
    } else {
        console.log(`[СТАТУС] Зміна статусу платежу: ${paymentData.status}`);
    }
    
    // Обов'язкова відповідь банку (HTTP 200)
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));