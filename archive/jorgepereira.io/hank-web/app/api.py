"""API endpoints for browsing memories.

All endpoints require authentication via Google OAuth session cookie.
Reads memory files from data/memories/ (shared Docker volume with hank bot).
"""

import os
import logging
import re

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import FileResponse

from app.auth import require_auth

logger = logging.getLogger(__name__)

MEMORIES_DIR = os.getenv("MEMORIES_DIR", "data/memories")

router = APIRouter(prefix="/api")


def _parse_frontmatter(filepath: str) -> dict:
    """Parse YAML frontmatter from a memory file."""
    try:
        with open(filepath, "r") as f:
            lines = f.readlines()
    except OSError:
        return {}

    if not lines or lines[0].strip() != "---":
        return {}

    meta = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip().strip('"')
    return meta


def _extract_body(filepath: str) -> str:
    """Extract the markdown body (after frontmatter) from a memory file."""
    try:
        with open(filepath, "r") as f:
            content = f.read()
    except OSError:
        return ""

    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            return content[end + 3:].strip()
    return content


@router.get("/memories")
async def list_memory_dates(request: Request):
    """List all dates that have memories."""
    require_auth(request)

    if not os.path.isdir(MEMORIES_DIR):
        return {"dates": []}

    dates = sorted(
        (d for d in os.listdir(MEMORIES_DIR) if os.path.isdir(os.path.join(MEMORIES_DIR, d))),
        reverse=True,
    )
    return {"dates": dates}


@router.get("/memories/{date}")
async def list_memories_for_date(date: str, request: Request):
    """List all memories for a specific date."""
    require_auth(request)

    day_dir = os.path.join(MEMORIES_DIR, date)
    if not os.path.isdir(day_dir):
        raise HTTPException(status_code=404, detail=f"No memories for {date}")

    files = sorted(f for f in os.listdir(day_dir) if f.endswith(".md"))

    memories = []
    for filename in files:
        filepath = os.path.join(day_dir, filename)
        meta = _parse_frontmatter(filepath)

        time_match = re.search(r"T(\d{2})-(\d{2})-(\d{2})", filename)
        time_str = f"{time_match.group(1)}:{time_match.group(2)}:{time_match.group(3)}" if time_match else ""

        body = _extract_body(filepath)
        title = ""
        for line in body.split("\n"):
            if line.strip().startswith("# "):
                title = line.strip()[2:]
                break

        memories.append({
            "filename": filename,
            "date": date,
            "time": time_str,
            "title": title or filename,
            "type": meta.get("type", "note"),
            "medium": meta.get("medium", "unknown"),
            "source": meta.get("source", "unknown"),
        })

    return {"date": date, "memories": memories}


@router.get("/memories/{date}/{filename}")
async def get_memory(date: str, filename: str, request: Request):
    """Get a single memory's full content and metadata."""
    require_auth(request)

    filepath = os.path.join(MEMORIES_DIR, date, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Memory not found")

    meta = _parse_frontmatter(filepath)
    body = _extract_body(filepath)

    has_html = os.path.exists(filepath.replace(".md", ".html"))
    image_file = meta.get("image")

    return {
        "filename": filename,
        "date": date,
        "metadata": meta,
        "body": body,
        "has_html": has_html,
        "image_file": image_file,
    }


@router.get("/memories/{date}/{filename}/html")
async def get_memory_html(date: str, filename: str, request: Request):
    """Get the raw HTML version of a memory."""
    require_auth(request)

    html_path = os.path.join(MEMORIES_DIR, date, filename.replace(".md", ".html"))
    if not os.path.exists(html_path):
        raise HTTPException(status_code=404, detail="No HTML version")

    with open(html_path, "r") as f:
        return {"html": f.read()}


@router.get("/memories/{date}/{filename}/image")
async def get_memory_image(date: str, filename: str, request: Request):
    """Serve the image file associated with a memory."""
    require_auth(request)

    meta = _parse_frontmatter(os.path.join(MEMORIES_DIR, date, filename))
    image_file = meta.get("image")
    if not image_file:
        raise HTTPException(status_code=404, detail="No image")

    image_path = os.path.join(MEMORIES_DIR, date, image_file)
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image file not found")

    return FileResponse(image_path)
