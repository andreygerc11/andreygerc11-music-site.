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

// === ЗМІННІ З RENDER ===
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MONO_TOKEN = process.env.MONO_TOKEN;
const BOT_TOKEN = process.env.BOT_TOKEN; 
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL; 
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "ТВІЙ_ID_ЯКЩО_НЕ_ДОДАВ_У_RENDER";

// === ЗМІННІ ДЛЯ GITHUB АРХІВУ ===
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; 
const GITHUB_EMAIL = process.env.GITHUB_EMAIL;

// === ТВОЇ ID ПАПОК GOOGLE DRIVE ===
const PREVIEW_FOLDER_ID = "1Vmwzr3kt98gDYIOaPTsZ0f6FwqcOMQ7S"; 
const FULL_FOLDER_ID = "1FGNuLTq9mFHqoUSqp-7PSKHixZHq3W2j";

async function sendTelegramMessage(text) {
    if (!BOT_TOKEN || !TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID === "ТВІЙ_ID_ЯКЩО_НЕ_ДОДАВ_У_RENDER") return;
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (e) {
        console.error("Помилка Telegram:", e.message);
    }
}

// === ІНТЕГРАЦІЯ З GOOGLE SHEETS ===
async function sendToGoogle(data) {
    const response = await fetch(GOOGLE_SHEETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        redirect: 'follow'
    });

    if (!response.ok) throw new Error(`Google Script повернув статус: ${response.status}`);

    const textResponse = await response.text();
    try {
        return JSON.parse(textResponse);
    } catch (e) {
        console.error("Помилка парсингу від Гугла:", textResponse);
        throw new Error("Невідомий формат відповіді від сервера бази даних");
    }
}

