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

// === ЗМІННІ З RENDER ===
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MONO_TOKEN = process.env.MONO_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; 
const BOT_TOKEN = process.env.BOT_TOKEN; 
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "ТВІЙ_ID_ЯКЩО_НЕ_ДОДАВ_У_RENDER";

// === ТВОЇ ID ПАПОК GOOGLE DRIVE ===
const PREVIEW_FOLDER_ID = "1Vmwzr3kt98gDYIOaPTsZ0f6FwqcOMQ7S"; 
const FULL_FOLDER_ID = "1FGNuLTq9mFHqoUSqp-7PSKHixZHq3W2j";

// === ГЛОБАЛЬНІ ЗМІННІ ===
let aiBlogPosts = [];

const hdMedicalImages = [
    "https://images.unsplash.com/photo-1530497610245-94d3c16cda28?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1579154204601-01588f351e67?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1584036561566-baf8f5f1b144?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1576086213369-97a306d36557?q=80&w=1200&auto=format&fit=crop", 
    "https://images.unsplash.com/photo-1631815589968-fdb09a223b1e?q=80&w=1200&auto=format&fit=crop"
];

// ==========================================
// 1. ТЕЛЕГРАМ ТА GOOGLE SHEETS
// ==========================================
async function sendTelegramMessage(text) {
    if (!BOT_TOKEN || !TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID === "ТВІЙ_ID_ЯКЩО_НЕ_ДОДАВ_У_RENDER") return;
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'HTML' });
    } catch (e) { console.error("Помилка Telegram:", e.message); }
}

async function sendToGoogle(data) {
    if (!GOOGLE_SHEETS_URL) return { success: true };
    const response = await fetch(GOOGLE_SHEETS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), redirect: 'follow' });
    if (!response.ok) throw new Error(`Google Script повернув статус: ${response.status}`);
    const textResponse = await response.text();
    try { return JSON.parse(textResponse); } catch (e) { return { success: true }; }
}

app.post('/api/register', async (req, res) => { try { res.json(await sendToGoogle({ action: 'register', ...req.body })); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/login', async (req, res) => { try { res.json(await sendToGoogle({ action: 'login', ...req.body })); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/social-auth', async (req, res) => { try { res.json(await sendToGoogle({ action: 'social_auth', email: req.body.email, name: req.body.name })); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/subscriptions', async (req, res) => { try { res.json(await sendToGoogle({ action: 'new_sub', ...req.body })); } catch (error) { res.status(500).json({ error: error.message }); } });
app.get('/api/subscriptions', async (req, res) => {
    if (!GOOGLE_SHEETS_URL) return res.json([]);
    try { const response = await fetch(`${GOOGLE_SHEETS_URL}?action=getSubs`, { redirect: 'follow' }); const data = await response.json(); res.json(data); } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// 2. МУЗИКА З GOOGLE DRIVE ТА ОПЛАТИ
// ==========================================
app.get('/api/music', async (req, res) => {
    try {
        if (!GOOGLE_API_KEY) throw new Error("Немає GOOGLE_API_KEY");
        const prevRes = await axios.get(`https://www.googleapis.com/drive/v3/files?q='${PREVIEW_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name,createdTime)&key=${GOOGLE_API_KEY}`);
        const fullRes = await axios.get(`https://www.googleapis.com/drive/v3/files?q='${FULL_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&key=${GOOGLE_API_KEY}`);
        const musicList = prevRes.data.files.map(f => {
            const cleanName = f.name.replace(/\.[^/.]+$/, "").replace(" (Прев'ю)", "").trim();
            const fullFile = fullRes.data.files.find(full => full.name.replace(/\.[^/.]+$/, "").trim() === cleanName);
            return { name: cleanName, previewId: f.id, fullId: fullFile ? fullFile.id : null, date: f.createdTime };
        }).filter(m => m.fullId);
        res.json(musicList);
    } catch (error) { res.status(500).json({ error: "Не вдалося завантажити музику" }); }
});

app.get('/api/stream/:fileId', async (req, res) => {
    try {
        if (!GOOGLE_API_KEY) throw new Error("Немає GOOGLE_API_KEY");
        const response = await axios({ method: 'get', url: `https://www.googleapis.com/drive/v3/files/${req.params.fileId}?alt=media&key=${GOOGLE_API_KEY}`, responseType: 'stream' });
        res.setHeader('Content-Type', 'audio/mpeg'); res.setHeader('Accept-Ranges', 'bytes'); response.data.pipe(res);
    } catch (error) { res.status(500).send("Помилка відтворення"); }
});

app.post('/api/pay', async (req, res) => {
    try {
        const { songId, songName } = req.body;
        if (!MONO_TOKEN) return res.json({ url: "https://send.monobank.ua/" });
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3736, ccy: 980, merchantPaymInfo: { destination: `Трек: ${songName}`, reference: songId },
            redirectUrl: "https://andreygerc11.github.io/music_confession/success.html", webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка оплати" }); }
});

app.post('/api/pay-subscription', async (req, res) => {
    try {
        const { email } = req.body;
        if (!MONO_TOKEN) return res.json({ url: "https://send.monobank.ua/" });
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 39999, ccy: 980, merchantPaymInfo: { destination: "Підписка Hertz Spectrum PRO", comment: email },
            redirectUrl: "https://andreygerc11.github.io/music_confession/success.html", webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка оплати" }); }
});

app.post('/api/webhook', async (req, res) => {
    try {
        const { invoiceId, status, reference } = req.body;
        if (status === 'success') {
            await sendToGoogle({ action: 'update_sub', invoiceId, status });
            await sendTelegramMessage(`🔥 <b>Нова оплата!</b>\nРеференс: ${reference}`);
        }
        res.status(200).send("OK");
    } catch (e) { res.status(500).send("Error"); }
});

// ==========================================
// 3. ГЕНЕРАТОР ВІДЕО ТА ОБКЛАДИНОК (Hertz Spectrum)
// ==========================================
function compressAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath).audioChannels(1).audioFrequency(16000).audioBitrate('64k').audioFilters(['highpass=f=100', 'lowpass=f=5000', 'volume=2.0', 'acompressor=threshold=-20dB:ratio=4:makeup=5']).toFormat('mp3').on('end', () => resolve(outputPath)).on('error', reject).save(outputPath);
    });
}

app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    let compressedPath = null;
    try {
        compressedPath = req.file.path + '_comp.mp3';
        await compressAudio(req.file.path, compressedPath);
        const formData = new FormData(); formData.append('file', fs.createReadStream(compressedPath)); formData.append('model', 'whisper-large-v3'); formData.append('language', 'uk');
        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() } });
        res.json({ lrc: response.data.text }); 
    } catch (error) { res.status(500).json({ error: "Whisper Error" }); }
    finally { 
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
    }
});

