const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

// Вказуємо шлях до FFmpeg для стиснення
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(cors());
app.use(express.json());

// Ліміт 50 МБ (бо ми стиснемо перед відправкою)
const upload = multer({ dest: '/tmp/', limits: { fileSize: 50 * 1024 * 1024 } });

const BACKEND_URL = "https://andreygerc11-music-site.onrender.com"; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const GROQ_API_KEY = process.env.GROQ_API_KEY; 

// ==========================================
// ГЕНЕРАЦІЯ ОБКЛАДИНКИ
// ==========================================
app.post('/api/generate-image', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) return res.status(500).json({ error: "Ключ Gemini не налаштовано" });
        const { lyrics, format, customPrompt } = req.body;
        
        let aspectRatio = "1:1"; 
        if (format === 'vertical' || format === 'portrait') aspectRatio = "9:16"; 
        if (format === 'horizontal' || format === 'cinema') aspectRatio = "16:9";

        let safeVisualDescription = "abstract cinematic background, elegant lighting, 8k resolution";

        if (customPrompt && customPrompt.length > 2) {
            safeVisualDescription = customPrompt;
        } else if (lyrics && lyrics.length > 5) {
            try {
                if (!GROQ_API_KEY) throw new Error("Немає ключа Groq");
                const textResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: 'llama3-8b-8192', 
                    messages: [{ role: 'user', content: `Read this: "${lyrics.substring(0, 300)}". Create ONE SENTENCE describing a background image for this song. NO TEXT ON IMAGE.` }]
                }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                if (textResponse.data && textResponse.data.choices) safeVisualDescription = textResponse.data.choices[0].message.content.trim();
            } catch (e) { safeVisualDescription = "Cinematic background inspired by music"; }
        }

        let aiPrompt = `Create an album cover. Visual scene: ${safeVisualDescription}. ASPECT RATIO MUST BE EXACTLY ${aspectRatio}. NO TEXT, NO LETTERS.`;
        
        const generateResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: aiPrompt }] }], generationConfig: { responseModalities: ["IMAGE"] } },
            { headers: { 'Content-Type': 'application/json' } }
        );

        if (generateResponse.data && generateResponse.data.candidates) {
            const part = generateResponse.data.candidates[0].content.parts.find(p => p.inlineData || p.inline_data);
            if (part) {
                const inlineData = part.inlineData || part.inline_data;
                return res.json({ imageUrl: `data:${inlineData.mimeType || "image/jpeg"};base64,${inlineData.data}` });
            }
        }
        throw new Error("Зображення не знайдено");
    } catch (error) {
        res.status(500).json({ error: "Не вдалося згенерувати ШІ-фон." });
    }
});

// Функція стиснення
function compressAudio(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioBitrate('32k').audioChannels(1).audioFrequency(16000).toFormat('mp3')
            .on('end', () => resolve(outputPath)).on('error', (err) => reject(err)).save(outputPath);
    });
}

// === ЖОРСТКИЙ АНТИ-ГАЛЮЦИНОГЕННИЙ ФІЛЬТР ===
function isHallucination(text) {
    const lower = text.toLowerCase().trim();
    if (lower.length <= 2) return true; // Занадто коротке (я, о, у)
    
    // Блокуємо повторення літер: "Цюююююю", "ннннн" (4 і більше однакових літер підряд)
    if (/(.)\1{3,}/.test(lower)) return true; 
    
    // Блокуємо повторення слів: "it it it", "та та та" (слово повторюється 3+ рази)
    if (/(\b\w+\b)(?:\s+\1){2,}/.test(lower)) return true; 

    // Блокуємо арабську в'язь
    if (/[\u0600-\u06FF]/.test(lower)) return true; 

    // Блокуємо Емодзі (😍, 🎶 тощо)
    if (/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/.test(lower)) return true;

    // Блокуємо типові слова-паразити Whisper на музиці
    const badWords = ["any", "breakfast", "google", "subscribe", "thanks for watching", "музика", "програш", "ооо", "ааа"];
    if (badWords.some(w => lower.includes(w))) return true;

    return false; // Якщо пройшло всі перевірки - це нормальний текст
}

// ==========================================
// WHISPER СИНХРОНІЗАЦІЯ
// ==========================================
app.post('/api/sync-lyrics', upload.single('audio'), async (req, res) => {
    let compressedPath = null;
    try {
        if (!GROQ_API_KEY) return res.status(500).json({ error: "Ключ Groq API не налаштовано!" });
        if (!req.file) return res.status(400).json({ error: "Аудіофайл не отримано." });

        compressedPath = req.file.path + '_compressed.mp3';
        await compressAudio(req.file.path, compressedPath);

        const formData = new FormData();
        formData.append('file', fs.createReadStream(compressedPath), 'audio.mp3');
        formData.append('model', 'whisper-large-v3'); 
        formData.append('response_format', 'verbose_json'); 
        formData.append('language', 'uk'); // ТІЛЬКИ УКРАЇНСЬКА
        formData.append('temperature', '0.0'); // МІНІМУМ ГАЛЮЦИНАЦІЙ
        formData.append('condition_on_previous_text', 'false'); // Забороняє зациклюватися

        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...formData.getHeaders() },
            maxBodyLength: Infinity, timeout: 60000 
        });

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);

        let lrcText = "";
        if (response.data.segments) {
            response.data.segments.forEach(seg => {
                let text = seg.text.trim();
                // Проганяємо текст через нашу м'ясорубку
                if (!isHallucination(text)) {
                    let d = new Date(seg.start * 1000);
                    let m = String(d.getUTCMinutes()).padStart(2, '0');
                    let s = String(d.getUTCSeconds()).padStart(2, '0');
                    let ms = String(Math.floor(d.getUTCMilliseconds() / 10)).padStart(2, '0');
                    lrcText += `[${m}:${s}.${ms}] ${text}\n`;
                }
            });
        }
        res.json({ lrc: lrcText });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
        
        let errorMessage = "Помилка розпізнавання.";
        if (error.code === 'ECONNABORTED') errorMessage = "Тайм-аут. Сервер занадто довго відповідав.";
        else if (error.response) errorMessage = `Сервер відхилив запит (${error.response.status}).`;
        res.status(500).json({ error: errorMessage });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));