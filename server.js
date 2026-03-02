const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// Твоє останнє посилання (v7)
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwXS6FZEC7IXqcRRYtMxLpQvbyhPyiaBit-kgpI5vshqLA1Z8lXtzypObV-09lwdjq-/exec";

app.get('/api/music', async (req, res) => {
    try {
        const response = await axios.get(GOOGLE_SCRIPT_URL, { 
            maxRedirects: 5 
        });
        res.json(response.data);
    } catch (error) {
        console.error("Помилка зв'язку:", error.message);
        res.status(500).json({ error: "Помилка зв'язку з Google Scripts" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює`));
