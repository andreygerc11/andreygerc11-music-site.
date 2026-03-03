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
        logging.error(f"Помилка Drive: {e}")
        return []

@app.route('/')
def home():
    return "Бот активний"

@app.route('/api/music')
def api_music():
    return jsonify([{"id": t['id'], "name": t['name']} for t in get_tracks()])

def run_web():
    port = int(os.environ.get("PORT", 8080))
    app.run(host='0.0.0.0', port=port)

# ЛОГІКА БОТА
@dp.message(CommandStart())
async def start(message: Message):
    args = message.text.split()
    # Якщо прийшли з сайту
    if len(args) > 1 and args[1].startswith("buy_"):
        file_id = args[1].replace("buy_", "")
        url = f"https://send.monobank.ua/jar/9UrhoP4T7P?a={PRICE}"
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💳 Оплатити 50 грн", url=url)],
            [InlineKeyboardButton(text="✅ Я оплатив", callback_data=f"check_{file_id}")]
        ])
        await message.answer("Ви обрали трек на сайті. Будь ласка, оплатіть його та натисніть кнопку нижче:", reply_markup=kb)
        return
    
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🎵 Перейти до треків", callback_data="menu")]])
    await message.answer("Вітаємо у проєкті «Голос проти раку»! Оберіть музику для підтримки.", reply_markup=kb)

@dp.callback_query(lambda c: c.data == "menu")
async def show_menu(callback: types.CallbackQuery):
    tracks = get_tracks()
    if not tracks:
        await callback.message.edit_text("Помилка: треки не знайдено.")
        return
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=f"{t['name']} - {PRICE}грн", callback_data=f"buy_{t['index']}")] for t in tracks])
    await callback.message.edit_text("Оберіть музику:", reply_markup=kb)

@dp.callback_query(lambda c: c.data.startswith("buy_"))
async def buy(callback: types.CallbackQuery):
    tracks = get_tracks()
    index = int(callback.data.split("_")[1])
    track = tracks[index]
    url = f"https://send.monobank.ua/jar/9UrhoP4T7P?a={PRICE}&t={track['name']}"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💳 Оплатити", url=url)],
        [InlineKeyboardButton(text="✅ Я оплатив", callback_data=f"paid_{track['id']}")]
    ])
    await callback.message.edit_text(f"Ви обрали: {track['name']}. Ціна: {PRICE} грн. Після оплати натисніть кнопку:", reply_markup=kb)

@dp.callback_query(lambda c: c.data.startswith("paid_") or c.data.startswith("check_"))
async def deliver(callback: types.CallbackQuery):
    # Отримуємо ID файлу з callback_data
    file_id = callback.data.split("_")[1]
    # Тепер видаємо посилання тільки після того, як людина натиснула "Я оплатив"
    download_url = f"https://drive.google.com/uc?export=download&id={file_id}"
    await callback.message.answer(f"Дякуємо за вашу підтримку! Ось ваше посилання на завантаження:\n{download_url}")

async def main():
    threading.Thread(target=run_web, daemon=True).start()
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
