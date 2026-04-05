import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request

from app.bot import create_app
from app.email_handler import router as email_router, set_processor
from app.processor import Processor

load_dotenv(".env.local")  # fallback for direct (non-Docker) runs

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

PROCESSORS: dict[str, type[Processor]] = {}


def _load_processors() -> dict[str, type[Processor]]:
    from app.processors.claude import ClaudeProcessor
    from app.processors.helloworld import HelloWorldProcessor
    return {
        "claude": ClaudeProcessor,
        "helloworld": HelloWorldProcessor,
    }


telegram_app = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global telegram_app, PROCESSORS
    PROCESSORS = _load_processors()

    token = os.environ["TELEGRAM_BOT_TOKEN"]
    mode = os.getenv("MODE", "polling")
    processor_name = os.getenv("PROCESSOR", "claude")

    processor_cls = PROCESSORS.get(processor_name)
    if not processor_cls:
        raise ValueError(f"Unknown processor: {processor_name}. Available: {list(PROCESSORS.keys())}")

    processor = processor_cls()
    logger.info("Using processor: %s", processor_name)
    set_processor(processor)

    allowed_users_str = os.getenv("ALLOWED_USER_IDS", "")
    allowed_users = {int(uid.strip()) for uid in allowed_users_str.split(",") if uid.strip()} or None
    if allowed_users:
        logger.info("Restricting to user IDs: %s", allowed_users)

    telegram_app = create_app(token, processor, allowed_users)

    await telegram_app.initialize()
    await telegram_app.start()

    if mode == "polling":
        logger.info("Starting Telegram bot in polling mode")
        await telegram_app.updater.start_polling()
    elif mode == "webhook":
        webhook_url = os.environ["WEBHOOK_BASE_URL"]
        secret = os.environ["TELEGRAM_WEBHOOK_SECRET"]
        logger.info("Setting Telegram webhook to %s/telegram", webhook_url)
        await telegram_app.bot.set_webhook(
            f"{webhook_url}/telegram", secret_token=secret
        )

    logger.info("Starting HTTP server (email endpoint ready)")
    yield

    if mode == "polling":
        await telegram_app.updater.stop()
    await telegram_app.stop()
    await telegram_app.shutdown()


server = FastAPI(lifespan=lifespan)
server.include_router(email_router)


@server.get("/health")
async def health():
    return {"status": "ok"}


@server.post("/telegram")
async def telegram_webhook(request: Request):
    """Receive Telegram updates in webhook mode."""
    secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
    header = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if secret and header != secret:
        logger.warning("Invalid Telegram webhook secret")
        raise HTTPException(status_code=403, detail="Invalid secret")

    from telegram import Update
    data = await request.json()
    update = Update.de_json(data, telegram_app.bot)
    await telegram_app.process_update(update)
    return {"status": "ok"}


def main() -> None:
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(server, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