app.post('/api/generate-image', async (req, res) => {
    try {
        const { lyrics, customPrompt, format } = req.body;
        
        let textToTranslate = "";
        if (customPrompt && lyrics) textToTranslate = `Сцена: ${customPrompt}. Настрій: ${lyrics.substring(0, 500)}`;
        else if (customPrompt) textToTranslate = `Сцена: ${customPrompt}`;
        else if (lyrics) textToTranslate = `Настрій: ${lyrics.substring(0, 600)}`;
        else textToTranslate = "Modern minimalistic music studio background";

        let basePrompt = "ultra realistic photography, 8k resolution";

        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: "llama-3.1-8b-instant",
                messages: [
                    { 
                        role: "system", 
                        content: "You are an expert prompt engineer. Translate the user's request into English and create a highly descriptive visual prompt (max 30 words) for an ULTRA REALISTIC, photorealistic image. No text, no logos, no cartoons, no digital art, no anime, no 3d render. Only real-life documentary style photography. Output ONLY the English prompt." 
                    },
                    { role: "user", content: String(textToTranslate) }
                ],
                temperature: 0.7,
                max_tokens: 150
            }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
            
            basePrompt = groqRes.data.choices[0].message.content.trim();
        } catch (groqError) {
            console.error("Groq Error Generator");
            basePrompt = "ultra realistic documentary photography, cinematic lighting, 8k, photorealistic"; 
        }

        const finalPrompt = `${basePrompt}, real photo, shot on DSLR, highly detailed, photorealistic, 8k resolution`;

        let imgWidth = 1080;
        let imgHeight = 1920; 
        
        if (format === 'horizontal') { imgWidth = 1920; imgHeight = 1080; } 
        else if (format === 'square') { imgWidth = 1080; imgHeight = 1080; } 
        else if (format === 'portrait') { imgWidth = 1080; imgHeight = 1350; } 
        else if (format === 'cinema') { imgWidth = 2560; imgHeight = 1080; }

        const randomSeed = Math.floor(Math.random() * 10000000);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=${imgWidth}&height=${imgHeight}&nologo=true&seed=${randomSeed}`;
        res.json({ imageUrl });
    } catch (error) { 
        console.error("Image Gen Error:", error.message);
        res.status(500).send("Помилка генерації зображення"); 
    }
});

// ==========================================
// НОВИЙ МАРШРУТ: РОЗБИВКА ТЕКСТУ НА СЦЕНИ (Hertz Director)
// ==========================================
app.post('/api/generate-storyboard', async (req, res) => {
    const { lyrics } = req.body;

    if (!lyrics) {
        return res.status(400).json({ error: 'Текст пісні не надано' });
    }

    const promptText = `
    You are a professional music video director. Analyze these lyrics and break them down into visual scenes (4 to 8 scenes max). 
    Translate the meaning to English to write highly detailed prompts for an AI Image Generator.
    Return ONLY a raw JSON array of objects. Do not add any markdown formatting, backticks, or extra text.
    Format MUST be exactly like this:
    [
      { "id": 1, "time": "00:00 - 00:10", "lyrics": "original ukrainian lyric line", "prompt": "Cinematic wide shot of..." }
    ]
    
    Lyrics:
    ${lyrics}
    `;

    try {
        const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama3-70b-8192", 
            messages: [{ role: "user", content: promptText }],
            temperature: 0.7,
            max_tokens: 2000
        }, {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const content = groqRes.data.choices[0].message.content.trim();
        
        let scenes = [];
        try {
            // Очищаємо JSON від можливих маркдаун-тегів (наприклад, ```json ... ```)
            const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
            scenes = JSON.parse(cleanJson);
        } catch (parseError) {
            console.error("Помилка парсингу JSON від Groq:", content);
            return res.status(500).json({ error: 'ШІ повернув неправильний формат даних.' });
        }

        res.json(scenes);

    } catch (error) {
        console.error("Помилка Groq API (Storyboard):", error.message);
        res.status(500).json({ error: 'Помилка генерації сценарію на сервері' });
    }
});


// ==========================================
// 4. АВТОМАТИЧНИЙ БЛОГ ТА НОВИНИ (ШІ)
// ==========================================
async function syncBlogFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/blog_posts.json`;
        const response = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        aiBlogPosts = JSON.parse(content);
        console.log(`✅ Архів блогу завантажено: ${aiBlogPosts.length} статей.`);
    } catch (error) { aiBlogPosts = []; }
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
        const data = { message: "Оновлення блогу", content: contentEncoded };
        if (sha) data.sha = sha;

        await axios.put(url, data, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
    } catch (e) { console.error("Помилка GitHub:", e.message); }
}

