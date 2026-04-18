const rssSources = [
    "https://news.google.com/rss/search?q=%D0%BE%D0%BD%D0%BA%D0%BE%D0%BB%D0%BE%D0%B3%D1%96%D1%8F+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=%D1%96%D0%BD%D0%BD%D0%BE%D0%B2%D0%B0%D1%86%D1%96%D1%97+%D0%BB%D1%96%D0%BA%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F+%D1%80%D0%B0%D0%BA%D1%83&hl=uk&gl=UA&ceid=UA:uk",
    "https://news.google.com/rss/search?q=cancer+research+breakthrough&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=targeted+cancer+therapy&hl=en-US&gl=US&ceid=US:en",
    "https://medicalxpress.com/rss-feed/cancer-news/",
    "https://www.sciencedaily.com/rss/health_medicine/cancer.xml",
    "https://www.youtube.com/feeds/videos.xml?channel_id=UC3S13n7_p_A7-HIt5f0-6Lg"
];

async function fetchAndRewriteNews() {
    if (!GROQ_API_KEY) return;
    try {
        console.log("Шукаю нові медичні статті по ВСІХ джерелах...");

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

                    const isDuplicate = aiBlogPosts.some(post => post.originalTitle === rawTitle);
                    if (isDuplicate) {
                        console.log(`Новина вже є. Пропускаю.`);
                        continue; 
                    }

                    let foundImageUrl = null;
                    let foundVideoUrl = null;

                    const ytMatch = itemXml.match(/<yt:videoId>(.*?)<\/yt:videoId>/i);
                    if (ytMatch) {
                        foundVideoUrl = `https://www.youtube.com/embed/${ytMatch[1]}`;
                    } else {
                        // === ЛОГІКА "ПРОГРІВУ" ШІ КАРТИНКИ ===
                        const randomSeed = Math.floor(Math.random() * 1000000);
                        // Обов'язково кодуємо пробіли для URL
                        const prompt = encodeURIComponent("optimistic modern medical research laboratory abstract cinematic high quality photography");
                        foundImageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1200&height=800&nologo=true&seed=${randomSeed}`;

                        console.log(`⏳ ШІ генерує ілюстрацію... Даємо йому час (до 20 сек)...`);
                        try {
                            // Сервер САМ робить запит і чекає. Це змушує Pollinations згенерувати картинку і покласти в кеш.
                            await axios.get(foundImageUrl, { responseType: 'arraybuffer', timeout: 20000 });
                            console.log(`✅ Ілюстрація успішно згенерована та закріплена в кеші!`);
                        } catch (imgErr) {
                            console.error("ШІ не встиг згенерувати картинку. Ставимо абстракцію.", imgErr.message);
                            // Якщо за 20 секунд ШІ все одно не впорався, ставимо красиву резервну картинку з Unsplash, щоб не було чорного квадрата
                            foundImageUrl = "https://images.unsplash.com/photo-1579154204601-01588f351e67?q=80&w=1200&auto=format&fit=crop"; 
                        }
                    }

                    console.log(`Відправляю Groq завдання на статтю: "${rawTitle}"...`);
                    
                    const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                        model: "llama-3.1-8b-instant",
                        messages: [
                            { 
                                role: "system", 
                                content: "Ти — професійний медичний журналіст. Твоє завдання: написати розгорнуту, глибоку і зрозумілу статтю на основі новини ВИКЛЮЧНО УКРАЇНСЬКОЮ МОВОЮ. Обсяг: 5-7 великих абзаців. Структура: Цікавий вступ, Детальний розбір теми (використовуй підзаголовки та списки для зручності), і Оптимістичний висновок для пацієнтів. Тільки текст статті." 
                            },
                            { 
                                role: "user", 
                                content: `Напиши велику, розгорнуту статтю про це: "${rawTitle}"` 
                            }
                        ],
                        temperature: 0.7,
                        max_tokens: 2000 
                    }, {
                        headers: { 
                            'Authorization': `Bearer ${GROQ_API_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    const rewrittenText = groqRes.data.choices[0].message.content.trim();
                    let shortTitle = rawTitle.split(" - ")[0]; 

                    const newPost = {
                        id: Date.now() + Math.floor(Math.random() * 1000), 
                        date: pubDate,
                        originalTitle: rawTitle,
                        title: shortTitle, 
                        content: rewrittenText,
                        imageUrl: foundImageUrl, 
                        videoUrl: foundVideoUrl  
                    };

                    aiBlogPosts.unshift(newPost);
                    addedCount++;

                    // Відпочинок 10 секунд між статтями
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            } catch (err) {
                console.error("Помилка при читанні одного з джерел, пропускаємо...", err.message);
            }
        }

        if (addedCount > 0) {
            await saveBlogToGitHub();
            console.log(`✅ Успіх! Додано та збережено ${addedCount} нових статей!`);
        }

    } catch (error) {
        console.error("Помилка авто-блогу:", error.message);
    }
}

syncBlogFromGitHub().then(() => {
    setTimeout(fetchAndRewriteNews, 15000); 
    setInterval(fetchAndRewriteNews, 24 * 60 * 60 * 1000);
});

app.get('/api/blog', (req, res) => {
    res.json(aiBlogPosts);
});

// === ЗАПУСК СЕРВЕРА ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Сервер успішно запущено на порту ${PORT}`);
});