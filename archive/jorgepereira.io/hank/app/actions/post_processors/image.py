"""Image post-processor — uses Claude Vision to describe images.

After an image memory is saved, this sends the image to Claude's
vision API to extract a description, any text visible in the image,
and relevant tags. The results are added to the markdown frontmatter.
"""

import base64
import logging
import os

from anthropic import AsyncAnthropic

from app.actions.remember import MemoryMetadata
from app.actions.post_processors.url import _add_frontmatter_field

logger = logging.getLogger(__name__)

VISION_PROMPT = """Analyze this image and provide:
1. A brief description (1-2 sentences)
2. Any text visible in the image (OCR)
3. Key objects or topics (comma-separated tags)

Respond in this exact format:
description: <brief description>
text: <any visible text, or "none">
tags: <comma-separated tags>"""


async def describe_image(filepath: str, metadata: MemoryMetadata) -> None:
    """Send the image to Claude Vision and add the description to frontmatter.

    Reads the image from metadata.image_path, sends it to Claude Vision,
    and adds description, visible text, and tags to the markdown file's frontmatter.
    """
    image_path = metadata.image_path
    if not image_path or not os.path.exists(image_path):
        logger.warning("No image file found for %s", filepath)
        return

    # Read and encode the image
    with open(image_path, "rb") as f:
        image_bytes = f.read()
    image_data = base64.b64encode(image_bytes).decode("ascii")

    # Detect media type from file magic bytes, not extension
    # (Telegram sends JPEGs even when we save as .png)
    if image_bytes[:3] == b'\xff\xd8\xff':
        media_type = "image/jpeg"
    elif image_bytes[:8] == b'\x89PNG\r\n\x1a\n':
        media_type = "image/png"
    elif image_bytes[:4] == b'GIF8':
        media_type = "image/gif"
    elif image_bytes[:4] == b'RIFF' and image_bytes[8:12] == b'WEBP':
        media_type = "image/webp"
    else:
        media_type = "image/jpeg"  # safe default for Telegram

    logger.info("Sending image to Claude Vision: %s (%s)", image_path, media_type)

    try:
        client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        message = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=512,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": VISION_PROMPT,
                    },
                ],
            }],
        )
    except Exception as e:
        logger.error("Claude Vision API call failed: %s", e)
        return

    response = message.content[0].text.strip()
    logger.info("Vision response: %s", response[:200])

    # Parse the structured response and add to frontmatter
    for line in response.split("\n"):
        line = line.strip()
        if line.startswith("description:"):
            desc = line[len("description:"):].strip()
            _add_frontmatter_field(filepath, "description", desc)
        elif line.startswith("text:"):
            text = line[len("text:"):].strip()
            if text.lower() != "none":
                _add_frontmatter_field(filepath, "ocr_text", text)
        elif line.startswith("tags:"):
            tags = line[len("tags:"):].strip()
            _add_frontmatter_field(filepath, "image_tags", tags)

    logger.info("Added vision metadata to %s", filepath)
