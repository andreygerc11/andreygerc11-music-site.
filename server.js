const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// Адреса вашого Google Apps Script
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwbNNLK7LAR-q0n7fgUrPvqOXsZLEWc2WHAZWrvE1-UUzVUy4wl3Ao14c9PrBXy72GS/exec";

app.get('/api/music', async (req, res) => {
    try {
        const response = await axios.get(GOOGLE_SCRIPT_URL);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Помилка зв'язку з Google Scripts" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущено на порту ${PORT}`));