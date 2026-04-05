"""Convert HTML email content to markdown with inlined images.

Fetches remote images and embeds them as base64 data URIs so the
markdown file is fully self-contained. Falls back to the original
URL if fetching fails.
"""

import base64
import logging
import mimetypes
import re

import httpx
from markdownify import markdownify

logger = logging.getLogger(__name__)


async def _fetch_image_as_base64(url: str) -> str | None:
    """Download an image and return it as a base64 data URI.

    Returns None if the fetch fails or the content isn't an image.
    """
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url, headers={"User-Agent": "HankBot/1.0"})
            resp.raise_for_status()
    except Exception as e:
        logger.warning("Failed to fetch image %s: %s", url, e)
        return None

    content_type = resp.headers.get("content-type", "")
    # Only process actual images
    if not content_type.startswith("image/"):
        logger.warning("Not an image (%s): %s", content_type, url)
        return None

    # Determine mime type — use content-type header, fallback to guessing from URL
    mime = content_type.split(";")[0].strip()
    if mime == "image/jpeg" or mime == "image/png" or mime == "image/gif" or mime == "image/webp":
        pass  # known good
    else:
        guessed, _ = mimetypes.guess_type(url)
        if guessed and guessed.startswith("image/"):
            mime = guessed

    encoded = base64.b64encode(resp.content).decode("ascii")
    return f"data:{mime};base64,{encoded}"


async def _inline_images(markdown_text: str) -> str:
    """Replace remote image URLs in markdown with base64 data URIs.

    Finds all ![alt](url) patterns and replaces the URL with a base64
    data URI. Skips images that are already data URIs or that fail to fetch.
    """
    # Find all markdown image references: ![alt](url)
    pattern = re.compile(r'(!\[[^\]]*\])\((https?://[^)]+)\)')
    matches = list(pattern.finditer(markdown_text))

    if not matches:
        return markdown_text

    logger.info("Inlining %d images", len(matches))

    # Fetch all images (could parallelize later)
    replacements = {}
    for match in matches:
        url = match.group(2)
        if url in replacements:
            continue  # already fetched this URL
        data_uri = await _fetch_image_as_base64(url)
        if data_uri:
            replacements[url] = data_uri

    # Apply replacements
    result = markdown_text
    for url, data_uri in replacements.items():
        result = result.replace(f"]({url})", f"]({data_uri})")

    logger.info("Inlined %d of %d images", len(replacements), len(matches))
    return result


async def convert_html_to_markdown(html: str, inline_images: bool = True) -> str:
    """Convert HTML to markdown, optionally inlining images as base64.

    Args:
        html: The HTML content to convert.
        inline_images: If True, fetch remote images and embed as base64.

    Returns:
        Markdown string with images inlined.
    """
    # Convert HTML to markdown using markdownify
    md = markdownify(html, heading_style="ATX", strip=["script", "style"])

    # Clean up excessive blank lines
    md = re.sub(r'\n{3,}', '\n\n', md)
    md = md.strip()

    # Inline images if requested
    if inline_images:
        md = await _inline_images(md)

    return md
