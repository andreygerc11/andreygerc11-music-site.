const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron'); // Модуль для автоматичних платежів за розкладом
const app = express();

app.use(cors());
app.use(express.json());

// 1. СТАРЕ ПОСИЛАННЯ (Для музики, працює як і раніше)
const MUSIC_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzjzr5afDgy4pAWlwKVsatYaAK4JZC6c7itGdJaeScLCp-2iZP4PZ-8j_Kid7t0jIw/exec";

// 2. НОВЕ ПОСИЛАННЯ (Для бази даних підписок) - Твій новий код!
const SUBS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzsMVH4mkam55ln4rs1oY4-F3UjGCugsl1aQ7dPtHWYvip2J6Dq1sh6iUpiUH4cnm4P/exec";

const BACKEND_URL = "https://andreygerc11-music-site.onrender.com"; 

const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN; 
const MONO_TOKEN = process.env.MONO_TOKEN; 
const TELEGRAM_CHAT_ID = "556627059"; 

// Функція відправки повідомлень в Телеграм
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

// --- ЧАСТИНА 1: МУЗИКА ---

app.get('/api/music', async (req, res) => {
    try {
        const response = await axios.get(MUSIC_SCRIPT_URL, { maxRedirects: 5 });
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
            amount: 3736, // 37.36 грн
            ccy: 980,
            redirectUrl: `https://golos-proty-raku.pp.ua/success.html?file=${songId}`,
            webHookUrl: `${BACKEND_URL}/api/webhook`, 
            merchantPaymInfo: {
                reference: songId,
                destination: `Оплата за трек: ${songName}`
            }
        }, { headers: { 'X-Token': MONO_TOKEN } });
        
        res.json({ url: response.data.pageUrl });
    } catch (error) {
        res.status(500).json({ error: "Не вдалося створити платіж" });
    }
});


// --- ЧАСТИНА 2: ПІДПИСКИ (ГЕНЕРАТОР) ---

// Створення платежу на пробний період із збереженням картки
app.post('/api/pay-subscription', async (req, res) => {
    try {
        if (!MONO_TOKEN) return res.status(500).json({ error: "Токен Монобанку не налаштовано" });

        const subId = 'sub_' + Date.now(); 
        
        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3900, // 39.00 грн (Пробний період)
            ccy: 980,
            redirectUrl: `https://golos-proty-raku.pp.ua/generator.html?status=subscribed`,
            webHookUrl: `${BACKEND_URL}/api/webhook`, 
            saveCardData: { saveCard: true }, // СЕКРЕТНА КОМАНДА: Зберегти картку!
            merchantPaymInfo: {
                reference: subId,
                destination: `Пробний період Hertz Spectrum (5 днів)`
            }
        }, { headers: { 'X-Token': MONO_TOKEN } });
        
        res.json({ url: response.data.pageUrl });
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: "Не вдалося створити підписку" });
    }
});


// --- ЧАСТИНА 3: ВЕБХУК (Обробка всіх оплат) ---

app.post('/api/webhook', async (req, res) => {
    const paymentData = req.body;
    
    if (paymentData.status === 'success') {
        const ref = paymentData.reference;
        
        // 1. Якщо це нова підписка (збереження токена картки)
        if (ref.startsWith('sub_')) {
            const walletId = paymentData.walletId; 
            
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 5); // Наступна оплата через 5 днів
            const nextDateString = nextDate.toISOString().split('T')[0];

            try {
                await axios.post(SUBS_SCRIPT_URL, {
                    action: "new_sub",
                    subId: ref,
                    walletId: walletId,
                    nextPaymentDate: nextDateString
                });
                await sendTelegramMessage(`🔥 <b>НОВА ПІДПИСКА!</b>\n\n💸 Сплачено: 39 грн (Пробний період)\n💳 <b>Картку успішно збережено!</b>\nНаступне списання (199 грн) заплановано на: ${nextDateString}`);
            } catch(e) {
                console.error("Помилка запису в таблицю підписок");
            }
        } 
        // 2. Якщо це автоматичне щомісячне зняття 199 грн
        else if (ref.startsWith('ren_')) {
            await sendTelegramMessage(`💸 <b>АВТОМАТИЧНЕ СПИСАННЯ УСПІШНЕ!</b>\n\nСума: 199 грн.\nПідписку подовжено.`);
        }
        // 3. Звичайна оплата за пісню
        else {
            await sendTelegramMessage(`✅ <b>Оплата за пісню!</b>\n\n🎵 ID: <code>${ref}</code>\n💰 Сума: ${(paymentData.amount / 100).toFixed(2)} грн`);
        }
    }
    res.status(200).send('OK');
});


// --- ЧАСТИНА 4: АВТОМАТИЧНІ ПЛАТЕЖІ (Щодня о 10:00) ---

cron.schedule('0 10 * * *', async () => {
    console.log('Запуск перевірки підписок...');
    if (!MONO_TOKEN) return;

    try {
        const response = await axios.get(`${SUBS_SCRIPT_URL}?action=getSubs`);
        const subs = response.data;
        const today = new Date().toISOString().split('T')[0];

        for (let sub of subs) {
            // Перевіряємо, чи активна підписка і чи настав день оплати
            if (sub.Status === 'active' && sub.NextPaymentDate && sub.NextPaymentDate <= today) {
                try {
                    // Звертаємося до Монобанку, щоб зняти гроші з токену картки (walletId)
                    await axios.post('https://api.monobank.ua/api/merchant/wallet/payment', {
                        walletId: sub.WalletId, 
                        amount: 19900, // 199.00 грн
                        ccy: 980,
                        reference: 'ren_' + sub.SubID + '_' + Date.now(),
                        destination: "Місячна підписка Hertz Spectrum"
                    }, { headers: { 'X-Token': MONO_TOKEN } });

                    // Якщо успішно - переносимо дату на 30 днів вперед
                    const nextDate = new Date();
                    nextDate.setDate(nextDate.getDate() + 30);
                    
                    await axios.post(SUBS_SCRIPT_URL, {
                        action: "update_sub",
                        subId: sub.SubID,
                        nextPaymentDate: nextDate.toISOString().split('T')[0]
                    });

                } catch (chargeError) {
                    await sendTelegramMessage(`❌ <b>Помилка списання 199 грн!</b>\nНе вдалося зняти гроші за підписку <code>${sub.SubID}</code>. Картка може бути порожньою або заблокованою.`);
                    
                    // Блокуємо підписку в базі
                    await axios.post(SUBS_SCRIPT_URL, {
                        action: "update_sub",
                        subId: sub.SubID,
                        status: "failed"
                    });
                }
            }
        }
    } catch (err) {
        console.error("Помилка роботи Cron:", err.message);
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));