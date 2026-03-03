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

load_dotenv()
TOKEN = os.getenv("BOT_TOKEN")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

logging.basicConfig(level=logging.INFO)
bot = Bot(token=TOKEN)
dp = Dispatcher()

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

@dp.message(CommandStart())
async def start(message: Message):
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
    user_id = callback.from_user.id
    key = f"{user_id}_{index}"
    payment_timers[key] = datetime.now()
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"Оплатити {PRICE} грн", url=track["payUrl"])]
    ])
    await callback.message.edit_text(
        "Натисни на кнопку «Оплатити 50 грн» нижче.\n\n"
        "Зачекайте 3 хвилини, поки пройде транзакція.\n"
        "Після цього автоматично з’явиться кнопка «Я оплатив».",
        reply_markup=kb
    )

async def check_timers():
    while True:
        await asyncio.sleep(30)
        now = datetime.now()
        for key, start_time in list(payment_timers.items()):
            # Якщо пройшло 3 хвилини і ми ще не показували кнопку
            if now - start_time >= timedelta(minutes=3) and now - start_time < timedelta(minutes=4):
                user_id, track_index = map(int, key.split("_"))
                track = TRACKS[track_index]
                kb = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="Я оплатив", callback_data=f"paid_{track_index}")]
                ])
                try:
                    await bot.send_message(user_id, f"Пісня: {track['name']}\nНатисни кнопку:", reply_markup=kb)
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
    asyncio.create_task(check_timers())
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())