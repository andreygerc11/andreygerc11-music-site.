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

# Налаштування Flask для сайту та Render
app = Flask('')
CORS(app)  # Виправляє помилку доступу (CORS) для вашого сайту на GitHub

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

TRACKS = get_tracks()

# API для вашого сайту (music.html)
@app.route('/api/music')
def api_music():
    current_tracks = get_tracks()
    return jsonify([{"id": t['id'], "name": t['name']} for t in current_tracks])

@app.route('/')
def home():
    return "Сервер бота та API активний"

def run_web():
    port = int(os.environ.get("PORT", 8080))
    app.run(host='0.0.0.0', port=port)

# Логіка Телеграм-бота
@dp.message(CommandStart())
async def start(message: Message):
    # Обробка входу з сайту (параметр buy_ID)
    args = message.text.split()
    if len(args) > 1 and args[1].startswith("buy_"):
        file_id = args[1].replace("buy_", "")
        url = f"https://send.monobank.ua/jar/9UrhoP4T7P?a={PRICE}"
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💳 Оплатити 50 грн", url=url)],
            [InlineKeyboardButton(text="✅ Я оплатив", callback_data=f"check_{file_id}")]
        ])
        await message.answer("Ви перейшли з сайту. Оплатіть трек для завантаження:", reply_markup=kb)
        return

    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🎵 Перейти до треків", callback_data="menu")]])
    await message.answer("Вітаємо у проєкті «Голос проти раку»!", reply_markup=kb)

@dp.callback_query(lambda c: c.data == "menu")
async def show_menu(callback: types.CallbackQuery):
    global TRACKS
    TRACKS = get_tracks()
    if not TRACKS:
        await callback.message.edit_text("Список порожній.")
        return
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=f"{t['name']} - {PRICE}грн", callback_data=f"buy_{t['index']}")] for t in TRACKS])
    await callback.message.edit_text("Оберіть пісню:", reply_markup=kb)

@dp.callback_query(lambda c: c.data.startswith("buy_"))
async def buy(callback: types.CallbackQuery):
    index = int(callback.data.split("_")[1])
    track = TRACKS[index]
    url = f"https://send.monobank.ua/jar/9UrhoP4T7P?a={PRICE}&t={track['name']}"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💳 Оплатити", url=url)],
        [InlineKeyboardButton(text="✅ Я оплатив", callback_data=f"paid_{index}")]
    ])
    await callback.message.edit_text(f"Трек: {track['name']}. Ціна: {PRICE} грн.", reply_markup=kb)

@dp.callback_query(lambda c: c.data.startswith("paid_") or c.data.startswith("check_"))
async def deliver(callback: types.CallbackQuery):
    # Спрощена логіка видачі (посилання на GDrive)
    await callback.message.answer("Дякуємо за підтримку! Ваше посилання на скачування буде надіслано після перевірки оплати.")

async def main():
    threading.Thread(target=run_web, daemon=True).start()
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
