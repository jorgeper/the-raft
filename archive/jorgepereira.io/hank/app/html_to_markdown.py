"""Convert HTML email content to markdown with inlined images.

Email HTML is heavily table-based for layout (not data). We strip the
layout cruft before converting so the markdown reads like a clean document.

Fetches remote images and embeds them as base64 data URIs so the
markdown file is fully self-contained.
"""

import base64
import logging
import mimetypes
import re

import httpx
from markdownify import markdownify

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# HTML cleanup — strip layout cruft before markdown conversion
# ---------------------------------------------------------------------------

def _clean_html(html: str) -> str:
    """Clean up email HTML before markdown conversion.

    Email newsletters use tables for layout, tracking pixels, social links,
    and other cruft that makes terrible markdown. This strips it down to
    the actual content.
    """
    # Remove tracking pixels (1x1 images, images with "track"/"open" in URL)
    html = re.sub(r'<img[^>]*(width=["\']1["\']|height=["\']1["\'])[^>]*/?\s*>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'<img[^>]*src=["\'][^"\']*(?:track|open|pixel|beacon)[^"\']*["\'][^>]*/?\s*>', '', html, flags=re.IGNORECASE)

    # Remove <style> and <script> blocks entirely
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.IGNORECASE | re.DOTALL)

    # Remove HTML comments
    html = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)

    # Unwrap layout tables — replace <table>, <tr>, <td> with <div>
    # so markdownify treats them as block elements, not data tables.
    for tag in ['table', 'tbody', 'thead', 'tfoot', 'tr']:
        html = re.sub(rf'<{tag}[^>]*>', '<div>', html, flags=re.IGNORECASE)
        html = re.sub(rf'</{tag}>', '</div>', html, flags=re.IGNORECASE)
    html = re.sub(r'<td[^>]*>', '<div>', html, flags=re.IGNORECASE)
    html = re.sub(r'</td>', '</div>', html, flags=re.IGNORECASE)
    html = re.sub(r'<th[^>]*>', '<div>', html, flags=re.IGNORECASE)
    html = re.sub(r'</th>', '</div>', html, flags=re.IGNORECASE)

    # Remove empty links (often used for tracking)
    html = re.sub(r'<a[^>]*>\s*</a>', '', html, flags=re.IGNORECASE)

    # Remove common email footer patterns
    html = re.sub(r'<div[^>]*>\s*(?:unsubscribe|manage preferences|view in browser|update your preferences).*?</div>', '', html, flags=re.IGNORECASE | re.DOTALL)

    return html


def _clean_markdown(md: str) -> str:
    """Clean up markdown after conversion.

    Removes artifacts left by HTML-to-markdown conversion.
    """
    # Collapse excessive blank lines
    md = re.sub(r'\n{3,}', '\n\n', md)

    # Remove lines that are just pipes and dashes (broken table remnants)
    md = re.sub(r'^\s*[\|\-\s]+\s*$', '', md, flags=re.MULTILINE)

    # Remove lines that are just whitespace
    md = re.sub(r'\n[ \t]+\n', '\n\n', md)

    # Collapse excessive blank lines again after cleanup
    md = re.sub(r'\n{3,}', '\n\n', md)

    return md.strip()


# ---------------------------------------------------------------------------
# Image inlining
# ---------------------------------------------------------------------------

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
    if not content_type.startswith("image/"):
        logger.warning("Not an image (%s): %s", content_type, url)
        return None

    mime = content_type.split(";")[0].strip()
    if mime not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
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
    pattern = re.compile(r'(!\[[^\]]*\])\((https?://[^)]+)\)')
    matches = list(pattern.finditer(markdown_text))

    if not matches:
        return markdown_text

    logger.info("Inlining %d images", len(matches))

    replacements = {}
    for match in matches:
        url = match.group(2)
        if url in replacements:
            continue
        data_uri = await _fetch_image_as_base64(url)
        if data_uri:
            replacements[url] = data_uri

    result = markdown_text
    for url, data_uri in replacements.items():
        result = result.replace(f"]({url})", f"]({data_uri})")

    logger.info("Inlined %d of %d images", len(replacements), len(matches))
    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def convert_html_to_markdown(html: str, inline_images: bool = True) -> str:
    """Convert HTML email content to clean markdown.

    1. Clean up email layout HTML (unwrap tables, strip tracking, etc.)
    2. Convert to markdown via markdownify
    3. Clean up markdown artifacts
    4. Optionally inline images as base64

    Args:
        html: The HTML content to convert.
        inline_images: If True, fetch remote images and embed as base64.

    Returns:
        Clean markdown string.
    """
    # Step 1: Clean HTML
    cleaned = _clean_html(html)

    # Step 2: Convert to markdown
    md = markdownify(cleaned, heading_style="ATX", strip=["script", "style"])

    # Step 3: Clean markdown
    md = _clean_markdown(md)

    # Step 4: Inline images
    if inline_images:
        md = await _inline_images(md)

    return md
