"""Hank entrypoint.

This is the main application file. It wires everything together:
- Selects which processor to use (hank, helloworld) based on PROCESSOR env var
- Injects the processor into both the Telegram bot and the email handler
- Starts the FastAPI server with endpoints for both channels:
  - POST /telegram — receives Telegram updates (webhook mode)
  - POST /email — receives inbound emails from Mailgun
  - GET /health — health check
"""

import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request

from app.bot import create_app as create_telegram_app
from app.email_handler import router as email_router, set_processor as set_email_processor, set_registry as set_email_registry
from app.identity import load_registry, IdentityRegistry
from app.processor import Processor

# Load .env.local for direct (non-Docker) runs.
# In Docker, env vars are injected via docker-compose env_file, so this is a no-op.
load_dotenv(".env.local")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Processor registry
# ---------------------------------------------------------------------------

PROCESSORS: dict[str, type[Processor]] = {}


def _load_processors() -> dict[str, type[Processor]]:
    """Register all available processor classes.

    To add a new processor, import it here and add it to the dict.
    The key becomes the value you set in the PROCESSOR env var.
    """
    from app.processors.hank import HankProcessor
    from app.processors.helloworld import HelloWorldProcessor
    return {
        "hank": HankProcessor,
        "helloworld": HelloWorldProcessor,
    }


def _create_processor() -> Processor:
    """Instantiate the processor selected by the PROCESSOR env var."""
    global PROCESSORS
    PROCESSORS = _load_processors()

    processor_name = os.getenv("PROCESSOR", "hank")
    processor_cls = PROCESSORS.get(processor_name)
    if not processor_cls:
        raise ValueError(f"Unknown processor: {processor_name}. Available: {list(PROCESSORS.keys())}")

    logger.info("Using processor: %s", processor_name)
    return processor_cls()


# ---------------------------------------------------------------------------
# Telegram setup
# ---------------------------------------------------------------------------

# Global reference to the Telegram Application, used by the webhook endpoint.
telegram_app = None

# Global identity registry, loaded at startup.
registry: IdentityRegistry | None = None


async def _start_telegram(processor: Processor) -> None:
    """Initialize and start the Telegram bot."""
    global telegram_app

    token = os.environ["TELEGRAM_BOT_TOKEN"]
    mode = os.getenv("MODE", "polling")

    telegram_app = create_telegram_app(token, processor, registry=registry)
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


async def _stop_telegram() -> None:
    """Gracefully shut down the Telegram bot."""
    mode = os.getenv("MODE", "polling")
    if mode == "polling":
        await telegram_app.updater.stop()
    await telegram_app.stop()
    await telegram_app.shutdown()


# ---------------------------------------------------------------------------
# Email setup
# ---------------------------------------------------------------------------

def _start_email(processor: Processor) -> None:
    """Inject the processor and registry into the email handler."""
    set_email_processor(processor)
    set_email_registry(registry)
    logger.info("Email handler ready (POST /email)")


# ---------------------------------------------------------------------------
# FastAPI server
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    global registry
    registry = load_registry()
    logger.info("Loaded identity registry (%d identities)", len(registry._identities))

    processor = _create_processor()
    _start_email(processor)
    await _start_telegram(processor)
    logger.info("Hank is ready")
    yield
    await _stop_telegram()


server = FastAPI(lifespan=lifespan)
server.include_router(email_router)


@server.get("/health")
async def health():
    """Simple health check — returns 200 if the server is running."""
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


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    """Start the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(server, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
