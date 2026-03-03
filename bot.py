import asyncio
import logging
import os
import threading
from flask import Flask, jsonify
from flask_cors import CORS
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton
from dotenv import load_dotenv
from googleapiclient.discovery import build

load_dotenv()
TOKEN = os.getenv("BOT_TOKEN")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# Налаштування сервера для Render та сайту
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
        logging.error(f"Drive error: {e}")
        return []

@app.route('/')
def home():
    return "Статус: Бот та API активні"

@app.route('/api/music')
def api_music():
    return jsonify([{"id": t['id'], "name": t['name']} for t in get_tracks()])

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
            [InlineKeyboardButton(text="✅ Я оплатив", callback_data=f"paid_{file_id}")]
        ])
        await message.answer(f"Ви обрали: {track_name}. Оплатіть і натисніть кнопку підтвердження:", reply_markup=kb)
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
        [InlineKeyboardButton(text="✅ Я оплатив", callback_data=f"paid_{track['id']}")]
    ])
    await callback.message.edit_text(f"Трек: {track['name']}. Ціна: {PRICE} грн. Після оплати натисніть кнопку:", reply_markup=kb)

@dp.callback_query(lambda c: c.data.startswith("paid_"))
async def timer_wait(callback: types.CallbackQuery):
    file_id = callback.data.split("_")[1]
    await callback.message.answer("Зачекайте 3 хвилини, ми перевіряємо ваш платіж... Посилання прийде автоматично.")
    
    # Таймер на 180 секунд (3 хвилини)
    await asyncio.sleep(180)
    
    download_url = f"https://drive.google.com/uc?export=download&id={file_id}"
    await callback.message.answer(f"Дякуємо за терпіння! Ваше посилання на завантаження:\n{download_url}")

def run_web():
    port = int(os.environ.get("PORT", 8080))
    app.run(host='0.0.0.0', port=port)

async def main():
    threading.Thread(target=run_web, daemon=True).start()
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
