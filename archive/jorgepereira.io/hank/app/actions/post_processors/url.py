"""URL post-processor — fetches the page title for URL memories.

When a memory is of type "url", this fetches the page and extracts
the <title> tag, then adds it to the frontmatter for future search/indexing.
"""

import logging
import re

import httpx

from app.actions.remember import MemoryMetadata

logger = logging.getLogger(__name__)


def _extract_url(filepath: str) -> str | None:
    """Extract the first URL from a memory file's body (after frontmatter)."""
    with open(filepath, "r") as f:
        content = f.read()

    # Skip frontmatter
    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            content = content[end + 3:]

    # Find first URL in the body
    match = re.search(r'https?://\S+', content)
    return match.group(0) if match else None


def _add_frontmatter_field(filepath: str, key: str, value: str) -> None:
    """Add a field to the YAML frontmatter of a markdown file."""
    with open(filepath, "r") as f:
        content = f.read()

    if not content.startswith("---"):
        return

    # Find the closing ---
    end = content.find("---", 3)
    if end == -1:
        return

    # Insert the new field before the closing ---
    # Escape quotes in the value for YAML
    escaped = value.replace('"', '\\"')
    new_field = f'{key}: "{escaped}"\n'
    content = content[:end] + new_field + content[end:]

    with open(filepath, "w") as f:
        f.write(content)


async def fetch_url_title(filepath: str, metadata: MemoryMetadata) -> None:
    """Fetch the page title for a URL memory and add it to frontmatter.

    Fetches the URL, extracts the <title> tag, and adds it as a
    "title" field in the frontmatter.
    """
    url = _extract_url(filepath)
    if not url:
        logger.warning("No URL found in %s, skipping title fetch", filepath)
        return

    logger.info("Fetching title for %s", url)

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            resp = await client.get(url, headers={"User-Agent": "HankBot/1.0"})
            resp.raise_for_status()
    except Exception as e:
        logger.warning("Failed to fetch %s: %s", url, e)
        return

    # Extract <title> from HTML
    match = re.search(r'<title[^>]*>(.*?)</title>', resp.text, re.IGNORECASE | re.DOTALL)
    if not match:
        logger.info("No <title> found for %s", url)
        return

    title = match.group(1).strip()
    # Clean up common title artifacts
    title = re.sub(r'\s+', ' ', title)  # collapse whitespace

    if title:
        logger.info("Fetched title for %s: %s", url, title[:80])
        _add_frontmatter_field(filepath, "title", title)
