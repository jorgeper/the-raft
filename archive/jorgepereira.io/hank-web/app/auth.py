"""Google OAuth authentication.

Uses Google OAuth2 to authenticate users. Only users with an identity
in identities.json are permitted access (resolved by email).

Flow:
1. User visits /login → redirected to Google
2. Google redirects back to /auth/callback with a code
3. We exchange the code for tokens, verify the email against identity registry
4. Set a signed session cookie with the identity ID
5. All /api/* and /app routes check the cookie
"""

import json
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


def _load_identities() -> dict:
    """Load identities and build email→identity lookup."""
    path = os.getenv("IDENTITIES_FILE", "data/identities.json")
    abs_path = os.path.abspath(path)
    logger.info("Loading identities from %s (abs: %s, exists: %s)", path, abs_path, os.path.exists(path))
    try:
        with open(path) as f:
            raw = f.read()
        logger.info("Raw identities (%d bytes): %s", len(raw), raw[:500])
        entries = json.loads(raw)
    except FileNotFoundError:
        logger.warning("Identities file not found: %s", abs_path)
        return {}
    except json.JSONDecodeError as e:
        logger.warning("Identities file not valid JSON: %s — %s", abs_path, e)
        return {}
    lookup = {}
    for entry in entries:
        for email in entry.get("emails", []):
            lookup[email.lower()] = entry
    logger.info("Loaded %d identities, email lookup: %s", len(entries), list(lookup.keys()))
    return lookup


def get_current_user(request: Request) -> dict | None:
    """Extract the authenticated identity from the session cookie.

    Returns a dict with 'id' and 'email' keys, or None.
    """
    cookie = request.cookies.get(COOKIE_NAME)
    if not cookie:
        return None
    try:
        data = _serializer.loads(cookie, max_age=SESSION_MAX_AGE)
        # New format: JSON string with identity info
        if isinstance(data, str) and data.startswith("{"):
            return json.loads(data)
        # Legacy format: plain email string — try to resolve
        identities = _load_identities()
        identity = identities.get(data.lower())
        if identity:
            return {"id": identity["id"], "email": data}
        return None
    except Exception:
        return None


def require_auth(request: Request) -> dict:
    """Require authentication. Returns identity dict or raises 401."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


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

    # Verify against identity registry
    identities = _load_identities()
    identity = identities.get(email)
    if not identity:
        logger.warning("OAuth: blocked login from %s (no identity found)", email)
        raise HTTPException(status_code=403, detail=f"Access denied for {email}")

    logger.info("OAuth: logged in as %s (identity=%s)", email, identity["id"])

    response = RedirectResponse(url="/app")
    cookie_value = _serializer.dumps(json.dumps({"id": identity["id"], "email": email}))
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