// === РЕЄСТРАЦІЯ ТА ЛОГІН ===
app.post('/api/register', async (req, res) => {
    try { res.json(await sendToGoogle({ action: 'register', ...req.body })); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
    try { res.json(await sendToGoogle({ action: 'login', ...req.body })); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/social-auth', async (req, res) => {
    try { res.json(await sendToGoogle({ action: 'social_auth', email: req.body.email, name: req.body.name })); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

// === ОТРИМАННЯ СПИСКУ ПІСЕНЬ ТА ПІДПИСОК ===
app.get('/api/music', async (req, res) => {
    try {
        if (!GOOGLE_API_KEY) throw new Error("Немає GOOGLE_API_KEY");

        const prevRes = await axios.get(`https://www.googleapis.com/drive/v3/files?q='${PREVIEW_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name,createdTime)&key=${GOOGLE_API_KEY}`);
        const fullRes = await axios.get(`https://www.googleapis.com/drive/v3/files?q='${FULL_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&key=${GOOGLE_API_KEY}`);

        const musicList = prevRes.data.files.map(f => {
            const cleanName = f.name.replace(/\.[^/.]+$/, "").replace(" (Прев'ю)", "").trim();
            const fullFile = fullRes.data.files.find(full => full.name.replace(/\.[^/.]+$/, "").trim() === cleanName);
            
            return {
                name: cleanName,
                previewId: f.id,
                fullId: fullFile ? fullFile.id : null,
                date: f.createdTime
            };
        }).filter(m => m.fullId);

        res.json(musicList);
    } catch (error) {
        console.error("Помилка завантаження списку:", error.message);
        res.status(500).json({ error: "Не вдалося завантажити музику" });
    }
});

app.post('/api/subscriptions', async (req, res) => {
    try { res.json(await sendToGoogle({ action: 'new_sub', ...req.body })); } 
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/subscriptions', async (req, res) => {
    try {
        const response = await fetch(`${GOOGLE_SHEETS_URL}?action=getSubs`, { redirect: 'follow' });
        const data = await response.json();
        res.json(data);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// === СТРІМІНГ АУДІО ===
app.get('/api/stream/:fileId', async (req, res) => {
    try {
        if (!GOOGLE_API_KEY) throw new Error("Немає GOOGLE_API_KEY");
        
        const response = await axios({
            method: 'get',
            url: `https://www.googleapis.com/drive/v3/files/${req.params.fileId}?alt=media&key=${GOOGLE_API_KEY}`,
            responseType: 'stream'
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');
        response.data.pipe(res);

    } catch (error) {
        console.error("Помилка стрімінгу:", error.message);
        res.status(500).send("Помилка відтворення");
    }
});

// === ОПЛАТИ (MONOBANK) ===
app.post('/api/pay-subscription', async (req, res) => {
    try {
        const { email } = req.body;
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3900, 
            ccy: 980,
            merchantPaymInfo: { destination: "Підписка Hertz Spectrum PRO", comment: email },
            redirectUrl: "https://golos-proty-raku.pp.ua/success.html",
            webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
        }, { headers: { 'X-Token': MONO_TOKEN } });
        res.json({ url: monoRes.data.pageUrl });
    } catch (error) { res.status(500).json({ error: "Помилка оплати" }); }
});

app.post('/api/pay', async (req, res) => {
    try {
        const { songId, songName } = req.body;
        const monoRes = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', {
            amount: 3736, 
            ccy: 980,
            merchantPaymInfo: { destination: `Трек: ${songName}`, reference: songId },
            redirectUrl: "https://golos-proty-raku.pp.ua/success.html",
            webHookUrl: "https://andreygerc11-music-site.onrender.com/api/webhook"
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

// === WHISPER (GROQ) ===
function compressAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioChannels(1).audioFrequency(16000).audioBitrate('64k')
            .audioFilters(['highpass=f=100', 'lowpass=f=5000', 'volume=2.0', 'acompressor=threshold=-20dB:ratio=4:makeup=5'])
            .toFormat('mp3').on('end', () => resolve(outputPath)).on('error', reject).save(outputPath);
    });
}

app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    let compressedPath = null;
    try {
        compressedPath = req.file.path + '_comp.mp3';
        await compressAudio(req.file.path, compressedPath);
        const formData = new FormData();
        formData.append('file', fs.createReadStream(compressedPath));
        formData.append('model', 'whisper-large-v3');
        formData.append('language', 'uk');
        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() }
        });
        res.json({ lrc: response.data.text }); 
    } catch (error) { res.status(500).json({ error: "Whisper Error" }); }
    finally { 
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
    }
});

// === ГЕНЕРАТОР ОБКЛАДИНОК ===
app.post('/api/generate-image', async (req, res) => {
    try {
        const { lyrics, customPrompt, format } = req.body;
        
        let textToTranslate = "";
        if (customPrompt && lyrics) {
            textToTranslate = `Опис: ${customPrompt}. Атмосфера пісні: ${lyrics.substring(0, 500)}`;
        } else if (customPrompt) {
            textToTranslate = `Опис: ${customPrompt}`;
        } else if (lyrics) {
            textToTranslate = `Атмосфера пісні: ${lyrics.substring(0, 600)}`;
        } else {
            textToTranslate = "Cinematic abstract music background";
        }

        let finalPrompt = "masterpiece, highly detailed music album cover";

        if (textToTranslate !== "Cinematic abstract music background") {
            try {
                const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: "llama-3.1-8b-instant",
                    messages: [
                        { 
                            role: "system", 
                            content: "You are a professional prompt engineer for an AI image generator. Translate the user's request into a highly descriptive visual prompt in English. Maximum 40 words. Focus on visual details, objects, and mood. Output ONLY the English prompt." 
                        },
                        { 
                            role: "user", 
                            content: String(textToTranslate) 
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 150
                }, {
                    headers: { 
                        'Authorization': `Bearer ${GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                finalPrompt = groqRes.data.choices[0].message.content.trim();
            } catch (groqError) {
                finalPrompt = "masterpiece, highly detailed music album cover, cinematic lighting"; 
            }
        } else {
            finalPrompt = textToTranslate;
        }

        let imgWidth = 1080;
        let imgHeight = 1920; 
        
        if (format === 'horizontal') {
            imgWidth = 1920;
            imgHeight = 1080; 
        } else if (format === 'square') {
            imgWidth = 1080;
            imgHeight = 1080; 
        } else if (format === 'portrait') {
            imgWidth = 1080;
            imgHeight = 1350; 
        } else if (format === 'cinema') {
            imgWidth = 2560;
            imgHeight = 1080; 
        }

        const randomSeed = Math.floor(Math.random() * 10000000);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=${imgWidth}&height=${imgHeight}&nologo=true&seed=${randomSeed}`;
        res.json({ imageUrl });
    } catch (error) { 
        res.status(500).send("Помилка генерації зображення"); 
    }
});

// === ШІ АВТО-БЛОГ З МЕДІА (КАРТИНКИ/ВІДЕО) ===
const BLOG_FILE_PATH = 'blog_posts.json';
let aiBlogPosts = [];

async function syncBlogFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        console.log("⚠️ GitHub Token або Repo не налаштовані.");
        return;
    }
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${BLOG_FILE_PATH}`;
        const res = await axios.get(url, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        const content = Buffer.from(res.data.content, 'base64').toString('utf8');
        aiBlogPosts = JSON.parse(content);
        console.log(`✅ Архів завантажено з GitHub: ${aiBlogPosts.length} статей.`);
    } catch (e) {
        console.log("ℹ️ Архів на GitHub ще не створений або порожній.");
    }
}

async function saveBlogToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${BLOG_FILE_PATH}`;
        let sha = null;
        try {
            const currentFile = await axios.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            sha = currentFile.data.sha;
        } catch (e) {}

        const content = Buffer.from(JSON.stringify(aiBlogPosts, null, 2)).toString('base64');
        
        await axios.put(url, {
            message: "Авто-оновлення архіву блогу [ШІ]",
            content: content,
            sha: sha,
            committer: { name: "Hertz AI", email: GITHUB_EMAIL || "bot@hertz.com" }
        }, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        console.log("🚀 Архів збережено на GitHub!");
    } catch (e) {
        console.error("❌ Помилка збереження на GitHub.");
    }
}

const rssSources = [
    "https://news.google.com/rss/search?q=%D0%BE%D0%BD%D0%BA%D0%BE%D0%BB%D0%BE%D0%B3%D1%96%D1%8F+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=cancer+research+breakthrough&hl=en-US&gl=US&ceid=US:en",
    "https://medicalxpress.com/rss-feed/cancer-news/"
];

async function fetchAndRewriteNews() {
    if (!GROQ_API_KEY) return;
    try {
        console.log("Шукаю нові медичні статті для блогу...");
        const rssUrl = rssSources[Math.floor(Math.random() * rssSources.length)];
        const response = await axios.get(rssUrl);
        const xml = response.data;

        const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/);
        if (!itemMatch) return;

        const itemXml = itemMatch[1];
        const titleMatch = itemXml.match(/<title>(.*?)<\/title>/);
        const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);
        const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/);

        if (titleMatch && linkMatch) {
            let rawTitle = titleMatch[1].replace("<![CDATA[", "").replace("]]>", "").trim();
            let sourceLink = linkMatch[1];
            let pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toLocaleDateString('uk-UA') : new Date().toLocaleDateString('uk-UA');

            const isDuplicate = aiBlogPosts.some(post => post.originalTitle === rawTitle);
            if (isDuplicate) {
                console.log("Ця стаття вже є в архіві. Чекаю.");
                return; 
            }

            // === НОВИЙ БЛОК: ШУКАЄМО КАРТИНКИ ТА ВІДЕО ===
            let foundImageUrl = null;
            let foundVideoUrl = null;

            const imgMatch = itemXml.match(/<(?:media:content|media:thumbnail|enclosure)[^>]+url="([^"]+)"/i) || itemXml.match(/<img[^>]+src="([^"]+)"/i);
            if (imgMatch) foundImageUrl = imgMatch[1];

            const videoMatch = itemXml.match(/<iframe[^>]+src="([^"]+(?:youtube\.com|youtu\.be)\/[^"]+)"/i);
            if (videoMatch) foundVideoUrl = videoMatch[1];

            console.log("Відправляю Groq на переклад...");
            
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: "llama-3.1-8b-instant",
                messages: [
                    { 
                        role: "system", 
                        content: "Ти — медичний журналіст-емпат. Твоє завдання: прочитати заголовок і суть новини (оригінал може бути АНГЛІЙСЬКОЮ або іншою мовою) і написати статтю-вижимку ВИКЛЮЧНО УКРАЇНСЬКОЮ МОВОЮ для блогу підтримки онкохворих. Обсяг: 3-4 абзаци. Пиши зрозуміло, оптимістично, без складної термінології. Тільки текст статті, без заголовка." 
                    },
                    { 
                        role: "user", 
                        content: `Опрацюй і переклади цю новину: "${rawTitle}"` 
                    }
                ],
                temperature: 0.6,
                max_tokens: 700
            }, {
                headers: { 
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            const rewrittenText = groqRes.data.choices[0].message.content.trim();
            let shortTitle = rawTitle.split(" - ")[0]; 

            const newPost = {
                id: Date.now(),
                date: pubDate,
                originalTitle: rawTitle,
                title: "Медичні новини: " + shortTitle,
                content: rewrittenText,
                sourceUrl: sourceLink,
                imageUrl: foundImageUrl, // Зберігаємо лінк на фото
                videoUrl: foundVideoUrl  // Зберігаємо лінк на відео
            };

            aiBlogPosts.unshift(newPost);
            await saveBlogToGitHub();
            console.log("✅ ШІ успішно написав статтю з медіа та відправив на GitHub!");
        }
    } catch (error) {
        console.error("Помилка генерації блогу:", error.message);
    }
}

syncBlogFromGitHub().then(() => {
    setTimeout(fetchAndRewriteNews, 15000); 
    setInterval(fetchAndRewriteNews, 8 * 60 * 60 * 1000);
});

app.get('/api/blog', (req, res) => {
    res.json(aiBlogPosts);
});

// === ЗАПУСК СЕРВЕРА ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Сервер успішно запущено на порту ${PORT}`);
});