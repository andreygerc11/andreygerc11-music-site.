import asyncio
import logging
import os
import threading
import aiohttp
from flask import Flask, jsonify
from flask_cors import CORS
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton
from dotenv import load_dotenv
from googleapiclient.discovery import build

# Завантаження змінних оточення
load_dotenv()
TOKEN = os.getenv("BOT_TOKEN")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
MONO_TOKEN = os.getenv("MONO_TOKEN")

# Налаштування Flask для Render та сайту
app = Flask('')
CORS(app)

logging.basicConfig(level=logging.INFO)
bot = Bot(token=TOKEN)
dp = Dispatcher()

FOLDER_ID = "1FGNuLTq9mFHqoUSqp-7PSKHixZHq3W2j"
PRICE = 50

def get_tracks():
    try:
        service = build("drive", "v3", developerKey=GOOGLE_API_KEY)
        results = service.files().list(
            q=f"'{FOLDER_ID}' in parents and mimeType='audio/mpeg' and trashed=false",
            fields="files(id, name)", orderBy="name"
        ).execute()
        files = results.get("files", [])
        return [{"index": i, "name": f["name"].replace(".mp3", ""), "id": f["id"]} for i, f in enumerate(files)]
    except Exception as e:
        logging.error(f"Помилка Google Drive: {e}")
        return []

@app.route('/')
def home():
    return "Сервер бота та API активний"

@app.route('/api/music')
def api_music():
    current_tracks = get_tracks()
    return jsonify([{"id": t['id'], "name": t['name']} for t in current_tracks])

async def check_mono_payment(amount, comment):
    """Перевірка виписки Monobank"""
    url = "https://api.monobank.ua/personal/statement/0/0"
    headers = {"X-Token": MONO_TOKEN}
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    for tr in data:
                        if tr.get('amount') >= amount * 100 and comment in tr.get('comment', ''):
                            return True
        except: pass
    return False

@dp.message(CommandStart())
async def start(message: Message):
    args = message.text.split()
    if len(args) > 1 and args[1].startswith("buy_"):
        file_id = args[1].replace("buy_", "")
        tracks = get_tracks()
        track_name = next((t['name'] for t in tracks if t['id'] == file_id), "Трек")
        url = f"https://send.monobank.ua/jar/9UrhoP4T7P?a={PRICE}&t={track_name}"
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=f"💳 Оплатити {PRICE} грн", url=url)],
            [InlineKeyboardButton(text="✅ Я оплатив", callback_data=f"verify_{file_id}_{track_name}")]
        ])
        await message.answer(f"Ви обрали: {track_name}. Оплатіть та натисніть кнопку:", reply_markup=kb)
        return
    
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🎵 Список треків", callback_data="menu")]])
    await message.answer("Проєкт «Голос проти раку» вітає вас!", reply_markup=kb)

@dp.callback_query(lambda c: c.data == "menu")
async def show_menu(callback: types.CallbackQuery):
    tracks = get_tracks()
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=f"{t['name']} - {PRICE}грн", callback_data=f"buy_{t['index']}")] for t in tracks])
    await callback.message.edit_text("Оберіть музику:", reply_markup=kb)

@dp.callback_query(lambda c: c.data.startswith("buy_"))
async def buy_choice(callback: types.CallbackQuery):
    tracks = get_tracks()
    idx = int(callback.data.split("_")[1])
    track = tracks[idx]
    url = f"https://send.monobank.ua/jar/9UrhoP4T7P?a={PRICE}&t={track['name']}"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💳 Оплатити", url=url)],
        [InlineKeyboardButton(text="✅ Я оплатив", callback_data=f"verify_{track['id']}_{track['name']}")]
    ])
    await callback.message.edit_text(f"Трек: {track['name']}. Ціна: {PRICE} грн.", reply_markup=kb)

@dp.callback_query(lambda c: c.data.startswith("verify_"))
async def verify(callback: types.CallbackQuery):
    data = callback.data.split("_")
    file_id, track_name = data[1], data[2]
    await callback.answer("Перевіряємо...")
    
    if await check_mono_payment(PRICE, track_name):
        url = f"https://drive.google.com/uc?export=download&id={file_id}"
        await callback.message.answer(f"Оплату знайдено! Скачати: {url}")
    else:
        await callback.message.answer("Оплату ще не знайдено. Спробуйте через хвилину.")

def run_web():
    port = int(os.environ.get("PORT", 8080))
    app.run(host='0.0.0.0', port=port)

