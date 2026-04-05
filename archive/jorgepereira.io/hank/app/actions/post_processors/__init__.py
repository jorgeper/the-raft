"""Post-processor registry.

After a memory is saved, post-processors run based on the content type.
Each processor can modify the saved file (e.g. add fetched URL title to frontmatter).

To add a new post-processor:
1. Create a file in this directory with an async function
2. Register it in POST_PROCESSORS below for the appropriate content type
"""

import logging

from app.actions.remember import MemoryMetadata

logger = logging.getLogger(__name__)


async def run_post_processors(filepath: str, metadata: MemoryMetadata) -> None:
    """Run all post-processors for the given content type.

    Args:
        filepath: Path to the saved markdown file.
        metadata: The memory's metadata (used to look up processors by type).
    """
    from app.actions.post_processors.url import fetch_url_title

    # Registry: content type → list of post-processor functions.
    # Each function signature: async def processor(filepath: str, metadata: MemoryMetadata) -> None
    POST_PROCESSORS: dict[str, list] = {
        "url": [fetch_url_title],
        "note": [],
    }

    processors = POST_PROCESSORS.get(metadata.content_type or "note", [])
    for processor in processors:
        try:
            await processor(filepath, metadata)
        except Exception as e:
            logger.error("Post-processor %s failed for %s: %s", processor.__name__, filepath, e)
