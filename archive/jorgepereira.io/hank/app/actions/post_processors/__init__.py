"""Post-processor registry.

After a memory is saved, post-processors run based on the content type.
The index post-processor runs for ALL types to keep the search index current.

To add a new post-processor:
1. Create a file in this directory with an async function
2. Register it in POST_PROCESSORS below for the appropriate content type
"""

import logging

from app.actions.remember import MemoryMetadata

logger = logging.getLogger(__name__)


async def run_post_processors(filepath: str, metadata: MemoryMetadata) -> None:
    """Run all post-processors for the given content type."""
    from app.actions.post_processors.url import fetch_url_title
    from app.actions.post_processors.image import describe_image
    from app.actions.post_processors.index import update_index

    # Registry: content type → list of post-processor functions.
    # Index runs for all types (appended after type-specific processors).
    TYPE_PROCESSORS: dict[str, list] = {
        "url": [fetch_url_title],
        "note": [],
        "image": [describe_image],
    }

    processors = TYPE_PROCESSORS.get(metadata.content_type or "note", [])
    # Always index after type-specific processing is done
    processors = processors + [update_index]

    for processor in processors:
        try:
            await processor(filepath, metadata)
        except Exception as e:
            logger.error("Post-processor %s failed for %s: %s", processor.__name__, filepath, e)