async def main():
    # Запуск сервера Flask у фоновому потоці
    threading.Thread(target=run_web, daemon=True).start()
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())import asyncio
import logging
import os
import threading
import aiohttp
from flask import Flask, jsonify
from flask_cors import CORS
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton
from dotenv import load_dotenv
from googleapiclient.discovery import build

# Завантаження змінних оточення
load_dotenv()
TOKEN = os.getenv("BOT_TOKEN")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
MONO_TOKEN = os.getenv("MONO_TOKEN")

# Налаштування Flask для Render та сайту
app = Flask('')
CORS(app)

logging.basicConfig(level=logging.INFO)
bot = Bot(token=TOKEN)
dp = Dispatcher()

FOLDER_ID = "1FGNuLTq9mFHqoUSqp-7PSKHixZHq3W2j"
PRICE = 50

def get_tracks():
    try:
        service = build("drive", "v3", developerKey=GOOGLE_API_KEY)
        results = service.files().list(
            q=f"'{FOLDER_ID}' in parents and mimeType='audio/mpeg' and trashed=false",
            fields="files(id, name)", orderBy="name"
        ).execute()
        files = results.get("files", [])
        return [{"index": i, "name": f["name"].replace(".mp3", ""), "id": f["id"]} for i, f in enumerate(files)]
    except Exception as e:
        logging.error(f"Помилка Google Drive: {e}")
        return []

@app.route('/')
def home():
    return "Сервер бота та API активний"

@app.route('/api/music')
def api_music():
    current_tracks = get_tracks()
    return jsonify([{"id": t['id'], "name": t['name']} for t in current_tracks])

async def check_mono_payment(amount, comment):
    """Перевірка виписки Monobank"""
    url = "https://api.monobank.ua/personal/statement/0/0"
    headers = {"X-Token": MONO_TOKEN}
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    for tr in data:
                        if tr.get('amount') >= amount * 100 and comment in tr.get('comment', ''):
                            return True
        except: pass
    return False

@dp.message(CommandStart())
async def start(message: Message):
    args = message.text.split()
    if len(args) > 1 and args[1].startswith("buy_"):
        file_id = args[1].replace("buy_", "")
        tracks = get_tracks()
        track_name = next((t['name'] for t in tracks if t['id'] == file_id), "Трек")
        url = f"https://send.monobank.ua/jar/9UrhoP4T7P?a={PRICE}&t={track_name}"
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=f"💳 Оплатити {PRICE} грн", url=url)],
            [InlineKeyboardButton(text="✅ Я оплатив", callback_data=f"verify_{file_id}_{track_name}")]
        ])
        await message.answer(f"Ви обрали: {track_name}. Оплатіть та натисніть кнопку:", reply_markup=kb)
        return
    
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🎵 Список треків", callback_data="menu")]])
    await message.answer("Проєкт «Голос проти раку» вітає вас!", reply_markup=kb)

@dp.callback_query(lambda c: c.data == "menu")
async def show_menu(callback: types.CallbackQuery):
    tracks = get_tracks()
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=f"{t['name']} - {PRICE}грн", callback_data=f"buy_{t['index']}")] for t in tracks])
    await callback.message.edit_text("Оберіть музику:", reply_markup=kb)

@dp.callback_query(lambda c: c.data.startswith("buy_"))
async def buy_choice(callback: types.CallbackQuery):
    tracks = get_tracks()
    idx = int(callback.data.split("_")[1])
    track = tracks[idx]
    url = f"https://send.monobank.ua/jar/9UrhoP4T7P?a={PRICE}&t={track['name']}"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💳 Оплатити", url=url)],
        [InlineKeyboardButton(text="✅ Я оплатив", callback_data=f"verify_{track['id']}_{track['name']}")]
    ])
    await callback.message.edit_text(f"Трек: {track['name']}. Ціна: {PRICE} грн.", reply_markup=kb)

@dp.callback_query(lambda c: c.data.startswith("verify_"))
async def verify(callback: types.CallbackQuery):
    data = callback.data.split("_")
    file_id, track_name = data[1], data[2]
    await callback.answer("Перевіряємо...")
    
    if await check_mono_payment(PRICE, track_name):
        url = f"https://drive.google.com/uc?export=download&id={file_id}"
        await callback.message.answer(f"Оплату знайдено! Скачати: {url}")
    else:
        await callback.message.answer("Оплату ще не знайдено. Спробуйте через хвилину.")

def run_web():
    port = int(os.environ.get("PORT", 8080))
    app.run(host='0.0.0.0', port=port)

async def main():
    # Запуск сервера Flask у фоновому потоці
    threading.Thread(target=run_web, daemon=True).start()
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
