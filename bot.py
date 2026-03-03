import asyncio
import logging
import os
import threading
from flask import Flask
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton
from dotenv import load_dotenv
from googleapiclient.discovery import build

load_dotenv()
TOKEN = os.getenv("BOT_TOKEN")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# --- МІКРО-СЕРВЕР ДЛЯ RENDER ---
app = Flask('')
@app.route('/')
def home():
    return "Бот працює!"

def run_web():
    port = int(os.environ.get("PORT", 8080))
    app.run(host='0.0.0.0', port=port)
# ------------------------------

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
        return [{"index": i, "name": f["name"].replace(".mp3", ""), "id": f["id"]} 
                for i, f in enumerate(results.get("files", []))]
    except: return []

TRACKS = get_tracks()

@dp.message(CommandStart())
async def start(message: Message):
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🎵 Треки", callback_data="menu")]])
    await message.answer("Вітаємо у проєкті «Голос проти раку»!", reply_markup=kb)

@dp.callback_query(lambda c: c.data == "menu")
async def show_menu(callback: types.CallbackQuery):
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
    await callback.message.edit_text(f"Ви обрали: {track['name']}. Оплатіть і натисніть кнопку.", reply_markup=kb)

@dp.callback_query(lambda c: c.data.startswith("paid_"))
async def paid(callback: types.CallbackQuery):
    index = int(callback.data.split("_")[1])
    url = f"https://drive.google.com/uc?export=download&id={TRACKS[index]['id']}"
    await callback.message.answer(f"Дякуємо! Скачати: {url}")

async def main_loop():
    # Запуск веб-сервера для Render в окремому потоці
    threading.Thread(target=run_web).start()
    logging.info("Polling started...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main_loop())
