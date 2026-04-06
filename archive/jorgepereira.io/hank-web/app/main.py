"""Hank Web — memory browser frontend.

A lightweight FastAPI app that serves a web UI for browsing saved memories.
Authenticates via Google OAuth (only ALLOWED_EMAIL can access).

Reads memory files from data/memories/ (shared Docker volume with the hank bot).
"""

import logging
import os
import pathlib

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse, FileResponse
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.auth import router as auth_router, get_current_user
from app.api import router as api_router

load_dotenv(".env.local")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

STATIC_DIR = pathlib.Path(__file__).parent / "static"

server = FastAPI()

server.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET", "change-me-in-production"),
)

server.include_router(auth_router)
server.include_router(api_router)


@server.get("/")
async def root():
    """Redirect root to the app."""
    return RedirectResponse(url="/app")


@server.get("/health")
async def health():
    """Health check."""
    return {"status": "ok"}


@server.get("/app")
async def app_page(request: Request):
    """Serve the memories browser. Requires authentication."""
    if not get_current_user(request):
        return RedirectResponse(url="/login")
    return FileResponse(STATIC_DIR / "app.html")


def main() -> None:
    port = int(os.getenv("PORT", "8001"))
    # proxy_headers=True tells uvicorn to trust X-Forwarded-Proto from Caddy
    # so redirect URIs use https:// instead of http://
    uvicorn.run(server, host="0.0.0.0", port=port, proxy_headers=True, forwarded_allow_ips="*")


if __name__ == "__main__":
    main()
