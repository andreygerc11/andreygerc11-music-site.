const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: '/tmp/', limits: { fileSize: 50 * 1024 * 1024 } });

// === ЗМІННІ З RENDER (СЕКРЕТИ) ===
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MONO_TOKEN = process.env.MONO_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; 
const BOT_TOKEN = process.env.BOT_TOKEN; 

// === ГЛОБАЛЬНІ ЗМІННІ ===
let aiBlogPosts = [];

// === 1. ЛОГІКА РОБОТИ З GITHUB АРХІВОМ ===

async function syncBlogFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/blog_posts.json`;
        const response = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        aiBlogPosts = JSON.parse(content);
        console.log(`✅ Архів завантажено з GitHub: ${aiBlogPosts.length} статей.`);
    } catch (error) {
        console.log("ℹ️ Архів на GitHub ще не створений або порожній.");
        aiBlogPosts = [];
    }
}

async function saveBlogToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/blog_posts.json`;
        let sha = null;
        try {
            const getRes = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            sha = getRes.data.sha;
        } catch (e) {}

        const contentEncoded = Buffer.from(JSON.stringify(aiBlogPosts, null, 2)).toString('base64');
        const data = { message: "Автоматичне оновлення блогу ШІ", content: contentEncoded };
        if (sha) data.sha = sha;

        await axios.put(url, data, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        console.log("🚀 Архів успішно збережено на GitHub!");
    } catch (error) {
        console.error("Помилка збереження на GitHub:", error.message);
    }
}

// === 2. АВТОМАТИЧНА ГЕНЕРАЦІЯ НОВИН (ШІ) ===

const rssSources = [
    "https://news.google.com/rss/search?q=%D0%BE%D0%BD%D0%BA%D0%BE%D0%BB%D0%BE%D0%B3%D1%96%D1%8F+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=%D1%96%D0%BD%D0%BD%D0%BE%D0%B2%D0%B0%D1%86%D1%96%D1%97+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA%D1%83&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=cancer+research+breakthrough&hl=en-US&gl=US&ceid=US:en",
    "https://medicalxpress.com/rss-feed/cancer-news/",
    "https://www.sciencedaily.com/rss/health_medicine/cancer.xml",
    "https://www.youtube.com/feeds/videos.xml?channel_id=UC3S13n7_p_A7-HIt5f0-6Lg"
];

async function fetchAndRewriteNews() {
    if (!GROQ_API_KEY) return;
    try {
        console.log("Шукаю нові медичні статті по всіх джерелах...");
        const allSources = rssSources.sort(() => 0.5 - Math.random());
        let addedCount = 0;

        for (const rssUrl of allSources) {
            try {
                const response = await axios.get(rssUrl);
                const xml = response.data;
                const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/) || xml.match(/<entry>([\s\S]*?)<\/entry>/);
                if (!itemMatch) continue;

                const itemXml = itemMatch[1];
                const titleMatch = itemXml.match(/<title>(.*?)<\/title>/);
                const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/) || itemXml.match(/<published>(.*?)<\/published>/);

                if (titleMatch) {
                    let rawTitle = titleMatch[1].replace("<![CDATA[", "").replace("]]>", "").trim();
                    let pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toLocaleDateString('uk-UA') : new Date().toLocaleDateString('uk-UA');

                    if (aiBlogPosts.some(p => p.originalTitle === rawTitle)) continue;

                    let foundImageUrl = null;
                    let foundVideoUrl = null;

                    const ytMatch = itemXml.match(/<yt:videoId>(.*?)<\/yt:videoId>/i);
                    if (ytMatch) {
                        foundVideoUrl = `https://www.youtube.com/embed/${ytMatch[1]}`;
                    } else {
                        const seed = Math.floor(Math.random() * 1000000);
                        const prompt = encodeURIComponent("optimistic modern medical research laboratory abstract cinematic high quality photography");
                        foundImageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1200&height=800&nologo=true&seed=${seed}`;
                        
                        console.log("⏳ Прогріваємо ШІ-картинку...");
                        try { await axios.get(foundImageUrl, { timeout: 15000 }); } catch(e) {}
                    }

                    console.log(`📝 Groq пише статтю: ${rawTitle}`);
                    const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                        model: "llama-3.1-8b-instant",
                        messages: [{ 
                            role: "system", 
                            content: "Ти — професійний медичний журналіст. Напиши розгорнуту статтю УКРАЇНСЬКОЮ (5-7 абзаців) з підзаголовками та оптимістичним висновком." 
                        }, { role: "user", content: `Тема: ${rawTitle}` }],
                        max_tokens: 2000
                    }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                    aiBlogPosts.unshift({
                        id: Date.now() + Math.floor(Math.random() * 1000),
                        date: pubDate,
                        originalTitle: rawTitle,
                        title: rawTitle.split(" - ")[0],
                        content: groqRes.data.choices[0].message.content.trim(),
                        imageUrl: foundImageUrl,
                        videoUrl: foundVideoUrl
                    });
                    addedCount++;
                    await new Promise(r => setTimeout(r, 12000));
                }
            } catch (e) { console.error("Помилка джерела:", e.message); }
        }
        if (addedCount > 0) await saveBlogToGitHub();
    } catch (e) { console.error("Помилка авто-блогу:", e.message); }
}

// === 3. ЕНДПОІНТИ (API) ===

app.get('/api/blog', (req, res) => res.json(aiBlogPosts));

app.post('/api/register', (req, res) => {
    // Тут твоя логіка реєстрації (Google Sheets або База)
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    // Тут твоя логіка входу
    res.json({ success: true });
});

app.get('/api/music', async (req, res) => {
    // Тут твоя логіка отримання списку музики
    res.json([]);
});

app.post('/api/pay', async (req, res) => {
    // Тут твоя логіка Monobank
    res.json({ url: "https://send.monobank.ua/..." });
});

// === 4. ЗАПУСК ТА ТАЙМЕРИ ===

const PORT = process.env.PORT || 10000;
syncBlogFromGitHub().then(() => {
    app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));
    
    // Запуск першої перевірки через 15 сек після старту
    setTimeout(fetchAndRewriteNews, 15000);
    // Далі - раз на 24 години
    setInterval(fetchAndRewriteNews, 24 * 60 * 60 * 1000);
});