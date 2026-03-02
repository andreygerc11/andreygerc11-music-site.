const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// ПРАВИЛЬНЕ ПОСИЛАННЯ (БЕЗ ДУБЛЮВАННЯ)
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxAMPJRtOoy89IlGEbpSWK8VOdo5HcBqBF09EOor7fJqgd9C0Phe0JePcnoO2HDsomB/exec";

app.get('/api/music', async (req, res) => {
    try {
        const response = await axios.get(GOOGLE_SCRIPT_URL, { maxRedirects: 5 });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Помилка зв'язку" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює`));
