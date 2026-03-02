const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// Твоє нове посилання (v4)
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzsf7cXAM5nSfUWxTS9ZUg_vOqyzsaJ687kpJmD0WMpYN5vRYWwVQ9aRt4zYO4UbKeP/exec";

app.get('/api/music', async (req, res) => {
    try {
        const response = await axios.get(GOOGLE_SCRIPT_URL, { maxRedirects: 5 });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Помилка зв'язку з Google" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює`));
