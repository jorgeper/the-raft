"""Google OAuth authentication.

Uses Google OAuth2 to authenticate users. Only the email address
specified in ALLOWED_EMAIL env var is permitted access.

Flow:
1. User visits /login → redirected to Google
2. Google redirects back to /auth/callback with a code
3. We exchange the code for tokens, verify the email
4. Set a signed session cookie
5. All /api/* and /app/* routes check the cookie
"""

import os
import logging

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import RedirectResponse
from itsdangerous import URLSafeTimedSerializer

logger = logging.getLogger(__name__)

router = APIRouter()

# Session cookie signing
SESSION_SECRET = os.getenv("SESSION_SECRET", "change-me-in-production")
SESSION_MAX_AGE = 60 * 60 * 24 * 7  # 7 days
_serializer = URLSafeTimedSerializer(SESSION_SECRET)

COOKIE_NAME = "hank_session"

# OAuth setup
oauth = OAuth()
oauth.register(
    name="google",
    client_id=os.getenv("GOOGLE_CLIENT_ID", ""),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET", ""),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


def get_current_user(request: Request) -> str | None:
    """Extract the authenticated email from the session cookie.

    Returns the email string or None if not authenticated.
    """
    cookie = request.cookies.get(COOKIE_NAME)
    if not cookie:
        return None
    try:
        email = _serializer.loads(cookie, max_age=SESSION_MAX_AGE)
        return email
    except Exception:
        return None


def require_auth(request: Request) -> str:
    """Require authentication. Returns the email or raises 401."""
    email = get_current_user(request)
    if not email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return email


@router.get("/login")
async def login(request: Request):
    """Redirect to Google OAuth login."""
    redirect_uri = str(request.url_for("auth_callback"))
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/auth/callback")
async def auth_callback(request: Request):
    """Handle Google OAuth callback — verify email and set session cookie."""
    token = await oauth.google.authorize_access_token(request)
    user_info = token.get("userinfo")

    if not user_info or not user_info.get("email"):
        logger.warning("OAuth callback: no email in response")
        raise HTTPException(status_code=403, detail="Could not get email from Google")

    email = user_info["email"].lower()
    allowed_email = os.getenv("ALLOWED_EMAIL", "").lower()

    if allowed_email and email != allowed_email:
        logger.warning("OAuth: blocked login from %s (allowed: %s)", email, allowed_email)
        raise HTTPException(status_code=403, detail=f"Access denied for {email}")

    logger.info("OAuth: logged in as %s", email)

    # Set signed session cookie and redirect to the app
    response = RedirectResponse(url="/app")
    cookie_value = _serializer.dumps(email)
    response.set_cookie(
        COOKIE_NAME,
        cookie_value,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return response


@router.get("/logout")
async def logout():
    """Clear the session cookie and redirect to login."""
    response = RedirectResponse(url="/login")
    response.delete_cookie(COOKIE_NAME)
    return response