const rssSources = [
    "https://news.google.com/rss/search?q=%D0%BE%D0%BD%D0%BA%D0%BE%D0%BB%D0%BE%D0%B3%D1%96%D1%8F+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=%D1%96%D0%BD%D0%BD%D0%BE%D0%B2%D0%B0%D1%86%D1%96%D1%97+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA%D1%83&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=%D0%BB%D0%B5%D0%B9%D0%BA%D0%B5%D0%BC%D1%96%D1%8F+%D1%82%D0%B5%D1%80%D0%B0%D0%BF%D1%96%D1%8F+%D0%BF%D1%80%D0%BE%D1%80%D0%B8%D0%B2&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=cancer+research+breakthrough&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=leukemia+treatment+advances&hl=en-US&gl=US&ceid=US:en",
    "https://medicalxpress.com/rss-feed/cancer-news/",
    "https://www.sciencedaily.com/rss/health_medicine/cancer.xml",
    "https://www.youtube.com/feeds/videos.xml?channel_id=UC3S13n7_p_A7-HIt5f0-6Lg"
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
                        // 1. Переклад заголовку на АНГЛІЙСЬКУ для картинки
                        let englishTitle = rawTitle;
                        try {
                            const translateRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                                model: "llama-3.1-8b-instant",
                                messages: [{ role: "system", content: "Translate the following medical news title to English. Output ONLY the English translation." }, { role: "user", content: rawTitle }],
                                max_tokens: 50
                            }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                            englishTitle = translateRes.data.choices[0].message.content.trim();
                        } catch (e) {}

                        const seed = Math.floor(Math.random() * 10000000);
                        const prompt = encodeURIComponent(`Ultra realistic photography, award winning medical documentary photo, highly detailed, real life: ${englishTitle}. Hospital or modern laboratory setting, soft natural lighting, 8k resolution, shot on DSLR. RandomHash: ${seed}`);
                        
                        foundImageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1200&height=800&nologo=true`;
                        
                        try { await axios.get(foundImageUrl, { responseType: 'arraybuffer', timeout: 25000 }); } 
                        catch(e) { foundImageUrl = hdMedicalImages[Math.floor(Math.random() * hdMedicalImages.length)]; }
                    }

                    // 3. Пишемо статтю УКРАЇНСЬКОЮ
                    const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                        model: "llama-3.1-8b-instant",
                        messages: [{ 
                            role: "system", 
                            content: "Ти — автор проєкту 'Голос проти раку'. Пиши розгорнуту статтю УКРАЇНСЬКОЮ (5-7 абзаців) з підзаголовками." 
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

app.get('/api/blog', (req, res) => res.json(aiBlogPosts));

// ==========================================
// 5. ЗАПУСК СЕРВЕРА
// ==========================================
const PORT = process.env.PORT || 10000;
syncBlogFromGitHub().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Сервер успішно запущено на порту ${PORT}`);
        setTimeout(fetchAndRewriteNews, 15000); 
        setInterval(fetchAndRewriteNews, 24 * 60 * 60 * 1000);
    });
});