const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// Вставлено ваше нове посилання на Google Apps Script
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzckoWMzXxnM77giiiGoL9yXe_DTZ0YX7dRRNLJCjAqVBFEqYDvmAMAr5RBrJq7iQwn/exec";

app.get('/api/music', async (req, res) => {
    try {
        // Додано перенаправлення (follow redirects), щоб axios точно отримав дані
        const response = await axios.get(GOOGLE_SCRIPT_URL, {
            maxRedirects: 5
        });
        res.json(response.data);
    } catch (error) {
        console.error("Помилка:", error.message);
        res.status(500).json({ error: "Помилка зв'язку з Google Scripts" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущено на порту ${PORT}`));
