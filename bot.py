import asyncio
import logging
from datetime import datetime, timedelta
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart, Command
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton
from dotenv import load_dotenv
import os
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from flask import Flask, request, jsonify
from flask_cors import CORS
import threading
import urllib.request
import json

load_dotenv()
TOKEN = os.getenv("BOT_TOKEN")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# ТВІЙ ID ДЛЯ ТЕХПІДТРИМКИ
ADMIN_ID = 556627059 

logging.basicConfig(level=logging.INFO)
bot = Bot(token=TOKEN)
dp = Dispatcher()

app = Flask(__name__)
CORS(app)

FOLDER_ID = "1FGNuLTq9mFHqoUSqp-7PSKHixZHq3W2j"
PRICE = 50
MONO_PAY_LINK = f"https://send.monobank.ua/jar/9UrhoP4T7P?a={PRICE}"

payment_timers = {} 

def get_tracks():
    try:
        service = build("drive", "v3", developerKey=GOOGLE_API_KEY)
        results = service.files().list(
            q=f"'{FOLDER_ID}' in parents and mimeType='audio/mpeg' and trashed=false",
            fields="files(id, name)",
            orderBy="name"
        ).execute()
        files = results.get("files", [])
        
        tracks = []
        for i, file in enumerate(files):
            name = file["name"].replace(".mp3", "").strip()
            tracks.append({
                "index": i,
                "name": name,
                "id": file["id"],
                "payUrl": f"{MONO_PAY_LINK}&t={name.replace(' ', '%20')}"
            })
        return tracks
    except HttpError as error:
        logging.error(f"Помилка Drive API: {error}")
        return []

TRACKS = get_tracks()

@app.route('/api/music', methods=['GET'])
def music_api():
    return jsonify(TRACKS)

@app.route('/api/support', methods=['POST'])
def support_handler():
    data = request.json
    name = data.get('name', 'Анонім')
    message = data.get('message', '')
    
    admin_text = f"📩 **Нове запитання з сайту!**\n\n👤 Від: {name}\n💬 Текст: {message}"
    
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    req = urllib.request.Request(url, method="POST")
    req.add_header('Content-Type', 'application/json')
    payload = json.dumps({"chat_id": ADMIN_ID, "text": admin_text}).encode('utf-8')
    
    try:
        urllib.request.urlopen(req, data=payload)
        return jsonify({"status": "ok"}), 200
    except Exception as e:
        logging.error(f"Помилка відправки техпідтримки: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@dp.message(CommandStart())
async def start(message: Message):
    # 1. ОБРОБКА ПЕРЕХОДУ З САЙТУ (коли людина тисне "Придбати")
    args = message.text.split(" ")
    if len(args) > 1 and args[1].startswith("buy_"):
        file_id = args[1].split("buy_")[1]
        track = next((t for t in TRACKS if t["id"] == file_id), None)
        
        if track:
            user_id = message.from_user.id
            key = f"{user_id}_{track['index']}"
            payment_timers[key] = datetime.now()
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text=f"Оплатити {PRICE} грн", url=track["payUrl"])]
            ])
            await message.answer(
                f"Ви обрали пісню: {track['name']}\n\n"
                f"Натисніть на кнопку «Оплатити {PRICE} грн» нижче.\n\n"
                "Зачекайте 3 хвилини, поки пройде транзакція.\n"
                "Після цього автоматично з’явиться кнопка «Я оплатив».",
                reply_markup=kb
            )
            return

    # 2. СТАНДАРТНЕ МЕНЮ (якщо просто написати /start у боті)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Переглянути треки", callback_data="show_menu")]
    ])
    await message.answer(
        f"Вітаю! Це бот «Голос проти раку».\n"
        f"Тут можна підтримати проєкт і отримати повні версії пісень за {PRICE} грн.\n\n"
        "Натисни кнопку нижче, щоб побачити список.",
        reply_markup=kb
    )

@dp.callback_query(lambda c: c.data == "show_menu")
async def show_menu(callback: types.CallbackQuery):
    if not TRACKS:
        await callback.message.edit_text("На жаль, пісень поки що немає.")
        await callback.answer()
        return
    kb = InlineKeyboardMarkup(inline_keyboard=[])
    for track in TRACKS:
        btn = InlineKeyboardButton(text=f"{track['name']} – {PRICE} грн", callback_data=f"buy_{track['index']}")
        kb.inline_keyboard.append([btn])
    await callback.message.edit_text("Обери пісню для покупки:", reply_markup=kb)
    await callback.answer()

@dp.callback_query(lambda c: c.data.startswith("buy_"))
async def buy_track(callback: types.CallbackQuery):
    try:
        index = int(callback.data.split("_")[1])
        track = TRACKS[index]
    except:
        await callback.answer("Трек не знайдено", show_alert=True)
        return
    
    # ВИПРАВЛЕНО ОДРУКІВКУ
    user_id = callback.from_user.id
    key = f"{user_id}_{index}"
    payment_timers[key] = datetime.now()
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"Оплатити {PRICE} грн", url=track["payUrl"])]
    ])
    await callback.message.edit_text(
        f"Натисни на кнопку «Оплатити {PRICE} грн» нижче.\n\n"
        "Зачекайте 3 хвилини, поки пройде транзакція.\n"
        "Після цього автоматично з’явиться кнопка «Я оплатив».",
        reply_markup=kb
    )

async def check_timers():
    while True:
        await asyncio.sleep(30)
        now = datetime.now()
        for key, start_time in list(payment_timers.items()):
            if now - start_time >= timedelta(minutes=3) and now - start_time < timedelta(minutes=4):
                user_id, track_index = map(int, key.split("_"))
                track = TRACKS[track_index]
                kb = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="Я оплатив", callback_data=f"paid_{track_index}")]
                ])
                try:
                    await bot.send_message(user_id, f"Пісня: {track['name']}\nТранзакція перевірена! Натисни кнопку:", reply_markup=kb)
                except:
                    pass

@dp.callback_query(lambda c: c.data.startswith("paid_"))
async def paid_track(callback: types.CallbackQuery):
    index = int(callback.data.split("_")[1])
    track = TRACKS[index]
    file_url = f"https://drive.google.com/uc?export=download&id={track['id']}"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Скачати трек", url=file_url)]
    ])
    await callback.message.edit_text(f"Дякую за підтримку! 💙\nОсь посилання: {track['name']}", reply_markup=kb)
    await callback.answer()

async def main():
    def run_flask():
        app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))
    threading.Thread(target=run_flask, daemon=True).start()
    
    await bot.delete_webhook(drop_pending_updates=True)
    
    asyncio.create_task(check_timers())
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
