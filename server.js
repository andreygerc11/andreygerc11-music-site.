const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.json());

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx-ZZyOgiOwl67Pvypqw2Tej6ylWGFATEPAwqE6zpuVDMIzg9XPRBfyhPkoo9R1NB_C/exec";
const MONO_TOKEN = "m5XYd9Yazsau6Rs2q6WAgQA"; 

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
        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 5000, // 50 грн в копійках
            ccy: 980,
            redirectUrl: "https://golos-proty-raku.pp.ua/success.html",
            merchantPaymInfo: {
                reference: songId,
                destination: `Оплата за трек: ${songName}`
            }
        }, {
            headers: { 'X-Token': MONO_TOKEN }
        });
        res.json({ url: response.data.pageUrl });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Не вдалося створити платіж" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));