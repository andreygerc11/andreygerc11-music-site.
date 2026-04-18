const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
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
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL;

// === GOOGLE DRIVE ДЛЯ МУЗИКИ ===
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; 
const PREVIEW_FOLDER_ID = process.env.PREVIEW_FOLDER_ID;
const FULL_FOLDER_ID = process.env.FULL_FOLDER_ID;

// === ГЛОБАЛЬНІ ЗМІННІ ===
let aiBlogPosts = [];

const hdMedicalImages = [
    "https://images.unsplash.com/photo-1530497610245-94d3c16cda28?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1579154204601-01588f351e67?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1584036561566-baf8f5f1b144?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1576086213369-97a306d36557?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1631815589968-fdb09a223b1e?q=80&w=1200&auto=format&fit=crop"
];

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

        const contentEncoded = Buffer.from(JSON.stringify(aiBlogPosts, null, 2), 'utf8').toString('base64');
        const data = { message: "Автоматичне оновлення блогу ШІ", content: contentEncoded };
        if (sha) data.sha = sha;

        await axios.put(url, data, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
    } catch (error) { console.error("Помилка збереження на GitHub:", error.message); }
}

// === 2. АВТОМАТИЧНА ГЕНЕРАЦІЯ НОВИН (ШІ) ===
const rssSources = [
    "https://news.google.com/rss/search?q=%D0%BE%D0%BD%D0%BA%D0%BE%D0%BB%D0%BE%D0%B3%D1%96%D1%8F+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=%D1%96%D0%BD%D0%BD%D0%BE%D0%B2%D0%B0%D1%86%D1%96%D1%97+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA%D1%83&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=cancer+research+breakthrough&hl=en-US&gl=US&ceid=US:en",
    "https://medicalxpress.com/rss-feed/cancer-news/"
];

async function fetchAndRewriteNews() {
    if (!GROQ_API_KEY) return;
    try {
        const allSources = rssSources.sort(() => 0.5 - Math.random());
        let addedCount = 0;

        for (const rssUrl of allSources) {
            try {
                const response = await axios.get(rssUrl, { timeout: 10000 });
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
                        const prompt = encodeURIComponent(`Professional digital art, cinematic lighting, 8k, medical concept: ${rawTitle}, hope, science, vibrant`);
                        foundImageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1200&height=800&nologo=true&seed=${seed}`;
                        
                        try { 
                            await axios.get(foundImageUrl, { responseType: 'arraybuffer', timeout: 15000 }); 
                        } catch(e) {
                            foundImageUrl = hdMedicalImages[Math.floor(Math.random() * hdMedicalImages.length)];
                        }
                    }

                    const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                        model: "llama-3.1-8b-instant",
                        messages: [{ 
                            role: "system", 
                            content: "Ти — Андрій Герц, автор проєкту 'Голос проти раку'. Пиши розгорнуту статтю УКРАЇНСЬКОЮ (5-7 абзаців) з підзаголовками." 
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
                    await new Promise(r => setTimeout(r, 10000));
                }
            } catch (e) { }
        }
        if (addedCount > 0) await saveBlogToGitHub();
    } catch (e) { }
}

// === 3. ЕНДПОІНТИ (API) ===

app.get('/api/blog', (req, res) => res.json(aiBlogPosts));

// === МАГАЗИН МУЗИКИ ЧЕРЕЗ GOOGLE DRIVE ===
app.get('/api/music', async (req, res) => {
    if (!GOOGLE_API_KEY || !PREVIEW_FOLDER_ID || !FULL_FOLDER_ID) {
        return res.status(500).json({ error: "Ключі Google Drive не налаштовані" });
    }
    try {
        const prevRes = await axios.get(`https://www.googleapis.com/drive/v3/files?q='${PREVIEW_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name,createdTime)&key=${GOOGLE_API_KEY}`);
        const fullRes = await axios.get(`https://www.googleapis.com/drive/v3/files?q='${FULL_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&key=${GOOGLE_API_KEY}`);
        
        const prevFiles = prevRes.data.files || [];
        const fullFiles = fullRes.data.files || [];
        
        const musicList = prevFiles.map(prev => {
            let cleanName = prev.name.replace('.mp3', '').replace('_prev', '').replace(' (Preview)', '').trim();
            const fullMatch = fullFiles.find(f => f.name.includes(cleanName));
            
            return {
                name: cleanName,
                previewId: prev.id,
                fullId: fullMatch ? fullMatch.id : 'not_found',
                date: prev.createdTime.split('T')[0]
            };
        });
        
        res.json(musicList);
    } catch (error) { 
        res.status(500).json({ error: "Помилка завантаження треків з Диску" }); 
    }
});

// === СТРІМІНГ МУЗИКИ З GOOGLE DRIVE ===
app.get('/api/stream/:fileId', async (req, res) => {
    try {
        const response = await axios({
            method: 'get',
            url: `https://www.googleapis.com/drive/v3/files/${req.params.fileId}?alt=media&key=${GOOGLE_API_KEY}`,
            responseType: 'stream'
        });
        res.setHeader('Content-Type', 'audio/mpeg');
        response.data.pipe(res);
    } catch (error) { 
        res.status(500).send("Помилка відтворення аудіо з Диску"); 
    }
});

// Оплата
app.post('/api/pay', async (req, res) => {
    const { songId, songName } = req.body;
    if (!MONO_TOKEN) return res.json({ url: "https://send.monobank.ua/jar/ТВІЙ_КОД" });
    try {
        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3736,
            ccy: 980,
            merchantPaymInfo: { destination: `Музична Сповідь: ${songName}`, comment: `ID:${songId}` },
            redirectUrl: "https://andreygerc11.github.io/music_confession/success.html"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: response.data.pageUrl });
    } catch (err) { res.status(500).json({ error: "Помилка оплати" }); }
});

// Авторизація
app.post('/api/social-auth', (req, res) => {
    res.json({ success: true, status: 'user', name: req.body.name });
});

app.post('/api/login', (req, res) => { res.json({ success: true, status: 'user' }); });
app.post('/api/register', (req, res) => { res.json({ success: true }); });

// === 4. ЗАПУСК ТА ТАЙМЕРИ ===
const PORT = process.env.PORT || 10000;
syncBlogFromGitHub().then(() => {
    app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));
    setTimeout(fetchAndRewriteNews, 15000); 
    setInterval(fetchAndRewriteNews, 24 * 60 * 60 * 1000); 
});